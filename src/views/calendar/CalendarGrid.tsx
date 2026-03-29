import { useRef, useEffect, useMemo, useCallback } from "react";
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
};

interface CalendarGridProps {
  events: CalendarEvent[];
  currentDate: Date;
  viewType: CalendarViewType;
  onDateChange: (date: Date) => void;
  onEventClick: (event: CalendarEvent, jsEvent: MouseEvent) => void;
  onDateSelect: (start: string, end: string) => void;
  onEventDrop: (eventId: string, newStart: string, newEnd?: string) => void;
}

export function CalendarGrid({
  events,
  currentDate,
  viewType,
  onDateChange,
  onEventClick,
  onDateSelect,
  onEventDrop,
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
      events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.startTime,
        end: e.endTime || undefined,
        allDay: e.allDay || false,
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
      })),
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

  const handleEventDrop = (info: EventDropArg) => {
    const newStart = info.event.start?.toISOString();
    const newEnd = info.event.end?.toISOString();
    if (newStart) {
      onEventDrop(info.event.id, newStart, newEnd);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-3">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={viewType}
        initialDate={currentDate}
        events={fcEvents}
        editable
        selectable
        selectMirror
        dayMaxEvents={3}
        nowIndicator
        height="100%"
        eventClick={handleEventClick}
        select={handleDateSelect}
        eventDrop={handleEventDrop}
        datesSet={handleDatesSet}
        eventDidMount={(info) => {
          // Add data attributes for CSS-based status styling
          const status = info.event.extendedProps.status;
          if (status) {
            info.el.setAttribute("data-status", status);
          }
          if (info.event.extendedProps.googleCalendarId) {
            info.el.setAttribute("data-external", "true");
          }
        }}
      />
    </div>
  );
}
