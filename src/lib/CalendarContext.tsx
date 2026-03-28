
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

// ── Context ──────────────────────────────────────────────────────────────────

interface CalendarContextType {
  events: CalendarEvent[];
  notifications: CalendarNotification[];
  loading: boolean;
  addEvent: (event: Partial<CalendarEvent> & { title: string; startTime: string }) => Promise<CalendarEvent | null>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<CalendarEvent | null>;
  deleteEvent: (id: string) => Promise<boolean>;
  dismissNotification: (id: string) => Promise<boolean>;
  fetchEventsByRange: (from: string, to: string) => Promise<CalendarEvent[]>;
  refresh: () => Promise<void>;
}

const CalendarContext = createContext<CalendarContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<CalendarNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) setEvents(data.events || []);
    } catch {
      // silent
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/notifications?unread=true");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) setNotifications(data.notifications || []);
    } catch {
      // silent
    }
  }, []);

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

    const eventsInterval = setInterval(fetchEvents, 30_000);
    const notifInterval = setInterval(fetchNotifications, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(eventsInterval);
      clearInterval(notifInterval);
    };
  }, [refresh, fetchEvents, fetchNotifications]);

  const addEvent = useCallback(
    async (event: Partial<CalendarEvent> & { title: string; startTime: string }) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", event }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        logger.context("Calendar: event created", { id: data.event?.id, title: event.title });
        await fetchEvents();
        return data.event as CalendarEvent;
      } catch {
        return null;
      }
    },
    [fetchEvents]
  );

  const updateEvent = useCallback(
    async (id: string, updates: Partial<CalendarEvent>) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", id, updates }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        logger.context("Calendar: event updated", { id });
        await fetchEvents();
        return data.event as CalendarEvent;
      } catch {
        return null;
      }
    },
    [fetchEvents]
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        if (!res.ok) return false;
        logger.context("Calendar: event deleted", { id });
        await fetchEvents();
        return true;
      } catch {
        return false;
      }
    },
    [fetchEvents]
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
        addEvent,
        updateEvent,
        deleteEvent,
        dismissNotification,
        fetchEventsByRange,
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
