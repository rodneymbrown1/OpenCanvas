"use client";

import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { AgentSelector } from "@/components/AgentSelector";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { FolderPickerModal } from "@/components/FolderPickerModal";
import { useSession } from "@/lib/SessionContext";
import Image from "next/image";
import {
  PanelLeftClose,
  PanelLeftOpen,
  FolderOpen,
  GripVertical,
} from "lucide-react";

export default function WorkspacePage() {
  const { session, setAgent, setWorkDir } = useSession();
  const { agent, workDir, agentConnected } = session;

  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(224);
  const [draggingExplorer, setDraggingExplorer] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [appPort, setAppPort] = useState<number | null>(null);

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
        <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)]">
          {appPort ? (
            <iframe src={`http://localhost:${appPort}`} className="w-full h-full border-0" title="App Preview" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-6 max-w-sm">
                <Image src="/open_canvas_logo.png" alt="Open Canvas" width={200} height={60} className="mx-auto opacity-80" priority />
                <p className="text-sm text-[var(--text-muted)]">
                  Your app preview will appear here. Connect an agent and start building.
                </p>
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
