import type {
  CalendarProvider,
  ConnectionConfig,
  ExternalCalendarEvent,
  SyncResult,
} from "./CalendarProviderInterface.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = "https://www.googleapis.com/auth/calendar";

async function googleFetch(url: string, accessToken: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 429) {
    // Rate limited - wait and retry once
    const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...((options.headers as Record<string, string>) || {}),
      },
    });
  }

  return res;
}

function toExternalEvent(item: any): ExternalCalendarEvent {
  const isAllDay = !!item.start?.date;
  return {
    uid: item.id,
    summary: item.summary || "(No title)",
    description: item.description || undefined,
    dtstart: isAllDay ? item.start.date : item.start?.dateTime || "",
    dtend: isAllDay ? item.end?.date : item.end?.dateTime || undefined,
    allDay: isAllDay,
    rrule: item.recurrence?.[0] || undefined,
    location: item.location || undefined,
    status: item.status === "tentative" ? "tentative" : item.status === "cancelled" ? "cancelled" : "confirmed",
    updated: item.updated,
    created: item.created,
    htmlLink: item.htmlLink,
  };
}

function toGoogleEvent(event: ExternalCalendarEvent | Partial<ExternalCalendarEvent>): any {
  const body: any = {};
  if (event.summary !== undefined) body.summary = event.summary;
  if (event.description !== undefined) body.description = event.description;
  if (event.location !== undefined) body.location = event.location;

  if (event.dtstart) {
    if (event.allDay) {
      body.start = { date: event.dtstart.split("T")[0] };
      body.end = { date: event.dtend ? event.dtend.split("T")[0] : event.dtstart.split("T")[0] };
    } else {
      body.start = { dateTime: event.dtstart, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      body.end = event.dtend
        ? { dateTime: event.dtend, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : body.start;
    }
  }

  return body;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google";
  readonly name = "Google Calendar";
  readonly icon = "calendar";

  isConnected(config: ConnectionConfig): boolean {
    const { access_token, refresh_token } = config.credentials;
    return !!(access_token && refresh_token);
  }

  getAuthUrl(clientId: string, _clientSecret: string, redirectPort: number): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `http://localhost:${redirectPort}/oauth/callback`,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const data = await res.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  }

  async refreshToken(refreshToken: string, clientId: string, clientSecret: string) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      throw new Error("Token refresh failed");
    }

    const data = await res.json();
    return {
      access_token: data.access_token,
      expiry_date: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  }

  async listCalendars(accessToken: string) {
    const res = await googleFetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, accessToken);
    if (!res.ok) throw new Error("Failed to list calendars");
    const data = await res.json();
    return (data.items || []).map((cal: any) => ({
      id: cal.id,
      name: cal.summary || cal.id,
      primary: cal.primary || false,
    }));
  }

  async listEvents(
    accessToken: string,
    calendarId: string,
    from: string,
    to: string
  ): Promise<ExternalCalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const res = await googleFetch(url, accessToken);
    if (!res.ok) throw new Error("Failed to list events");
    const data = await res.json();
    return (data.items || []).map(toExternalEvent);
  }

  async getChanges(
    accessToken: string,
    calendarId: string,
    syncToken?: string
  ): Promise<SyncResult> {
    const params = new URLSearchParams();
    if (syncToken) {
      params.set("syncToken", syncToken);
    } else {
      // Initial sync: get events from last 30 days
      params.set("timeMin", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    }
    params.set("maxResults", "250");

    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const res = await googleFetch(url, accessToken);

    if (res.status === 410) {
      // Sync token expired, do full sync
      return this.getChanges(accessToken, calendarId);
    }

    if (!res.ok) throw new Error("Failed to get changes");
    const data = await res.json();

    const events: ExternalCalendarEvent[] = [];
    const deleted: string[] = [];

    for (const item of data.items || []) {
      if (item.status === "cancelled") {
        deleted.push(item.id);
      } else {
        events.push(toExternalEvent(item));
      }
    }

    return {
      events,
      deleted,
      nextSyncToken: data.nextSyncToken,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: ExternalCalendarEvent
  ): Promise<string> {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await googleFetch(url, accessToken, {
      method: "POST",
      body: JSON.stringify(toGoogleEvent(event)),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create event: ${err}`);
    }

    const data = await res.json();
    return data.id;
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>
  ): Promise<void> {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const res = await googleFetch(url, accessToken, {
      method: "PATCH",
      body: JSON.stringify(toGoogleEvent(event)),
    });

    if (!res.ok) throw new Error("Failed to update event");
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<void> {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const res = await googleFetch(url, accessToken, { method: "DELETE" });
    if (!res.ok && res.status !== 410) throw new Error("Failed to delete event");
  }
}
