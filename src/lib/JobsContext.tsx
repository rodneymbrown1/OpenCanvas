import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { ViewId } from "@/lib/ViewContext";

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
  tabId?: string;  // The tab context that triggered this voice job
}

interface JobsContextType {
  jobs: Job[];
  activeJobs: Job[];
  activeCount: number;
  /** Add a speech-triggered job (spawns a background CLW session, context-aware) */
  spawnVoiceJob: (prompt: string, view?: ViewId, targetSessionId?: string) => Promise<void>;
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
          prompt: jobPrompts.get(s.id) || undefined,
        }));
        setJobs(sessions);
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
    async (prompt: string, view?: ViewId, targetSessionId?: string) => {
      setSpawning(true);
      try {
        // Ensure PTY server is running
        const statusRes = await fetch("/api/pty-status");
        const statusData = await statusRes.json();
        if (!statusData.running) {
          await fetch("/api/pty-status", { method: "POST" });
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const check = await fetch("/api/pty-status");
            const checkData = await check.json();
            if (checkData.running) break;
          }
        }

        // Get workspace root from config
        let projectRoot = "";
        try {
          const configRes = await fetch("/api/config");
          const configData = await configRes.json();
          projectRoot = configData.workspace?.root || configData.session?.lastWorkDir || "";
        } catch {}

        if (!projectRoot) {
          console.warn("[VoiceJob] No workspace directory found");
          setSpawning(false);
          return;
        }

        // Fetch voice routing — resolves cwd and skill content based on active tab
        let cwd = projectRoot;
        let skillContent = "";
        let tabId = view || "workspace";

        if (view) {
          try {
            const routeRes = await fetch(
              `/api/voice-routing?view=${encodeURIComponent(view)}&cwd=${encodeURIComponent(projectRoot)}`
            );
            if (routeRes.ok) {
              const routeData = await routeRes.json();
              cwd = routeData.cwd || projectRoot;
              skillContent = routeData.skillContent || "";
              tabId = routeData.tabId || view;
            }
          } catch {
            console.warn("[VoiceJob] Voice routing failed, using defaults");
          }
        }

        // If targeting an existing session (Jobs tab), inject into that session
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
            console.error("[VoiceJob] Failed to send input to session", targetSessionId);
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
            tabId,
          }),
        });

        if (spawnRes.ok) {
          const spawnData = await spawnRes.json();
          if (spawnData.session?.id) {
            jobPrompts.set(spawnData.session.id, prompt);
          }
        } else {
          console.error("[VoiceJob] Failed to spawn voice job");
        }

        setSpawning(false);
        fetchJobs();
      } catch (err) {
        console.error("[VoiceJob] Failed to spawn:", err);
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
