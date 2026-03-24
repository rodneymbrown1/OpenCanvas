"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/SessionContext";
import type {
  AgentType,
  TerminalTab,
  ProjectTerminalState,
} from "@/lib/types/terminal";
import { createDefaultProjectState, DEFAULT_TERMINAL_HEIGHT } from "@/lib/types/terminal";

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(workDir: string): string {
  if (!workDir) return "_default";
  return workDir.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80);
}

function storageKey(workDir: string): string {
  return `oc-terminals-${slugify(workDir)}`;
}

function legacyStorageKey(workDir: string): string {
  if (!workDir) return "oc-session";
  const slug = workDir.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80);
  return `oc-session-${slug}`;
}

function generateTabId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function nextLabel(tabs: TerminalTab[], agent: AgentType): string {
  const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);
  const existing = tabs.filter((t) => t.agent === agent).length;
  return `${agentName} ${existing + 1}`;
}

function readPersistedState(workDir: string): ProjectTerminalState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(workDir));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function persistState(workDir: string, state: ProjectTerminalState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(workDir), JSON.stringify(state));
  } catch {}
}

/** Migrate legacy single-session state to multi-tab format */
function migrateLegacyState(workDir: string): ProjectTerminalState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(legacyStorageKey(workDir));
    if (!raw) return null;
    const legacy = JSON.parse(raw);
    if (!legacy.sessionId && !legacy.agentConnected) return null;

    const tab: TerminalTab = {
      id: generateTabId(),
      sessionId: legacy.sessionId || null,
      agent: legacy.agent || "claude",
      label: (legacy.agent || "Claude").charAt(0).toUpperCase() + (legacy.agent || "claude").slice(1) + " 1",
      status: legacy.agentConnected ? "connected" : "disconnected",
      createdAt: new Date().toISOString(),
    };

    return {
      tabs: [tab],
      activeTabId: tab.id,
      terminalHeight: DEFAULT_TERMINAL_HEIGHT,
    };
  } catch {}
  return null;
}

// ── Context ─────────────────────────────────────────────────────────────────

interface TerminalContextType {
  /** Current project's terminal state */
  state: ProjectTerminalState;
  /** Add a new terminal tab for the given agent */
  addTab: (agent: AgentType) => string;
  /** Remove a tab (does NOT kill the PTY process) */
  removeTab: (tabId: string) => void;
  /** Switch to a tab */
  setActiveTab: (tabId: string) => void;
  /** Mark a tab as connected with a PTY session ID */
  connectTab: (tabId: string, sessionId: string) => void;
  /** Mark a tab as disconnected */
  disconnectTab: (tabId: string) => void;
  /** Update a tab's status */
  updateTabStatus: (tabId: string, status: TerminalTab["status"]) => void;
  /** Set the terminal panel height */
  setTerminalHeight: (height: number) => void;
  /** Rename a tab */
  renameTab: (tabId: string, label: string) => void;
  /** Whether we're reconciling sessions on mount */
  reconciling: boolean;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { workDir } = session;

  // Store per-project states in a ref map so we don't lose state when switching projects
  const statesRef = useRef<Map<string, ProjectTerminalState>>(new Map());

  const [state, setState] = useState<ProjectTerminalState>(() => {
    // Try persisted state first, then legacy migration, then default
    const persisted = readPersistedState(workDir);
    if (persisted) {
      statesRef.current.set(slugify(workDir), persisted);
      return persisted;
    }
    const migrated = migrateLegacyState(workDir);
    if (migrated) {
      statesRef.current.set(slugify(workDir), migrated);
      return migrated;
    }
    const fresh = createDefaultProjectState();
    statesRef.current.set(slugify(workDir), fresh);
    return fresh;
  });

  const [reconciling, setReconciling] = useState(false);
  const currentWorkDirRef = useRef(workDir);

  // ── Persist on every state change ──────────────────────────────────────────
  useEffect(() => {
    if (!workDir) return;
    persistState(workDir, state);
    statesRef.current.set(slugify(workDir), state);
  }, [state, workDir]);

