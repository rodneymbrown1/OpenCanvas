import { ChevronLeft, ChevronRight, Plus, Calendar, LayoutGrid, Columns3, Clock } from "lucide-react";
import type { CalendarViewType } from "./useCalendarNav";

const VIEW_OPTIONS: { id: CalendarViewType; label: string; icon: typeof Calendar }[] = [
  { id: "dayGridMonth", label: "Month", icon: LayoutGrid },
  { id: "timeGridWeek", label: "Week", icon: Columns3 },
  { id: "timeGridDay", label: "Day", icon: Clock },
];

interface CalendarToolbarProps {
  currentDate: Date;
  viewType: CalendarViewType;
  onViewChange: (view: CalendarViewType) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewEvent: () => void;
  eventCount: number;
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
}: CalendarToolbarProps) {
  const title = currentDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    ...(viewType === "timeGridDay" ? { day: "numeric", weekday: "long" } : {}),
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

      {/* Right: View switcher + new event */}
      <div className="flex items-center gap-2">
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
