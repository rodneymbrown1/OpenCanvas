
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

  // Shared visibility-resume trigger for all three poll loops
  const resumePollRef = useRef<(() => void) | null>(null);

  // Per-loop consecutive error counters for exponential backoff
  const stackErrorsRef = useRef(0);
  const servicesErrorsRef = useRef(0);
  const portsErrorsRef = useRef(0);

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

  // ONE shared visibility listener — resumes all three poll loops when tab becomes visible
  useEffect(() => {
    function onVisible() {
      if (!document.hidden && resumePollRef.current) resumePollRef.current();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Stack session polling (checks dedicated stack session for port + log) ─

  useEffect(() => {
    if (!session.workDir) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prevResume = resumePollRef.current;

    function schedule(delayMs: number) {
      if (cancelled) return;
      timer = setTimeout(pollStack, delayMs);
    }

    async function pollStack() {
      if (cancelled) return;
      if (document.hidden) { logger.poll("stack: skipped — tab hidden"); return; }
      logger.poll("stack: poll start", { errors: stackErrorsRef.current, appStatus: stateRef.current.appStatus });
      const controller = new AbortController();
      try {
        const res = await fetch(`/api/stack?cwd=${encodeURIComponent(session.workDir)}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) {
          stackErrorsRef.current++;
          const delay = Math.min(1500 * Math.pow(2, stackErrorsRef.current), 30000);
          logger.pollWarn(`stack: ${res.status} — backing off ${delay}ms`, { errors: stackErrorsRef.current });
          schedule(delay);
          return;
        }
        stackErrorsRef.current = 0;
        const data = await res.json();

        if (data.running && data.session) {
          const s = data.session;
          setState((prev) => {
            const updates: Partial<ProjectState> = {
              stackSessionId: s.id,
              startupLog: s.lastOutput || prev.startupLog,
            };
            if (s.detectedPort && s.detectedPort !== prev.appPort) {
              updates.appPort = s.detectedPort;
              updates.appStatus = "running";
              updates.appReady = false;
            } else if (s.detectedPort && prev.appStatus !== "running") {
              updates.appStatus = "running";
            }
            if (!s.detectedPort && !prev.appPort && prev.appStatus !== "building") {
              updates.appStatus = "building";
            }
            return { ...prev, ...updates };
          });
        } else {
          setState((prev) => prev.stackSessionId ? { ...prev, stackSessionId: null } : prev);
        }
      } catch {
        if (!cancelled) {
          stackErrorsRef.current++;
          const delay = Math.min(1500 * Math.pow(2, stackErrorsRef.current), 30000);
          logger.pollWarn(`stack: network error — backing off ${delay}ms`, { errors: stackErrorsRef.current });
          schedule(delay);
          return;
        }
      }
      if (!cancelled) {
        const status = stateRef.current.appStatus;
        const delay = (status === "initializing" || status === "building") ? 1500 : 8000;
        logger.poll(`stack: ok — next poll in ${delay}ms`, { appStatus: status });
        schedule(delay);
      }
    }

    function resume() {
      if (!cancelled) { logger.poll("stack: tab visible — resuming poll"); if (timer) clearTimeout(timer); pollStack(); }
    }
    resumePollRef.current = () => { prevResume?.(); resume(); };

    pollStack();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      resumePollRef.current = prevResume ?? null;
    };
  }, [session.workDir]);

  // ── Multi-service status polling ────────────────────────────────────────

  useEffect(() => {
    if (!session.workDir) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prevResume = resumePollRef.current;

    function getBaseDelay() {
      const { appStatus, runConfigExists } = stateRef.current;
      if (!runConfigExists && appStatus === "idle") return 15000;
      return (appStatus === "initializing" || appStatus === "building") ? 2000 : 8000;
    }
    function schedule(delayMs: number) {
      if (cancelled) return;
      timer = setTimeout(pollServices, delayMs);
    }

    async function pollServices() {
      if (cancelled) return;
      if (document.hidden) { logger.poll("services: skipped — tab hidden"); return; }
      logger.poll("services: poll start", { errors: servicesErrorsRef.current, appStatus: stateRef.current.appStatus });
      const controller = new AbortController();
      try {
        const res = await fetch(`/api/services?cwd=${encodeURIComponent(session.workDir)}`, {
          signal: controller.signal,
        });
        if (!res.ok || cancelled) {
          servicesErrorsRef.current++;
          schedule(Math.min(getBaseDelay() * Math.pow(2, servicesErrorsRef.current), 30000));
          return;
        }
        servicesErrorsRef.current = 0;
        const data = await res.json();

        setState((prev) => {
          const services = (data.services || {}) as Record<string, ServiceStatusInfo>;
          const hasRunConfig = !!data.hasRunConfig;
          const startOrder = data.startOrder || [];
          let primaryPort: number | null = prev.appPort;
          if (hasRunConfig && Object.keys(services).length > 0) {
            const webService = Object.values(services).find(
              (s) => s.type === "web" && s.state === "running" && s.port
            );
            if (webService?.port && !prev.appPort) {
              primaryPort = webService.port;
            }
            const anyRunning = Object.values(services).some((s) => s.state === "running");
            if (anyRunning && prev.appStatus !== "running") {
              return {
                ...prev,
                services,
                runConfigExists: hasRunConfig,
                startOrder,
                appPort: primaryPort,
                appStatus: "running",
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
        if (!cancelled) {
          servicesErrorsRef.current++;
          const delay = Math.min(getBaseDelay() * Math.pow(2, servicesErrorsRef.current), 30000);
          logger.pollWarn(`services: network error — backing off ${delay}ms`, { errors: servicesErrorsRef.current });
          schedule(delay);
          return;
        }
      }
      if (!cancelled) {
        const delay = getBaseDelay();
        logger.poll(`services: ok — next poll in ${delay}ms`);
        schedule(delay);
      }
    }

    function resume() {
      if (!cancelled) { logger.poll("services: tab visible — resuming poll"); if (timer) clearTimeout(timer); pollServices(); }
    }
    resumePollRef.current = () => { prevResume?.(); resume(); };

    pollServices();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      resumePollRef.current = prevResume ?? null;
    };
  }, [session.workDir]);

  // ── Port auto-detection polling (fallback — from lsof scan) ─────────────

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prevResume = resumePollRef.current;

    function schedule(delayMs: number) {
      if (cancelled) return;
      timer = setTimeout(pollPorts, delayMs);
    }

    async function pollPorts() {
      if (cancelled) return;
      if (document.hidden) { logger.poll("ports: skipped — tab hidden"); return; }
      logger.poll("ports: poll start", { errors: portsErrorsRef.current, appStatus: stateRef.current.appStatus });
      const controller = new AbortController();
      try {
        const res = await fetch("/api/ports", { signal: controller.signal });
        if (!res.ok || cancelled) {
          portsErrorsRef.current++;
          const base = stateRef.current.appStatus === "running" ? 10000 : 3000;
          const delay = Math.min(base * Math.pow(2, portsErrorsRef.current), 30000);
          logger.pollWarn(`ports: ${res.status} — backing off ${delay}ms`, { errors: portsErrorsRef.current });
          schedule(delay);
          return;
        }
        portsErrorsRef.current = 0;
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
          const currentProjectName = session.workDir ? session.workDir.split("/").pop() : "";
          const newPorts = ports.filter(
            (p) =>
              p.port >= 41000 &&
              p.port <= 49999 &&
              !RESERVED_PORTS.has(p.port) &&
              !baselinePortsRef.current.has(p.port) &&
              (!p.projectName || p.projectName === currentProjectName)
          );

          let nextAppPort = prev.appPort;
          let nextAppStatus = prev.appStatus;

          if (newPorts.length > 0 && !prev.appPort) {
            nextAppPort = newPorts[0].port;
            nextAppStatus = "running";
            candidatePortRef.current = null;
          }

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
            appReady: nextAppPort !== prev.appPort ? false : prev.appReady,
          };
        });
      } catch {
        if (!cancelled) {
          portsErrorsRef.current++;
          const base = stateRef.current.appStatus === "running" ? 10000 : 3000;
          const delay = Math.min(base * Math.pow(2, portsErrorsRef.current), 30000);
          logger.pollWarn(`ports: network error — backing off ${delay}ms`, { errors: portsErrorsRef.current });
          schedule(delay);
          return;
        }
      }
      if (!cancelled) {
        const delay = stateRef.current.appStatus === "running" ? 10000 : 3000;
        logger.poll(`ports: ok — next poll in ${delay}ms`, { appStatus: stateRef.current.appStatus });
        schedule(delay);
      }
    }

    function resume() {
      if (!cancelled) { logger.poll("ports: tab visible — resuming poll"); if (timer) clearTimeout(timer); pollPorts(); }
    }
    resumePollRef.current = () => { prevResume?.(); resume(); };

    pollPorts();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      resumePollRef.current = prevResume ?? null;
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
