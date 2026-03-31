import { useState } from "react";
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  Bell,
  X,
  Trash2,
  Bot,
  User,
  Terminal,
  ExternalLink,
  Repeat,
  Pencil,
  Upload,
  Unlink,
  Loader2,
} from "lucide-react";
import type { CalendarEvent } from "@/lib/CalendarContext";

const STATUS_STYLES: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-cyan-400",
  triggered: "text-blue-400",
  completed: "text-green-400",
  failed: "text-orange-400",
  missed: "text-red-400",
  cancelled: "text-[var(--text-muted)]",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  running: Terminal,
  triggered: Bell,
  completed: CheckCircle,
  failed: AlertTriangle,
  missed: AlertTriangle,
  cancelled: X,
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function projectName(path?: string): string {
  if (!path) return "";
  return path.split("/").pop() || path;
}

interface CalendarEventPopoverProps {
  event: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  onEdit?: (event: CalendarEvent) => void;
  onPushToGoogle?: (eventId: string) => Promise<boolean>;
  onRemoveFromGoogle?: (eventId: string) => Promise<boolean>;
  gcalAvailable?: boolean;
}

export function CalendarEventPopover({
  event,
  position,
  onClose,
  onDelete,
  onComplete,
  onEdit,
  onPushToGoogle,
  onRemoveFromGoogle,
  gcalAvailable,
}: CalendarEventPopoverProps) {
  const [syncing, setSyncing] = useState(false);
  const StatusIcon = STATUS_ICONS[event.status] || Clock;
  const TargetIcon = event.target === "agent" ? Bot : event.target === "both" ? Terminal : User;
  const isSynced = !!event.googleCalendarId;

  const handlePushToGoogle = async () => {
    if (!onPushToGoogle) return;
    setSyncing(true);
    await onPushToGoogle(event.id);
    setSyncing(false);
  };

  const handleRemoveFromGoogle = async () => {
    if (!onRemoveFromGoogle) return;
    setSyncing(true);
    await onRemoveFromGoogle(event.id);
    setSyncing(false);
  };

  // Position the popover near the click, but keep it on screen
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(position.y, window.innerHeight - 320),
    left: Math.min(position.x, window.innerWidth - 340),
    zIndex: 100,
  };

  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        style={style}
        className="w-[320px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl p-4 space-y-3"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={STATUS_STYLES[event.status]}>
              <StatusIcon size={16} />
            </div>
            <h3 className="font-semibold text-sm truncate">{event.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Time */}
        <div className="text-xs text-[var(--text-muted)] space-y-0.5">
          <div>{event.allDay ? "All day" : formatDateTime(event.startTime)}</div>
          {event.endTime && !event.allDay && (
            <div>to {formatDateTime(event.endTime)}</div>
          )}
        </div>

        {/* Description */}
        {event.description && (
          <p className="text-xs text-[var(--text-secondary)]">{event.description}</p>
        )}

        {/* Meta tags */}
        <div className="flex flex-wrap gap-1.5">
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            <TargetIcon size={10} />
            {event.target === "user" ? "Me" : event.target === "agent" ? "Agent" : "Both"}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] ${STATUS_STYLES[event.status]}`}>
            {event.status}
          </span>
          {event.recurrence && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
              <Repeat size={10} />
              recurring
            </span>
          )}
          {event.googleCalendarId && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              <ExternalLink size={10} />
              Google
            </span>
          )}
          {event.source.projectPath && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
              {projectName(event.source.projectPath)}
            </span>
          )}
          {event.action?.agent && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
              <Bot size={10} />
              {event.action.agent}
            </span>
          )}
          {event.googleCalendarId && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
              <ExternalLink size={10} />
              synced
            </span>
          )}
        </div>

        {/* Action */}
        {event.action && (
          <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 text-xs">
            <span className="text-[var(--accent)] font-medium">{event.action.type}:</span>{" "}
            <span className="text-[var(--text-secondary)]">{event.action.payload}</span>
            {event.action.projectPath && (
              <div className="text-[var(--text-muted)] mt-0.5">
                in {projectName(event.action.projectPath)}
              </div>
            )}
          </div>
        )}

        {/* Execution info */}
        {event.execution && (
          <div className="bg-[var(--bg-tertiary)] rounded-lg p-2 text-xs space-y-0.5">
            <div className="text-[var(--text-muted)]">
              {event.execution.durationMs != null && (
                <span>Duration: {Math.round(event.execution.durationMs / 1000)}s</span>
              )}
              {event.execution.exitCode != null && (
                <span className="ml-2">Exit: {event.execution.exitCode}</span>
              )}
            </div>
            {event.execution.error && (
              <div className="text-orange-400">{event.execution.error}</div>
            )}
            {event.execution.outputSummary && (
              <div className="text-[var(--text-muted)] truncate" title={event.execution.outputSummary}>
                {event.execution.outputSummary.split("\n").slice(-1)[0]}
              </div>
            )}
          </div>
        )}

        {/* Google Calendar sync actions */}
        {gcalAvailable && (
          <div className="flex gap-2 pt-1 border-t border-[var(--border)]">
            {!isSynced && onPushToGoogle && (
              <button
                onClick={handlePushToGoogle}
                disabled={syncing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                Push to Google
              </button>
            )}
            {isSynced && onRemoveFromGoogle && (
              <button
                onClick={handleRemoveFromGoogle}
                disabled={syncing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
                Unlink Google
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1 border-t border-[var(--border)]">
          {onEdit && event.status !== "cancelled" && (
            <button
              onClick={() => { onEdit(event); onClose(); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              <Pencil size={12} />
              Edit
            </button>
          )}
          {(event.status === "pending" || event.status === "triggered") && (
            <button
              onClick={() => onComplete(event.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
            >
              <CheckCircle size={12} />
              Complete
            </button>
          )}
          <button
            onClick={() => onDelete(event.id)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      </div>
    </>
  );
}
