import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { logger } from "@/lib/logger";
import { useToast } from "@/lib/ToastContext";
export interface Job {
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
  paused?: boolean;
  prompt?: string; // The speech-to-text prompt that triggered this job
  lastOutput?: string[]; // Last ~20 lines of clean agent output
  logs?: Array<{ ts: string; event: string; detail?: string }>;
}

interface JobsContextType {
  jobs: Job[];
  activeJobs: Job[];
  activeCount: number;
  /** Add a speech-triggered job (spawns a background agent session) */
  spawnVoiceJob: (prompt: string, targetSessionId?: string) => Promise<void>;
  /** Whether a voice job is currently being spawned */
  spawning: boolean;
  /** Kill a running job (SIGTERM → SIGKILL) */
  killJob: (id: string) => Promise<void>;
  /** Pause a running job (SIGSTOP) or resume it (SIGCONT) */
  pauseJob: (id: string, paused: boolean) => Promise<void>;
}

const JobsContext = createContext<JobsContextType | null>(null);

// In-memory map of job IDs → the prompt that triggered them
const jobPrompts = new Map<string, string>();

export function JobsProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [spawning, setSpawning] = useState(false);

  const lastJobsHash = useRef("");
  const consecutiveErrorsRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        const sessions: Job[] = (data.sessions || []).map((s: Job) => ({
          ...s,
          prompt: jobPrompts.get(s.id) || s.prompt || undefined,
        }));
        // Only update state if sessions actually changed (avoid re-render churn)
        const hash = sessions.map((s) => `${s.id}:${s.status}:${s.outputBytes}`).join("|");
        if (hash !== lastJobsHash.current) {
          lastJobsHash.current = hash;
          setJobs(sessions);
        }

        // Prune jobPrompts for completed/failed sessions (server has the prompt)
        const activeIds = new Set(
          sessions.filter((s) => s.status === "running").map((s) => s.id)
        );
        for (const id of jobPrompts.keys()) {
          if (!activeIds.has(id)) jobPrompts.delete(id);
        }
      }
    } catch {
      // PTY server may not be running
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    function schedulePoll(delayMs: number) {
      if (cancelled) return;
      pollTimerRef.current = setTimeout(runPoll, delayMs);
    }

    async function runPoll() {
      if (cancelled) return;
      if (document.hidden) {
        logger.poll("jobs: skipped — tab hidden");
        return;
      }
      logger.poll("jobs: poll start", { errors: consecutiveErrorsRef.current });
      try {
        await fetchJobs();
        consecutiveErrorsRef.current = 0;
      } catch {
        consecutiveErrorsRef.current++;
      }
      if (cancelled) return;
      const hasActive = jobs.some((j) => j.status === "running");
      const baseDelay = hasActive ? 2000 : 8000;
      const backoff = Math.min(baseDelay * Math.pow(2, consecutiveErrorsRef.current), 30000);
      const nextDelay = consecutiveErrorsRef.current > 0 ? backoff : baseDelay;
      if (consecutiveErrorsRef.current > 0) {
        logger.pollWarn(`jobs: error — backing off ${nextDelay}ms`, { errors: consecutiveErrorsRef.current });
      } else {
        logger.poll(`jobs: ok — next poll in ${nextDelay}ms`, { hasActive });
      }
      schedulePoll(nextDelay);
    }

    function onVisible() {
      if (cancelled) return;
      logger.poll("jobs: tab visible — resuming poll");
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      runPoll();
    }

    document.addEventListener("visibilitychange", onVisible);
    runPoll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchJobs, jobs]);

  const activeJobs = jobs.filter((j) => j.status === "running");

  const killJob = useCallback(async (id: string) => {
    logger.context(`JobsContext: killJob → session=${id}`);
    try {
      const res = await fetch(`/api/sessions/${id}/kill`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logger.error("context", `killJob: server error session=${id}`, data);
        toast(data.error || "Failed to kill job", { type: "error" });
        return;
      }
      logger.context(`JobsContext: killJob ✓ session=${id}`);
      fetchJobs();
    } catch (err) {
      logger.error("context", `killJob: fetch failed session=${id}`, err);
      toast("Failed to kill job", { type: "error" });
    }
  }, [fetchJobs, toast]);

  const pauseJob = useCallback(async (id: string, paused: boolean) => {
    const signal = paused ? "SIGSTOP" : "SIGCONT";
    logger.context(`JobsContext: pauseJob → session=${id} signal=${signal}`);
    try {
      const res = await fetch(`/api/sessions/${id}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logger.error("context", `pauseJob: server error session=${id}`, data);
        toast(data.error || "Failed to pause/resume job", { type: "error" });
        return;
      }
      logger.context(`JobsContext: pauseJob ✓ session=${id} paused=${data.paused}`);
      fetchJobs();
    } catch (err) {
      logger.error("context", `pauseJob: fetch failed session=${id}`, err);
      toast("Failed to pause/resume job", { type: "error" });
    }
  }, [fetchJobs, toast]);

  const spawnVoiceJob = useCallback(
    async (prompt: string, targetSessionId?: string) => {
      logger.context("VoiceJob: spawning", { prompt: prompt.substring(0, 100), targetSessionId });
      setSpawning(true);
      try {
        // Ensure PTY server is running
        const statusRes = await fetch("/api/pty-status");
        const statusData = await statusRes.json();
        if (!statusData.running) {
          await fetch("/api/pty-status", { method: "POST" });
          let started = false;
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const check = await fetch("/api/pty-status");
            const checkData = await check.json();
            if (checkData.running) { started = true; break; }
          }
          if (!started) {
            logger.error("context", "VoiceJob: PTY server failed to start after 5 retries");
            setSpawning(false);
            return;
          }
        }

        // Fetch voice context — all skills composed, cwd = recording/
        let cwd = "";
        let skillContent = "";

        try {
          const contextRes = await fetch("/api/voice-context");
          if (contextRes.ok) {
            const contextData = await contextRes.json();
            cwd = contextData.cwd || "";
            skillContent = contextData.skillContent || "";
          }
        } catch {
          logger.warn("context", "VoiceJob: voice context fetch failed, using defaults");
        }

        if (!cwd) {
          logger.warn("context", "VoiceJob: no working directory from voice context");
          setSpawning(false);
          return;
        }

        // If targeting an existing session, inject into that session
        if (targetSessionId) {
          const inputPrompt = skillContent
            ? `<context>\n${skillContent}\n</context>\n\n${prompt}`
            : prompt;

          const inputRes = await fetch(`/api/sessions/${targetSessionId}/input`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: inputPrompt }),
          });

          if (!inputRes.ok) {
            logger.error("context", `VoiceJob: failed to send input to session ${targetSessionId}`);
          }

          setSpawning(false);
          fetchJobs();
          return;
        }

        // Spawn a new voice job via the HTTP endpoint
        const spawnRes = await fetch("/api/voice-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            agent: "claude",
            cwd,
            skillContent,
          }),
        });

        if (spawnRes.ok) {
          const spawnData = await spawnRes.json();
          if (spawnData.session?.id) {
            jobPrompts.set(spawnData.session.id, prompt);
            logger.context("VoiceJob: spawned", { sessionId: spawnData.session.id });
          }
        } else {
          logger.error("context", "VoiceJob: failed to spawn voice job");
        }

        setSpawning(false);
        fetchJobs();
      } catch (err) {
        logger.error("context", "VoiceJob: failed to spawn", err);
        toast("Voice job failed to start", { type: "error" });
        setSpawning(false);
      }
    },
    [fetchJobs]
  );

  return (
    <JobsContext.Provider
      value={{
        jobs,
        activeJobs,
        activeCount: activeJobs.length,
        spawnVoiceJob,
        spawning,
        killJob,
        pauseJob,
      }}
    >
      {children}
    </JobsContext.Provider>
  );
}

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within JobsProvider");
  return ctx;
}
