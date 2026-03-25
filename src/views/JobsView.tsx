
import { useState, useEffect, useCallback } from "react";
import { Activity, Clock, CheckCircle, AlertCircle, Terminal } from "lucide-react";

interface Session {
  id: string;
  agent: string;
  cwd: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  outputBytes: number;
  inputBytes: number;
  pid: number | null;
}

function formatDuration(start: string, end: string | null): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default function JobsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // PTY server may not be running
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const running = sessions.filter((s) => s.status === "running");
  const completed = sessions.filter((s) => s.status !== "running");

  const statusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Activity size={14} className="text-[var(--accent)] animate-pulse" />;
      case "completed":
        return <CheckCircle size={14} className="text-[var(--success)]" />;
      default:
        return <AlertCircle size={14} className="text-[var(--error)]" />;
    }
  };

  const agentColor = (agent: string) => {
    switch (agent) {
      case "claude": return "bg-orange-500";
      case "codex": return "bg-green-500";
      case "gemini": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Jobs</h1>
        <span className="text-xs text-[var(--text-muted)]">
          {running.length} active &middot; {sessions.length} total
        </span>
      </div>

      {loading ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-12 text-center">
          <Activity size={24} className="text-[var(--text-muted)] mx-auto animate-pulse mb-2" />
          <p className="text-sm text-[var(--text-muted)]">Loading sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-12 text-center space-y-3">
          <Terminal size={40} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-[var(--text-secondary)]">No active jobs</p>
          <p className="text-xs text-[var(--text-muted)]">
            Jobs will appear here when your coding agent is working.
            Go to the Workspace and connect an agent.
          </p>
        </div>
      ) : (
        <>
          {/* Active jobs */}
          {running.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Active ({running.length})
              </h2>
              {running.map((s) => (
                <div
                  key={s.id}
                  className="bg-[var(--bg-secondary)] border border-[var(--accent)]/30 rounded-xl px-4 py-3 flex items-center gap-4"
                >
                  {statusIcon(s.status)}
                  <span className={`w-2 h-2 rounded-full ${agentColor(s.agent)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {s.agent.charAt(0).toUpperCase() + s.agent.slice(1)} Session
                      </p>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {s.id}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {s.cwd}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--accent)]">
                      <Clock size={11} className="inline mr-1" />
                      {formatDuration(s.startedAt, null)}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      PID {s.pid}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Completed jobs */}
          {completed.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                History ({completed.length})
              </h2>
              {completed.map((s) => (
                <div
                  key={s.id}
                  className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-4"
                >
                  {statusIcon(s.status)}
                  <span className={`w-2 h-2 rounded-full ${agentColor(s.agent)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-[var(--text-secondary)]">
                        {s.agent.charAt(0).toUpperCase() + s.agent.slice(1)} Session
                      </p>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {s.id}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(s.startedAt).toLocaleString()}
                      {" — "}
                      {formatDuration(s.startedAt, s.endedAt)}
                      {s.exitCode !== null && ` (exit ${s.exitCode})`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
