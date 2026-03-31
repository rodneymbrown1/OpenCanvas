
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/SessionContext";
import { useView } from "@/lib/ViewContext";
import { useProject } from "@/lib/ProjectContext";
import {
  FolderOpen,
  Plus,
  Trash2,
  Clock,
  ExternalLink,
  HardDrive,
  RefreshCw,
  CheckCircle,
  FolderSearch,
  AlertTriangle,
  Wifi,
  WifiOff,
  Square,
  Play,
  Loader2,
} from "lucide-react";
import { CalendarAccordion } from "@/components/CalendarAccordion";

interface ProjectEntry {
  name: string;
  path: string;
  lastOpened?: string;
  description?: string;
  exists?: boolean;
}

interface SharedFile {
  name: string;
  path: string;
  size: number;
}

interface GlobalState {
  configured: boolean;
  home: string;
  sharedDataDir: string;
  projects: ProjectEntry[];
  sharedData: SharedFile[];
}

// ── Setup Screen ──────────────────────────────────────────────────────────────

function SetupScreen({ onSetup }: { onSetup: (home?: string) => void }) {
  const [customPath, setCustomPath] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md w-full space-y-6 p-6">
        <div className="text-center space-y-2">
          <HardDrive size={32} className="mx-auto text-[var(--accent)]" />
          <h1 className="text-xl font-bold">Set Up Open Canvas</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Create a home directory where Open Canvas stores your projects,
            shared data, and global settings.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => { setUseCustom(false); onSetup(); }}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${
              !useCustom
                ? "border-[var(--accent)] bg-[var(--accent)]/5"
                : "border-[var(--border)] hover:border-[var(--text-muted)]"
            }`}
          >
            <p className="text-sm font-medium">Default Location</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
              ~/.open-canvas/
            </p>
          </button>

          <button
            onClick={() => setUseCustom(true)}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${
              useCustom
                ? "border-[var(--accent)] bg-[var(--accent)]/5"
                : "border-[var(--border)] hover:border-[var(--text-muted)]"
            }`}
          >
            <p className="text-sm font-medium">Custom Location</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Choose where to store Open Canvas data
            </p>
          </button>

          {useCustom && (
            <div className="flex gap-2">
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/path/to/open-canvas-home"
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                onClick={() => onSetup(customPath || undefined)}
                disabled={!customPath}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
              >
                Set Up
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-[var(--text-muted)] text-center">
          This creates: global.yaml, shared-data/, and a project registry.
        </p>
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

const revealInFinder = (path: string) =>
  fetch("/api/files/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });

export default function ProjectsView() {
  const { session, setWorkDir } = useSession();
  const { setView } = useView();
  const { state: projectState, stopApp } = useProject();
  const [state, setState] = useState<GlobalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  // Server status for non-current projects: path -> { running, port, services }
  interface ProjectServiceStatus {
    running: boolean;
    port: number | null;
    services: Record<string, { name: string; state: string; type?: string; port?: number }>;
    hasRunConfig: boolean;
  }
  const [serverStatus, setServerStatus] = useState<Record<string, ProjectServiceStatus>>({});
  const [stoppingPaths, setStoppingPaths] = useState<Set<string>>(new Set());

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setState(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Poll server status for all registered projects
  useEffect(() => {
    if (!state?.projects.length) return;

    async function pollServerStatus() {
      const statuses: Record<string, ProjectServiceStatus> = {};
      await Promise.all(
        state!.projects.map(async (project) => {
          try {
            // Try multi-service endpoint first
            const svcRes = await fetch(`/api/services?cwd=${encodeURIComponent(project.path)}`);
            if (svcRes.ok) {
              const svcData = await svcRes.json();
              const services = svcData.services || {};
              const runningServices = Object.values(services).filter(
                (s: unknown) => (s as { state: string }).state === "running"
              );
              const primaryPort = (Object.values(services).find(
                (s: unknown) => (s as { state: string; port?: number }).state === "running" && (s as { port?: number }).port
              ) as { port?: number } | undefined)?.port || null;

              statuses[project.path] = {
                running: runningServices.length > 0,
                port: primaryPort,
                services,
                hasRunConfig: !!svcData.hasRunConfig,
              };
              return;
            }
          } catch {
            // Fall through to legacy stack check
          }
          try {
            const res = await fetch(`/api/stack?cwd=${encodeURIComponent(project.path)}`);
            if (res.ok) {
              const data = await res.json();
              statuses[project.path] = {
                running: !!data.running,
                port: data.session?.detectedPort || null,
                services: {},
                hasRunConfig: false,
              };
            } else {
              statuses[project.path] = { running: false, port: null, services: {}, hasRunConfig: false };
            }
          } catch {
            statuses[project.path] = { running: false, port: null, services: {}, hasRunConfig: false };
          }
        })
      );
      setServerStatus(statuses);
    }

    pollServerStatus();
    const interval = setInterval(pollServerStatus, 5000);
    return () => clearInterval(interval);
  }, [state?.projects]);

  const handleStopServer = async (projectPath: string) => {
    setStoppingPaths((prev) => new Set(prev).add(projectPath));
    // Stop multi-service sessions
    try {
      await fetch("/api/services?action=stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
    } catch {}
    // Also stop legacy stack session
    try {
      await fetch("/api/stack?action=stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
    } catch {}
    setStoppingPaths((prev) => {
      const next = new Set(prev);
      next.delete(projectPath);
      return next;
    });
    // Refresh server status
    setServerStatus((prev) => ({
      ...prev,
      [projectPath]: { running: false, port: null, services: {}, hasRunConfig: prev[projectPath]?.hasRunConfig ?? false },
    }));
  };

  const handleSetup = async (customHome?: string) => {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup", customHome }),
    });
    fetchState();
  };

  const handleCreate = async (name: string) => {
    setCreateError("");
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Failed to create project");
        return;
      }
      setShowCreate(false);
      setNewName("");
      fetchState();
    } finally {
      setCreating(false);
    }
  };

  const handleRegister = async (projectPath: string, name?: string) => {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", path: projectPath, name }),
    });
    fetchState();
  };

  const handleRemove = async (projectPath: string) => {
    const name = projectPath.split("/").pop() || projectPath;
    if (!confirm(`Remove project "${name}" from the registry? (The files on disk will not be deleted.)`)) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", path: projectPath }),
    });
    fetchState();
  };

  const handleOpen = async (project: ProjectEntry) => {
    // Register the open (updates lastOpened)
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", path: project.path, name: project.name }),
    });
    // Update workspace root
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { root: project.path } }),
    });
    setWorkDir(project.path);
    setView("workspace");
  };

  const handleOpenInNewTab = (project: ProjectEntry) => {
    // Register the open
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", path: project.path, name: project.name }),
    }).catch(() => {});
    // Open in new tab with project param
    const url = `/workspace?project=${encodeURIComponent(project.path)}`;
    window.open(url, "_blank");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        Loading...
      </div>
    );
  }

  // First-time setup
  if (!state?.configured) {
    return <SetupScreen onSetup={handleSetup} />;
  }

  const isCurrentProject = (p: ProjectEntry) => p.path === session.workDir;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Project Manager</h1>
          <span className="text-xs text-[var(--text-muted)]">
            {state.projects.length} project{state.projects.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateError(""); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus size={12} />
            New Project
          </button>
          <button
            onClick={fetchState}
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Create project */}
        {showCreate && (
          <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
            <form
              onSubmit={(e) => { e.preventDefault(); if (newName.trim()) handleCreate(newName.trim()); }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                autoFocus
                className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-xs focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim() || creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs disabled:opacity-50"
              >
                {creating && <Loader2 size={11} className="animate-spin" />}
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(""); setCreateError(""); }}
                className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Cancel
              </button>
            </form>
            {createError && <p className="text-[11px] text-[var(--error)] px-1">{createError}</p>}
            {state?.home && (
              <p className="text-[10px] text-[var(--text-muted)] px-1">
                Creates in: {state.home}/projects/{newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "..."}
              </p>
            )}
          </div>
        )}

        {/* Auto-register current workspace if not in list */}
        {session.workDir && !state.projects.find((p) => p.path === session.workDir) && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
            <div className="flex items-center gap-2 text-xs">
              <FolderOpen size={14} className="text-[var(--accent)]" />
              <span>Current workspace not registered:</span>
              <span className="font-mono text-[var(--text-muted)]">{session.workDir}</span>
            </div>
            <button
              onClick={() => handleRegister(session.workDir)}
              className="px-2.5 py-1 rounded text-xs bg-[var(--accent)] text-white"
            >
              Register
            </button>
          </div>
        )}

        {/* Global info — above projects */}
        <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-[var(--accent)]" />
              <span className="text-xs font-medium">Open Canvas Home</span>
            </div>
            <div className="flex items-center gap-2">
              {state.sharedData.length > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {state.sharedData.length} shared file{state.sharedData.length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={() => revealInFinder(state.home)}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                title="Reveal in Finder"
              >
                <FolderSearch size={12} />
              </button>
            </div>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1 ml-5">{state.home}</p>
        </div>

        {/* Calendar accordion */}
        <CalendarAccordion />

        {/* Projects grid */}
        {state.projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {state.projects.map((project) => {
              const isCurrent = isCurrentProject(project);
              return (
                <div
                  key={project.path}
                  className={`p-4 rounded-xl border transition-colors ${
                    isCurrent
                      ? "border-[var(--accent)] bg-[var(--accent)]/5"
                      : "border-[var(--border)] hover:border-[var(--text-muted)]"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium truncate">{project.name}</h3>
                        {isCurrent && (
                          <span className="flex items-center gap-1 text-[10px] text-[var(--accent)]">
                            <CheckCircle size={10} /> active
                          </span>
                        )}
                        {project.exists === false && (
                          <span className="flex items-center gap-1 text-[10px] text-[var(--error)]">
                            <AlertTriangle size={10} /> missing
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] font-mono truncate mt-0.5">
                        {project.path}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {project.lastOpened && (
                          <p className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                            <Clock size={9} />
                            {new Date(project.lastOpened).toLocaleDateString()}
                          </p>
                        )}
                        {/* Server status indicator with service topology */}
                        {(() => {
                          const status = isCurrent
                            ? { running: !!projectState.appPort, port: projectState.appPort, services: projectState.services, hasRunConfig: projectState.runConfigExists }
                            : serverStatus[project.path] || { running: false, port: null, services: {}, hasRunConfig: false };
                          const isStopping = stoppingPaths.has(project.path);
                          const serviceEntries = Object.values(status.services || {});
                          const hasServices = serviceEntries.length > 0;
                          const runningCount = serviceEntries.filter((s) => s.state === "running").length;

                          if (hasServices && runningCount > 0) {
                            return (
                              <div className="flex flex-col gap-1 mt-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                                    <Wifi size={10} /> {runningCount}/{serviceEntries.length} services
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isCurrent) stopApp();
                                      else handleStopServer(project.path);
                                    }}
                                    disabled={isStopping}
                                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] border border-[var(--border)] transition-colors disabled:opacity-50"
                                    title="Stop all services"
                                  >
                                    <Square size={8} /> {isStopping ? "Stopping..." : "Stop"}
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                  {serviceEntries.map((svc) => (
                                    <span key={svc.name} className="flex items-center gap-1 text-[10px]">
                                      <span className={`w-1.5 h-1.5 rounded-full ${
                                        svc.state === "running" ? "bg-green-400" :
                                        svc.state === "starting" ? "bg-yellow-400" :
                                        "bg-[var(--text-muted)]"
                                      }`} />
                                      <span className="font-mono text-[var(--text-muted)]">{svc.name}</span>
                                      {svc.port && <span className="font-mono text-[var(--text-muted)]">:{svc.port}</span>}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          }

                          if (hasServices && runningCount === 0) {
                            return (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                                  <WifiOff size={10} /> {serviceEntries.length} service{serviceEntries.length !== 1 ? "s" : ""} configured
                                </span>
                              </div>
                            );
                          }

                          // Legacy single-port display
                          if (status.running && status.port) {
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                                  <Wifi size={10} /> :{status.port}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isCurrent) stopApp();
                                    else handleStopServer(project.path);
                                  }}
                                  disabled={isStopping}
                                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] border border-[var(--border)] transition-colors disabled:opacity-50"
                                  title="Stop server"
                                >
                                  <Square size={8} /> {isStopping ? "Stopping..." : "Stop"}
                                </button>
                              </div>
                            );
                          }
                          if (status.running && !status.port) {
                            return (
                              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                                <Wifi size={10} /> starting...
                              </span>
                            );
                          }
                          return (
                            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                              <WifiOff size={10} /> no server
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {!isCurrent ? (
                        <>
                          <button
                            onClick={() => handleOpen(project)}
                            disabled={project.exists === false}
                            className="px-2.5 py-1 rounded text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleOpenInNewTab(project)}
                            disabled={project.exists === false}
                            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                            title="Open in new tab"
                          >
                            <ExternalLink size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpenInNewTab(project)}
                          className="px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] border border-[var(--border)] transition-colors"
                          title="Open in new tab"
                        >
                          new tab
                        </button>
                      )}
                      <button
                        onClick={() => revealInFinder(project.path)}
                        className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                        title="Reveal in Finder"
                      >
                        <FolderSearch size={12} />
                      </button>
                      <button
                        onClick={() => handleRemove(project.path)}
                        className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 transition-colors"
                        title="Remove from list"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <FolderOpen size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No projects registered</p>
            <p className="text-xs mt-1">Add a project or open a folder to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
