
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
import { logger } from "@/lib/logger";

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelinePhase = "idle" | "uploading" | "formatting" | "organizing" | "ready";
export type AppStatus = "idle" | "initializing" | "building" | "running" | "error";

interface PortInfo {
  port: number;
  pid: number;
  command: string;
  projectName?: string;  // set by /api/ports when port is in the registry
}

export interface DataFileEntry {
  name: string;
  path: string;
  status: "raw" | "formatting" | "formatted";
  size?: number;
}

export interface ServiceStatusInfo {
  name: string;
  state: "stopped" | "starting" | "running" | "error" | "stopping";
  type?: string;
  port?: number;
  pid?: number;
  sessionId?: string;
}

interface ProjectState {
  // Data pipeline
  pipelinePhase: PipelinePhase;
  dataFiles: DataFileEntry[];

  // App preview (backward compatible — maps to primary web service)
  appPort: number | null;
  appStatus: AppStatus;
  appReady: boolean;  // true once HTTP probe confirms the app is responding
  stackSessionId: string | null;
  detectedPorts: PortInfo[];
  startupLog: string[];
  iframeKey: number;

  // Multi-service state
  services: Record<string, ServiceStatusInfo>;
  runConfigExists: boolean;
  startOrder: string[];
}

interface ProjectContextType {
  state: ProjectState;
  startApp: () => Promise<void>;
  stopApp: () => Promise<void>;
  refreshAppPreview: () => void;
  clearAppPort: () => void;
  setAppPort: (port: number | null) => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

// Reserved ports that should never be auto-selected as app preview
const RESERVED_PORTS = new Set([40000, 40001]);

// ── Provider ─────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();

  const initialState: ProjectState = {
    pipelinePhase: "idle",
    dataFiles: [],
    appPort: null,
    appStatus: "idle",
    appReady: false,
    stackSessionId: null,
    detectedPorts: [],
    startupLog: [],
    iframeKey: 0,
    services: {},
    runConfigExists: false,
    startOrder: [],
  };

  const [state, setState] = useState<ProjectState>(initialState);

  // Keep a ref to current state so polling callbacks read fresh values
  // without stale closure captures and without being in effect deps.
  const stateRef = useRef<ProjectState>(initialState);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Baseline ports snapshot (taken on mount)
  const baselinePortsRef = useRef<Set<number>>(new Set());
  const baselineTakenRef = useRef(false);
  const candidatePortRef = useRef<number | null>(null);

  // ── Reset state when project (workDir) changes ─────────────────────────────
  const prevWorkDirRef = useRef(session.workDir);

