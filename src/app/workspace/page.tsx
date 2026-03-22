"use client";

import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { AgentTerminal } from "@/components/Terminal";
import { AgentSelector } from "@/components/AgentSelector";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { FolderPickerModal } from "@/components/FolderPickerModal";
import { useSession } from "@/lib/SessionContext";
import Image from "next/image";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottomClose,
  PanelBottomOpen,
  FolderOpen,
  GripHorizontal,
  GripVertical,
  Loader2,
} from "lucide-react";

export default function WorkspacePage() {
  const { session, autoReconnecting, setAgent, setWorkDir, connect, disconnect } = useSession();
  const { agent, workDir, agentConnected, sessionId } = session;

  const [showExplorer, setShowExplorer] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(224);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [draggingTerminal, setDraggingTerminal] = useState(false);
  const [draggingExplorer, setDraggingExplorer] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyStarting, setPtyStarting] = useState(false);
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

  // Check PTY server status
  const checkPtyServer = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/pty-status");
      const data = await res.json();
      setPtyReady(data.running);
      return data.running;
    } catch {
      setPtyReady(false);
      return false;
    }
  }, []);

  const startPtyServer = useCallback(async () => {
    setPtyStarting(true);
    try {
      await fetch("/api/pty-status", { method: "POST" });
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkPtyServer()) break;
      }
    } catch {}
    setPtyStarting(false);
  }, [checkPtyServer]);

  useEffect(() => {
    checkPtyServer().then((running) => {
      if (!running) startPtyServer();
    });
  }, [checkPtyServer, startPtyServer]);

  // Drag handlers
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingTerminal) {
        setTerminalHeight(Math.max(120, Math.min(window.innerHeight - e.clientY, window.innerHeight - 200)));
      }
      if (draggingExplorer) {
        setExplorerWidth(Math.max(150, Math.min(e.clientX - 56, 500)));
      }
    },
    [draggingTerminal, draggingExplorer]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingTerminal(false);
    setDraggingExplorer(false);
  }, []);

  useEffect(() => {
    if (draggingTerminal || draggingExplorer) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [draggingTerminal, draggingExplorer, handleMouseMove, handleMouseUp]);

  const handleFolderSelect = async (path: string) => {
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { root: path } }),
    });
    setWorkDir(path);
    setShowFolderPicker(false);
  };

  const handleConnect = async () => {
    const ready = await checkPtyServer();
    if (!ready) await startPtyServer();
    // Session will be set when terminal sends onSessionCreated
    setShowConnectModal(false);
    setShowTerminal(true);
    // Temporarily mark connected — real session ID comes from terminal
    connect("pending");
  };

  const handleSessionCreated = (newSessionId: string) => {
    connect(newSessionId);
  };

  return (
    <div
      className={`flex flex-col h-screen ${
        draggingTerminal || draggingExplorer ? "select-none cursor-col-resize" : ""
      }`}
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
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ptyReady ? "bg-[var(--success)]" : ptyStarting ? "bg-[var(--warning)] animate-pulse" : "bg-[var(--error)]"
              }`}
            />
            {ptyReady ? "PTY" : ptyStarting ? "starting..." : "PTY offline"}
          </div>
          <AgentSelector value={agent} onChange={setAgent} />
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={showTerminal ? "Hide Terminal" : "Show Terminal"}
          >
            {showTerminal ? <PanelBottomClose size={16} /> : <PanelBottomOpen size={16} />}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
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

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)]">
            {appPort ? (
              <iframe src={`http://localhost:${appPort}`} className="w-full h-full border-0" title="App Preview" />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-6 max-w-sm">
                  <Image src="/open_canvas_logo.png" alt="Open Canvas" width={200} height={60} className="mx-auto opacity-80" priority />
                  <p className="text-sm text-[var(--text-muted)]">Your app preview will appear here. Connect an agent and start building.</p>
                </div>
              </div>
            )}
          </div>

          {showTerminal && (
            <>
              <div
                className="h-1 bg-[var(--border)] cursor-row-resize flex items-center justify-center hover:bg-[var(--accent)] transition-colors shrink-0"
                onMouseDown={() => setDraggingTerminal(true)}
              >
                <GripHorizontal size={10} className="text-[var(--text-muted)]" />
              </div>
              <div style={{ height: terminalHeight }} className="min-h-[120px] shrink-0">
                {agentConnected && ptyReady && workDir ? (
                  <AgentTerminal
                    agent={agent}
                    cwd={workDir}
                    sessionId={sessionId !== "pending" ? sessionId : undefined}
                    onSessionCreated={handleSessionCreated}
                    onReconnectFailed={disconnect}
                  />
                ) : (
                  <div className="flex flex-col h-full bg-[var(--bg-primary)]">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">TERMINAL</span>
                      <button
                        onClick={() => {
                          if (!ptyReady && !ptyStarting) startPtyServer();
                          else setShowConnectModal(true);
                        }}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        {autoReconnecting ? (
                          <><Loader2 size={12} className="animate-spin" />reconnecting...</>
                        ) : ptyStarting ? (
                          <><Loader2 size={12} className="animate-spin" />starting PTY server...</>
                        ) : !ptyReady ? (
                          <><span className="w-2 h-2 rounded-full bg-[var(--error)]" />PTY offline — click to start</>
                        ) : (
                          <><span className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />disconnected — click to connect</>
                        )}
                      </button>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <button
                        onClick={() => setShowConnectModal(true)}
                        disabled={!ptyReady}
                        className={`text-sm transition-colors ${ptyReady ? "text-[var(--text-muted)] hover:text-[var(--accent)]" : "text-[var(--text-muted)] opacity-50"}`}
                      >
                        {autoReconnecting ? "Reconnecting to previous session..." : !workDir ? "Select a folder first, then connect your agent" : !ptyReady ? "Waiting for PTY server..." : `Click to connect ${agent}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {previewFile && <FilePreviewModal filePath={previewFile} onClose={() => setPreviewFile(null)} />}
      {showConnectModal && <ConnectAgentModal agent={agent} onClose={() => setShowConnectModal(false)} onConnected={handleConnect} />}
      {showFolderPicker && <FolderPickerModal onSelect={handleFolderSelect} onClose={() => setShowFolderPicker(false)} />}
    </div>
  );
}
