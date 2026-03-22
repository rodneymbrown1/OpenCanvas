"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  agent: "claude" | "codex" | "gemini" | "shell";
  cwd: string;
  ptyPort?: number;
  sessionId?: string | null;
  onSessionCreated?: (sessionId: string) => void;
  onReconnectFailed?: () => void;
}

export function AgentTerminal({
  agent,
  cwd,
  ptyPort = 3001,
  sessionId,
  onSessionCreated,
  onReconnectFailed,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up previous terminal UI only (not the WS — it may be reused)
    if (termRef.current) {
      termRef.current.dispose();
    }

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#3b82f6",
        selectionBackground: "#3b82f644",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Close previous WebSocket if exists
    if (wsRef.current) {
      wsRef.current.close();
    }

    console.log(`[Terminal] Connecting to ws://localhost:${ptyPort}...`);
    const ws = new WebSocket(`ws://localhost:${ptyPort}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);

      if (sessionId) {
        // Reconnect to existing session
        console.log(`[Terminal] Reconnecting to session ${sessionId}`);
        term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Reconnecting to ${agent}...`);
        ws.send(JSON.stringify({ type: "reconnect", sessionId }));
      } else {
        // Start new session
        console.log(`[Terminal] Spawning new ${agent} session`);
        term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Connecting to ${agent}...`);
        ws.send(
          JSON.stringify({
            type: "spawn",
            agent,
            cwd,
            cols: term.cols,
            rows: term.rows,
          })
        );
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "output":
          term.write(msg.data);
          break;
        case "session":
          console.log(`[Terminal] Session created:`, msg.session.id);
          onSessionCreated?.(msg.session.id);
          break;
        case "exit":
          console.log(`[Terminal] Agent exited with code ${msg.code}`);
          term.writeln(
            `\x1b[33m[Open Canvas]\x1b[0m Agent exited with code ${msg.code}`
          );
          setConnected(false);
          break;
        case "error":
          console.error("[Terminal] Error from server:", msg.message);
          term.writeln(`\x1b[31m[Open Canvas]\x1b[0m ${msg.message}`);
          // If we were trying to reconnect and it failed, notify parent
          if (sessionId) {
            onReconnectFailed?.();
          }
          break;
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      console.log(`[Terminal] WebSocket closed: code=${event.code}`);
      setConnected(false);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      term.writeln(
        "\x1b[31m[Open Canvas]\x1b[0m Cannot connect to PTY server."
      );
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          })
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [agent, cwd, ptyPort, sessionId, onSessionCreated, onReconnectFailed]);

  useEffect(() => {
    mountedRef.current = true;
    const cleanup = connect();
    return () => {
      mountedRef.current = false;
      cleanup?.();
      termRef.current?.dispose();
      // Don't close the WebSocket on unmount — session stays alive on server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            TERMINAL
          </span>
          <span className="text-xs text-[var(--text-muted)]">{agent}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"
            }`}
          />
          <span className="text-xs text-[var(--text-muted)]">
            {connected ? "connected" : "disconnected"}
          </span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 bg-[var(--bg-primary)]" />
    </div>
  );
}
