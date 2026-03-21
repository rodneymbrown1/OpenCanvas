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
}

export function AgentTerminal({
  agent,
  cwd,
  ptyPort = 3001,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up previous
    if (termRef.current) {
      termRef.current.dispose();
    }
    if (wsRef.current) {
      wsRef.current.close();
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

    // Connect WebSocket
    console.log(`[Terminal] Connecting to ws://localhost:${ptyPort}...`);
    const wsUrl = `ws://localhost:${ptyPort}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[Terminal] WebSocket connected, spawning ${agent} in ${cwd}`);
      setConnected(true);
      term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Connecting to ${agent}...`);
      const spawnMsg = {
        type: "spawn",
        agent,
        cwd,
        cols: term.cols,
        rows: term.rows,
      };
      console.log("[Terminal] Sending spawn:", spawnMsg);
      ws.send(JSON.stringify(spawnMsg));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "output":
          term.write(msg.data);
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
          break;
      }
    };

    ws.onclose = (event) => {
      console.log(`[Terminal] WebSocket closed: code=${event.code} reason=${event.reason}`);
      setConnected(false);
      term.writeln("\x1b[33m[Open Canvas]\x1b[0m Disconnected from PTY server");
    };

    ws.onerror = (event) => {
      console.error("[Terminal] WebSocket error:", event);
      term.writeln(
        "\x1b[31m[Open Canvas]\x1b[0m Cannot connect to PTY server."
      );
      term.writeln(
        "\x1b[90mThe PTY server should auto-start. Check the PTY status indicator.\x1b[0m"
      );
    };

    // Send input to PTY
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle resize
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
  }, [agent, cwd, ptyPort]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      termRef.current?.dispose();
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            TERMINAL
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {agent}
          </span>
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
