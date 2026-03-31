import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Calendar,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  MessageSquare,
  Zap,
  Terminal,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { SyncStatus } from "@/lib/CalendarContext";
import { useToast } from "@/lib/ToastContext";
import { AgentTerminal } from "@/components/Terminal";

interface McpStatus {
  available: boolean;
  calendars: { id: string; summary: string; primary: boolean }[];
  userEmail: string | null;
  lastSync: string | null;
  error: string | null;
  agent?: string;
  connectionId?: string;
  calendarDir?: string;
}

interface AutoSyncStatus {
  enabled: boolean;
  eventId: string | null;
  interval: string;
  recurrence: string | null;
  lastRun?: string | null;
}

const AUTO_SYNC_INTERVAL_LABELS: Record<string, string> = {
  "30min": "Every 30 min",
  "1h": "Every hour",
  "2h": "Every 2 hours",
  "6h": "Every 6 hours",
  "12h": "Every 12 hours",
  "24h": "Every day",
};

interface PipelineStep {
  step: number;
  status: "pending" | "running" | "passed" | "failed";
  detail: string;
}

interface GCalConnectionModalProps {
  onClose: () => void;
  syncStatus: SyncStatus;
  onSync: () => void;
}

export function GCalConnectionModal({ onClose, syncStatus, onSync }: GCalConnectionModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const [autoSync, setAutoSync] = useState<AutoSyncStatus>({ enabled: false, eventId: null, interval: "1h", recurrence: null });
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalKey, setTerminalKey] = useState(0);

  const STEP_LABELS = ["", "Claude CLI", "Connection Status", "Calendar Access", "Ready"];

  const fetchAutoSync = useCallback(() => {
    fetch("/api/calendar/auto-sync")
      .then((r) => r.json())
      .then((data) => setAutoSync(data))
      .catch(() => {});
  }, []);

  const checkStatus = useCallback(() => {
    setLoading(true);
    fetch("/api/calendar/mcp-status")
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        if (data.available && !data.lastSync) setNeedsSync(true);
      })
      .catch(() => setStatus({ available: false, calendars: [], userEmail: null, lastSync: null, error: "Failed to check" }))
      .finally(() => setLoading(false));
    fetchAutoSync();
  }, [fetchAutoSync]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleAutoSyncToggle = async () => {
    setAutoSyncLoading(true);
    try {
      if (autoSync.enabled) {
        await fetch("/api/calendar/auto-sync", { method: "DELETE" });
        setAutoSync({ enabled: false, eventId: null, interval: autoSync.interval, recurrence: null });
        toast("Auto-sync disabled", { type: "info" });
      } else {
        const res = await fetch("/api/calendar/auto-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: autoSync.interval }),
        });
        const data = await res.json();
        setAutoSync({ ...data });
        toast("Auto-sync enabled", { type: "success" });
      }
    } catch {
      toast("Failed to update auto-sync", { type: "error" });
    } finally {
      setAutoSyncLoading(false);
    }
  };

  const handleAutoSyncIntervalChange = async (interval: string) => {
    setAutoSync((prev) => ({ ...prev, interval }));
    if (autoSync.enabled) {
      try {
        const res = await fetch("/api/calendar/auto-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval }),
        });
        const data = await res.json();
        setAutoSync({ ...data });
      } catch {
        toast("Failed to update interval", { type: "error" });
      }
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setSteps([]);
    setNeedsSync(false);

    try {
      const resp = await fetch("/api/calendar/mcp-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "claude" }),
      });
      const contentType = resp.headers.get("content-type") || "";

      if (!contentType.includes("text/event-stream")) {
        const data = await resp.json();
        setSteps([{ step: 1, status: "failed", detail: data.error || "Connection failed" }]);
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
            if (evt.type === "step") {
              setSteps((prev) => {
                const existing = prev.findIndex((s) => s.step === evt.step);
                const updated = { step: evt.step, status: evt.status, detail: evt.detail };
                if (existing >= 0) {
                  const copy = [...prev];
                  copy[existing] = updated;
                  return copy;
                }
                return [...prev, updated];
              });
              setTimeout(() => progressRef.current?.scrollTo({ top: progressRef.current.scrollHeight }), 0);
            } else if (evt.type === "done" && evt.data?.success) {
              if (evt.data.needsSync) setNeedsSync(true);
              checkStatus();
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setSteps((prev) => [...prev, { step: 0, status: "failed", detail: err.message || "Connection failed" }]);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const connRes = await fetch("/api/calendar/connections");
      if (connRes.ok) {
        const connData = await connRes.json();
        const mcpConn = connData.connections?.find(
          (c: any) => c.credentials?.auth_method === "mcp"
        );
        if (mcpConn) {
          await fetch("/api/calendar/connections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "remove", connectionId: mcpConn.id }),
          });
        }
      }
      setStatus(null);
      checkStatus();
    } catch {
      toast("Failed to disconnect Google Calendar", { type: "error" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefresh = () => {
    onSync();
    checkStatus();
  };

  const stepIcon = (s: PipelineStep) => {
    if (s.status === "running") return <Loader2 size={12} className="animate-spin text-blue-400" />;
    if (s.status === "passed") return <CheckCircle size={12} className="text-green-400" />;
    if (s.status === "failed") return <AlertCircle size={12} className="text-red-400" />;
    return <div className="w-3 h-3 rounded-full border border-[var(--border)]" />;
  };

  const formatSync = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl max-h-[90vh] overflow-auto transition-all duration-200 ${showTerminal ? "w-[640px]" : "w-[460px]"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-purple-400" />
            <h2 className="text-sm font-semibold">Google Calendar</h2>
            {loading ? (
              <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />
            ) : status?.available ? (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">
                <CheckCircle size={9} /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 font-medium">
                <AlertCircle size={9} /> Not connected
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* ── Connected state ─────────────────────────────────────────── */}
          {!loading && status?.available && (
            <>
              {/* Account info */}
              <div className="bg-[var(--bg-primary)] rounded-lg p-3 space-y-2">
                {status.userEmail && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Account</span>
                    <span className="text-xs text-[var(--text-primary)] font-medium">{status.userEmail}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Calendars</span>
                  <span className="text-xs text-[var(--text-primary)]">
                    {status.calendars.length} accessible
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-muted)]">Last sync</span>
                  <span className="text-xs text-[var(--text-primary)]">
                    {formatSync(status.lastSync || syncStatus.lastSync)}
                  </span>
                </div>
                {syncStatus.error && (
                  <div className="text-xs text-orange-400 bg-orange-500/5 rounded px-2 py-1">
                    {syncStatus.error}
                  </div>
                )}
              </div>

              {/* Calendar list */}
              {status.calendars.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Calendars</span>
                  <div className="space-y-1">
                    {status.calendars.map((cal) => (
                      <div
                        key={cal.id}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] text-xs"
                      >
                        <div className={`w-2 h-2 rounded-full ${cal.primary ? "bg-purple-400" : "bg-[var(--text-muted)]"}`} />
                        <span className="text-[var(--text-primary)] flex-1 truncate">{cal.summary}</span>
                        {cal.primary && <span className="text-[10px] text-purple-400">Primary</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sync prompt */}
              <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <MessageSquare size={14} className="text-purple-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-xs text-purple-300 font-medium">Sync via Claude</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Ask Claude in this conversation to sync your Google Calendar.
                      Claude has direct access to your Google Calendar and will import events automatically.
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] italic">
                      Try: "Sync my Google Calendar events to Open Canvas"
                    </p>
                  </div>
                </div>
              </div>

              {/* Auto-sync */}
              <div className="bg-[var(--bg-primary)] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap size={13} className={autoSync.enabled ? "text-yellow-400" : "text-[var(--text-muted)]"} />
                    <span className="text-xs font-medium text-[var(--text-primary)]">Auto-Sync</span>
                    {autoSync.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Active</span>
                    )}
                  </div>
                  <button
                    onClick={handleAutoSyncToggle}
                    disabled={autoSyncLoading}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                      autoSync.enabled ? "bg-yellow-500" : "bg-[var(--border)]"
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      autoSync.enabled ? "translate-x-4" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
                {autoSync.enabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)]">Interval</span>
                    <select
                      value={autoSync.interval}
                      onChange={(e) => handleAutoSyncIntervalChange(e.target.value)}
                      className="flex-1 text-[10px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    >
                      {Object.entries(AUTO_SYNC_INTERVAL_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!autoSync.enabled && (
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Schedule Claude to sync your Google Calendar automatically on a recurring interval.
                  </p>
                )}
                {autoSync.enabled && autoSync.lastRun && (
                  <p className="text-[10px] text-[var(--text-muted)]">Last run: {formatSync(autoSync.lastRun)}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRefresh}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh Status
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50 ml-auto"
                >
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Disconnect
                </button>
              </div>
            </>
          )}

          {/* ── Not connected state ────────────────────────────────────── */}
          {!loading && !status?.available && steps.length === 0 && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--text-muted)]">
                Connect your Google Calendar to see events in Open Canvas.
                Claude has built-in Google Calendar access — no API keys needed.
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 w-full justify-center"
              >
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                Connect Google Calendar
              </button>
            </div>
          )}

          {/* ── Pipeline steps ─────────────────────────────────────────── */}
          {steps.length > 0 && (
            <div ref={progressRef} className="space-y-1.5 bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border)]">
              {steps.map((s) => (
                <div key={s.step} className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{stepIcon(s)}</div>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${
                      s.status === "passed" ? "text-green-400" :
                      s.status === "failed" ? "text-red-400" :
                      s.status === "running" ? "text-blue-400" :
                      "text-[var(--text-muted)]"
                    }`}>
                      {STEP_LABELS[s.step] || `Step ${s.step}`}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] break-all">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Needs first sync prompt ────────────────────────────────── */}
          {needsSync && !loading && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-blue-300 font-medium">Ready for first sync!</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Connection registered. Ask Claude: "Sync my Google Calendar events to Open Canvas"
              </p>
            </div>
          )}

          {/* Debug Terminal */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <button
              onClick={() => {
                if (!showTerminal) setTerminalKey((k) => k + 1);
                setShowTerminal((v) => !v);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xs"
            >
              {showTerminal ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Terminal size={12} />
              <span>Debug Terminal</span>
              <span className="ml-auto text-[10px] opacity-60">~/.open-canvas/calendar</span>
            </button>
            {showTerminal && status?.calendarDir && (
              <div className="h-[220px] bg-[#0a0a0a]">
                <AgentTerminal
                  key={terminalKey}
                  agent="shell"
                  cwd={status.calendarDir}
                  visible
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-[10px] text-[var(--text-muted)] pt-1">
            Google Calendar events are synced through Claude's built-in integration.
          </div>
        </div>
      </div>
    </div>
  );
}