  // ── Switch project: save current state, load target project's state ────────
  useEffect(() => {
    if (currentWorkDirRef.current === workDir) return;

    // Save current state for the old project
    statesRef.current.set(slugify(currentWorkDirRef.current), state);
    currentWorkDirRef.current = workDir;

    // Load state for new project
    const slug = slugify(workDir);
    const cached = statesRef.current.get(slug);
    if (cached) {
      setState(cached);
      return;
    }

    const persisted = readPersistedState(workDir);
    if (persisted) {
      statesRef.current.set(slug, persisted);
      setState(persisted);
      return;
    }

    const migrated = migrateLegacyState(workDir);
    if (migrated) {
      statesRef.current.set(slug, migrated);
      setState(migrated);
      return;
    }

    const fresh = createDefaultProjectState();
    statesRef.current.set(slug, fresh);
    setState(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDir]);

  // ── Reconcile with PTY server on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function reconcile() {
      if (state.tabs.length === 0) return;

      setReconciling(true);
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) { setReconciling(false); return; }
        const data = await res.json();
        const runningSessions = new Set(
          (data.sessions || [])
            .filter((s: { status: string }) => s.status === "running")
            .map((s: { id: string }) => s.id)
        );

        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((tab) => {
            if (!tab.sessionId) return tab;
            if (runningSessions.has(tab.sessionId)) {
              return { ...tab, status: "disconnected" as const }; // will auto-reconnect
            }
            return { ...tab, status: "exited" as const, sessionId: null };
          }),
        }));
      } catch {}
      setReconciling(false);
    }

    reconcile();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addTab = useCallback((agent: AgentType): string => {
    const id = generateTabId();
    setState((prev) => {
      const tab: TerminalTab = {
        id,
        sessionId: null,
        agent,
        label: nextLabel(prev.tabs, agent),
        status: "disconnected",
        createdAt: new Date().toISOString(),
      };

      // Trigger cross-agent context handoff (async, non-blocking)
      const existingAgents = prev.tabs
        .filter((t) => t.agent !== agent && t.status === "connected")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (existingAgents.length > 0 && workDir) {
        const from = existingAgents[0];
        fetch("/api/context-handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workDir,
            fromAgent: from.agent,
            toAgent: agent,
            fromSessionId: from.sessionId,
          }),
        }).catch(() => {}); // Fire and forget
      }

      return {
        ...prev,
        tabs: [...prev.tabs, tab],
        activeTabId: id,
      };
    });
    return id;
  }, [workDir]);

  const removeTab = useCallback((tabId: string) => {
    setState((prev) => {
      const newTabs = prev.tabs.filter((t) => t.id !== tabId);
      let newActiveId = prev.activeTabId;
      if (prev.activeTabId === tabId) {
        // Activate the previous tab, or the first remaining tab
        const removedIdx = prev.tabs.findIndex((t) => t.id === tabId);
        const fallback = newTabs[Math.max(0, removedIdx - 1)] || newTabs[0];
        newActiveId = fallback?.id || null;
      }
      return { ...prev, tabs: newTabs, activeTabId: newActiveId };
    });
  }, []);

  const setActiveTab = useCallback((tabId: string) => {
    setState((prev) => ({ ...prev, activeTabId: tabId }));
  }, []);

  const connectTab = useCallback((tabId: string, sessionId: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, sessionId, status: "connected" as const } : t
      ),
    }));
  }, []);

  const disconnectTab = useCallback((tabId: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, status: "disconnected" as const, sessionId: null } : t
      ),
    }));
  }, []);

  const updateTabStatus = useCallback((tabId: string, status: TerminalTab["status"]) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, status } : t)),
    }));
  }, []);

  const setTerminalHeight = useCallback((height: number) => {
    setState((prev) => ({ ...prev, terminalHeight: height }));
  }, []);

  const renameTab = useCallback((tabId: string, label: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, label } : t)),
    }));
  }, []);

  return (
    <TerminalContext.Provider
      value={{
        state,
        addTab,
        removeTab,
        setActiveTab,
        connectTab,
        disconnectTab,
        updateTabStatus,
        setTerminalHeight,
        renameTab,
        reconciling,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminals() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminals must be used within TerminalProvider");
  return ctx;
}
