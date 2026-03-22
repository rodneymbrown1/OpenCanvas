"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

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

const STORAGE_KEY = "oc-session";

const SessionContext = createContext<SessionContextType | null>(null);

function readStoredSession(): SessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>(() => {
    const stored = readStoredSession();
    if (stored) {
      // Restore stored values but mark as NOT connected yet — auto-reconnect will verify
      return {
        agent: stored.agent || "claude",
        workDir: stored.workDir || "",
        sessionId: stored.sessionId,
        agentConnected: false,
      };
    }
    return { agentConnected: false, sessionId: null, agent: "claude", workDir: "" };
  });

  const [autoReconnecting, setAutoReconnecting] = useState(false);

  // ── Persist to localStorage on every state change ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  // ── Auto-reconnect on mount ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function tryAutoReconnect() {
      // 1. Get candidate from state (restored from localStorage)
      let candidateId = session.sessionId;
      let candidateAgent = session.agent;
      let candidateWorkDir = session.workDir;

      // Skip "pending" placeholder
      if (candidateId === "pending") candidateId = null;

      // 2. If no candidate from localStorage, check YAML config
      if (!candidateId) {
        try {
          const res = await fetch("/api/config");
          const config = await res.json();
          candidateId = config.session?.lastSessionId || null;
          candidateAgent = config.session?.lastAgent || config.agent?.active || "claude";
          candidateWorkDir = config.session?.lastWorkDir || config.workspace?.root || "";
        } catch {}
      }

      if (!candidateId) return;

      setAutoReconnecting(true);

      // 3. Verify session still exists on PTY server
      try {
        const res = await fetch(`/api/sessions/${candidateId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session?.status === "running") {
            // Session is alive — reconnect
            if (!cancelled) {
              setSession({
                agentConnected: true,
                sessionId: candidateId,
                agent: candidateAgent as AgentType,
                workDir: candidateWorkDir,
              });
            }
            setAutoReconnecting(false);
            return;
          }
        }

        // Session is gone or not running — check for ANY running session
        const allRes = await fetch("/api/sessions");
        if (allRes.ok) {
          const allData = await allRes.json();
          const running = allData.sessions?.find(
            (s: { status: string }) => s.status === "running"
          );
          if (running && !cancelled) {
            setSession({
              agentConnected: true,
              sessionId: running.id,
              agent: running.agent as AgentType,
              workDir: running.cwd || candidateWorkDir,
            });
            setAutoReconnecting(false);
            return;
          }
        }

        // Nothing running — clear stale state
        if (!cancelled) {
          clearPersistedSession();
        }
      } catch {
        // PTY server not reachable — clear stale session to prevent reconnect loops
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
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clear persisted session from both stores ──────────────────────────
  const clearPersistedSession = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    setSession((s) => ({ ...s, agentConnected: false, sessionId: null }));
    fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { lastSessionId: null, connectedAt: null },
      }),
    }).catch(() => {});
  }, []);

  // ── Public actions ────────────────────────────────────────────────────
  const setAgent = useCallback((agent: AgentType) => {
    setSession((s) => ({ ...s, agent }));
  }, []);

  const setWorkDir = useCallback((workDir: string) => {
    setSession((s) => ({ ...s, workDir }));
  }, []);

  const connect = useCallback(
    (sessionId: string) => {
      setSession((s) => ({ ...s, agentConnected: true, sessionId }));
      // Persist to YAML asynchronously
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
