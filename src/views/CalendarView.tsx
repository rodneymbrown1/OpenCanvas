
import { useState, useCallback } from "react";
import { CalendarDays } from "lucide-react";
import { useCalendar, type CalendarEvent } from "@/lib/CalendarContext";
import { CalendarGrid } from "./calendar/CalendarGrid";
import { CalendarToolbar } from "./calendar/CalendarToolbar";
import { CalendarEventForm } from "./calendar/CalendarEventForm";
import { CalendarEventPopover } from "./calendar/CalendarEventPopover";
import { CalendarSidebar } from "./calendar/CalendarSidebar";
import { GCalConnectionModal } from "./calendar/GCalConnectionModal";
import { useCalendarNav } from "./calendar/useCalendarNav";

export default function CalendarView() {
  const { events, loading, addEvent, deleteEvent, updateEvent, syncStatus, syncGoogleCalendar, pushToGoogle, removeFromGoogle } = useCalendar();
  const nav = useCalendarNav();

  const [showForm, setShowForm] = useState(false);
  const [formInitialStart, setFormInitialStart] = useState<string | undefined>();
  const [formInitialEnd, setFormInitialEnd] = useState<string | undefined>();
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>();
  const [popoverEvent, setPopoverEvent] = useState<CalendarEvent | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [showGCalModal, setShowGCalModal] = useState(false);

  const handleCreate = useCallback(
    async (event: Partial<CalendarEvent> & { title: string; startTime: string }) => {
      if (editingEvent) {
        // Editing existing event — update instead of create
        await updateEvent(editingEvent.id, event);
        setEditingEvent(undefined);
      } else {
        await addEvent(event);
      }
      setShowForm(false);
    },
    [addEvent, updateEvent, editingEvent]
  );

  const handleEdit = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setFormInitialStart(undefined);
    setFormInitialEnd(undefined);
    setShowForm(true);
    setPopoverEvent(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteEvent(id);
      setPopoverEvent(null);
    },
    [deleteEvent]
  );

  const handleComplete = useCallback(
    async (id: string) => {
      await updateEvent(id, { status: "completed" });
      setPopoverEvent(null);
    },
    [updateEvent]
  );

  const handleEventClick = useCallback((event: CalendarEvent, jsEvent: MouseEvent) => {
    setPopoverEvent(event);
    setPopoverPosition({ x: jsEvent.clientX, y: jsEvent.clientY });
  }, []);

  const handleDateSelect = useCallback((start: string, end: string) => {
    setFormInitialStart(start);
    setFormInitialEnd(end);
    setShowForm(true);
  }, []);

  const handleEventDrop = useCallback(
    async (eventId: string, newStart: string, newEnd?: string) => {
      const updates: Partial<CalendarEvent> = { startTime: newStart };
      if (newEnd) updates.endTime = newEnd;
      await updateEvent(eventId, updates);
    },
    [updateEvent]
  );

  const handleNewEvent = useCallback(() => {
    setEditingEvent(undefined);
    setFormInitialStart(undefined);
    setFormInitialEnd(undefined);
    setShowForm(true);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <CalendarDays size={20} className="animate-pulse mr-2" />
        Loading calendar...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <CalendarToolbar
        currentDate={nav.currentDate}
        viewType={nav.viewType}
        onViewChange={nav.setViewType}
        onPrev={nav.goPrev}
        onNext={nav.goNext}
        onToday={nav.goToToday}
        onNewEvent={handleNewEvent}
        eventCount={events.length}
        syncStatus={syncStatus}
        onSync={syncGoogleCalendar}
        onGCalClick={() => setShowGCalModal(true)}
      />

      <div className="flex flex-1 min-h-0">
        <CalendarGrid
          events={events}
          currentDate={nav.currentDate}
          viewType={nav.viewType}
          onDateChange={nav.setCurrentDate}
          onEventClick={handleEventClick}
          onDateSelect={handleDateSelect}
          onEventDrop={handleEventDrop}
          isEmpty={events.length === 0}
        />
        <CalendarSidebar events={events} />
      </div>

      {showForm && (
        <CalendarEventForm
          onSubmit={handleCreate}
          onCancel={() => { setShowForm(false); setEditingEvent(undefined); }}
          initialStart={formInitialStart}
          initialEnd={formInitialEnd}
          editEvent={editingEvent}
        />
      )}

      {popoverEvent && (
        <CalendarEventPopover
          event={popoverEvent}
          position={popoverPosition}
          onClose={() => setPopoverEvent(null)}
          onDelete={handleDelete}
          onComplete={handleComplete}
          onEdit={handleEdit}
          onPushToGoogle={pushToGoogle}
          onRemoveFromGoogle={removeFromGoogle}
          gcalAvailable={syncStatus.gcalAvailable}
        />
      )}

      {showGCalModal && (
        <GCalConnectionModal
          onClose={() => setShowGCalModal(false)}
          syncStatus={syncStatus}
          onSync={syncGoogleCalendar}
        />
      )}
    </div>
  );
}
