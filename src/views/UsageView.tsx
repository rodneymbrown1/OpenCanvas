
import { useState, useEffect, useCallback } from "react";
import { BarChart3, Zap, Clock, ArrowUpDown } from "lucide-react";
import { AgentSelector } from "@/components/AgentSelector";
import { useSession } from "@/lib/SessionContext";

interface Session {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  outputBytes: number;
  inputBytes: number;
  outputLines: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// Rough token estimate: ~4 chars per token for English text
function estimateTokens(bytes: number): number {
  return Math.round(bytes / 4);
}

function estimateCost(agent: string, outputBytes: number, inputBytes: number): string {
  const outputTokens = estimateTokens(outputBytes);
  const inputTokens = estimateTokens(inputBytes);
  // Rough pricing per 1M tokens
  const pricing: Record<string, { input: number; output: number }> = {
    claude: { input: 3, output: 15 },
    codex: { input: 2.5, output: 10 },
    gemini: { input: 1.25, output: 5 },
  };
  const p = pricing[agent] || pricing.claude;
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  if (cost < 0.01) return "< $0.01";
  return `$${cost.toFixed(2)}`;
}

interface DayBucket {
  label: string;
  tokens: number;
}

function TokenBarChart({ sessions }: { sessions: Session[] }) {
  const now = new Date();
  const DAY_MS = 86_400_000;
  const days: DayBucket[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() - (6 - i) * DAY_MS);
    return {
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      tokens: 0,
    };
  });

  // Bucket sessions into the last 7 days by startedAt
  for (const s of sessions) {
    const start = new Date(s.startedAt).getTime();
    const daysAgo = Math.floor((now.getTime() - start) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < 7) {
      days[6 - daysAgo].tokens += estimateTokens(s.outputBytes + s.inputBytes);
    }
  }

  const maxTokens = Math.max(...days.map((d) => d.tokens), 1);
  const W = 700;
  const H = 72;
  const barW = Math.floor(W / 7) - 8;
  const maxBarH = H - 20; // leave 20px for labels at bottom

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 16}`}
      className="w-full"
      aria-label="Token usage over the last 7 days"
    >
      {days.map((day, i) => {
        const x = i * (W / 7) + 4;
        const barH = day.tokens > 0 ? Math.max(4, Math.round((day.tokens / maxTokens) * maxBarH)) : 0;
        const y = H - barH;
        return (
          <g key={i}>
            {barH > 0 && (
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill="var(--accent)"
                opacity={0.75}
              >
                <title>{day.label}: ~{day.tokens.toLocaleString()} tokens</title>
              </rect>
            )}
            <text
              x={x + barW / 2}
              y={H + 13}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {day.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function UsageView() {
  const { session: currentSession, setAgent } = useSession();
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
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const agentSessions = sessions.filter(
    (s) => s.agent === currentSession.agent
  );

  const totalOutput = agentSessions.reduce((sum, s) => sum + s.outputBytes, 0);
  const totalInput = agentSessions.reduce((sum, s) => sum + s.inputBytes, 0);
  const activeSessions = agentSessions.filter((s) => s.status === "running");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usage</h1>
        <AgentSelector value={currentSession.agent} onChange={setAgent} />
      </div>

      {/* Metrics cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-yellow-400" />
            <span className="text-xs text-[var(--text-muted)]">
              Est. Tokens (this instance)
            </span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">
            {estimateTokens(totalOutput + totalInput).toLocaleString()}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {formatBytes(totalInput)} in / {formatBytes(totalOutput)} out
          </p>
        </div>

        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-green-400" />
            <span className="text-xs text-[var(--text-muted)]">
              Est. Cost
            </span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">
            {estimateCost(currentSession.agent, totalOutput, totalInput)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Based on approximate {currentSession.agent} pricing
          </p>
        </div>

        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ArrowUpDown size={16} className="text-blue-400" />
            <span className="text-xs text-[var(--text-muted)]">
              Active Sessions
            </span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">
            {activeSessions.length}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {agentSessions.length} total this instance
          </p>
        </div>
      </div>

      {/* Activity chart */}
      {agentSessions.length > 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <BarChart3 size={11} />
            Activity — last 7 days
          </h2>
          <TokenBarChart sessions={agentSessions} />
        </div>
      )}

      {/* Session history */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Session History</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Loading...
          </div>
        ) : agentSessions.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            <BarChart3 size={32} className="mx-auto mb-2 opacity-50" />
            No sessions yet for {currentSession.agent}. Connect an agent in the Workspace to get started.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {agentSessions.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-center gap-4">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    s.status === "running"
                      ? "bg-[var(--success)] animate-pulse"
                      : s.status === "completed"
                      ? "bg-[var(--text-muted)]"
                      : "bg-[var(--error)]"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {s.id}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {s.agent}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Started {new Date(s.startedAt).toLocaleTimeString()}
                    {" — "}
                    {formatDuration(s.startedAt, s.endedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--text-secondary)]">
                    ~{estimateTokens(s.outputBytes + s.inputBytes).toLocaleString()} tokens
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {formatBytes(s.outputBytes)} output
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
