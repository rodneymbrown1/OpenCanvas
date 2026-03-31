import { useRef, useEffect, useMemo, useCallback } from "react";
import { CalendarDays, Clock, Zap, CheckCircle2, XCircle, MinusCircle, Activity, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, DateSelectArg, EventDropArg } from "@fullcalendar/core";
import type { CalendarEvent } from "@/lib/CalendarContext";
import type { CalendarViewType } from "./useCalendarNav";
import "./calendar-theme.css";

const STATUS_COLORS: Record<string, string> = {
  pending: "#eab308",
  triggered: "#3b82f6",
  completed: "#22c55e",
  missed: "#ef4444",
  cancelled: "#6b7280",
  running: "#06b6d4",
  failed: "#f97316",
};

const STATUS_META: Record<string, { label: string; Icon: LucideIcon }> = {
  pending:   { label: "Pending",   Icon: Clock },
  triggered: { label: "Triggered", Icon: Zap },
  completed: { label: "Completed", Icon: CheckCircle2 },
  missed:    { label: "Missed",    Icon: XCircle },
  cancelled: { label: "Cancelled", Icon: MinusCircle },
  running:   { label: "Running",   Icon: Activity },
  failed:    { label: "Failed",    Icon: AlertCircle },
};

function StatusLegend() {
  return (
    <div className="px-3 py-2 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1">
      {Object.entries(STATUS_META).map(([key, { label, Icon }]) => (
        <span
          key={key}
          className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
          aria-label={`Status: ${label}`}
        >
          <Icon size={10} style={{ color: STATUS_COLORS[key] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

interface CalendarGridProps {
  events: CalendarEvent[];
  currentDate: Date;
  viewType: CalendarViewType;
  onDateChange: (date: Date) => void;
  onEventClick: (event: CalendarEvent, jsEvent: MouseEvent) => void;
  onDateSelect: (start: string, end: string) => void;
  onEventDrop: (eventId: string, newStart: string, newEnd?: string) => void;
  isEmpty?: boolean;
}

export function CalendarGrid({
  events,
  currentDate,
  viewType,
  onDateChange,
  onEventClick,
  onDateSelect,
  onEventDrop,
  isEmpty,
}: CalendarGridProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const programmaticNav = useRef(false);

  // Sync external nav state to FullCalendar (skip datesSet feedback loop)
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    programmaticNav.current = true;
    api.changeView(viewType);
    api.gotoDate(currentDate);
    // Reset flag after FullCalendar finishes its synchronous render cycle
    requestAnimationFrame(() => { programmaticNav.current = false; });
  }, [currentDate, viewType]);

  // Map CalendarEvent[] to FullCalendar EventInput[]
  const fcEvents = useMemo(
    () =>
      events.map((e) => {
        // Ensure startTime has a time component for timeGrid rendering.
        // Date-only strings (e.g. "2026-03-30") from Google Calendar are
        // treated as all-day by FullCalendar regardless of allDay flag.
        const startStr = e.startTime;
        const endStr = e.endTime || undefined;
        const isDateOnly = startStr && !startStr.includes("T");
        const isAllDay = !!(e.allDay || isDateOnly);

        return {
          id: e.id,
          title: e.title,
          start: startStr,
          end: endStr,
          allDay: isAllDay,
          backgroundColor: STATUS_COLORS[e.status] || STATUS_COLORS.pending,
          borderColor: STATUS_COLORS[e.status] || STATUS_COLORS.pending,
          textColor: "#fff",
          extendedProps: {
            status: e.status,
            target: e.target,
            source: e.source,
            description: e.description,
            action: e.action,
            recurrence: e.recurrence,
            googleCalendarId: e.googleCalendarId,
            tags: e.tags,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          },
        };
      }),
    [events]
  );

  const handleEventClick = (info: EventClickArg) => {
    const original = events.find((e) => e.id === info.event.id);
    if (original) {
      onEventClick(original, info.jsEvent);
    }
  };

  const handleDateSelect = (info: DateSelectArg) => {
    onDateSelect(info.startStr, info.endStr);
  };

  // Sync FullCalendar's date range back to nav state — skip programmatic changes
  const lastMidpoint = useRef(0);
  const handleDatesSet = useCallback(
    (info: { start: Date; end: Date }) => {
      if (programmaticNav.current) return;
      const mid = (info.start.getTime() + info.end.getTime()) / 2;
      // Only update if midpoint changed by > 1 hour (avoids micro-drift loops)
      if (Math.abs(mid - lastMidpoint.current) < 3_600_000) return;
      lastMidpoint.current = mid;
      onDateChange(new Date(mid));
    },
    [onDateChange]
  );

  const handleEventDrop = (info: EventDropArg | { event: { id: string; start: Date | null; end: Date | null } }) => {
    const newStart = info.event.start?.toISOString();
    const newEnd = info.event.end?.toISOString();
    if (newStart) {
      onEventDrop(info.event.id, newStart, newEnd);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-3 relative">
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center space-y-1.5 opacity-40">
            <CalendarDays size={32} className="mx-auto text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">No events yet.</p>
            <p className="text-xs text-[var(--text-muted)]">Click a date to create one.</p>
          </div>
        </div>
      )}
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={viewType}
        initialDate={currentDate}
        events={fcEvents}
        editable
        selectable
        selectMirror
        nowIndicator
        height="100%"
        /* Month view: collapse at 3 events per cell with "+more" link.
           Week/Day timeGrid views: show all events (Infinity). */
        dayMaxEvents={3}
        views={{
          timeGridWeek: { dayMaxEvents: false },
          timeGridDay: { dayMaxEvents: false },
        }}
        /* Default duration for events without an endTime in timeGrid views */
        defaultTimedEventDuration="01:00:00"
        /* Show events that span from midnight with minimal height */
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="08:00:00"
        eventClick={handleEventClick}
        select={handleDateSelect}
        eventDrop={handleEventDrop}
        datesSet={handleDatesSet}
        /* Allow resizing events in timeGrid views */
        eventResize={handleEventDrop as any}
        eventDidMount={(info) => {
          // Add data attributes for CSS-based status styling
          const status = info.event.extendedProps.status;
          if (status) {
            info.el.setAttribute("data-status", status);
            const statusLabel = STATUS_META[status]?.label ?? status;
            info.el.setAttribute("title", `${info.event.title} — ${statusLabel}`);
          }
          if (info.event.extendedProps.googleCalendarId) {
            info.el.setAttribute("data-external", "true");
          }
        }}
      />
      <StatusLegend />
    </div>
  );
}
