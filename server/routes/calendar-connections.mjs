// server/routes/calendar-connections.mjs — Calendar connection & sync API routes
//
// Architecture: Google Calendar tools (gcal_*) are Claude.ai built-in integrations,
// NOT MCP servers that can be spawned via CLI. The server provides:
//   - /api/calendar/gcal-import  — accepts pre-fetched events from Claude Code
//   - /api/calendar/gcal-connect — lightweight connection registration (no agent spawn)
//   - /api/calendar/mcp-status   — reads cached connection state from connections.yaml
// Actual Google Calendar API calls happen through Claude Code's MCP tools.

import { execFile } from "child_process";
import path from "node:path";
import { triggerAgentSession } from "../cron-scheduler.mjs";
import {
  listConnections,
  addConnection,
  removeConnection,
  updateConnection,
} from "../../src/lib/calendar/connections.js";
import { listProviders } from "../../src/lib/calendar/providers/index.js";
import { log, logError } from "../logger.mjs";
import {
  readEvents,
  addEvent as addCalendarEvent,
  updateEvent as updateCalendarEvent,
  getEventById,
  deleteEvent as deleteCalendarEvent,
  CALENDAR_DIR,
} from "../../src/lib/calendarConfig.js";

const CAT = "calendar";
const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");

// ── Auto-sync helpers ──────────────────────────────────────────────────────────

const GCAL_AUTO_SYNC_TAG = "gcal-auto-sync";

const AUTO_SYNC_INTERVALS = {
  "30min": "*/30 * * * *",
  "1h":    "0 * * * *",
  "2h":    "0 */2 * * *",
  "6h":    "0 */6 * * *",
  "12h":   "0 */12 * * *",
  "24h":   "0 0 * * *",
};

function findAutoSyncEvent() {
  return readEvents().find(
    (e) => e.tags?.includes(GCAL_AUTO_SYNC_TAG) && e.status !== "cancelled"
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (e) { reject(e); }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Find an existing MCP-based connection for a given agent (or any agent).
 */
function findMcpConnection(agent) {
  const all = listConnections();
  if (agent) {
    return all.find(
      (c) => c.credentials?.auth_method === "mcp" && c.credentials?.agent === agent && c.enabled
    );
  }
  // Any MCP connection
  return all.find((c) => c.credentials?.auth_method === "mcp" && c.enabled);
}

/**
 * Normalize a datetime value from Google Calendar events.
 * Handles: ISO strings, date-only strings, {dateTime: "..."}, {date: "..."}
 */
function normalizeDateTime(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      logError(CAT, `normalizeDateTime: unparseable string "${value}"`);
      return null;
    }
    return value;
  }
  if (typeof value === "object") {
    if (value.dateTime) return value.dateTime;
    if (value.date) return value.date;
    if (value.toISOString) return value.toISOString();
    logError(CAT, `normalizeDateTime: unknown format: ${JSON.stringify(value).slice(0, 100)}`);
  }
  return null;
}

/**
 * Upsert an array of Google Calendar events into local calendar.yaml.
 * If `window` is provided ({ timeMin, timeMax } as ISO strings), local events
 * in that range whose googleCalendarId is absent from the incoming set are
 * soft-deleted (status → "cancelled") to mirror deletions made in Google.
 * Returns { pulled, updated, deleted, errors[], total }.
 */
