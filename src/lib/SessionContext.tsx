
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { logger } from "@/lib/logger";

type AgentType = "claude" | "codex" | "gemini";

interface SessionState {
  agentConnected: boolean;
  sessionId: string | null;
  agent: AgentType;
  workDir: string;
}

interface SessionContextType {
  session: SessionState;
  autoReconnecting: boolean;
  setAgent: (agent: AgentType) => void;
  setWorkDir: (dir: string) => void;
  connect: (sessionId: string) => void;
  disconnect: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

// ── Per-project localStorage key ──────────────────────────────────────────
// Each project gets its own storage so tabs with different projects
// don't clobber each other's session state.

function storageKey(workDir: string): string {
  if (!workDir) return "oc-session";
  // Slugify the path for a stable key
  const slug = workDir.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80);
  return `oc-session-${slug}`;
}

function getProjectFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("project") || "";
}

function readStoredSession(workDir?: string): SessionState | null {
  if (typeof window === "undefined") return null;
  try {
    // Try project-specific key first
    if (workDir) {
      const raw = localStorage.getItem(storageKey(workDir));
      if (raw) return JSON.parse(raw);
    }
    // Fall back to generic key
    const raw = localStorage.getItem("oc-session");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Always start with SSR-safe defaults to prevent hydration mismatch.
  // Client-only values (localStorage, URL params) are read in useEffect below.
  const [session, setSession] = useState<SessionState>({
    agentConnected: false,
    sessionId: null,
    agent: "claude",
    workDir: "",
  });

  const [autoReconnecting, setAutoReconnecting] = useState(false);

  // Hydrate from localStorage / URL params after mount (client only)
  useEffect(() => {
    logger.session("Hydrating session from localStorage/URL");
    const urlProject = getProjectFromUrl();
    const stored = readStoredSession(urlProject);
    if (stored) {
      logger.session("Restored session from storage", { agent: stored.agent, workDir: urlProject || stored.workDir, sessionId: stored.sessionId });
      setSession({
        agent: stored.agent || "claude",
        workDir: urlProject || stored.workDir || "",
        sessionId: stored.sessionId,
        agentConnected: false,
      });
    } else if (urlProject) {
      logger.session("Set workDir from URL param", urlProject);
      setSession((s) => ({ ...s, workDir: urlProject }));
    } else {
      logger.session("No stored session or URL project found");
    }
  }, []);

  // ── Persist to per-project localStorage on every state change ───────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = storageKey(session.workDir);
    localStorage.setItem(key, JSON.stringify(session));
    // Also update generic key as fallback
    localStorage.setItem("oc-session", JSON.stringify(session));
  }, [session]);

  // ── Sync URL ?project= param when workDir changes ──────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !session.workDir) return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("project") || "";
    if (current !== session.workDir) {
      url.searchParams.set("project", session.workDir);
      window.history.replaceState(null, "", url.toString());
    }
  }, [session.workDir]);

  // ── Auto-reconnect on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function tryAutoReconnect() {
      // URL is the authoritative source for the active project.
      // Read it once at the start — never let server config override it.
      const urlProject = getProjectFromUrl();

      let candidateId = session.sessionId;
      let candidateAgent = session.agent;
      // If the URL already specifies a project, use it. Otherwise fall back to
      // the initial session state (which may be empty on first load).
      let candidateWorkDir = urlProject || session.workDir;

      if (candidateId === "pending") candidateId = null;

      if (!candidateId) {
        try {
          const res = await fetch("/api/config");
          const config = await res.json();
          candidateId = config.session?.lastSessionId || null;
          candidateAgent = config.session?.lastAgent || config.agent?.active || "claude";
          // Only use server-stored workDir if the URL didn't specify one.
          // This prevents the server's stale lastWorkDir from overwriting a
          // project the user explicitly navigated to.
          if (!urlProject) {
            candidateWorkDir = config.session?.lastWorkDir || config.workspace?.root || "";
          }
        } catch {}
      }

      if (!candidateId) return;

      setAutoReconnecting(true);
      logger.session("Auto-reconnect attempting", { candidateId, candidateAgent, candidateWorkDir });

      try {
        const res = await fetch(`/api/sessions/${candidateId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session?.status === "running") {
            // Only reconnect to this session if its cwd matches the active project.
            // If the URL specifies a project, the session must belong to it.
            const sessionCwd = data.session?.cwd || candidateWorkDir;
            if (urlProject && sessionCwd !== urlProject) {
              logger.session("Auto-reconnect: session cwd mismatch with URL project — skipping", { sessionCwd, urlProject });
            } else if (!cancelled) {
              setSession({
                agentConnected: true,
                sessionId: candidateId,
                agent: candidateAgent as AgentType,
                workDir: urlProject || sessionCwd,
              });
              setAutoReconnecting(false);
              return;
            }
          }
        }

        // Check for any running session matching this project's workDir
        const allRes = await fetch("/api/sessions");
        if (allRes.ok) {
          const allData = await allRes.json();
          const running = allData.sessions?.find(
            (s: { status: string; cwd: string }) =>
              s.status === "running" &&
              (!candidateWorkDir || s.cwd === candidateWorkDir)
          );
          if (running && !cancelled) {
            setSession({
              agentConnected: true,
              sessionId: running.id,
              agent: running.agent as AgentType,
              // Always prefer the URL project over the session's cwd so we
              // never navigate away from the project the user opened.
              workDir: urlProject || running.cwd || candidateWorkDir,
            });
            setAutoReconnecting(false);
            return;
          }
        }

        if (!cancelled) {
          clearPersistedSession();
        }
      } catch {
        if (!cancelled) {
          clearPersistedSession();
        }
      }

      setAutoReconnecting(false);
    }

    tryAutoReconnect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clear persisted session ─────────────────────────────────────────────
  const clearPersistedSession = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey(session.workDir));
      localStorage.removeItem("oc-session");
    }
    setSession((s) => ({ ...s, agentConnected: false, sessionId: null }));
    fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { lastSessionId: null, connectedAt: null },
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.workDir]);

  // ── Public actions ──────────────────────────────────────────────────────
  const setAgent = useCallback((agent: AgentType) => {
    setSession((s) => ({ ...s, agent }));
    // Persist agent choice to config
    fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: { active: agent } }),
    }).catch(() => {});
  }, []);

  const setWorkDir = useCallback((workDir: string) => {
    logger.session("workDir changed", workDir);
    setSession((s) => ({ ...s, workDir }));
  }, []);

  const connect = useCallback(
    (sessionId: string) => {
      setSession((s) => ({ ...s, agentConnected: true, sessionId }));
      if (sessionId && sessionId !== "pending") {
        fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: {
              lastSessionId: sessionId,
              lastAgent: session.agent,
              lastWorkDir: session.workDir,
              connectedAt: new Date().toISOString(),
            },
          }),
        }).catch(() => {});
      }
    },
    [session.agent, session.workDir]
  );

  const disconnect = useCallback(() => {
    clearPersistedSession();
  }, [clearPersistedSession]);

  return (
    <SessionContext.Provider
      value={{ session, autoReconnecting, setAgent, setWorkDir, connect, disconnect }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
