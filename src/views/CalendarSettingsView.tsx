"use client";

import { useState } from "react";
import { useCalendar } from "@/lib/CalendarContext";
import {
  CalendarDays,
  RefreshCw,
  Link,
  Unlink,
  Settings,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

interface GoogleSyncState {
  connected: boolean;
  lastSync?: string;
  direction: "read" | "write" | "bidirectional";
  calendars: string[];
  syncing: boolean;
  error?: string;
}

export function CalendarSettingsView() {
  const { refresh } = useCalendar();
  const [syncState, setSyncState] = useState<GoogleSyncState>({
    connected: false,
    direction: "bidirectional",
    calendars: [],
    syncing: false,
  });

  const handleConnect = async () => {
    // Placeholder — Google OAuth flow would be triggered here via MCP server
    setSyncState((s) => ({ ...s, error: "Google Calendar MCP server not configured. Add it in Settings > MCP." }));
  };

  const handleSync = async () => {
    setSyncState((s) => ({ ...s, syncing: true, error: undefined }));
    try {
      const res = await fetch("/api/calendar/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }
      setSyncState((s) => ({
        ...s,
        syncing: false,
        lastSync: new Date().toISOString(),
      }));
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setSyncState((s) => ({ ...s, syncing: false, error: message }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="text-[var(--accent)]" />
        <h2 className="text-sm font-semibold">Google Calendar Integration</h2>
      </div>

      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 space-y-4">
        {/* Connection status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {syncState.connected ? (
              <CheckCircle size={14} className="text-green-400" />
            ) : (
              <AlertTriangle size={14} className="text-yellow-400" />
            )}
            <span className="text-xs">
              {syncState.connected ? "Connected to Google Calendar" : "Not connected"}
            </span>
          </div>
          <button
            onClick={syncState.connected ? () => setSyncState((s) => ({ ...s, connected: false })) : handleConnect}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            {syncState.connected ? (
              <>
                <Unlink size={12} /> Disconnect
              </>
            ) : (
              <>
                <Link size={12} /> Connect
              </>
            )}
          </button>
        </div>

        {/* Sync direction */}
        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">Sync Direction</label>
          <select
            value={syncState.direction}
            onChange={(e) => setSyncState((s) => ({ ...s, direction: e.target.value as GoogleSyncState["direction"] }))}
            className="w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            <option value="read">Read only (Google → Open Canvas)</option>
            <option value="write">Write only (Open Canvas → Google)</option>
            <option value="bidirectional">Bidirectional</option>
          </select>
        </div>

        {/* Manual sync */}
        {syncState.connected && (
          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--text-muted)]">
              {syncState.lastSync
                ? `Last sync: ${new Date(syncState.lastSync).toLocaleString()}`
                : "Never synced"}
            </div>
            <button
              onClick={handleSync}
              disabled={syncState.syncing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncState.syncing ? "animate-spin" : ""} />
              {syncState.syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        )}

        {/* Error display */}
        {syncState.error && (
          <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded">
            {syncState.error}
          </p>
        )}

        {/* MCP hint */}
        <div className="text-[11px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
          <p>
            Google Calendar sync requires an MCP server. Configure one in{" "}
            <span className="text-[var(--accent)]">Settings → MCP</span> with:
          </p>
          <code className="block mt-1 px-2 py-1 rounded bg-[var(--bg-primary)] text-[10px] font-mono">
            name: google-calendar | command: npx | args: -y, @anthropic/mcp-google-calendar
          </code>
        </div>
      </div>
    </div>
  );
}
