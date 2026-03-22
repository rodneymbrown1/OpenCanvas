"use client";

import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { AgentSelector } from "@/components/AgentSelector";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { FolderPickerModal } from "@/components/FolderPickerModal";
import { ProjectStatusBar } from "@/components/ProjectStatusBar";
import { useSession } from "@/lib/SessionContext";
import { useProject } from "@/lib/ProjectContext";
import Image from "next/image";
import {
  PanelLeftClose,
  PanelLeftOpen,
  FolderOpen,
  RefreshCw,
  ExternalLink,
  X,
  Play,
  Loader2,
  Square,
} from "lucide-react";

function AppControls() {
  const { state: project, startApp, stopApp } = useProject();

  if (project.appStatus === "building" || project.appStatus === "initializing") {
    return (
      <div className="space-y-3 max-w-md">
        <div className="flex items-center justify-center gap-2 text-xs text-[var(--accent)]">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {project.appStatus === "initializing"
              ? "Asking agent to start the dev server..."
              : "Starting app..."}
          </span>
        </div>
        {project.startupLog.length > 0 && (
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3 text-left">
            <pre className="text-[10px] leading-relaxed text-[var(--text-muted)] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {project.startupLog.slice(-10).join("\n")}
            </pre>
          </div>
        )}
        <button
          onClick={stopApp}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (project.appStatus === "error") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-[var(--error)]">Failed to start app</p>
        {project.startupLog.length > 0 && (
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-3 text-left max-w-md">
            <pre className="text-[10px] leading-relaxed text-[var(--text-muted)] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {project.startupLog.slice(-10).join("\n")}
            </pre>
          </div>
        )}
        <button
          onClick={startApp}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Play size={14} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startApp}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
    >
      <Play size={14} />
      Run App
    </button>
  );
}

export default function WorkspaceView() {
  const { session, setAgent, setWorkDir } = useSession();
  const { agent, workDir } = session;
  const { state: project, refreshAppPreview, clearAppPort, stopApp } = useProject();

  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(224);
  const [draggingExplorer, setDraggingExplorer] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Load config on mount
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.workspace?.root && !workDir) {
          setWorkDir(config.workspace.root);
        }
        if (config.agent?.active && agent === "claude") {
          setAgent(config.agent.active);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explorer resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingExplorer) return;
      setExplorerWidth(Math.max(150, Math.min(e.clientX - 56, 500)));
    },
    [draggingExplorer]
  );

  const handleMouseUp = useCallback(() => setDraggingExplorer(false), []);

  useEffect(() => {
    if (draggingExplorer) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [draggingExplorer, handleMouseMove, handleMouseUp]);

  const handleFolderSelect = async (path: string) => {
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { root: path } }),
    });
    setWorkDir(path);
    setShowFolderPicker(false);
  };

  return (
    <div
      className={`flex flex-col h-full ${draggingExplorer ? "select-none cursor-col-resize" : ""}`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={showExplorer ? "Hide Explorer" : "Show Explorer"}
          >
            {showExplorer ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            onClick={() => setShowFolderPicker(true)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
              workDir
                ? "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                : "text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <FolderOpen size={13} />
            {workDir ? <span className="truncate max-w-[300px]">{workDir}</span> : "Select Folder"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <AgentSelector value={agent} onChange={setAgent} />
        </div>
      </div>

      {/* Project status bar */}
      <ProjectStatusBar />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* File explorer (resizable) */}
        {showExplorer && (
          <>
            <div
              style={{ width: explorerWidth }}
              className="border-r border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shrink-0"
            >
              {workDir ? (
                <FileExplorer onFilePreview={setPreviewFile} />
              ) : (
                <div className="p-3 space-y-3">
                  <p className="text-xs text-[var(--text-muted)]">No folder open.</p>
                  <button
                    onClick={() => setShowFolderPicker(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)] text-xs text-[var(--text-secondary)] transition-colors"
                  >
                    <FolderOpen size={14} className="text-[var(--accent)]" />
                    Open Folder
                  </button>
                </div>
              )}
            </div>
            <div
              className="w-1 bg-[var(--border)] cursor-col-resize hover:bg-[var(--accent)] transition-colors shrink-0"
              onMouseDown={() => setDraggingExplorer(true)}
            />
          </>
        )}

        {/* App preview */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)] flex flex-col">
          {project.appPort ? (
            <>
              {/* App preview toolbar */}
              <div className="flex items-center justify-between px-3 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                  <span>localhost:{project.appPort}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={refreshAppPreview}
                    className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Refresh preview"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <a
                    href={`http://localhost:${project.appPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Open in browser"
                  >
                    <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={stopApp}
                    className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Stop app"
                  >
                    <Square size={10} />
                  </button>
                </div>
              </div>
              {/* Iframe */}
              <iframe
                key={project.iframeKey}
                src={`http://localhost:${project.appPort}`}
                className="flex-1 border-0"
                title="App Preview"
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-6 max-w-sm">
                <Image src="/open_canvas_logo.png" alt="Open Canvas" width={200} height={60} className="mx-auto opacity-80" priority />
                <p className="text-sm text-[var(--text-muted)]">
                  Your app preview will appear here.
                </p>
                {session.agentConnected ? (
                  <AppControls />
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    Connect an agent to get started.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {previewFile && <FilePreviewModal filePath={previewFile} onClose={() => setPreviewFile(null)} />}
      {showFolderPicker && <FolderPickerModal onSelect={handleFolderSelect} onClose={() => setShowFolderPicker(false)} />}
    </div>
  );
}
