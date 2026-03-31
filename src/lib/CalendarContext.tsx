
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { logger } from "@/lib/logger";
import { useToast } from "@/lib/ToastContext";

// ── Types (client-safe mirrors of calendarConfig types) ──────────────────────

export type AgentType = "claude" | "codex" | "gemini" | "user";
export type EventTarget = "agent" | "user" | "both";
export type ActionType = "prompt" | "command" | "reminder";
export type EventStatus = "pending" | "running" | "triggered" | "completed" | "failed" | "missed" | "cancelled";

export interface EventAction {
  type: ActionType;
  payload: string;
  projectPath?: string;
  agent?: string;
}

export interface EventSource {
  agent: AgentType;
  projectPath?: string;
  sessionId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime?: string;
  allDay?: boolean;
  recurrence?: string;
  source: EventSource;
  target: EventTarget;
  action?: EventAction;
  status: EventStatus;
  googleCalendarId?: string;
  tags?: string[];
  execution?: ExecutionRecord;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  durationMs?: number;
  outputSummary?: string;
  error?: string;
}

export interface CalendarNotification {
  id: string;
  eventId: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

// ── Sync types ──────────────────────────────────────────────────────────────

export interface SyncStatus {
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
  gcalAvailable: boolean;
  pulled: number;
  updated: number;
}

// ── Context ──────────────────────────────────────────────────────────────────

interface CalendarContextType {
  events: CalendarEvent[];
  notifications: CalendarNotification[];
  loading: boolean;
  syncStatus: SyncStatus;
  addEvent: (event: Partial<CalendarEvent> & { title: string; startTime: string }) => Promise<CalendarEvent | null>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<CalendarEvent | null>;
  deleteEvent: (id: string) => Promise<boolean>;
  dismissNotification: (id: string) => Promise<boolean>;
  fetchEventsByRange: (from: string, to: string) => Promise<CalendarEvent[]>;
  syncGoogleCalendar: () => Promise<void>;
  pushToGoogle: (eventId: string) => Promise<boolean>;
  removeFromGoogle: (eventId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const CalendarContext = createContext<CalendarContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<CalendarNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSync: null,
    syncing: false,
    error: null,
    gcalAvailable: false,
    pulled: 0,
    updated: 0,
  });
  const mountedRef = useRef(true);
  const syncInProgressRef = useRef(false);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) setEvents(data.events || []);
    } catch (err) {
      logger.error("calendar", "fetchEvents failed", err);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/notifications?unread=true");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) setNotifications(data.notifications || []);
    } catch (err) {
      logger.error("calendar", "fetchNotifications failed", err);
    }
  }, []);

  // Check Google Calendar connection status (fast-path: uses cached connection)
  const checkGcalStatus = useCallback(async (): Promise<boolean> => {
    try {
      const statusRes = await fetch("/api/calendar/mcp-status");
      if (!statusRes.ok) {
        if (mountedRef.current) setSyncStatus((s) => ({ ...s, gcalAvailable: false }));
        return false;
      }
      const statusData = await statusRes.json();
      logger.calendar("GCal status check:", statusData.available ? "available" : "not available", statusData.cached ? "(cached)" : "(live)");
      if (mountedRef.current) setSyncStatus((s) => ({ ...s, gcalAvailable: statusData.available }));
      return statusData.available;
    } catch {
      if (mountedRef.current) setSyncStatus((s) => ({ ...s, gcalAvailable: false }));
      return false;
    }
  }, []);

  // Refresh sync status from server (reads last_sync from connection record)
  const syncGoogleCalendar = useCallback(async () => {
    // This no longer spawns agents or calls mcp-sync.
    // It just refreshes the status from connections.yaml and re-fetches events.
    // Actual sync happens when user asks Claude to pull events (via gcal-import).
    await checkGcalStatus();
    await fetchEvents();
  }, [checkGcalStatus, fetchEvents]);

  // Push a local event to Google Calendar (via Claude Code — not directly from browser)
  const pushToGoogle = useCallback(async (eventId: string): Promise<boolean> => {
    // Server can't push to Google directly. This is a no-op placeholder.
    // Claude Code calls gcal_create_event MCP tool then gcal-link endpoint.
    console.log("[OC:CALENDAR] pushToGoogle: ask Claude to push event", eventId);
    return false;
  }, []);

  // Remove a Google Calendar link from a local event
  const removeFromGoogle = useCallback(async (eventId: string): Promise<boolean> => {
    try {
      // Just unlink the local event — we can't delete from Google without MCP tools
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: eventId, updates: { googleCalendarId: null } }),
      });
      await fetchEvents();
      return true;
    } catch (err) {
      logger.error("calendar", "removeFromGoogle failed", err);
      toast("Failed to unlink from Google Calendar", { type: "error" });
      return false;
    }
  }, [fetchEvents, toast]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchEvents(), fetchNotifications()]);
  }, [fetchEvents, fetchNotifications]);

  // Initial load + polling
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    refresh().finally(() => {
      if (mountedRef.current) setLoading(false);
    });

    // Check GCal connection status (fast: reads connections.yaml, no agent spawn)
    checkGcalStatus();

    const eventsInterval = setInterval(fetchEvents, 30_000);
    const notifInterval = setInterval(fetchNotifications, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(eventsInterval);
      clearInterval(notifInterval);
    };
  }, [refresh, fetchEvents, fetchNotifications, checkGcalStatus]);

  const addEvent = useCallback(
    async (event: Partial<CalendarEvent> & { title: string; startTime: string }) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", event }),
        });
        if (!res.ok) { toast("Failed to create event", { type: "error" }); return null; }
        const data = await res.json();
        logger.context("Calendar: event created", { id: data.event?.id, title: event.title });
        await fetchEvents();
        return data.event as CalendarEvent;
      } catch (err) {
        logger.error("calendar", "addEvent failed", err);
        toast("Failed to create event", { type: "error" });
        return null;
      }
    },
    [fetchEvents, toast]
  );

  const updateEvent = useCallback(
    async (id: string, updates: Partial<CalendarEvent>) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", id, updates }),
        });
        if (!res.ok) { toast("Failed to update event", { type: "error" }); return null; }
        const data = await res.json();
        logger.context("Calendar: event updated", { id });
        await fetchEvents();
        return data.event as CalendarEvent;
      } catch (err) {
        logger.error("calendar", "updateEvent failed", err);
        toast("Failed to update event", { type: "error" });
        return null;
      }
    },
    [fetchEvents, toast]
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        if (!res.ok) { toast("Failed to delete event", { type: "error" }); return false; }
        logger.context("Calendar: event deleted", { id });
        await fetchEvents();
        return true;
      } catch (err) {
        logger.error("calendar", "deleteEvent failed", err);
        toast("Failed to delete event", { type: "error" });
        return false;
      }
    },
    [fetchEvents, toast]
  );

  const fetchEventsByRange = useCallback(
    async (from: string, to: string): Promise<CalendarEvent[]> => {
      try {
        const params = new URLSearchParams({ from, to, expand: "true" });
        const res = await fetch(`/api/calendar?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.events || [];
      } catch {
        return [];
      }
    },
    []
  );

  const dismissNotification = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/calendar/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss", id }),
        });
        if (!res.ok) return false;
        await fetchNotifications();
        return true;
      } catch {
        return false;
      }
    },
    [fetchNotifications]
  );

  return (
    <CalendarContext.Provider
      value={{
        events,
        notifications,
        loading,
        syncStatus,
        addEvent,
        updateEvent,
        deleteEvent,
        dismissNotification,
        fetchEventsByRange,
        syncGoogleCalendar,
        pushToGoogle,
        removeFromGoogle,
        refresh,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCalendar() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used within CalendarProvider");
  return ctx;
}
