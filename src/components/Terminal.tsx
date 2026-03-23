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

function getTerminalTheme() {
  const style = getComputedStyle(document.documentElement);
  const get = (v: string) => style.getPropertyValue(v).trim() || undefined;
  return {
    background: get("--bg-primary") || "#0a0a0a",
    foreground: get("--text-primary") || "#e5e5e5",
    cursor: get("--accent") || "#3b82f6",
    selectionBackground: (get("--accent") || "#3b82f6") + "44",
  };
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
  const retriesRef = useRef(0);
  const MAX_RETRIES = 3;
  const gotOutputRef = useRef(false);
  const gotSessionRef = useRef(false);

  // Store callbacks in refs to prevent useCallback dependency changes
  // that would cause the connect effect to re-run and create loops
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onReconnectFailedRef = useRef(onReconnectFailed);
  onReconnectFailedRef.current = onReconnectFailed;

  const log = useCallback(
    (level: "info" | "warn" | "error", ...args: unknown[]) => {
      const prefix = `[Terminal:${agent}]`;
      if (level === "error") console.error(prefix, ...args);
      else if (level === "warn") console.warn(prefix, ...args);
      else console.log(prefix, ...args);
    },
    [agent]
  );

  const connect = useCallback(() => {
    if (!containerRef.current) {
      log("warn", "Container ref not ready, skipping connect");
      return;
    }

    if (termRef.current) {
      termRef.current.dispose();
    }

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      theme: getTerminalTheme(),
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

    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `ws://localhost:${ptyPort}`;
    log("info", `Connecting to ${wsUrl}`, { sessionId: sessionId || "(new spawn)", cwd });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      gotOutputRef.current = false;
      gotSessionRef.current = false;

      if (sessionId) {
        log("info", `WS open — sending reconnect for session ${sessionId}`);
        term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Reconnecting to ${agent} (session: ${sessionId})...`);
        ws.send(JSON.stringify({ type: "reconnect", sessionId }));
      } else {
        log("info", `WS open — sending spawn: agent=${agent} cwd=${cwd} cols=${term.cols} rows=${term.rows}`);
        term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Spawning ${agent}...`);
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
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        log("error", "Failed to parse server message:", event.data, e);
        return;
      }

      switch (msg.type) {
        case "output":
          if (!gotOutputRef.current) {
            log("info", "✓ First output received — agent is running");
          }
          gotOutputRef.current = true;
          retriesRef.current = 0;
          term.write(msg.data);
          break;

        case "session": {
          gotSessionRef.current = true;
          const s = msg.session;
          log("info", `✓ Session: id=${s.id} agent=${s.agent} pid=${s.pid} status=${s.status}`);

          if (s.status === "completed" || s.status === "failed") {
            // Session already ended — show buffered output but don't treat as live
            log("warn", `Session ${s.id} is ${s.status} — displaying history only`);
            term.writeln(`\x1b[33m[Open Canvas]\x1b[0m Session ${s.id} has already ${s.status} (exit code: ${s.exitCode ?? "?"})`);
            term.writeln(`\x1b[90mBuffered output shown below. Click "connect" to start a new session.\x1b[0m`);
            // Don't call onSessionCreated — this prevents the reconnect loop
            // Close the WebSocket after receiving buffered output
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.close();
              }
              onReconnectFailedRef.current?.();
            }, 500);
          } else {
            term.writeln(`\x1b[36m[Open Canvas]\x1b[0m Session ${s.id} (PID: ${s.pid || "starting"})`);
            onSessionCreatedRef.current?.(s.id);
          }
          break;
        }

        case "exit":
          log("warn", `Agent exited: code=${msg.code}`);
          term.writeln(
            `\x1b[33m[Open Canvas]\x1b[0m Agent exited with code ${msg.code}`
          );
          setConnected(false);
          break;

        case "error":
          log("error", `Server error: ${msg.message}`);
          term.writeln(`\x1b[31m[Open Canvas] ERROR:\x1b[0m ${msg.message}`);
          if (sessionId) {
            log("info", "Error during reconnect — clearing stale session");
            onReconnectFailedRef.current?.();
          }
          break;

        default:
          log("warn", `Unknown message type: ${msg.type}`, msg);
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;

      const reason = event.reason || "(no reason)";
      log("warn", `WS closed: code=${event.code} clean=${event.wasClean} reason="${reason}" gotSession=${gotSessionRef.current} gotOutput=${gotOutputRef.current}`);

      setConnected(false);

      // Case 1: WS closed before any server response — PTY server not running
      if (!event.wasClean && !gotSessionRef.current && !gotOutputRef.current) {
        term.writeln(
          `\x1b[31m[Open Canvas]\x1b[0m Connection lost (code: ${event.code}). PTY server may not be running.`
        );
        term.writeln(
          `\x1b[90mRun: npm run pty-server\x1b[0m`
        );
      }

      // Case 2: Reconnecting to stale session
      if (sessionId && !gotOutputRef.current) {
        retriesRef.current++;
        log("warn", `Reconnect attempt ${retriesRef.current}/${MAX_RETRIES} failed`);
        if (retriesRef.current >= MAX_RETRIES) {
          log("error", "Max retries — clearing stale session");
          term.writeln(
            `\x1b[31m[Open Canvas]\x1b[0m Session ${sessionId} is no longer available.`
          );
          onReconnectFailedRef.current?.();
          retriesRef.current = 0;
        }
      }

      // Case 3: New spawn got a session but agent crashed immediately
      if (!sessionId && gotSessionRef.current && !gotOutputRef.current) {
        log("error", `Agent '${agent}' created a session but produced no output — it likely crashed or is not installed`);
        term.writeln(
          `\x1b[31m[Open Canvas]\x1b[0m Agent '${agent}' failed to start.`
        );
        term.writeln(
          `\x1b[90mVerify '${agent}' is installed: which ${agent}\x1b[0m`
        );
      }
    };

    ws.onerror = (event) => {
      if (!mountedRef.current) return;
      log("error", "WS error event fired", event);
      term.writeln(
        `\x1b[31m[Open Canvas]\x1b[0m Cannot connect to PTY server at ws://localhost:${ptyPort}`
      );
      term.writeln(
        `\x1b[90mRun: npm run pty-server\x1b[0m`
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, cwd, ptyPort, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    const cleanup = connect();
    return () => {
      mountedRef.current = false;
      cleanup?.();
      termRef.current?.dispose();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Update xterm theme when data-theme attribute changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) {
        termRef.current.options.theme = getTerminalTheme();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

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
