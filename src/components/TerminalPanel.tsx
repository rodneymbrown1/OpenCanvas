"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AgentTerminal } from "@/components/Terminal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { TerminalTabBar } from "@/components/TerminalTabBar";
import { useSession } from "@/lib/SessionContext";
import { useTerminals } from "@/lib/TerminalContext";
import { useView } from "@/lib/ViewContext";
import { GripHorizontal, Loader2, Plus } from "lucide-react";
import type { AgentType } from "@/lib/types/terminal";

export function TerminalPanel() {
  const { view } = useView();
  const { session, connect: sessionConnect, disconnect: sessionDisconnect } = useSession();
  const { workDir, agent: defaultAgent } = session;

  const {
    state,
    addTab,
    connectTab,
    disconnectTab,
    updateTabStatus,
    setTerminalHeight,
  } = useTerminals();
  const { tabs, activeTabId, terminalHeight } = state;

  const [isDragging, setIsDragging] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectingTabId, setConnectingTabId] = useState<string | null>(null);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyStarting, setPtyStarting] = useState(false);

  const isWorkspace = view === "workspace";

  // ── PTY server management ─────────────────────────────────────────────────

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

  // ── Drag resize ───────────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const newHeight = Math.max(120, Math.min(window.innerHeight - e.clientY, window.innerHeight - 200));
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

  // ── Tab connection handlers ───────────────────────────────────────────────

  const handleConnectTab = async (tabId: string) => {
    const ready = await checkPtyServer();
    if (!ready) await startPtyServer();
    updateTabStatus(tabId, "connecting");
  };

  const handleSessionCreated = (tabId: string, sessionId: string) => {
    connectTab(tabId, sessionId);
    // Also update legacy SessionContext for backward compat (port detection, etc.)
    sessionConnect(sessionId);
  };

  const handleReconnectFailed = (tabId: string) => {
    disconnectTab(tabId);
  };

  const handleTabCreated = (tabId: string, agent: AgentType) => {
    if (agent === "shell") {
      // Shell terminals auto-connect, no modal needed
      handleConnectTab(tabId);
    } else {
      setConnectingTabId(tabId);
      setShowConnectModal(true);
    }
  };

  const handleAddAndConnect = () => {
    if (!workDir) return;
    const tabId = addTab(defaultAgent);
    setConnectingTabId(tabId);
    setShowConnectModal(true);
  };

  const handleModalConnected = () => {
    setShowConnectModal(false);
    if (connectingTabId) {
      handleConnectTab(connectingTabId);
      setConnectingTabId(null);
    }
  };

  // Auto-connect tabs that have a sessionId but are "disconnected" (reconnect scenario)
  const autoConnectingRef = useRef(new Set<string>());
  useEffect(() => {
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
  }, [tabs, ptyReady, updateTabStatus]);

  // ── Determine which modal agent to use ────────────────────────────────────
  const connectingTab = connectingTabId ? tabs.find((t) => t.id === connectingTabId) : null;
  const modalAgent = connectingTab?.agent || defaultAgent;

  // ── Render ────────────────────────────────────────────────────────────────

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showTerminal = isWorkspace && tabs.length > 0;

  return (
    <>
      <div
        className={`flex flex-col shrink-0 ${isDragging ? "select-none" : ""}`}
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
        <TerminalTabBar onTabCreated={handleTabCreated} />

        {/* Terminal content area */}
        <div
          style={{ height: terminalHeight }}
          className="min-h-[120px] shrink-0 relative"
        >
          {tabs.length === 0 ? (
            /* Empty state: no tabs */
            <div className="flex flex-col h-full bg-[var(--bg-primary)]">
              <div className="flex-1 flex items-center justify-center">
                <button
                  onClick={handleAddAndConnect}
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
                      sessionId={
                        tab.sessionId && tab.status !== "connecting"
                          ? tab.sessionId
                          : tab.sessionId || undefined
                      }
                      tabId={tab.id}
                      visible={isActive}
                      onSessionCreated={(sid) => handleSessionCreated(tab.id, sid)}
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
                            onClick={() => handleConnectTab(tab.id)}
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
                          onClick={() => {
                            setConnectingTabId(tab.id);
                            setShowConnectModal(true);
                          }}
                          disabled={!ptyReady}
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

      {/* Connect modal — only for agent types, not plain shell */}
      {showConnectModal && modalAgent !== "shell" && (
        <ConnectAgentModal
          agent={modalAgent}
          onClose={() => {
            setShowConnectModal(false);
            setConnectingTabId(null);
          }}
          onConnected={handleModalConnected}
        />
      )}
    </>
  );
}
