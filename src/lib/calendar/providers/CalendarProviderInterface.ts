/**
 * External calendar event in a provider-agnostic format.
 * Uses iCal-like concepts for cross-calendar compatibility.
 */
export interface ExternalCalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  dtstart: string;       // ISO 8601
  dtend?: string;        // ISO 8601
  allDay?: boolean;
  rrule?: string;        // iCal RRULE string
  location?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  calendarId?: string;
  updated?: string;      // ISO 8601
  created?: string;      // ISO 8601
  htmlLink?: string;
}

export interface SyncResult {
  events: ExternalCalendarEvent[];
  nextSyncToken?: string;
  deleted?: string[];     // UIDs of deleted events
}

export type SyncDirection = "bidirectional" | "pull-only" | "push-only";
export type ConflictStrategy = "newest-wins" | "remote-wins" | "local-wins";

export interface ConnectionConfig {
  id: string;
  provider: string;
  enabled: boolean;
  credentials: Record<string, string>;
  settings: {
    direction: SyncDirection;
    calendars: string[];
    conflict_resolution: ConflictStrategy;
  };
  sync_state: {
    last_sync?: string;
    sync_token?: string;
    error?: string | null;
  };
}

/**
 * Abstract interface for calendar providers (Google, Outlook, etc.)
 */
export interface CalendarProvider {
  readonly id: string;
  readonly name: string;
  readonly icon: string;

  /** Check if provider is connected and tokens are valid */
  isConnected(config: ConnectionConfig): boolean;

  /** Generate the OAuth authorization URL */
  getAuthUrl(clientId: string, clientSecret: string, redirectPort: number): string;

  /** Exchange OAuth code for tokens */
  exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{ access_token: string; refresh_token: string; expiry_date: string }>;

  /** Refresh an expired access token */
  refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ access_token: string; expiry_date: string }>;

  /** List available calendars for the authenticated user */
  listCalendars(accessToken: string): Promise<{ id: string; name: string; primary: boolean }[]>;

  /** Fetch events within a date range */
  listEvents(
    accessToken: string,
    calendarId: string,
    from: string,
    to: string
  ): Promise<ExternalCalendarEvent[]>;

  /** Fetch changes since last sync */
  getChanges(
    accessToken: string,
    calendarId: string,
    syncToken?: string
  ): Promise<SyncResult>;

  /** Create an event on the remote calendar */
  createEvent(
    accessToken: string,
    calendarId: string,
    event: ExternalCalendarEvent
  ): Promise<string>; // returns remote event ID

  /** Update an event on the remote calendar */
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: Partial<ExternalCalendarEvent>
  ): Promise<void>;

  /** Delete an event from the remote calendar */
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<void>;
}