  useEffect(() => {
    if (prevWorkDirRef.current && prevWorkDirRef.current !== session.workDir) {
      logger.project(`Project switched: ${prevWorkDirRef.current} → ${session.workDir}`);
      setState({ ...initialState });
      baselinePortsRef.current = new Set();
      baselineTakenRef.current = false;
      candidatePortRef.current = null;
    }
    prevWorkDirRef.current = session.workDir;

    // Auto-discover already-running ports for this project via PortRegistry
    if (session.workDir) {
      (async () => {
        try {
          const res = await fetch("/api/ports/registry?action=project-ports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectPath: session.workDir }),
          });
          if (!res.ok) return;
          const data = await res.json();
          const allocations = data.allocations || [];

          // Find running allocations
          const running = allocations.filter(
            (a: { status: string }) => a.status === "running"
          );
          if (running.length > 0) {
            // Find the primary web port
            const webAlloc = running.find(
              (a: { serviceType: string }) => a.serviceType === "web"
            ) || running[0];

            const services: Record<string, ServiceStatusInfo> = {};
            for (const alloc of running) {
              services[alloc.serviceName] = {
                name: alloc.serviceName,
                state: "running",
                type: alloc.serviceType,
                port: alloc.port,
                pid: alloc.pid,
              };
            }

            setState((prev) => ({
              ...prev,
              appPort: webAlloc.port,
              appStatus: "running",
              services,
            }));
            logger.project(`Auto-discovered ${running.length} running port(s) for project`);
          }
        } catch {
          // Registry not available — will fall back to polling
        }
      })();
    }
  }, [session.workDir]);

  // ── Stack session polling (checks dedicated stack session for port + log) ─

  useEffect(() => {
    if (!session.workDir) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollStack() {
      if (cancelled) return;
      const controller = new AbortController();
      try {
        const res = await fetch(`/api/stack?cwd=${encodeURIComponent(session.workDir)}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        if (data.running && data.session) {
          const s = data.session;
          setState((prev) => {
            const updates: Partial<ProjectState> = {
              stackSessionId: s.id,
              startupLog: s.lastOutput || prev.startupLog,
            };

            // Only advance appPort when stdout confirms the port is live.
            // allocatedPort is reserved but not yet listening — showing the
            // iframe on it produces "Cannot preview app" errors.
            if (s.detectedPort && prev.appStatus !== "running") {
              updates.appPort = s.detectedPort;
              updates.appStatus = "running";
              // Reset appReady so the readiness probe re-confirms the new port
              if (s.detectedPort !== prev.appPort) updates.appReady = false;
            }

            if (!s.detectedPort && !prev.appPort && prev.appStatus !== "building") {
              updates.appStatus = "building";
            }

            return { ...prev, ...updates };
          });
        } else {
          setState((prev) => {
            if (prev.stackSessionId) {
              return { ...prev, stackSessionId: null };
            }
            return prev;
          });
        }
      } catch {
        // ignore (AbortError or network error)
      } finally {
        if (!cancelled) {
          // Adaptive delay: fast while starting, slow once running
          const status = stateRef.current.appStatus;
          const delay = (status === "initializing" || status === "building") ? 1500 : 8000;
          timer = setTimeout(pollStack, delay);
        }
      }
    }

    pollStack();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session.workDir]);

  // ── Multi-service status polling ────────────────────────────────────────

  useEffect(() => {
    if (!session.workDir) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollServices() {
      if (cancelled) return;
      const controller = new AbortController();
      try {
        const res = await fetch(`/api/services?cwd=${encodeURIComponent(session.workDir)}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        setState((prev) => {
          const services = (data.services || {}) as Record<string, ServiceStatusInfo>;
          const hasRunConfig = !!data.hasRunConfig;
          const startOrder = data.startOrder || [];

          // Find the primary port from the first running "web" service
          let primaryPort: number | null = prev.appPort;
          if (hasRunConfig && Object.keys(services).length > 0) {
            const webService = Object.values(services).find(
              (s) => s.type === "web" && s.state === "running" && s.port
            );
            if (webService?.port && !prev.appPort) {
              primaryPort = webService.port;
            }
            // If any service is running, override appStatus
            const anyRunning = Object.values(services).some((s) => s.state === "running");
            if (anyRunning && prev.appStatus !== "running") {
              return {
                ...prev,
                services,
                runConfigExists: hasRunConfig,
                startOrder,
                appPort: primaryPort,
                appStatus: "running",
                // Reset appReady so probe re-confirms the new port
                appReady: primaryPort === prev.appPort ? prev.appReady : false,
              };
            }
          }

          return {
            ...prev,
            services,
            runConfigExists: hasRunConfig,
            startOrder,
            appPort: primaryPort ?? prev.appPort,
          };
        });
      } catch {
        // /api/services not available or request aborted — ignore
      } finally {
        if (!cancelled) {
          // Fast poll only during active startup; skip entirely if no run-config
          const { appStatus, runConfigExists } = stateRef.current;
          if (!runConfigExists && appStatus === "idle") {
            // No run-config — check infrequently
            timer = setTimeout(pollServices, 15000);
          } else {
            const delay = (appStatus === "initializing" || appStatus === "building") ? 2000 : 8000;
            timer = setTimeout(pollServices, delay);
          }
        }
      }
    }

    pollServices();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session.workDir]);

  // ── Port auto-detection polling (fallback — from lsof scan) ─────────────

  useEffect(() => {
    let cancelled = false;

    async function pollPorts() {
      try {
        const res = await fetch("/api/ports");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ports: PortInfo[] = (data.ports || []).map(
          (p: { port: number; pid: number; command: string; projectName?: string }) => ({
            port: p.port,
            pid: p.pid,
            command: p.command || "",
            projectName: p.projectName,
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

          // Find new ports (not baseline, not reserved, in dev range).
          // Registry ownership check: if a port is registered to a *different*
          // project, skip it — prevents Project B's lsof scan from claiming
          // Project A's port when both apps are running simultaneously.
          const currentProjectName = session.workDir
            ? session.workDir.split("/").pop()
            : "";
          const newPorts = ports.filter(
            (p) =>
              p.port >= 3000 &&
              p.port <= 49999 &&
              !RESERVED_PORTS.has(p.port) &&
              !baselinePortsRef.current.has(p.port) &&
              (!p.projectName || p.projectName === currentProjectName)
          );

          let nextAppPort = prev.appPort;
          let nextAppStatus = prev.appStatus;

          // Single-poll confirmation — no debounce. The lsof scan only returns
          // listening ports so a port appearing once is reliable enough.
          if (newPorts.length > 0 && !prev.appPort) {
            nextAppPort = newPorts[0].port;
            nextAppStatus = "running";
            candidatePortRef.current = null;
          }

          // App port disappeared
          if (prev.appPort && !currentPortSet.has(prev.appPort)) {
            nextAppPort = null;
            nextAppStatus = prev.appStatus === "running" ? "idle" : prev.appStatus;
            candidatePortRef.current = null;
          }

          return {
            ...prev,
            detectedPorts: ports,
            appPort: nextAppPort,
            appStatus: nextAppStatus,
            // Reset appReady when port changes so probe re-confirms
            appReady: nextAppPort !== prev.appPort ? false : prev.appReady,
          };
        });
      } catch {
        // API not available or request aborted — ignore
      } finally {
        if (!cancelled) {
          // Slow down once an app is running — lsof scan is expensive
          const status = stateRef.current.appStatus;
          const delay = status === "running" ? 10000 : 3000;
          timer = setTimeout(pollPorts, delay);
        }
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    pollPorts();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session.agentConnected]);

  // ── HTTP readiness probe ─────────────────────────────────────────────────
  // After the app port is confirmed in stdout, the HTTP server may need a few
  // hundred ms to fully bind. Probe with retries; set appReady once it responds.

  useEffect(() => {
    if (state.appStatus !== "running" || !state.appPort || state.appReady) return;
    let cancelled = false;
    const port = state.appPort;
    let attempt = 0;
    const MAX_ATTEMPTS = 25; // ~12s total at 500ms intervals

    async function probe() {
      if (cancelled || attempt >= MAX_ATTEMPTS) return;
      attempt++;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 1500);
        // mode: no-cors — we just need to know the socket accepted the connection
        await fetch(`http://localhost:${port}`, { signal: controller.signal, mode: "no-cors" });
        clearTimeout(t);
        if (!cancelled) {
          setState((prev) => prev.appPort === port ? { ...prev, appReady: true } : prev);
        }
      } catch {
        if (!cancelled) setTimeout(probe, 500);
      }
    }

    probe();
    return () => { cancelled = true; };
  }, [state.appStatus, state.appPort, state.appReady]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const startApp = useCallback(async () => {
    if (!session.workDir || !session.agent) return;
    logger.project("Starting app", { workDir: session.workDir, agent: session.agent });
    setState((prev) => ({ ...prev, appStatus: "initializing", appReady: false, startupLog: [] }));

    try {
      // Clean up any existing instance first (kill-and-restart)
      logger.project("Killing existing instances before start");
      await Promise.allSettled([
        fetch("/api/services?action=stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: session.workDir }),
        }),
        fetch("/api/stack?action=stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: session.workDir }),
        }),
      ]);

      // Ask the user's selected agent to find and start the app
      const res = await fetch("/api/stack?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: session.agent, cwd: session.workDir }),
      });
      const data = await res.json();

      if (data.error) {
        logger.error("project", "startApp failed", data.error);
        setState((prev) => ({
          ...prev,
          appStatus: "error",
          startupLog: [data.error],
        }));
      } else if (data.session) {
        setState((prev) => ({
          ...prev,
          stackSessionId: data.session.id,
          appStatus: data.alreadyRunning ? "running" : "building",
          appPort: data.session.detectedPort || prev.appPort,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          appStatus: "error",
          startupLog: ["Unknown error — no session returned"],
        }));
      }
    } catch (err) {
      logger.error("project", "startApp fetch failed", err);
      setState((prev) => ({
        ...prev,
        appStatus: "error",
        startupLog: ["Cannot reach PTY server. Run: npm run open-canvas"],
      }));
    }
  }, [session.workDir, session.agent]);

  const stopApp = useCallback(async () => {
    if (!session.workDir) return;
    logger.project("Stopping app", { workDir: session.workDir });
    // Stop services (multi-service)
    try {
      await fetch("/api/services?action=stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.workDir }),
      });
    } catch {
      // ignore
    }
    // Also stop legacy stack session
    try {
      await fetch("/api/stack?action=stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.workDir }),
      });
    } catch {
      // ignore
    }
    // Release ports from registry
    try {
      await fetch("/api/ports/registry?action=release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: session.workDir }),
      });
    } catch {
      // ignore
    }
    setState((prev) => ({
      ...prev,
      appPort: null,
      appStatus: "idle",
      appReady: false,
      stackSessionId: null,
      startupLog: [],
      services: {},
    }));
    candidatePortRef.current = null;
  }, [session.workDir]);

  const refreshAppPreview = useCallback(() => {
    setState((prev) => ({ ...prev, iframeKey: prev.iframeKey + 1 }));
  }, []);

  const clearAppPort = useCallback(() => {
    setState((prev) => ({ ...prev, appPort: null, appStatus: "idle", appReady: false }));
    candidatePortRef.current = null;
  }, []);

  const setAppPort = useCallback((port: number | null) => {
    setState((prev) => ({
      ...prev,
      appPort: port,
      appStatus: port ? "running" : "idle",
      appReady: false,
    }));
  }, []);

  return (
    <ProjectContext.Provider
      value={{ state, startApp, stopApp, refreshAppPreview, clearAppPort, setAppPort }}
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
