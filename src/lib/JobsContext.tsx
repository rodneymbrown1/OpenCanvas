import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { logger } from "@/lib/logger";
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
}

const JobsContext = createContext<JobsContextType | null>(null);

// In-memory map of job IDs → the prompt that triggered them
const jobPrompts = new Map<string, string>();

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [spawning, setSpawning] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        const sessions: Job[] = (data.sessions || []).map((s: Job) => ({
          ...s,
          prompt: jobPrompts.get(s.id) || s.prompt || undefined,
        }));
        setJobs(sessions);

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
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const activeJobs = jobs.filter((j) => j.status === "running");

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
