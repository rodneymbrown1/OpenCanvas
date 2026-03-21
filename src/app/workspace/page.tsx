"use client";

import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { AgentTerminal } from "@/components/Terminal";
import { AgentSelector, useActiveAgent } from "@/components/AgentSelector";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottomClose,
  PanelBottomOpen,
  FolderOpen,
  GripHorizontal,
  Loader2,
} from "lucide-react";

export default function WorkspacePage() {
  const [agent, setAgent] = useActiveAgent();
  const [workDir, setWorkDir] = useState("");
  const [showExplorer, setShowExplorer] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyStarting, setPtyStarting] = useState(false);
  const [appPort, setAppPort] = useState<number | null>(null);

  // Load config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        setWorkDir(config.workspace?.root || "");
      })
      .catch(() => {});
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

  // Start PTY server if not running
  const startPtyServer = useCallback(async () => {
    setPtyStarting(true);
    console.log("[OpenCanvas] Starting PTY server...");
    try {
      const res = await fetch("/api/pty-status", { method: "POST" });
      const data = await res.json();
      console.log("[OpenCanvas] PTY start response:", data);
      if (data.started) {
        // Poll until ready
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const ready = await checkPtyServer();
          if (ready) {
            console.log("[OpenCanvas] PTY server is ready");
            break;
          }
        }
      }
    } catch (err) {
      console.error("[OpenCanvas] Failed to start PTY server:", err);
    }
    setPtyStarting(false);
  }, [checkPtyServer]);

  // On mount: check PTY server, auto-start if needed
  useEffect(() => {
    checkPtyServer().then((running) => {
      if (!running) {
        console.log("[OpenCanvas] PTY server not running, starting...");
        startPtyServer();
      }
    });
  }, [checkPtyServer, startPtyServer]);

  const handleDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const newHeight = window.innerHeight - e.clientY;
      setTerminalHeight(
        Math.max(120, Math.min(newHeight, window.innerHeight - 200))
      );
    },
    [isDragging]
  );

  const setWorkspace = async () => {
    const dir = prompt("Enter the path to your project folder:");
    if (!dir?.trim()) return;
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { root: dir.trim() } }),
    });
    setWorkDir(dir.trim());
  };

  const handleConnect = async () => {
    // Ensure PTY server is running before connecting
    const ready = await checkPtyServer();
    if (!ready) {
      console.log("[OpenCanvas] PTY not ready, starting...");
      await startPtyServer();
    }
    setAgentConnected(true);
    setShowConnectModal(false);
    setShowTerminal(true);
  };

  return (
    <div
      className="flex flex-col h-screen select-none"
      onMouseMove={handleDrag}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={showExplorer ? "Hide Explorer" : "Show Explorer"}
          >
            {showExplorer ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>

          {workDir ? (
            <button
              onClick={setWorkspace}
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <FolderOpen size={13} />
              <span className="truncate max-w-[300px]">{workDir}</span>
            </button>
          ) : (
            <button
              onClick={setWorkspace}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <FolderOpen size={13} />
              Select Folder
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* PTY status indicator */}
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ptyReady
                  ? "bg-[var(--success)]"
                  : ptyStarting
                  ? "bg-[var(--warning)] animate-pulse"
                  : "bg-[var(--error)]"
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
            {showTerminal ? (
              <PanelBottomClose size={16} />
            ) : (
              <PanelBottomOpen size={16} />
            )}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {showExplorer && (
          <div className="w-56 border-r border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shrink-0">
            {workDir ? (
              <FileExplorer onFilePreview={setPreviewFile} />
            ) : (
              <div className="p-3 text-xs text-[var(--text-muted)]">
                Select a folder to browse files.
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* App preview area */}
          <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)]">
            {appPort ? (
              <iframe
                src={`http://localhost:${appPort}`}
                className="w-full h-full border-0"
                title="App Preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4 max-w-sm">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] text-2xl font-bold mx-auto">
                    OC
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">
                    Your app preview will appear here. Connect an agent and
                    start building.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Terminal (collapsible) */}
          {showTerminal && (
            <>
              <div
                className="h-1 bg-[var(--border)] cursor-row-resize flex items-center justify-center hover:bg-[var(--accent)] transition-colors shrink-0"
                onMouseDown={() => setIsDragging(true)}
              >
                <GripHorizontal
                  size={10}
                  className="text-[var(--text-muted)]"
                />
              </div>

              <div
                style={{ height: terminalHeight }}
                className="min-h-[120px] shrink-0"
              >
                {agentConnected && ptyReady && workDir ? (
                  <AgentTerminal agent={agent} cwd={workDir} />
                ) : (
                  <div className="flex flex-col h-full bg-[var(--bg-primary)]">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">
                        TERMINAL
                      </span>
                      <button
                        onClick={() => {
                          if (!ptyReady && !ptyStarting) {
                            startPtyServer();
                          } else {
                            setShowConnectModal(true);
                          }
                        }}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        {ptyStarting ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            starting PTY server...
                          </>
                        ) : !ptyReady ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-[var(--error)]" />
                            PTY offline — click to start
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                            disconnected — click to connect
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <button
                        onClick={() => setShowConnectModal(true)}
                        disabled={!ptyReady}
                        className={`text-sm transition-colors ${
                          ptyReady
                            ? "text-[var(--text-muted)] hover:text-[var(--accent)]"
                            : "text-[var(--text-muted)] opacity-50"
                        }`}
                      >
                        {!workDir
                          ? "Select a folder first, then connect your agent"
                          : !ptyReady
                          ? "Waiting for PTY server..."
                          : `Click to connect ${agent}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {previewFile && (
        <FilePreviewModal
          filePath={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {showConnectModal && (
        <ConnectAgentModal
          agent={agent}
          onClose={() => setShowConnectModal(false)}
          onConnected={handleConnect}
        />
      )}
    </div>
  );
}
