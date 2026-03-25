import {
  readEvents,
  addEvent as addLocalEvent,
  updateEvent as updateLocalEvent,
  deleteEvent as deleteLocalEvent,
  type CalendarEvent,
} from "../../calendarConfig.js";
import { getConnection, updateSyncState } from "../connections.js";
import { getProvider } from "../providers/index.js";
import type { ExternalCalendarEvent, ConnectionConfig } from "../providers/CalendarProviderInterface.js";

interface SyncReport {
  connectionId: string;
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

function externalToLocal(ext: ExternalCalendarEvent, connectionId: string): Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "status"> {
  return {
    title: ext.summary,
    description: ext.description,
    startTime: ext.dtstart,
    endTime: ext.dtend,
    allDay: ext.allDay,
    source: { agent: "user" },
    target: "user",
    googleCalendarId: `${connectionId}:${ext.uid}`,
    tags: ["synced"],
  };
}

function localToExternal(event: CalendarEvent): ExternalCalendarEvent {
  return {
    uid: event.googleCalendarId?.split(":")[1] || "",
    summary: event.title,
    description: event.description,
    dtstart: event.startTime,
    dtend: event.endTime,
    allDay: event.allDay,
    status: event.status === "cancelled" ? "cancelled" : "confirmed",
  };
}

async function ensureValidToken(connection: ConnectionConfig): Promise<string> {
  const provider = getProvider(connection.provider);
  if (!provider) throw new Error(`Provider ${connection.provider} not found`);

  const { access_token, refresh_token, token_expiry, client_id, client_secret } = connection.credentials;

  // Check if token is expired (with 5 min buffer)
  if (token_expiry && new Date(token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
    return access_token;
  }

  // Refresh token
  if (!refresh_token || !client_id || !client_secret) {
    throw new Error("Cannot refresh token: missing credentials");
  }

  const refreshed = await provider.refreshToken(refresh_token, client_id, client_secret);
  updateSyncState(connection.id, {});

  // Update connection with new token
  const { updateConnection } = await import("../connections.js");
  updateConnection(connection.id, {
    credentials: {
      ...connection.credentials,
      access_token: refreshed.access_token,
      token_expiry: refreshed.expiry_date,
    },
  });

  return refreshed.access_token;
}

/**
 * Sync a single calendar connection (bidirectional).
 */
export async function syncConnection(connectionId: string): Promise<SyncReport> {
  const report: SyncReport = {
    connectionId,
    pulled: 0,
    pushed: 0,
    deleted: 0,
    conflicts: 0,
    errors: [],
  };

  const connection = getConnection(connectionId);
  if (!connection) {
    report.errors.push("Connection not found");
    return report;
  }

  if (!connection.enabled) {
    report.errors.push("Connection is disabled");
    return report;
  }

  const provider = getProvider(connection.provider);
  if (!provider) {
    report.errors.push(`Provider ${connection.provider} not found`);
    return report;
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidToken(connection);
  } catch (err: any) {
    const msg = `Token error: ${err.message}`;
    report.errors.push(msg);
    updateSyncState(connectionId, { error: msg });
    return report;
  }

  const direction = connection.settings.direction;
  const conflictStrategy = connection.settings.conflict_resolution;

  // Pull phase
  if (direction !== "push-only") {
    for (const calId of connection.settings.calendars) {
      try {
        const changes = await provider.getChanges(
          accessToken,
          calId,
          connection.sync_state.sync_token
        );

        const localEvents = readEvents();

        // Handle new/updated remote events
        for (const ext of changes.events) {
          const externalRef = `${connectionId}:${ext.uid}`;
          const existing = localEvents.find((e) => e.googleCalendarId === externalRef);

          if (!existing) {
            // New remote event -> create locally
            addLocalEvent(externalToLocal(ext, connectionId));
            report.pulled++;
          } else {
            // Existing -> check conflict
            const remoteUpdated = ext.updated ? new Date(ext.updated).getTime() : 0;
            const localUpdated = new Date(existing.updatedAt).getTime();

            if (remoteUpdated > localUpdated || conflictStrategy === "remote-wins") {
              updateLocalEvent(existing.id, {
                title: ext.summary,
                description: ext.description,
                startTime: ext.dtstart,
                endTime: ext.dtend,
                allDay: ext.allDay,
              });
              report.pulled++;
            } else if (conflictStrategy === "newest-wins" && localUpdated > remoteUpdated) {
              report.conflicts++;
            }
          }
        }

        // Handle deleted remote events
        for (const deletedUid of changes.deleted || []) {
          const externalRef = `${connectionId}:${deletedUid}`;
          const existing = localEvents.find((e) => e.googleCalendarId === externalRef);
          if (existing) {
            deleteLocalEvent(existing.id);
            report.deleted++;
          }
        }

        // Update sync token
        if (changes.nextSyncToken) {
          updateSyncState(connectionId, { sync_token: changes.nextSyncToken });
        }
      } catch (err: any) {
        report.errors.push(`Pull error (${calId}): ${err.message}`);
      }
    }
  }

  // Push phase
  if (direction !== "pull-only") {
    const localEvents = readEvents();
    const lastSync = connection.sync_state.last_sync
      ? new Date(connection.sync_state.last_sync).getTime()
      : 0;

    // Find local events that need pushing
    const toPush = localEvents.filter((e) => {
      // Skip events that came from this connection (already synced)
      if (e.googleCalendarId?.startsWith(`${connectionId}:`)) {
        // But push if locally updated after last sync
        return new Date(e.updatedAt).getTime() > lastSync;
      }
      // Push events without external ID that were created after last sync
      if (!e.googleCalendarId) {
        return new Date(e.createdAt).getTime() > lastSync;
      }
      return false;
    });

    const targetCalendar = connection.settings.calendars[0] || "primary";

    for (const event of toPush) {
      try {
        const extEvent = localToExternal(event);

        if (event.googleCalendarId?.startsWith(`${connectionId}:`)) {
          // Update existing remote event
          const remoteId = event.googleCalendarId.split(":")[1];
          await provider.updateEvent(accessToken, targetCalendar, remoteId, extEvent);
        } else {
          // Create new remote event
          const remoteId = await provider.createEvent(accessToken, targetCalendar, extEvent);
          updateLocalEvent(event.id, {
            googleCalendarId: `${connectionId}:${remoteId}`,
          });
        }
        report.pushed++;
      } catch (err: any) {
        report.errors.push(`Push error (${event.title}): ${err.message}`);
      }
    }
  }

  // Update sync state
  updateSyncState(connectionId, {
    last_sync: new Date().toISOString(),
    error: report.errors.length > 0 ? report.errors.join("; ") : null,
  });

  return report;
}

/**
 * Push a single local event to a connected calendar.
 */
export async function pushEvent(connectionId: string, eventId: string): Promise<void> {
  const connection = getConnection(connectionId);
  if (!connection) throw new Error("Connection not found");

  const provider = getProvider(connection.provider);
  if (!provider) throw new Error(`Provider ${connection.provider} not found`);

  const localEvents = readEvents();
  const event = localEvents.find((e) => e.id === eventId);
  if (!event) throw new Error("Event not found");

  const accessToken = await ensureValidToken(connection);
  const targetCalendar = connection.settings.calendars[0] || "primary";
  const extEvent = localToExternal(event);

  if (event.googleCalendarId?.startsWith(`${connectionId}:`)) {
    const remoteId = event.googleCalendarId.split(":")[1];
    await provider.updateEvent(accessToken, targetCalendar, remoteId, extEvent);
  } else {
    const remoteId = await provider.createEvent(accessToken, targetCalendar, extEvent);
    updateLocalEvent(event.id, { googleCalendarId: `${connectionId}:${remoteId}` });
  }
}
