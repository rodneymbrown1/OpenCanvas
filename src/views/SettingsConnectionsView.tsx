
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Link2,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Calendar,
  Github,
  LogOut,
} from "lucide-react";
import { logger } from "../lib/logger";

interface ConnectionInfo {
  id: string;
  provider: string;
  enabled: boolean;
  credentials: {
    has_access_token: boolean;
    has_refresh_token: boolean;
    token_expiry?: string;
    auth_method?: string;
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

// ── Google Calendar MCP Status Card ─────────────────────────────────────────

interface McpStatus {
  available: boolean;
  calendars: { id: string; summary: string; primary: boolean }[];
  userEmail: string | null;
  error: string | null;
}

function GoogleCalendarMcpCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const progressRef = useRef<HTMLDivElement>(null);

  const checkStatus = useCallback(() => {
    fetch("/api/calendar/mcp-status")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ available: false, calendars: [], userEmail: null, error: "Failed to check MCP status" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setProgress([]);

    try {
      const resp = await fetch("/api/calendar/mcp-connect", { method: "POST" });
      const contentType = resp.headers.get("content-type") || "";

      if (!contentType.includes("text/event-stream")) {
        const data = await resp.json();
        setProgress((p) => [...p, data.error || "Connection failed"]);
        setConnecting(false);
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

            if (evt.type === "progress") {
              setProgress((p) => [...p, evt.data]);
              setTimeout(() => progressRef.current?.scrollTo({ top: progressRef.current.scrollHeight }), 0);
            } else if (evt.type === "auth_action") {
              setProgress((p) => [...p, `Auth: ${evt.data}`]);
            } else if (evt.type === "done") {
              if (evt.data?.success) {
                setProgress((p) => [...p, "Connected successfully!"]);
                checkStatus();
              }
            } else if (evt.type === "error") {
              setProgress((p) => [...p, `Error: ${evt.data}`]);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setProgress((p) => [...p, err.message || "Connection failed"]);
    } finally {
      setConnecting(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setPullResult(null);
    try {
      const res = await fetch("/api/calendar/mcp-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pull", calendarId: "primary" }),
      });
      const data = await res.json();
      if (res.ok) {
        setPullResult(`Pulled ${data.pulled} new, updated ${data.updated}${data.errors?.length ? `, ${data.errors.length} errors` : ""}`);
      } else {
        setPullResult(data.error || "Pull failed");
      }
    } catch (err: any) {
      setPullResult(err.message || "Pull failed");
    } finally {
      setPulling(false);
      setTimeout(() => setPullResult(null), 8000);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
        Google Calendar
      </h3>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 space-y-3">
        {/* Header with status */}
        <div className="flex items-start gap-3">
          <Calendar size={20} className="text-[var(--accent)] mt-0.5 shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-[var(--text-primary)] font-medium">Google Calendar</p>
              {loading ? (
                <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />
              ) : status?.available ? (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">
                  <CheckCircle size={10} /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 font-medium">
                  <AlertCircle size={10} /> Not connected
                </span>
              )}
            </div>
            {status?.available && status.userEmail && (
              <p className="text-xs text-[var(--text-muted)]">{status.userEmail}</p>
            )}
            {status?.available && status.calendars.length > 0 && (
              <div className="text-xs text-[var(--text-muted)]">
                {status.calendars.length} calendar{status.calendars.length !== 1 ? "s" : ""} accessible
              </div>
            )}
          </div>
        </div>

        {/* Not connected: show connect button */}
        {!loading && !status?.available && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-muted)]">
              Connect your Google Calendar to sync events with Open Canvas. Claude handles authentication — a browser window will open for Google sign-in.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {connecting ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
              Connect Google Calendar
            </button>
          </div>
        )}

        {/* Connection progress log */}
        {progress.length > 0 && (
          <div
            ref={progressRef}
            className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] max-h-[140px] overflow-y-auto"
          >
            {progress.map((line, i) => (
              <p key={i} className="text-[10px] font-mono text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap break-all">{line}</p>
            ))}
          </div>
        )}

        {/* Connected: show pull button */}
        {status?.available && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePull}
              disabled={pulling}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {pulling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Pull Events from Google
            </button>
            {pullResult && (
              <span className="text-xs text-[var(--text-muted)]">{pullResult}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-primary)] rounded-lg px-3 py-2">
          <CheckCircle size={12} className="text-[var(--accent)] shrink-0" />
          <span>Powered by Claude MCP. No API keys or manual OAuth setup.</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // GitHub auth state
  const [ghStatus, setGhStatus] = useState<GitHubAuthStatus | null>(null);
  const [ghLoggingIn, setGhLoggingIn] = useState(false);
  const [ghOneTimeCode, setGhOneTimeCode] = useState<string | null>(null);
  const [ghProgress, setGhProgress] = useState<string[]>([]);
  const ghProgressRef = useRef<HTMLDivElement>(null);

  // Calendar connection state (legacy OAuth removed — MCP is primary)

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

  // OAuth flow removed — Google Calendar uses Claude's built-in MCP server

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
                      {conn.credentials.auth_method === "gcloud-adc" && (
                        <span className="ml-1 text-[10px] opacity-70">via gcloud</span>
                      )}
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

      {/* Google Calendar via MCP */}
      <GoogleCalendarMcpCard />
    </div>
  );
}
