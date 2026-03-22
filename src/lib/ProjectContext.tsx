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
import { useSession } from "./SessionContext";

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelinePhase = "idle" | "uploading" | "formatting" | "organizing" | "ready";
export type AppStatus = "idle" | "initializing" | "building" | "running" | "error";

interface PortInfo {
  port: number;
  pid: number;
  command: string;
}

export interface DataFileEntry {
  name: string;
  path: string;
  status: "raw" | "formatting" | "formatted";
  size?: number;
}

interface ProjectState {
  // Data pipeline
  pipelinePhase: PipelinePhase;
  dataFiles: DataFileEntry[];

  // App preview
  appPort: number | null;
  appStatus: AppStatus;
  detectedPorts: PortInfo[];
  startupLog: string[];
  iframeKey: number;
}

interface ProjectContextType {
  state: ProjectState;
  refreshAppPreview: () => void;
  clearAppPort: () => void;
  setAppPort: (port: number | null) => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

// Reserved ports that should never be auto-selected as app preview
const RESERVED_PORTS = new Set([3000, 3001]);

// ── Provider ─────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();

  const [state, setState] = useState<ProjectState>({
    pipelinePhase: "idle",
    dataFiles: [],
    appPort: null,
    appStatus: "idle",
    detectedPorts: [],
    startupLog: [],
    iframeKey: 0,
  });

  // Baseline ports snapshot (taken on mount)
  const baselinePortsRef = useRef<Set<number>>(new Set());
  const baselineTakenRef = useRef(false);
  // Debounce: port must appear in 2 consecutive polls
  const candidatePortRef = useRef<number | null>(null);

  // ── Session-based port detection (fast — from PTY output parsing) ───────

  useEffect(() => {
    if (!session.sessionId || session.sessionId === "pending" || !session.agentConnected) return;
    let cancelled = false;

    async function pollSession() {
      try {
        const res = await fetch(`/api/sessions/${session.sessionId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const s = data.session;
        if (!s || cancelled) return;

        setState((prev) => {
          // If session detected a port and we don't have one yet, use it immediately
          if (s.detectedPort && !prev.appPort) {
            return {
              ...prev,
              appPort: s.detectedPort,
              appStatus: "running",
              startupLog: s.lastOutput || [],
            };
          }
          // Always update startup log
          if (s.lastOutput?.length > 0) {
            return { ...prev, startupLog: s.lastOutput };
          }
          return prev;
        });
      } catch {
        // ignore
      }
    }

    pollSession();
    const interval = setInterval(pollSession, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session.sessionId, session.agentConnected]);

  // ── Port auto-detection polling (fallback — from lsof scan) ─────────────

  useEffect(() => {
    let cancelled = false;

    async function pollPorts() {
      try {
        const res = await fetch("/api/ports");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ports: PortInfo[] = (data.ports || []).map(
          (p: { port: number; pid: number; command: string }) => ({
            port: p.port,
            pid: p.pid,
            command: p.command || "",
          })
        );

        if (cancelled) return;

        // Take baseline snapshot on first successful poll
        if (!baselineTakenRef.current) {
          baselinePortsRef.current = new Set(ports.map((p) => p.port));
          baselineTakenRef.current = true;
        }

        setState((prev) => {
          const currentPortSet = new Set(ports.map((p) => p.port));

          // Find new ports (not baseline, not reserved, in dev range)
          const newPorts = ports.filter(
            (p) =>
              p.port >= 3000 &&
              p.port <= 9999 &&
              !RESERVED_PORTS.has(p.port) &&
              !baselinePortsRef.current.has(p.port)
          );

          let nextAppPort = prev.appPort;
          let nextAppStatus = prev.appStatus;

          if (newPorts.length > 0 && !prev.appPort) {
            const candidate = newPorts[0].port;
            if (candidatePortRef.current === candidate) {
              // Port confirmed in 2 consecutive polls — commit it
              nextAppPort = candidate;
              nextAppStatus = "running";
              candidatePortRef.current = null;
            } else {
              // First sighting — mark as candidate
              candidatePortRef.current = candidate;
            }
          }

          // App port disappeared
          if (prev.appPort && !currentPortSet.has(prev.appPort)) {
            nextAppPort = null;
            nextAppStatus = prev.appStatus === "running" ? "idle" : prev.appStatus;
            candidatePortRef.current = null;
          }

          // Detect building state: agent session running but no app port yet
          if (
            session.agentConnected &&
            !nextAppPort &&
            nextAppStatus === "idle" &&
            prev.appStatus !== "building"
          ) {
            // Don't auto-set building — let it be set explicitly or stay idle
          }

          return {
            ...prev,
            detectedPorts: ports,
            appPort: nextAppPort,
            appStatus: nextAppStatus,
          };
        });
      } catch {
        // API not available — ignore
      }
    }

    pollPorts();
    const interval = setInterval(pollPorts, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session.agentConnected]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const refreshAppPreview = useCallback(() => {
    setState((prev) => ({ ...prev, iframeKey: prev.iframeKey + 1 }));
  }, []);

  const clearAppPort = useCallback(() => {
    setState((prev) => ({ ...prev, appPort: null, appStatus: "idle" }));
    candidatePortRef.current = null;
  }, []);

  const setAppPort = useCallback((port: number | null) => {
    setState((prev) => ({
      ...prev,
      appPort: port,
      appStatus: port ? "running" : "idle",
    }));
  }, []);

  return (
    <ProjectContext.Provider
      value={{ state, refreshAppPreview, clearAppPort, setAppPort }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
