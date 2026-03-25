import {
  Clock,
  CheckCircle,
  AlertTriangle,
  Bell,
  Bot,
  User,
  Terminal,
  ExternalLink,
} from "lucide-react";
import type { CalendarEvent } from "@/lib/CalendarContext";

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
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

interface CalendarSidebarProps {
  events: CalendarEvent[];
}

export function CalendarSidebar({ events }: CalendarSidebarProps) {
  // Show upcoming events (next 7 days, pending/triggered only)
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcoming = events
    .filter((e) => {
      const start = new Date(e.startTime);
      return start >= now && start <= weekLater && (e.status === "pending" || e.status === "triggered");
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 10);

  // Group upcoming by date
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const e of upcoming) {
    const key = formatDate(e.startTime);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }

  // Stats
  const pendingCount = events.filter((e) => e.status === "pending").length;
  const completedCount = events.filter((e) => e.status === "completed").length;
  const externalCount = events.filter((e) => e.googleCalendarId).length;

  return (
    <div className="w-60 border-l border-[var(--border)] bg-[var(--bg-secondary)] overflow-auto shrink-0">
      {/* Stats */}
      <div className="p-3 border-b border-[var(--border)]">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
          Overview
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-yellow-400">{pendingCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">Pending</div>
          </div>
          <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-green-400">{completedCount}</div>
            <div className="text-[10px] text-[var(--text-muted)]">Done</div>
          </div>
        </div>
        {externalCount > 0 && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-purple-400">
            <ExternalLink size={10} />
            {externalCount} synced event{externalCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div className="p-3">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
          Upcoming
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic">No upcoming events</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([date, dateEvents]) => (
              <div key={date}>
                <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1 flex items-center gap-1">
                  {date}
                  {dateEvents.some((e) => isToday(e.startTime)) && (
                    <span className="text-[var(--accent)] normal-case">Today</span>
                  )}
                </div>
                <div className="space-y-1">
                  {dateEvents.map((event) => {
                    const StatusIcon = STATUS_ICONS[event.status] || Clock;
                    const TargetIcon =
                      event.target === "agent" ? Bot : event.target === "both" ? Terminal : User;

                    return (
                      <div
                        key={event.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors group"
                      >
                        <div className={`shrink-0 ${STATUS_STYLES[event.status]}`}>
                          <StatusIcon size={12} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{event.title}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {event.allDay ? "All day" : formatTime(event.startTime)}
                          </div>
                        </div>
                        <TargetIcon size={10} className="text-[var(--text-muted)] shrink-0 opacity-0 group-hover:opacity-100" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
