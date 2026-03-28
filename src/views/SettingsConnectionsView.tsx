
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Link2,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Calendar,
  Github,
  LogOut,
} from "lucide-react";

interface ConnectionInfo {
  id: string;
  provider: string;
  enabled: boolean;
  credentials: {
    has_access_token: boolean;
    has_refresh_token: boolean;
    token_expiry?: string;
  };
  settings: {
    direction: string;
    calendars: string[];
    conflict_resolution: string;
  };
  sync_state: {
    last_sync?: string;
    sync_token?: string;
    error?: string | null;
  };
}

interface ProviderInfo {
  id: string;
  name: string;
}

interface GitHubAuthStatus {
  authenticated: boolean;
  ghInstalled: boolean;
  username?: string | null;
  message?: string;
}

export function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // GitHub auth state
  const [ghStatus, setGhStatus] = useState<GitHubAuthStatus | null>(null);
  const [ghLoggingIn, setGhLoggingIn] = useState(false);
  const [ghOneTimeCode, setGhOneTimeCode] = useState<string | null>(null);
  const [ghProgress, setGhProgress] = useState<string[]>([]);
  const ghProgressRef = useRef<HTMLDivElement>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/connections");
      if (!res.ok) return;
      const data = await res.json();
      setConnections(data.connections || []);
      setProviders(data.providers || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchConnections();
    const interval = setInterval(fetchConnections, 10_000);
    return () => clearInterval(interval);
  }, [fetchConnections]);

  // GitHub auth
  const fetchGhStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/github-auth/status");
      if (res.ok) setGhStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchGhStatus(); }, [fetchGhStatus]);

  const ghLogin = async () => {
    setGhLoggingIn(true);
    setGhOneTimeCode(null);
    setGhProgress([]);
    try {
      const resp = await fetch("/api/github-auth/login", { method: "POST" });
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await resp.json();
        setMessage({ type: "error", text: data.error || "Login failed" });
        setGhLoggingIn(false);
        return;
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine.slice(6));
            if (evt.type === "code") {
              setGhOneTimeCode(evt.data);
            } else if (evt.type === "progress") {
              setGhProgress((prev) => [...prev, evt.data]);
              setTimeout(() => ghProgressRef.current?.scrollTo({ top: ghProgressRef.current.scrollHeight }), 0);
            } else if (evt.type === "done") {
              setMessage({ type: "success", text: "GitHub authentication successful!" });
              setTimeout(() => setMessage(null), 4000);
              await fetchGhStatus();
            } else if (evt.type === "error") {
              setMessage({ type: "error", text: typeof evt.data === "string" ? evt.data : "Login failed" });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Login failed" });
    } finally {
      setGhLoggingIn(false);
      setGhOneTimeCode(null);
    }
  };

  const ghLogout = async () => {
    await fetch("/api/github-auth/logout", { method: "POST" });
    await fetchGhStatus();
    setMessage({ type: "success", text: "Logged out of GitHub" });
    setTimeout(() => setMessage(null), 3000);
  };

  const initiateOAuth = async (providerId: string) => {
    setConnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initiate-oauth", provider: providerId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error + (data.hint ? ` (${data.hint})` : "") });
        setConnecting(false);
        return;
      }

      // Open auth URL in new tab
      window.open(data.authUrl, "_blank");
      setMessage({ type: "success", text: "Authorization opened in your browser. Complete the flow there." });

      // Poll for connection to complete
      const pollInterval = setInterval(async () => {
        await fetchConnections();
        const conn = (await fetch("/api/calendar/connections").then((r) => r.json())).connections;
        const pending = conn?.find((c: any) => c.id === data.connectionId);
        if (pending?.credentials?.has_access_token) {
          clearInterval(pollInterval);
          setConnecting(false);
          setMessage({ type: "success", text: "Connected successfully!" });
          setTimeout(() => setMessage(null), 3000);
        }
      }, 2000);

      // Stop polling after 5 min
      setTimeout(() => {
        clearInterval(pollInterval);
        setConnecting(false);
      }, 5 * 60 * 1000);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
      setConnecting(false);
    }
  };

  const removeConnection = async (id: string) => {
    await fetch("/api/calendar/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", connectionId: id }),
    });
    await fetchConnections();
  };

  const syncNow = async (id: string) => {
    setSyncing(id);
    try {
      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", connectionId: id }),
      });
      const data = await res.json();
      if (data.report?.errors?.length) {
        setMessage({ type: "error", text: data.report.errors[0] });
      } else {
        setMessage({
          type: "success",
          text: `Synced: ${data.report?.pulled || 0} pulled, ${data.report?.pushed || 0} pushed`,
        });
      }
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
    setSyncing(null);
    await fetchConnections();
  };

  const isConnected = (conn: ConnectionInfo) =>
    conn.credentials.has_access_token && conn.credentials.has_refresh_token;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link2 size={20} className="text-[var(--accent)]" />
        <h1 className="text-xl font-bold">Connections</h1>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Connect external services like GitHub and Google Calendar.
      </p>

      {/* Status message */}
      {message && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {message.type === "success" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {message.text}
        </div>
      )}

      {/* GitHub Authentication */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          GitHub
        </h3>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Github size={16} className="text-[var(--text-secondary)]" />
              <span className="text-sm font-medium">GitHub</span>
              {ghStatus?.authenticated ? (
                <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                  <CheckCircle size={10} />
                  {ghStatus.username || "Connected"}
                </span>
              ) : ghStatus && !ghStatus.ghInstalled ? (
                <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                  <AlertCircle size={10} />
                  CLI not installed
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
                  Not connected
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {ghStatus?.authenticated && (
                <button
                  onClick={ghLogout}
                  className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  title="Log out"
                >
                  <LogOut size={14} />
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            {ghStatus?.authenticated
              ? "Authenticated with GitHub. You can clone private repositories."
              : "Authenticate with GitHub to clone private repositories. Requires the GitHub CLI (gh)."}
          </p>

          {!ghStatus?.authenticated && (
            <>
              {ghStatus && !ghStatus.ghInstalled ? (
                <div className="text-xs text-yellow-400 bg-yellow-500/10 px-3 py-2 rounded">
                  GitHub CLI is not installed. Install it with: <code className="bg-[var(--bg-tertiary)] px-1 py-0.5 rounded">brew install gh</code>
                </div>
              ) : (
                <button
                  onClick={ghLogin}
                  disabled={ghLoggingIn}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] text-sm transition-colors disabled:opacity-50"
                >
                  {ghLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
                  {ghLoggingIn ? "Authenticating..." : "Authenticate with GitHub"}
                </button>
              )}
            </>
          )}

          {/* One-time code display */}
          {ghOneTimeCode && (
            <div className="bg-[var(--bg-primary)] border border-[var(--accent)] rounded-lg p-3 space-y-1">
              <p className="text-xs text-[var(--text-muted)]">Your one-time code:</p>
              <p className="text-lg font-mono font-bold text-[var(--accent)] tracking-widest select-all">{ghOneTimeCode}</p>
              <p className="text-xs text-[var(--text-muted)]">
                A browser window should open. Paste this code there to complete authentication.
              </p>
            </div>
          )}

          {/* Auth progress */}
          {ghProgress.length > 0 && (
            <div
              ref={ghProgressRef}
              className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] max-h-[120px] overflow-y-auto"
            >
              {ghProgress.map((line, i) => (
                <p key={i} className="text-[10px] font-mono text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap break-all">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calendar Connections */}
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
        Calendars
      </h3>

      {/* Existing connections */}
      {connections.length > 0 && (
        <div className="space-y-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-[var(--accent)]" />
                  <span className="text-sm font-medium capitalize">{conn.provider} Calendar</span>
                  {isConnected(conn) ? (
                    <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                      <CheckCircle size={10} />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                      <AlertCircle size={10} />
                      Pending
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isConnected(conn) && (
                    <button
                      onClick={() => syncNow(conn.id)}
                      disabled={syncing === conn.id}
                      className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                      title="Sync now"
                    >
                      {syncing === conn.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => removeConnection(conn.id)}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-[var(--text-muted)]">Direction:</span>{" "}
                  <span className="text-[var(--text-secondary)]">{conn.settings.direction}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Calendars:</span>{" "}
                  <span className="text-[var(--text-secondary)]">{conn.settings.calendars.join(", ")}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Conflicts:</span>{" "}
                  <span className="text-[var(--text-secondary)]">{conn.settings.conflict_resolution}</span>
                </div>
              </div>

              {/* Sync state */}
              {conn.sync_state.last_sync && (
                <div className="text-xs text-[var(--text-muted)]">
                  Last synced: {new Date(conn.sync_state.last_sync).toLocaleString()}
                </div>
              )}
              {conn.sync_state.error && (
                <div className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                  {conn.sync_state.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {connections.length === 0 && !connecting && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-8 text-center space-y-3">
          <Link2 size={32} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-sm text-[var(--text-secondary)]">No calendar connections</p>
          <p className="text-xs text-[var(--text-muted)]">
            Connect Google Calendar to sync events bidirectionally
          </p>
        </div>
      )}

      {/* Add connection */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          Add Connection
        </h3>
        <div className="flex gap-2">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => initiateOAuth(p.id)}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] text-sm transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              Connect {p.name}
            </button>
          ))}
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-sm text-[var(--text-muted)] opacity-50 cursor-not-allowed"
            title="Coming soon"
          >
            Outlook (coming soon)
          </button>
        </div>
      </div>
    </div>
  );
}
