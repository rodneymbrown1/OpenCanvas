
import { useState, useRef, useEffect } from "react";
import {
  Activity,
  Clock,
  CheckCircle,
  AlertCircle,
  Terminal,
  ChevronDown,
  ChevronRight,
  Mic,
  Cpu,
  ArrowDownUp,
} from "lucide-react";
import { useJobs, type Job } from "@/lib/JobsContext";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MiniTerminal({
  lines,
  maxLines = 5,
  isRunning,
}: {
  lines: string[];
  maxLines?: number;
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const displayLines = lines.slice(-maxLines);

  if (displayLines.length === 0) {
    return (
      <div className="mt-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] p-3">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
            Output
          </span>
          {isRunning && (
            <span className="text-[10px] text-[var(--accent)] animate-pulse ml-auto">
              Working...
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] font-mono italic mt-2">
          Waiting for output...
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]/50">
        <Terminal size={12} className="text-[var(--text-muted)]" />
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
          Output
        </span>
        {isRunning && (
          <span className="text-[10px] text-[var(--accent)] animate-pulse ml-auto">
            Working...
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="px-3 py-2 max-h-[120px] overflow-y-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        {displayLines.map((line, i) => (
          <p
            key={i}
            className="text-[11px] font-mono text-[var(--text-secondary)] leading-relaxed truncate"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, defaultExpanded }: { job: Job; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const isRunning = job.status === "running";

  const statusIcon = () => {
    switch (job.status) {
      case "running":
        return <Activity size={16} className="text-[var(--accent)] animate-pulse" />;
      case "completed":
        return <CheckCircle size={16} className="text-[var(--success)]" />;
      default:
        return <AlertCircle size={16} className="text-[var(--error)]" />;
    }
  };

  const agentColor = () => {
    switch (job.agent) {
      case "claude": return "bg-orange-500";
      case "codex": return "bg-green-500";
      case "gemini": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const statusLabel = () => {
    switch (job.status) {
      case "running": return "Running";
      case "completed": return "Completed";
      case "failed": return "Failed";
      default: return job.status;
    }
  };

  return (
    <div
      className={`bg-[var(--bg-secondary)] border rounded-xl overflow-hidden transition-all ${
        isRunning
          ? "border-[var(--accent)]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
          : "border-[var(--border)]"
      }`}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-tertiary)]/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
        )}

        {statusIcon()}
        <span className={`w-2.5 h-2.5 rounded-full ${agentColor()} shrink-0`} />

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {job.agent.charAt(0).toUpperCase() + job.agent.slice(1)} Job
            </span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {job.id}
            </span>
            {job.prompt && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--accent)]">
                <Mic size={10} />
                voice
              </span>
            )}
          </div>
          {job.prompt && (
            <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
              &ldquo;{job.prompt}&rdquo;
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className={`text-xs ${isRunning ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
            <Clock size={11} className="inline mr-1" />
            {formatDuration(job.startedAt, job.endedAt)}
          </p>
          <p className={`text-[10px] mt-0.5 ${
            isRunning ? "text-[var(--accent)] font-medium" : "text-[var(--text-muted)]"
          }`}>
            {statusLabel()}
          </p>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-[var(--border)]/50">
          <div className="grid grid-cols-2 gap-3 mt-3">
            {/* Working directory */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Working Directory
              </p>
              <p className="text-xs text-[var(--text-secondary)] font-mono truncate">
                {job.cwd}
              </p>
            </div>

            {/* PID */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Process
              </p>
              <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                <Cpu size={10} />
                PID {job.pid || "—"}
              </p>
            </div>

            {/* I/O */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                I/O Traffic
              </p>
              <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                <ArrowDownUp size={10} />
                {formatBytes(job.outputBytes)} out / {formatBytes(job.inputBytes)} in
              </p>
            </div>

            {/* Timing */}
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Started
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {new Date(job.startedAt).toLocaleString()}
              </p>
            </div>

            {/* Exit code (if completed) */}
            {job.exitCode !== null && (
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                  Exit Code
                </p>
                <p className={`text-xs font-mono ${
                  job.exitCode === 0 ? "text-[var(--success)]" : "text-[var(--error)]"
                }`}>
                  {job.exitCode}
                </p>
              </div>
            )}

            {/* Voice prompt */}
            {job.prompt && (
              <div className="col-span-2">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                  Voice Prompt
                </p>
                <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded px-2 py-1.5 border border-[var(--border)]">
                  {job.prompt}
                </p>
              </div>
            )}
          </div>

          {/* Live agent output stream */}
          {(isRunning || (job.lastOutput && job.lastOutput.length > 0)) && (
            <MiniTerminal
              lines={job.lastOutput || []}
              maxLines={isRunning ? 5 : 3}
              isRunning={isRunning}
            />
          )}

          {/* Session lifecycle logs */}
          {job.logs && job.logs.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Session Log
              </p>
              <div className="bg-[var(--bg-primary)] rounded border border-[var(--border)] px-2 py-1.5 max-h-32 overflow-y-auto space-y-0.5">
                {job.logs.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                    <span className="text-[var(--text-muted)] shrink-0">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    <span className={`font-medium shrink-0 ${
                      entry.event.includes("error") || entry.event.includes("timeout")
                        ? "text-[var(--error)]"
                        : entry.event.includes("ready") || entry.event.includes("submitted")
                          ? "text-[var(--success)]"
                          : "text-[var(--accent)]"
                    }`}>
                      {entry.event}
                    </span>
                    {entry.detail && (
                      <span className="text-[var(--text-secondary)] truncate">
                        {entry.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobsView() {
  const { jobs, activeJobs, activeCount } = useJobs();
  const completed = jobs.filter((j) => j.status !== "running");
  const loading = false; // JobsContext handles loading

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Jobs</h1>
          {activeCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-medium animate-pulse">
              {activeCount} active
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {activeCount} active &middot; {jobs.length} total
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-12 text-center space-y-3">
          <Terminal size={40} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-[var(--text-secondary)]">No active jobs</p>
          <p className="text-xs text-[var(--text-muted)]">
            Jobs will appear here when your coding agent is working.
            Use the microphone button in the sidebar to start a voice-triggered job,
            or go to the Workspace and connect an agent.
          </p>
        </div>
      ) : (
        <>
          {/* Active jobs */}
          {activeJobs.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Active ({activeJobs.length})
              </h2>
              {activeJobs.map((job) => (
                <JobCard key={job.id} job={job} defaultExpanded />
              ))}
            </div>
          )}

          {/* Completed jobs */}
          {completed.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                History ({completed.length})
              </h2>
              {completed.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
