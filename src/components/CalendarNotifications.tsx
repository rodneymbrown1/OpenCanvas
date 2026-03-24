"use client";

import { useState, useRef, useEffect } from "react";
import { useCalendar } from "@/lib/CalendarContext";
import { Bell, BellRing, X, Clock } from "lucide-react";

export function CalendarNotifications() {
  const { notifications, dismissNotification } = useCalendar();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const count = notifications.length;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (count === 0) return null;

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors relative"
        title={`${count} notification${count !== 1 ? "s" : ""}`}
      >
        {count > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {count > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--accent)] text-[9px] text-white font-bold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Notifications
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">{count} unread</span>
          </div>

          <div className="max-h-64 overflow-auto">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="px-3 py-2 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {n.title}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {n.message}
                    </p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock size={10} className="text-[var(--text-muted)]" />
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {new Date(n.timestamp).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => dismissNotification(n.id)}
                    className="p-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                    title="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
