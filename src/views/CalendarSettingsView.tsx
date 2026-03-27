
import { useState, useEffect, useCallback } from "react";
import { useCalendar } from "@/lib/CalendarContext";
import {
  CalendarDays,
  RefreshCw,
  Link,
  Unlink,
  CheckCircle,
  AlertTriangle,
  Loader,
  Trash2,
  ExternalLink,
} from "lucide-react";

interface Connection {
  id: string;
  provider: string;
  enabled: boolean;
  settings: {
    direction: "bidirectional" | "pull-only" | "push-only";
    calendars: string[];
    conflict_resolution: "newest-wins" | "remote-wins" | "local-wins";
  };
  sync_state: {
    last_sync?: string;
    sync_token?: string;
    error?: string | null;
  };
}

interface ConnectionsResponse {
  connections: Connection[];
  providers: string[];
}

export function CalendarSettingsView() {
  const { refresh } = useCalendar();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/connections");
      if (!res.ok) throw new Error("Failed to load connections");
      const data: ConnectionsResponse = await res.json();
      setConnections(data.connections || []);
      setProviders(data.providers || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleConnect = async () => {
    setError(undefined);
    setOauthPending(true);
    try {
      const res = await fetch("/api/calendar/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initiate-oauth", provider: "google" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "OAuth initiation failed");

      if (data.authUrl) {
        window.open(data.authUrl, "_blank");
        // Poll for connection completion
        const pollInterval = setInterval(async () => {
          await fetchConnections();
          const connected = connections.length > 0 || (await fetch("/api/calendar/connections").then(r => r.json()).then(d => d.connections?.length > 0));
          if (connected) {
            clearInterval(pollInterval);
            setOauthPending(false);
            await fetchConnections();
          }
        }, 3000);
        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setOauthPending(false);
        }, 120000);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      setOauthPending(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setError(undefined);
    try {
      const res = await fetch("/api/calendar/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", connectionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to disconnect");
      }
      await fetchConnections();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Disconnect failed";
      setError(message);
    }
  };

  const handleSync = async (connectionId?: string) => {
    setError(undefined);
    setSyncing(true);
    try {
      const body: Record<string, string> = { action: "sync" };
      if (connectionId) body.connectionId = connectionId;

      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }
      await fetchConnections();
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setError(message);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateSettings = async (connectionId: string, settings: Partial<Connection["settings"]>) => {
    setError(undefined);
    try {
      const res = await fetch("/api/calendar/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", connectionId, settings }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      await fetchConnections();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Update failed";
      setError(message);
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] p-4">
        <Loader size={14} className="animate-spin" /> Loading connections...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="text-[var(--accent)]" />
        <h2 className="text-sm font-semibold">Google Calendar Integration</h2>
      </div>

      {/* Error display */}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded">
          {error}
        </p>
      )}

      {/* Existing connections */}
      {connections.map((conn) => (
        <div
          key={conn.id}
          className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 space-y-3"
        >
          {/* Connection header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-green-400" />
              <span className="text-xs font-medium">
                {conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1)} Calendar
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">{conn.id}</span>
            </div>
            <button
              onClick={() => handleDisconnect(conn.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>

          {/* Sync direction */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Sync Direction</label>
            <select
              value={conn.settings.direction}
              onChange={(e) =>
                handleUpdateSettings(conn.id, {
                  direction: e.target.value as Connection["settings"]["direction"],
                })
              }
              className={inputClass}
            >
              <option value="pull-only">Pull only (Google → Open Canvas)</option>
              <option value="push-only">Push only (Open Canvas → Google)</option>
              <option value="bidirectional">Bidirectional</option>
            </select>
          </div>

          {/* Conflict resolution */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Conflict Resolution</label>
            <select
              value={conn.settings.conflict_resolution}
              onChange={(e) =>
                handleUpdateSettings(conn.id, {
                  conflict_resolution: e.target.value as Connection["settings"]["conflict_resolution"],
                })
              }
              className={inputClass}
            >
              <option value="newest-wins">Newest wins</option>
              <option value="remote-wins">Remote wins (Google)</option>
              <option value="local-wins">Local wins (Open Canvas)</option>
            </select>
          </div>

          {/* Sync status & button */}
          <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
            <div className="text-xs text-[var(--text-muted)]">
              {conn.sync_state.last_sync
                ? `Last sync: ${new Date(conn.sync_state.last_sync).toLocaleString()}`
                : "Never synced"}
              {conn.sync_state.error && (
                <span className="text-red-400 ml-2">Error: {conn.sync_state.error}</span>
              )}
            </div>
            <button
              onClick={() => handleSync(conn.id)}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>
      ))}

      {/* No connections — show connect button */}
      {connections.length === 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-yellow-400" />
              <span className="text-xs">Not connected</span>
            </div>
            <button
              onClick={handleConnect}
              disabled={oauthPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            >
              {oauthPending ? (
                <>
                  <Loader size={12} className="animate-spin" /> Waiting for OAuth...
                </>
              ) : (
                <>
                  <Link size={12} /> Connect Google Calendar
                </>
              )}
            </button>
          </div>

          <div className="text-[11px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
            <p>
              Requires <span className="text-[var(--accent)]">google_calendar_client_id</span> and{" "}
              <span className="text-[var(--accent)]">google_calendar_client_secret</span> in Settings → API Keys.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
