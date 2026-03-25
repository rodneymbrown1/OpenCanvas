import {
  FolderOpen,
  Bot,
  DollarSign,
  Settings,
  Wifi,
  Sun,
  Moon,
  Database,
  CalendarDays,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { useView, type ViewId } from "@/lib/ViewContext";
import { CalendarNotifications } from "@/components/CalendarNotifications";
import { SpeechToTextButton } from "@/components/SpeechToTextButton";
import { useJobs } from "@/lib/JobsContext";

const NAV_ITEMS: { id: ViewId; icon: typeof FolderOpen; label: string }[] = [
  { id: "workspace", icon: FolderOpen, label: "Workspace" },
  { id: "jobs", icon: Bot, label: "Jobs" },
  { id: "usage", icon: DollarSign, label: "Usage" },
  { id: "ports", icon: Wifi, label: "Ports" },
  { id: "data", icon: Database, label: "Data" },
  { id: "calendar", icon: CalendarDays, label: "Calendar" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { view, setView } = useView();
  const [theme, toggleTheme] = useTheme();
  const { activeCount } = useJobs();

  return (
    <aside className="w-14 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      {/* Logo → Project Manager */}
      <button
        onClick={() => setView("projects")}
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-4 transition-colors ${
          view === "projects"
            ? "bg-[var(--bg-tertiary)] ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-secondary)]"
            : "hover:bg-[var(--bg-tertiary)] hover:ring-1 hover:ring-[var(--border)]"
        }`}
        title="Project Manager"
      >
        <img
          src="/open_square_canvas_logo.png"
          alt="Open Canvas"
          width={32}
          height={32}
          className="rounded"
        />
      </button>

      {NAV_ITEMS.map((item) => {
        const isActive = view === item.id;
        const isJobs = item.id === "jobs";
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={isJobs && activeCount > 0 ? `Jobs (${activeCount} active)` : item.label}
            className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isActive
                ? "bg-[var(--bg-tertiary)] text-[var(--accent)]"
                : isJobs && activeCount > 0
                  ? "text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            } ${isJobs && activeCount > 0 ? "jobs-glow" : ""}`}
          >
            <item.icon size={20} className={isJobs && activeCount > 0 ? "animate-pulse" : ""} />
            {/* Active jobs badge */}
            {isJobs && activeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--accent)] text-[9px] text-white font-bold flex items-center justify-center animate-bounce">
                {activeCount > 9 ? "9+" : activeCount}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      <SpeechToTextButton />

      <CalendarNotifications />

      <button
        onClick={toggleTheme}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </aside>
  );
}