function upsertGoogleEvents(remoteEvents, window = null) {
  const localEvents = readEvents();
  let pulled = 0;
  let updated = 0;
  let deleted = 0;
  const errors = [];
  const seenRefs = new Set();

  for (const remote of remoteEvents) {
    try {
      const remoteId = remote.id || remote.eventId || remote.uid;
      const title = remote.summary || remote.title || "(No title)";
      const description = remote.description || "";

      let startTime = normalizeDateTime(remote.start || remote.startTime || remote.dtstart);
      let endTime = normalizeDateTime(remote.end || remote.endTime || remote.dtend);
      const allDay = remote.allDay === true || remote.all_day === true ||
        (startTime && !startTime.includes("T"));

      if (!remoteId) {
        logError(CAT, `gcal-import: skipping event with no ID: ${JSON.stringify(remote).slice(0, 200)}`);
        continue;
      }
      if (!startTime) {
        logError(CAT, `gcal-import: skipping "${title}" — no start time: ${JSON.stringify(remote).slice(0, 200)}`);
        continue;
      }

      log(CAT, `gcal-import: "${title}" id=${remoteId} start=${startTime} allDay=${allDay}`);

      const externalRef = `mcp:${remoteId}`;
      seenRefs.add(externalRef);
      const existing = localEvents.find((e) => e.googleCalendarId === externalRef);

      if (existing) {
        updateCalendarEvent(existing.id, {
          title,
          description: description || existing.description,
          startTime,
          endTime: endTime || existing.endTime,
          allDay,
        });
        updated++;
      } else {
        addCalendarEvent({
          title,
          description: description || undefined,
          startTime,
          endTime: endTime || undefined,
          allDay,
          source: { agent: "user" },
          target: "user",
          status: "pending",
          googleCalendarId: externalRef,
          tags: ["synced", "google-calendar"],
        });
        pulled++;
      }
    } catch (eventErr) {
      const errMsg = `"${remote.summary || remote.title || "?"}": ${eventErr.message}`;
      errors.push(errMsg);
      logError(CAT, `gcal-import event error: ${errMsg}`);
    }
  }

  // Soft-delete local events that were removed from Google Calendar.
  // Only runs when the caller provides the time window that was queried.
  if (window?.timeMin && window?.timeMax) {
    const windowStart = new Date(window.timeMin).getTime();
    const windowEnd   = new Date(window.timeMax).getTime();
    // Re-read after upserts so we see the freshest state
    const freshLocal = readEvents();
    for (const local of freshLocal) {
      if (!local.googleCalendarId?.startsWith("mcp:")) continue;
      if (local.status === "cancelled") continue;
      if (seenRefs.has(local.googleCalendarId)) continue;
      const evStart = local.startTime ? new Date(local.startTime).getTime() : null;
      if (evStart === null || evStart < windowStart || evStart > windowEnd) continue;
      updateCalendarEvent(local.id, { status: "cancelled" });
      log(CAT, `gcal-import: soft-deleted "${local.title}" (${local.googleCalendarId}) — absent from Google response`);
      deleted++;
    }
  }

  log(CAT, `gcal-import complete: ${pulled} new, ${updated} updated, ${deleted} deleted, ${errors.length} errors / ${remoteEvents.length} total`);
  return { pulled, updated, deleted, errors, total: remoteEvents.length };
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/calendar/connections ──────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "GET") {
    const connections = listConnections();
    const safe = connections.map((c) => ({
      ...c,
      credentials: {
        has_access_token: !!c.credentials?.access_token,
        has_refresh_token: !!c.credentials?.refresh_token,
        token_expiry: c.credentials?.token_expiry,
        auth_method: c.credentials?.auth_method || "mcp",
        agent: c.credentials?.agent,
        last_verified: c.credentials?.last_verified,
        user_email: c.credentials?.user_email,
        calendar_count: c.credentials?.calendar_count,
        calendars_json: c.credentials?.calendars_json,
      },
    }));
    jsonResponse(res, { connections: safe, providers: listProviders().map((p) => ({ id: p.id, name: p.name })) });
    return true;
  }

  // ── GET /api/calendar/mcp-status ──────────────────────────────────────
  // Pure cache read from connections.yaml — never spawns agents.
  if (pathname === "/api/calendar/mcp-status" && method === "GET") {
    const agent = url.searchParams.get("agent") || null;

    const conn = findMcpConnection(agent);
    if (conn) {
      let calendars = [];
      try { calendars = conn.credentials?.calendars_json ? JSON.parse(conn.credentials.calendars_json) : []; } catch {}
      jsonResponse(res, {
        available: true,
        calendars,
        userEmail: conn.credentials?.user_email || null,
        lastVerified: conn.credentials?.last_verified || null,
        lastSync: conn.sync_state?.last_sync || null,
        error: conn.sync_state?.error || null,
        agent: conn.credentials?.agent || "claude",
        connectionId: conn.id,
        calendarDir: CALENDAR_DIR,
      });
    } else {
      jsonResponse(res, {
        available: false,
        calendars: [],
        userEmail: null,
        error: null,
        agent: agent || "claude",
        calendarDir: CALENDAR_DIR,
      });
    }
    return true;
  }

  // ── POST /api/calendar/gcal-import ────────────────────────────────────
  // Core sync endpoint. Accepts pre-fetched Google Calendar events and
  // upserts them into calendar.yaml. Called by Claude Code after it
  // fetches events via mcp__claude_ai_Google_Calendar__gcal_list_events.
  if (pathname === "/api/calendar/gcal-import" && method === "POST") {
    const body = await parseBody(req);
    log(CAT, `gcal-import: received request with ${body.events?.length ?? 0} events`);

    if (!body.events || !Array.isArray(body.events)) {
      logError(CAT, `gcal-import: invalid body — events field missing or not array`);
      jsonResponse(res, { error: "events array required" }, 400);
      return true;
    }

    if (body.events.length === 0) {
      jsonResponse(res, { pulled: 0, updated: 0, deleted: 0, errors: [], total: 0 });
      return true;
    }

    // Log first event for debugging
    log(CAT, `gcal-import: first event sample: ${JSON.stringify(body.events[0]).slice(0, 500)}`);

    const window = (body.timeMin && body.timeMax)
      ? { timeMin: body.timeMin, timeMax: body.timeMax }
      : null;
    const result = upsertGoogleEvents(body.events, window);

    // Update connection sync state if we have one
    const conn = findMcpConnection(body.agent || null);
    if (conn) {
      updateConnection(conn.id, {
        credentials: {
          ...conn.credentials,
          last_verified: new Date().toISOString(),
        },
        sync_state: {
          last_sync: new Date().toISOString(),
          error: result.errors.length ? result.errors[0] : null,
        },
      });
    }

    jsonResponse(res, result);
    return true;
  }

  // ── POST /api/calendar/gcal-connect ───────────────────────────────────
  // Register a Google Calendar connection. Called by Claude Code or the
  // GCalConnectionModal after verifying access via MCP tools.
  // Accepts: { agent, userEmail, calendars: [{id, summary, primary}] }
  if (pathname === "/api/calendar/gcal-connect" && method === "POST") {
    const body = await parseBody(req);
    const agent = body.agent || "claude";
    const calendars = body.calendars || [];
    const userEmail = body.userEmail || "";

    log(CAT, `gcal-connect: agent=${agent} email=${userEmail} calendars=${calendars.length}`);

    const credentialData = {
      auth_method: "mcp",
      agent,
      user_email: userEmail,
      calendar_count: String(calendars.length),
      calendars_json: JSON.stringify(calendars),
      last_verified: new Date().toISOString(),
      access_token: "mcp-managed",
      refresh_token: "mcp-managed",
    };

    const existing = findMcpConnection(agent);
    if (existing) {
      updateConnection(existing.id, { credentials: credentialData, enabled: true });
      log(CAT, `gcal-connect: updated connection ${existing.id}`);
      jsonResponse(res, { connectionId: existing.id, action: "updated" });
    } else {
      const conn = addConnection("google", credentialData, {
        direction: "bidirectional",
        calendars: ["primary"],
        conflict_resolution: "newest-wins",
      });
      log(CAT, `gcal-connect: created connection ${conn.id}`);
      jsonResponse(res, { connectionId: conn.id, action: "created" });
    }
    return true;
  }

  // ── POST /api/calendar/gcal-export ────────────────────────────────────
  // Returns a local event formatted for Google Calendar API.
  // Claude Code can use this to push events via MCP tools.
  if (pathname === "/api/calendar/gcal-export" && method === "POST") {
    const body = await parseBody(req);
    const { eventId } = body;

    if (!eventId) {
      jsonResponse(res, { error: "eventId required" }, 400);
      return true;
    }

    const event = getEventById(eventId);
    if (!event) {
      jsonResponse(res, { error: "Event not found" }, 404);
      return true;
    }

    // Format for Google Calendar API
    const gcalEvent = {
      summary: event.title,
      description: event.description || "",
    };

    if (event.allDay) {
      const dateStr = event.startTime.split("T")[0];
      gcalEvent.start = { date: dateStr };
      gcalEvent.end = event.endTime
        ? { date: event.endTime.split("T")[0] }
        : { date: dateStr };
    } else {
      gcalEvent.start = { dateTime: event.startTime };
      gcalEvent.end = event.endTime
        ? { dateTime: event.endTime }
        : { dateTime: event.startTime };
    }

    jsonResponse(res, {
      event: gcalEvent,
      localId: event.id,
      googleCalendarId: event.googleCalendarId || null,
    });
    return true;
  }

  // ── POST /api/calendar/gcal-link ──────────────────────────────────────
  // After Claude Code pushes an event to Google Calendar, call this to
  // store the Google Calendar ID on the local event.
  if (pathname === "/api/calendar/gcal-link" && method === "POST") {
    const body = await parseBody(req);
    const { localEventId, googleEventId } = body;

    if (!localEventId || !googleEventId) {
      jsonResponse(res, { error: "localEventId and googleEventId required" }, 400);
      return true;
    }

    const gcalId = googleEventId.startsWith("mcp:") ? googleEventId : `mcp:${googleEventId}`;
    const updated = updateCalendarEvent(localEventId, { googleCalendarId: gcalId });
    if (!updated) {
      jsonResponse(res, { error: "Event not found" }, 404);
      return true;
    }

    log(CAT, `gcal-link: ${localEventId} → ${gcalId}`);
    jsonResponse(res, { linked: true, googleCalendarId: gcalId });
    return true;
  }

  // ── POST /api/calendar/mcp-connect (legacy SSE pipeline) ──────────────
  // Simplified: just checks CLI exists and creates connection record.
  // No longer spawns agents to test calendar access.
  if (pathname === "/api/calendar/mcp-connect" && method === "POST") {
    const body = await parseBody(req);
    const agent = body.agent || "claude";
    const AGENT_LABELS = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
    const label = AGENT_LABELS[agent] || agent;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendStep = (step, status, detail) => {
      try { res.write(`data: ${JSON.stringify({ type: "step", step, status, detail })}\n\n`); } catch {}
    };
    const sendEvent = (type, data) => {
      try { res.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch {}
    };

    // Step 1: Check agent CLI
    sendStep(1, "running", `Checking ${label} CLI...`);
    const agentPath = await new Promise((resolve) => {
      execFile("which", [agent], { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
    });

    if (!agentPath) {
      sendStep(1, "failed", `${label} CLI not found in PATH.`);
      sendEvent("fix", {
        step: 1,
        message: `Install ${label} CLI first.`,
        command: agent === "claude" ? "npm install -g @anthropic-ai/claude-code" : `npm install -g @${agent === "codex" ? "openai/codex" : "google/gemini-cli"}`,
      });
      res.end();
      return true;
    }
    sendStep(1, "passed", `${label} CLI found at ${agentPath}`);

    // Step 2: Check for existing connection
    sendStep(2, "running", "Checking connection status...");
    const existing = findMcpConnection(agent);
    if (existing) {
      sendStep(2, "passed", "Existing connection found.");
      sendStep(3, "passed", `Connected as ${existing.credentials?.user_email || agent}`);
      sendEvent("done", { success: true, agent, connectionId: existing.id });
      res.end();
      return true;
    }

    // Step 2 continued: No existing connection — guide user
    sendStep(2, "passed", `${label} CLI is available.`);
    sendStep(3, "running", "Ready for Google Calendar access...");

    // Create a pending connection record
    const conn = addConnection("google", {
      auth_method: "mcp",
      agent,
      user_email: "",
      calendar_count: "0",
      calendars_json: "[]",
      last_verified: null,
      access_token: "mcp-managed",
      refresh_token: "mcp-managed",
    }, {
      direction: "bidirectional",
      calendars: ["primary"],
      conflict_resolution: "newest-wins",
    });

    sendStep(3, "passed", `Connection registered. Ask Claude to sync your Google Calendar.`);
    sendStep(4, "passed", "Setup complete! Use 'Sync Now' to pull events via Claude.");
    sendEvent("done", { success: true, agent, connectionId: conn.id, needsSync: true });

    res.end();
    return true;
  }

  // ── GET /api/calendar/auto-sync ───────────────────────────────────────
  // Returns the current auto-sync recurring event status.
  if (pathname === "/api/calendar/auto-sync" && method === "GET") {
    const ev = findAutoSyncEvent();
    if (!ev) {
      jsonResponse(res, { enabled: false, eventId: null, interval: "1h", recurrence: null });
    } else {
      // Reverse-lookup the interval key from the cron expression
      const intervalKey = Object.entries(AUTO_SYNC_INTERVALS).find(
        ([, cron]) => cron === ev.recurrence
      )?.[0] || "1h";
      jsonResponse(res, {
        enabled: true,
        eventId: ev.id,
        interval: intervalKey,
        recurrence: ev.recurrence,
        status: ev.status,
        lastRun: ev.execution?.endedAt || null,
      });
    }
    return true;
  }

  // ── POST /api/calendar/auto-sync ──────────────────────────────────────
  // Create or update the auto-sync recurring event.
  // Body: { interval: "1h" | "2h" | "6h" | "12h" | "24h" | "30min" }
  if (pathname === "/api/calendar/auto-sync" && method === "POST") {
    const body = await parseBody(req);
    const interval = body.interval || "1h";
    const recurrence = AUTO_SYNC_INTERVALS[interval] || AUTO_SYNC_INTERVALS["1h"];

    const existing = findAutoSyncEvent();
    if (existing) {
      updateCalendarEvent(existing.id, { recurrence, status: "pending" });
      log(CAT, `auto-sync: updated interval to ${interval} (${recurrence})`);
      jsonResponse(res, { enabled: true, eventId: existing.id, interval, recurrence });
    } else {
      const ev = addCalendarEvent({
        title: "Google Calendar Auto-Sync",
        description: "Automatically syncs Google Calendar events to Open Canvas via Claude.",
        startTime: new Date().toISOString(),
        recurrence,
        source: { agent: "user" },
        target: "agent",
        action: {
          type: "prompt",
          payload:
            "Sync my Google Calendar to Open Canvas. List events for the next 14 days from all accessible calendars and import them.",
          agent: "claude",
        },
        status: "pending",
        tags: ["auto-sync", GCAL_AUTO_SYNC_TAG],
      });
      log(CAT, `auto-sync: created event ${ev.id} interval=${interval} (${recurrence})`);
      jsonResponse(res, { enabled: true, eventId: ev.id, interval, recurrence });
    }
    return true;
  }

  // ── DELETE /api/calendar/auto-sync ────────────────────────────────────
  // Remove the auto-sync recurring event.
  if (pathname === "/api/calendar/auto-sync" && method === "DELETE") {
    const ev = findAutoSyncEvent();
    if (ev) {
      deleteCalendarEvent(ev.id);
      log(CAT, `auto-sync: removed event ${ev.id}`);
      jsonResponse(res, { removed: true });
    } else {
      jsonResponse(res, { removed: false });
    }
    return true;
  }

  // ── POST /api/calendar/connections ─────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "POST") {
    const body = await parseBody(req);

    if (body.action === "update") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      const updated = updateConnection(body.connectionId, body.updates || {});
      if (!updated) {
        jsonResponse(res, { error: "Connection not found" }, 404);
        return true;
      }
      jsonResponse(res, { connection: updated });
      return true;
    }

    if (body.action === "remove") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      const removed = removeConnection(body.connectionId);
      jsonResponse(res, { removed });
      return true;
    }

    jsonResponse(res, { error: "action required (update|remove)" }, 400);
    return true;
  }

  // ── POST /api/calendar/gcal-push ──────────────────────────────────────
  // Spawns a Claude Code agent session that calls gcal_create_event (or
  // gcal_update_event for existing synced events) and then POST
  // /api/calendar/gcal-link to persist the returned Google event ID.
  if (pathname === "/api/calendar/gcal-push" && method === "POST") {
    const body = await parseBody(req);
    const { eventId } = body;

    if (!eventId) {
      jsonResponse(res, { error: "eventId required" }, 400);
      return true;
    }

    const event = getEventById(eventId);
    if (!event) {
      jsonResponse(res, { error: "Event not found" }, 404);
      return true;
    }

    // Resolve the target Google Calendar ID from the connection record
    const conn = findMcpConnection(body.agent || null);
    if (!conn) {
      jsonResponse(res, { error: "No Google Calendar connection found. Connect Google Calendar first." }, 400);
      return true;
    }

    let calendarId = "primary";
    try {
      const calendars = JSON.parse(conn.credentials?.calendars_json || "[]");
      const primary = calendars.find((c) => c.primary);
      if (primary?.id) calendarId = primary.id;
    } catch {}

    const agent = conn.credentials?.agent || "claude";

    // Build a precise prompt so Claude calls the right MCP tool and links back
    const isUpdate = event.googleCalendarId?.startsWith("mcp:");
    const remoteEventId = isUpdate ? event.googleCalendarId.split(":")[1] : null;

    const toolCall = isUpdate
      ? `gcal_update_event with calendarId="${calendarId}", eventId="${remoteEventId}"`
      : `gcal_create_event with calendarId="${calendarId}"`;

    const eventFields = [
      `summary: "${event.title.replace(/"/g, '\\"')}"`,
      event.description ? `description: "${event.description.replace(/"/g, '\\"')}"` : null,
      event.allDay
        ? `start: {date: "${event.startTime.split("T")[0]}"}, end: {date: "${(event.endTime || event.startTime).split("T")[0]}"}`
        : `start: {dateTime: "${event.startTime}"}, end: {dateTime: "${event.endTime || event.startTime}"}`,
    ].filter(Boolean).join(", ");

    const linkBack = isUpdate
      ? `(already linked — no gcal-link call needed)`
      : `Then immediately POST http://localhost:3001/api/calendar/gcal-link with body: {"localEventId":"${eventId}","googleEventId":"<id from the MCP response>"}`;

    const prompt = [
      `Push an Open Canvas calendar event to Google Calendar.`,
      ``,
      `Step 1: Call ${toolCall} with these fields: ${eventFields}`,
      `Step 2: ${linkBack}`,
      `Step 3: Reply "Push complete: <googleEventId>" or describe any error.`,
      ``,
      `Do not ask questions. Execute all steps now.`,
    ].join("\n");

    try {
      triggerAgentSession({ agent, cwd: OC_HOME, prompt });
      log(CAT, `gcal-push: agent session queued for event ${eventId} (${isUpdate ? "update" : "create"})`);
      jsonResponse(res, { queued: true, eventId, agent, operation: isUpdate ? "update" : "create" });
    } catch (err) {
      logError(CAT, `gcal-push: failed to spawn session: ${err.message}`);
      jsonResponse(res, { error: `Could not start push session: ${err.message}` }, 503);
    }
    return true;
  }

  return false;
}
