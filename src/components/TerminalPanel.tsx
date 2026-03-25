
import { useState, useEffect, useCallback, useRef } from "react";
import { AgentTerminal } from "@/components/Terminal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { TerminalTabBar } from "@/components/TerminalTabBar";
import { SessionHistoryPanel } from "@/components/SessionHistoryPanel";
import { useSession } from "@/lib/SessionContext";
import { useTerminals } from "@/lib/TerminalContext";
import { useView } from "@/lib/ViewContext";
import { GripHorizontal, Loader2, Plus } from "lucide-react";
import type { AgentType, SessionHistoryEntry } from "@/lib/types/terminal";
import { logger } from "@/lib/logger";

export function TerminalPanel() {
  const { view } = useView();
  const { session, connect: sessionConnect } = useSession();
  const { workDir } = session;

  const {
    state,
    addTab,
    connectTab,
    disconnectTab,
    updateTabStatus,
    setTerminalHeight,
    reconciling,
  } = useTerminals();
  const { tabs, activeTabId, terminalHeight } = state;

  const [isDragging, setIsDragging] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyStarting, setPtyStarting] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<SessionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isWorkspace = view === "workspace";

  // ── PTY server management ─────────────────────────────────────────────────

  const checkPtyServer = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/pty-status");
      const data = await res.json();
      logger.terminal(`PTY server status: ${data.running ? "running" : "stopped"}`);
      setPtyReady(data.running);
      return data.running;
    } catch {
      logger.terminal("PTY server check failed");
      setPtyReady(false);
      return false;
    }
  }, []);

  const startPtyServer = useCallback(async () => {
    logger.terminal("Starting PTY server...");
    setPtyStarting(true);
    try {
      await fetch("/api/pty-status", { method: "POST" });
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await checkPtyServer()) break;
      }
    } catch {}
    setPtyStarting(false);
    logger.terminal("PTY server start sequence complete");
  }, [checkPtyServer]);

  // Auto-start PTY server on mount
  useEffect(() => {
    checkPtyServer().then((running) => {
      if (!running) startPtyServer();
    });
  }, [checkPtyServer, startPtyServer]);

  // ── Drag resize ───────────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const newHeight = Math.max(
        120,
        Math.min(window.innerHeight - e.clientY, window.innerHeight - 200)
      );
      setTerminalHeight(newHeight);
    },
    [isDragging, setTerminalHeight]
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

  // ── Connection handlers ───────────────────────────────────────────────────

  const ensurePtyReady = useCallback(async () => {
    const ready = await checkPtyServer();
    if (!ready) await startPtyServer();
  }, [checkPtyServer, startPtyServer]);

  const handleSessionCreated = (tabId: string, sessionId: string) => {
    connectTab(tabId, sessionId);
    // Also update legacy SessionContext for backward compat (port detection, etc.)
    sessionConnect(sessionId);
  };

  const handleReconnectFailed = (tabId: string) => {
    disconnectTab(tabId);
  };

  // ── "+" button and modal flow ─────────────────────────────────────────────

  const handleAddClicked = () => {
    if (!workDir) return;
    setShowConnectModal(true);
  };

  const handleModalConnected = async (agent: AgentType) => {
    setShowConnectModal(false);
    if (!workDir) return; // Guard against workDir clearing between click and connect
    // Create the tab and immediately start connecting
    const tabId = addTab(agent);
    await ensurePtyReady();
    updateTabStatus(tabId, "connecting");
  };

  const handleModalClosed = () => {
    setShowConnectModal(false);
  };

  // ── History panel ─────────────────────────────────────────────────────────

  const handleHistoryClicked = useCallback(async () => {
    if (showHistoryPanel) {
      setShowHistoryPanel(false);
      return;
    }
    if (!workDir) return;
    setShowHistoryPanel(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/session-history?cwd=${encodeURIComponent(workDir)}&limit=100`
      );
      if (res.ok) {
        const data = await res.json();
        setHistoryEntries(data.entries || []);
      }
    } catch {
      logger.terminal("Failed to fetch session history");
    }
    setHistoryLoading(false);
  }, [showHistoryPanel, workDir]);

  const handleHistoryClosed = useCallback(() => {
    setShowHistoryPanel(false);
  }, []);

  const handleRestore = useCallback(
    async (entry: SessionHistoryEntry) => {
      setShowHistoryPanel(false);
      if (!workDir) return;
      const tabId = addTab(entry.agent, {
        resumeSessionId: entry.sessionId,
        label: entry.label,
      });
      await ensurePtyReady();
      updateTabStatus(tabId, "connecting");
    },
    [workDir, addTab, ensurePtyReady, updateTabStatus]
  );

  // ── Auto-reconnect tabs with existing sessionIds on mount / project switch ──
  // Wait for reconciliation to finish so we don't try to reconnect stale sessions
  const autoConnectingRef = useRef(new Set<string>());

  // Clear tracking set when switching projects so new project's tabs can reconnect
  useEffect(() => {
    autoConnectingRef.current.clear();
  }, [workDir]);
  useEffect(() => {
    if (reconciling) return; // Wait for PTY session validation to complete
    for (const tab of tabs) {
      if (
        tab.sessionId &&
        tab.status === "disconnected" &&
        ptyReady &&
        !autoConnectingRef.current.has(tab.id)
      ) {
        autoConnectingRef.current.add(tab.id);
        updateTabStatus(tab.id, "connecting");
      }
    }
  }, [tabs, ptyReady, reconciling, updateTabStatus]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className={`flex flex-col shrink-0 w-full overflow-hidden ${isDragging ? "select-none" : ""}`}
        style={{ display: isWorkspace ? "flex" : "none" }}
      >
        {/* Resize handle */}
        <div
          className="h-1 bg-[var(--border)] cursor-row-resize flex items-center justify-center hover:bg-[var(--accent)] transition-colors shrink-0"
          onMouseDown={() => setIsDragging(true)}
        >
          <GripHorizontal size={10} className="text-[var(--text-muted)]" />
        </div>

        {/* Tab bar */}
        <div className="relative">
          <TerminalTabBar
            onAddClicked={handleAddClicked}
            onHistoryClicked={handleHistoryClicked}
          />
          {showHistoryPanel && (
            <SessionHistoryPanel
              entries={historyEntries}
              loading={historyLoading}
              onRestore={handleRestore}
              onClose={handleHistoryClosed}
            />
          )}
        </div>

        {/* Terminal content area */}
        <div
          style={{ height: terminalHeight }}
          className="min-h-[120px] shrink-0 relative w-full overflow-hidden"
        >
          {tabs.length === 0 ? (
            /* Empty state: no tabs */
            <div className="flex flex-col h-full bg-[var(--bg-primary)]">
              <div className="flex-1 flex items-center justify-center">
                <button
                  onClick={handleAddClicked}
                  disabled={!workDir}
                  className={`flex items-center gap-2 text-sm transition-colors ${
                    workDir
                      ? "text-[var(--text-muted)] hover:text-[var(--accent)]"
                      : "text-[var(--text-muted)] opacity-50"
                  }`}
                >
                  <Plus size={16} />
                  {!workDir
                    ? "Select a folder first, then create a terminal"
                    : "Create a terminal to get started"}
                </button>
              </div>
            </div>
          ) : (
            /* Render all tab terminals — only active one visible */
            tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const shouldRender =
                tab.status === "connecting" || tab.status === "connected";

              return (
                <div
                  key={tab.id}
                  className="absolute inset-0"
                  style={{ display: isActive ? "flex" : "none" }}
                >
                  {shouldRender && ptyReady && workDir ? (
                    <AgentTerminal
                      agent={tab.agent}
                      cwd={workDir}
                      sessionId={tab.sessionId || undefined}
                      tabId={tab.id}
                      visible={isActive}
                      resumeSessionId={tab.resumeSessionId}
                      onSessionCreated={(sid) =>
                        handleSessionCreated(tab.id, sid)
                      }
                      onReconnectFailed={() => handleReconnectFailed(tab.id)}
                    />
                  ) : tab.status === "exited" ? (
                    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-2">
                          <p className="text-sm text-[var(--text-muted)]">
                            Session ended
                          </p>
                          <button
                            onClick={async () => {
                              await ensurePtyReady();
                              updateTabStatus(tab.id, "connecting");
                            }}
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            Reconnect
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
                      <div className="flex-1 flex items-center justify-center">
                        <button
                          onClick={async () => {
                            await ensurePtyReady();
                            updateTabStatus(tab.id, "connecting");
                          }}
                          disabled={!ptyReady && !ptyStarting}
                          className={`text-sm transition-colors ${
                            ptyReady
                              ? "text-[var(--text-muted)] hover:text-[var(--accent)]"
                              : "text-[var(--text-muted)] opacity-50"
                          }`}
                        >
                          {ptyStarting ? (
                            <span className="flex items-center gap-2">
                              <Loader2 size={14} className="animate-spin" />
                              Starting PTY server...
                            </span>
                          ) : !ptyReady ? (
                            "Waiting for PTY server..."
                          ) : (
                            `Click to connect ${tab.agent}`
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Connect modal with built-in agent picker */}
      {showConnectModal && (
        <ConnectAgentModal
          onClose={handleModalClosed}
          onConnected={handleModalConnected}
        />
      )}
    </>
  );
}
