/**
 * PTY WebSocket Server
 *
 * Spawns real PTY sessions for coding agents (claude, codex, gemini)
 * and bridges them to the browser via WebSocket.
 *
 * Protocol:
 *   Client sends: { type: "spawn", agent: "claude"|"codex"|"gemini"|"shell", cwd: "/path", cols: N, rows: N }
 *   Client sends: { type: "input", data: "..." }
 *   Client sends: { type: "resize", cols: N, rows: N }
 *   Server sends: { type: "output", data: "..." }
 *   Server sends: { type: "exit", code: N }
 *   Server sends: { type: "error", message: "..." }
 */

import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import pty from "@homebridge/node-pty-prebuilt-multiarch";

const CONFIG_PATH = join(process.cwd(), "open-canvas.yaml");

function loadConfig() {
  try {
    return parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { server: { pty_port: 3001 } };
  }
}

const config = loadConfig();
const PORT = config.server?.pty_port || 3001;

// Agents are launched through the login shell so PATH is resolved correctly
const AGENT_COMMANDS = {
  claude: { shell: "/bin/zsh", args: ["-l", "-c", "claude"] },
  codex: { shell: "/bin/zsh", args: ["-l", "-c", "codex"] },
  gemini: { shell: "/bin/zsh", args: ["-l", "-c", "gemini"] },
  shell: { shell: process.env.SHELL || "/bin/zsh", args: [] },
};

const wss = new WebSocketServer({ port: PORT });

console.log(`[pty-server] listening on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  let ptyProcess = null;

  console.log("[pty-server] client connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type !== "input") {
      console.log(`[pty-server] received:`, msg.type, msg.agent || "");
    }

    switch (msg.type) {
      case "spawn": {
        const agentName = msg.agent || "shell";
        const agentDef = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.shell;
        const cwd = msg.cwd || process.env.HOME;
        const cols = msg.cols || 120;
        const rows = msg.rows || 30;

        // Kill existing process if any
        if (ptyProcess) {
          try {
            ptyProcess.kill();
          } catch (e) {
            console.log("[pty-server] kill error:", e.message);
          }
        }

        try {
          console.log(
            `[pty-server] spawning ${agentName} via ${agentDef.shell} in ${cwd} (${cols}x${rows})`
          );

          ptyProcess = pty.spawn(agentDef.shell, agentDef.args, {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: {
              ...process.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
          });

          console.log(`[pty-server] spawned PID ${ptyProcess.pid}`);

          ptyProcess.onData((data) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "output", data }));
            }
          });

          ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(
              `[pty-server] process exited: code=${exitCode} signal=${signal}`
            );
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "exit", code: exitCode }));
            }
            ptyProcess = null;
          });
        } catch (err) {
          console.error(`[pty-server] spawn error:`, err);
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to start ${agentName}: ${err.message}`,
            })
          );
        }
        break;
      }

      case "input": {
        if (ptyProcess) {
          ptyProcess.write(msg.data);
        }
        break;
      }

      case "resize": {
        if (ptyProcess && msg.cols && msg.rows) {
          try {
            ptyProcess.resize(msg.cols, msg.rows);
          } catch (e) {
            console.log("[pty-server] resize error:", e.message);
          }
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("[pty-server] client disconnected");
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {}
    }
  });
});
