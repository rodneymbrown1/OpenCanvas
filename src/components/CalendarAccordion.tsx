"use client";

import { useState } from "react";
import { useCalendar, type CalendarEvent } from "@/lib/CalendarContext";
import { useView } from "@/lib/ViewContext";
import {
  CalendarDays,
  ChevronRight,
  ChevronDown,
  Clock,
  Plus,
  Bell,
  CheckCircle,
  Bot,
  User,
  ExternalLink,
} from "lucide-react";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return "Today";
  }
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    return "Tomorrow";
  }
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function projectName(path?: string): string {
  if (!path) return "";
  return path.split("/").pop() || path;
}

// ── Mini Event Row ───────────────────────────────────────────────────────────

function MiniEvent({ event }: { event: CalendarEvent }) {
  const isCompleted = event.status === "completed";
  const TargetIcon = event.target === "agent" ? Bot : User;

  return (
    <div
      className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--bg-tertiary)] transition-colors ${
        isCompleted ? "opacity-50" : ""
      }`}
    >
      {/* Time */}
      <span className="text-xs text-[var(--text-muted)] w-14 shrink-0 text-right tabular-nums">
        {event.allDay ? "all day" : formatTime(event.startTime)}
      </span>

      {/* Status dot */}
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          event.status === "pending"
            ? "bg-yellow-400"
            : event.status === "completed"
              ? "bg-green-400"
              : event.status === "triggered"
                ? "bg-blue-400"
                : "bg-red-400"
        }`}
      />

      {/* Title */}
      <span
        className={`text-xs truncate flex-1 ${
          isCompleted
            ? "line-through text-[var(--text-muted)]"
            : "text-[var(--text-primary)]"
        }`}
      >
        {event.title}
      </span>

      {/* Target icon */}
      <TargetIcon size={10} className="text-[var(--text-muted)] shrink-0" />

      {/* Project badge */}
      {event.source.projectPath && (
        <span className="text-[10px] px-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] shrink-0 max-w-16 truncate">
          {projectName(event.source.projectPath)}
        </span>
      )}
    </div>
  );
}

// ── Accordion Component ──────────────────────────────────────────────────────

export function CalendarAccordion() {
  const [expanded, setExpanded] = useState(true);
  const { events, loading } = useCalendar();
  const { setView } = useView();

  // Get events for today + next 3 days
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 4);
  cutoff.setHours(0, 0, 0, 0);

  const upcoming = events.filter((e) => {
    const start = new Date(e.startTime);
    return start <= cutoff && e.status !== "cancelled";
  });

  // Group by day label
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const e of upcoming) {
    const label = formatShortDate(e.startTime);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(e);
  }

  const pendingCount = upcoming.filter((e) => e.status === "pending").length;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[var(--text-muted)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--text-muted)]" />
        )}
        <CalendarDays size={15} className="text-[var(--accent)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">Calendar</span>
        {pendingCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] font-medium">
            {pendingCount}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setView("calendar");
          }}
          className="p-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--accent)]"
          title="Open full calendar"
        >
          <ExternalLink size={12} />
        </button>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-1 py-1.5">
          {loading ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-3">
              Loading...
            </div>
          ) : upcoming.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-3">
              No upcoming events
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(grouped).map(([label, dayEvents]) => (
                <div key={label}>
                  <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 py-0.5">
                    {label}
                  </div>
                  {dayEvents.map((event) => (
                    <MiniEvent key={event.id} event={event} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Quick actions */}
          <div className="flex items-center justify-between px-2 pt-2 mt-1 border-t border-[var(--border)]">
            <button
              onClick={() => setView("calendar")}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              View All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
