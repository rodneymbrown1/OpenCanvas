"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type AgentType = "claude" | "codex" | "gemini";

interface SessionState {
  agentConnected: boolean;
  sessionId: string | null;
  agent: AgentType;
  workDir: string;
}

interface SessionContextType {
  session: SessionState;
  setAgent: (agent: AgentType) => void;
  setWorkDir: (dir: string) => void;
  connect: (sessionId: string) => void;
  disconnect: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    agentConnected: false,
    sessionId: null,
    agent: "claude",
    workDir: "",
  });

  const setAgent = useCallback((agent: AgentType) => {
    setSession((s) => ({ ...s, agent }));
  }, []);

  const setWorkDir = useCallback((workDir: string) => {
    setSession((s) => ({ ...s, workDir }));
  }, []);

  const connect = useCallback((sessionId: string) => {
    setSession((s) => ({ ...s, agentConnected: true, sessionId }));
  }, []);

  const disconnect = useCallback(() => {
    setSession((s) => ({ ...s, agentConnected: false, sessionId: null }));
  }, []);

  return (
    <SessionContext.Provider
      value={{ session, setAgent, setWorkDir, connect, disconnect }}
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
