import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Calendar, LayoutGrid, Columns3, Clock, RefreshCw, CloudOff, Check } from "lucide-react";
import type { CalendarViewType } from "./useCalendarNav";
import type { SyncStatus } from "@/lib/CalendarContext";

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const VIEW_OPTIONS: { id: CalendarViewType; label: string; icon: typeof Calendar }[] = [
  { id: "dayGridMonth", label: "Month", icon: LayoutGrid },
  { id: "timeGridWeek", label: "Week", icon: Columns3 },
  { id: "timeGridDay", label: "Day", icon: Clock },
];

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface CalendarToolbarProps {
  currentDate: Date;
  viewType: CalendarViewType;
  onViewChange: (view: CalendarViewType) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewEvent: () => void;
  eventCount: number;
  syncStatus?: SyncStatus;
  onSync?: () => void;
  onGCalClick?: () => void;
}

export function CalendarToolbar({
  currentDate,
  viewType,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  onNewEvent,
  eventCount,
  syncStatus,
  onSync,
  onGCalClick,
}: CalendarToolbarProps) {
  const liveClock = useLiveClock();

  const title = currentDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    ...(viewType === "timeGridDay" ? { day: "numeric", weekday: "long" } : {}),
  });

  const clockStr = liveClock.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  const dateStr = liveClock.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
      {/* Left: Title + nav */}
      <div className="flex items-center gap-3">
        <Calendar size={20} className="text-[var(--accent)]" />
        <h1 className="text-lg font-bold">{title}</h1>
        <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
          {eventCount}
        </span>
        <div className="flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)]">
          <Clock size={12} className="text-[var(--accent)]" />
          <span className="text-xs font-mono text-[var(--text-primary)]">{dateStr}</span>
          <span className="text-xs text-[var(--text-muted)]">—</span>
          <span className="text-xs font-mono font-semibold text-[var(--accent)]">{clockStr}</span>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={onPrev}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={onToday}
            className="px-2 py-0.5 text-xs rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Today
          </button>
          <button
            onClick={onNext}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Right: Sync status + View switcher + new event */}
      <div className="flex items-center gap-2">
        {/* Google Calendar connection button */}
        {syncStatus && (
          <button
            onClick={onGCalClick}
            disabled={syncStatus.syncing}
            title={syncStatus.gcalAvailable
              ? `Google Calendar: ${syncStatus.syncing ? "Syncing..." : `Last sync: ${formatLastSync(syncStatus.lastSync)}`}`
              : "Click to connect Google Calendar"
            }
            className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
              syncStatus.gcalAvailable
                ? syncStatus.syncing
                  ? "border-purple-500/30 text-purple-400 bg-purple-500/5"
                  : syncStatus.error
                  ? "border-orange-500/30 text-orange-400 bg-orange-500/5 hover:bg-orange-500/10"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/30 hover:bg-purple-500/5"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/30 hover:bg-purple-500/5"
            }`}
          >
            {syncStatus.syncing ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : syncStatus.gcalAvailable && syncStatus.lastSync ? (
              <Check size={12} className="text-green-400" />
            ) : syncStatus.gcalAvailable ? (
              <Calendar size={12} className="text-purple-400" />
            ) : (
              <CloudOff size={12} />
            )}
            <span className="hidden sm:inline">
              {syncStatus.syncing
                ? "Syncing"
                : syncStatus.gcalAvailable && syncStatus.lastSync
                ? formatLastSync(syncStatus.lastSync)
                : "Google Calendar"}
            </span>
          </button>
        )}

        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          {VIEW_OPTIONS.map((v) => (
            <button
              key={v.id}
              onClick={() => onViewChange(v.id)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                viewType === v.id
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              <v.icon size={12} />
              {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={onNewEvent}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          Event
        </button>
      </div>
    </div>
  );
}
