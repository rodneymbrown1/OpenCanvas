import { useEffect, useRef } from "react";
import { X, Terminal } from "lucide-react";
import type { SessionHistoryEntry, AgentType } from "@/lib/types/terminal";

function agentColor(agent: AgentType): string {
  switch (agent) {
    case "claude":
      return "bg-orange-400";
    case "codex":
      return "bg-green-400";
    case "gemini":
      return "bg-blue-400";
    case "shell":
      return "bg-gray-400";
    default:
      return "bg-gray-400";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

function groupByDate(
  entries: SessionHistoryEntry[]
): { label: string; entries: SessionHistoryEntry[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: Map<string, SessionHistoryEntry[]> = new Map();

  for (const entry of entries) {
    const d = new Date(entry.createdAt);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) {
      label = "Today";
    } else if (d.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else {
      label = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }

  return Array.from(groups.entries()).map(([label, entries]) => ({
    label,
    entries,
  }));
}

interface SessionHistoryPanelProps {
  entries: SessionHistoryEntry[];
  loading: boolean;
  onRestore: (entry: SessionHistoryEntry) => void;
  onClose: () => void;
}

export function SessionHistoryPanel({
  entries,
  loading,
  onRestore,
  onClose,
}: SessionHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const grouped = groupByDate(entries);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 w-80 max-h-[320px] overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-b-lg shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-secondary)]">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Session History
        </span>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--text-muted)]">
          Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-1">
          <Terminal size={16} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">
            No session history yet
          </span>
        </div>
      ) : (
        <div className="py-1">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-1 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {group.label}
              </div>
              {group.entries.map((entry) => (
                <button
                  key={entry.sessionId}
                  onClick={() => onRestore(entry)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors group"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${agentColor(entry.agent)}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-[var(--text-primary)] truncate">
                        {entry.label}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                        {entry.agent}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span>{relativeTime(entry.createdAt)}</span>
                      {entry.durationSeconds !== null && (
                        <>
                          <span>·</span>
                          <span>{formatDuration(entry.durationSeconds)}</span>
                        </>
                      )}
                      {entry.exitCode !== null && entry.exitCode !== 0 && (
                        <>
                          <span>·</span>
                          <span className="text-[var(--error)]">
                            exit {entry.exitCode}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
