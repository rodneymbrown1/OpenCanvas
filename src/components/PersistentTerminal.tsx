"use client";

import { useState, useEffect, useCallback } from "react";
import { AgentTerminal } from "@/components/Terminal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { useSession } from "@/lib/SessionContext";
import { useView } from "@/lib/ViewContext";
import { GripHorizontal, Loader2 } from "lucide-react";

export function PersistentTerminal() {
  const { view } = useView();
  const { session, autoReconnecting, connect, disconnect } = useSession();
  const { agent, workDir, agentConnected, sessionId } = session;

  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [isDragging, setIsDragging] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyStarting, setPtyStarting] = useState(false);

  const isWorkspace = view === "workspace";

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

  // Auto-start PTY server on mount
  useEffect(() => {
    checkPtyServer().then((running) => {
      if (!running) startPtyServer();
    });
  }, [checkPtyServer, startPtyServer]);

  // Drag resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      setTerminalHeight(
        Math.max(120, Math.min(window.innerHeight - e.clientY, window.innerHeight - 200))
      );
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleConnect = async () => {
    const ready = await checkPtyServer();
    if (!ready) await startPtyServer();
    setShowConnectModal(false);
    setShowTerminal(true);
    connect("pending");
  };

  const handleSessionCreated = (newSessionId: string) => {
    connect(newSessionId);
  };

  // The terminal panel is ALWAYS in the DOM but hidden when not on /workspace.
  // This preserves the xterm.js instance, WebSocket, and scrollback across navigation.
  return (
    <>
      <div
        className={`flex flex-col shrink-0 ${isDragging ? "select-none" : ""}`}
        style={{ display: isWorkspace && showTerminal ? "flex" : "none" }}
      >
        {/* Resize handle */}
        <div
          className="h-1 bg-[var(--border)] cursor-row-resize flex items-center justify-center hover:bg-[var(--accent)] transition-colors shrink-0"
          onMouseDown={() => setIsDragging(true)}
        >
          <GripHorizontal size={10} className="text-[var(--text-muted)]" />
        </div>

        {/* Terminal content */}
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
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  TERMINAL
                </span>
                <button
                  onClick={() => {
                    if (!ptyReady && !ptyStarting) startPtyServer();
                    else setShowConnectModal(true);
                  }}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {autoReconnecting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      reconnecting...
                    </>
                  ) : ptyStarting ? (
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
                  {autoReconnecting
                    ? "Reconnecting to previous session..."
                    : !workDir
                    ? "Select a folder first, then connect your agent"
                    : !ptyReady
                    ? "Waiting for PTY server..."
                    : `Click to connect ${agent}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Connect modal */}
      {showConnectModal && (
        <ConnectAgentModal
          agent={agent}
          onClose={() => setShowConnectModal(false)}
          onConnected={handleConnect}
        />
      )}
    </>
  );
}

// Export toggle hook for workspace top bar
export { };
