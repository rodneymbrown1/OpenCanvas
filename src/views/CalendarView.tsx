"use client";

import { useState } from "react";
import { useCalendar, type CalendarEvent } from "@/lib/CalendarContext";
import {
  CalendarDays,
  Clock,
  Plus,
  Trash2,
  Edit,
  CheckCircle,
  AlertTriangle,
  Bell,
  Terminal,
  User,
  Bot,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isFuture(iso: string): boolean {
  return new Date(iso).getTime() > Date.now();
}

function projectName(path?: string): string {
  if (!path) return "";
  return path.split("/").pop() || path;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "text-yellow-400",
  triggered: "text-blue-400",
  completed: "text-green-400",
  missed: "text-red-400",
  cancelled: "text-[var(--text-muted)]",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  triggered: Bell,
  completed: CheckCircle,
  missed: AlertTriangle,
  cancelled: X,
};

// ── Event Creation Form ──────────────────────────────────────────────────────

function EventForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (event: Partial<CalendarEvent> & { title: string; startTime: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [target, setTarget] = useState<"user" | "agent" | "both">("user");
  const [actionType, setActionType] = useState<"reminder" | "prompt" | "command">("reminder");
  const [actionPayload, setActionPayload] = useState("");
  const [actionProject, setActionProject] = useState("");
  const [recurrence, setRecurrence] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startTime) return;
    onSubmit({
      title,
      description: description || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: endTime ? new Date(endTime).toISOString() : undefined,
      allDay,
      target,
      recurrence: recurrence || undefined,
      source: { agent: "user" },
      action:
        actionPayload
          ? {
              type: actionType,
              payload: actionPayload,
              projectPath: actionProject || undefined,
            }
          : undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">New Event</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <X size={16} />
        </button>
      </div>

      <input
        type="text"
        placeholder="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        required
      />

      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none"
      />

      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="rounded"
          />
          All day
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">Start</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
            required
          />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">End</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-[var(--text-muted)] mb-1 block">
          Recurrence (cron expression, optional)
        </label>
        <input
          type="text"
          placeholder="e.g. 0 9 * * 1-5 (weekdays at 9am)"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-[var(--text-muted)] mb-1 block">For</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as "user" | "agent" | "both")}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            <option value="user">Me</option>
            <option value="agent">Agent</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-[var(--text-muted)] mb-1 block">Action Type</label>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as "reminder" | "prompt" | "command")}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            <option value="reminder">Reminder</option>
            <option value="prompt">Agent Prompt</option>
            <option value="command">Command</option>
          </select>
        </div>
      </div>

      {(actionType === "prompt" || actionType === "command") && (
        <>
          <input
            type="text"
            placeholder={
              actionType === "prompt" ? "Prompt to send to agent" : "Command to execute"
            }
            value={actionPayload}
            onChange={(e) => setActionPayload(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="Project path (optional)"
            value={actionProject}
            onChange={(e) => setActionProject(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </>
      )}

      {actionType === "reminder" && (
        <input
          type="text"
          placeholder="Reminder message"
          value={actionPayload}
          onChange={(e) => setActionPayload(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      )}

      <button
        type="submit"
        className="w-full py-2 text-sm font-medium rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
      >
        Create Event
      </button>
    </form>
  );
}

// ── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  onDelete,
  onComplete,
}: {
  event: CalendarEvent;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const StatusIcon = STATUS_ICONS[event.status] || Clock;
  const targetIcon =
    event.target === "agent" ? Bot : event.target === "both" ? Terminal : User;
  const TargetIcon = targetIcon;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-3 flex items-start gap-3 group hover:border-[var(--accent)]/30 transition-colors">
      {/* Status indicator */}
      <div className={`mt-0.5 ${STATUS_STYLES[event.status]}`}>
        <StatusIcon size={16} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
            {event.title}
          </h4>
          <TargetIcon size={12} className="text-[var(--text-muted)] shrink-0" />
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[var(--text-muted)]">
            {event.allDay ? formatDate(event.startTime) : formatDateTime(event.startTime)}
          </span>
          {event.source.projectPath && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
              {projectName(event.source.projectPath)}
            </span>
          )}
          {event.recurrence && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
              recurring
            </span>
          )}
        </div>

        {event.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
            {event.description}
          </p>
        )}

        {event.action && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent)]">
              {event.action.type}
            </span>
            <span className="text-xs text-[var(--text-muted)] truncate">
              {event.action.payload}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {event.status === "pending" && (
          <button
            onClick={() => onComplete(event.id)}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-green-400"
            title="Mark complete"
          >
            <CheckCircle size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(event.id)}
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-400"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────────────

type FilterStatus = "all" | "pending" | "triggered" | "completed" | "missed" | "cancelled";
type FilterTarget = "all" | "user" | "agent" | "both";

export default function CalendarView() {
  const { events, loading, addEvent, deleteEvent, updateEvent } = useCalendar();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterTarget, setFilterTarget] = useState<FilterTarget>("all");

  const filtered = events.filter((e) => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterTarget !== "all" && e.target !== filterTarget) return false;
    return true;
  });

  // Group events by date
  const grouped = filtered.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    const key = formatDate(e.startTime);
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  const handleCreate = async (
    event: Partial<CalendarEvent> & { title: string; startTime: string }
  ) => {
    await addEvent(event);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await deleteEvent(id);
  };

  const handleComplete = async (id: string) => {
    await updateEvent(id, { status: "completed" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <CalendarDays size={20} className="animate-pulse mr-2" />
        Loading calendar...
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={22} className="text-[var(--accent)]" />
          <h1 className="text-lg font-bold">Calendar</h1>
          <span className="text-sm text-[var(--text-muted)]">
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          New Event
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[var(--text-muted)]">Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="triggered">Triggered</option>
            <option value="completed">Completed</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[var(--text-muted)]">For:</label>
          <select
            value={filterTarget}
            onChange={(e) => setFilterTarget(e.target.value as FilterTarget)}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            <option value="all">All</option>
            <option value="user">Me</option>
            <option value="agent">Agent</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <EventForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* Events grouped by date */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <CalendarDays size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No events yet</p>
          <p className="text-xs mt-1">
            Create an event or ask your agent to schedule one
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([date, dateEvents]) => (
            <div key={date}>
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-2">
                {date}
                {dateEvents.some((e) => isToday(e.startTime)) && (
                  <span className="text-[var(--accent)] normal-case tracking-normal">
                    Today
                  </span>
                )}
              </h3>
              <div className="space-y-2">
                {dateEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={handleDelete}
                    onComplete={handleComplete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
