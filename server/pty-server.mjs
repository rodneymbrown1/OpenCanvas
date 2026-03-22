/**
 * PTY WebSocket Server with Session Tracking
 *
 * Spawns real PTY sessions for coding agents and tracks:
 * - Session ID, agent, start time, status
 * - Output byte count (proxy for token usage)
 * - Active/completed sessions list
 *
 * WebSocket Protocol:
 *   Client: { type: "spawn", agent, cwd, cols, rows }
 *   Client: { type: "input", data }
 *   Client: { type: "resize", cols, rows }
 *   Client: { type: "reconnect", sessionId }
 *   Server: { type: "output", data }
 *   Server: { type: "exit", code }
 *   Server: { type: "error", message }
 *   Server: { type: "session", session: {...} }
 *
 * HTTP API (same port):
 *   GET /sessions — list all sessions
 *   GET /sessions/:id — get session by ID
 */

import { WebSocketServer } from "ws";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { randomUUID } from "node:crypto";
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

const AGENT_COMMANDS = {
  claude: { shell: "/bin/zsh", args: ["-l", "-c", "claude"] },
  codex: { shell: "/bin/zsh", args: ["-l", "-c", "codex"] },
  gemini: { shell: "/bin/zsh", args: ["-l", "-c", "gemini"] },
  shell: { shell: process.env.SHELL || "/bin/zsh", args: [] },
};

// ── Session Store ──────────────────────────────────────────────────────────

const sessions = new Map();

// Strip ANSI escape codes for clean text
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "");
}

function createSession(agent, cwd) {
  const id = randomUUID().slice(0, 8);
  const session = {
    id,
    agent,
    cwd,
    status: "starting",
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    outputBytes: 0,
    inputBytes: 0,
    outputLines: 0,
    pid: null,
    lastOutput: [],    // Last 20 lines of clean text
    detectedPort: null, // Port detected from output (e.g., "localhost:3002")
  };
  sessions.set(id, session);
  return session;
}

function getAllSessions() {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

// ── HTTP Server (for /sessions API) ────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/sessions") {
    res.end(JSON.stringify({ sessions: getAllSessions() }));
    return;
  }

  // POST /sessions/:id/input — send input to a running session
  const inputMatch = req.url?.match(/^\/sessions\/(.+)\/input$/);
  if (inputMatch && req.method === "POST") {
    const sessionId = inputMatch[1];
    const proc = activeProcesses.get(sessionId);
    if (!proc?.ptyProcess) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found or not running" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { command } = JSON.parse(body);
        if (!command) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "command required" }));
          return;
        }
        // Write the command + newline to the PTY
        proc.ptyProcess.write(command + "\n");
        const session = sessions.get(sessionId);
        if (session) {
          session.inputBytes += Buffer.byteLength(command + "\n");
        }
        console.log(`[pty-server] injected command to session=${sessionId}: ${command.substring(0, 80)}`);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  const match = req.url?.match(/^\/sessions\/(.+)$/);
  if (match) {
    const session = sessions.get(match[1]);
    if (session) {
      res.end(JSON.stringify({ session }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
    }
    return;
  }

  if (req.url === "/health") {
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

// Map sessionId -> { ptyProcess, clients: Set<ws> }
const activeProcesses = new Map();

wss.on("connection", (ws) => {
  let currentSessionId = null;

  console.log("[pty-server] client connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type !== "input") {
      console.log(`[pty-server] received:`, msg.type, msg.agent || msg.sessionId || "");
    }

    switch (msg.type) {
      case "spawn": {
        const agentName = msg.agent || "shell";
        const agentDef = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.shell;
        const cwd = msg.cwd || process.env.HOME;
        const cols = msg.cols || 120;
        const rows = msg.rows || 30;

        const session = createSession(agentName, cwd);
        currentSessionId = session.id;

        try {
          console.log(
            `[pty-server] spawning: ${agentDef.shell} ${agentDef.args.join(" ")} | agent=${agentName} session=${session.id} cwd=${cwd} (${cols}x${rows})`
          );

          const ptyProcess = pty.spawn(agentDef.shell, agentDef.args, {
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

          session.pid = ptyProcess.pid;
          session.status = "running";

          // Track this process with its connected clients
          activeProcesses.set(session.id, {
            ptyProcess,
            clients: new Set([ws]),
            outputBuffer: [], // Keep last 5000 chars for reconnection
          });

          console.log(`[pty-server] spawned PID ${ptyProcess.pid} session=${session.id}`);

          // Send session info to client
          ws.send(JSON.stringify({ type: "session", session }));

          ptyProcess.onData((data) => {
            session.outputBytes += Buffer.byteLength(data);
            session.outputLines += (data.match(/\n/g) || []).length;

            // Capture clean text lines for lastOutput and port detection
            const clean = stripAnsi(data);
            const lines = clean.split("\n").filter((l) => l.trim());
            for (const line of lines) {
              session.lastOutput.push(line.trim());
              if (session.lastOutput.length > 20) session.lastOutput.shift();

              // Detect port from common dev server patterns
              if (!session.detectedPort) {
                // Matches: localhost:3002, 127.0.0.1:8080, http://localhost:3002
                const portMatch = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
                if (portMatch) {
                  const port = parseInt(portMatch[1], 10);
                  if (port >= 3000 && port <= 9999 && port !== 3000 && port !== 3001) {
                    session.detectedPort = port;
                    console.log(`[pty-server] session=${session.id} detected app port: ${port}`);
                  }
                }
              }
            }

            const proc = activeProcesses.get(session.id);
            if (proc) {
              // Buffer output for reconnection (keep last 5000 chars)
              proc.outputBuffer.push(data);
              if (proc.outputBuffer.length > 200) {
                proc.outputBuffer.shift();
              }
              // Send to all connected clients
              for (const client of proc.clients) {
                if (client.readyState === client.OPEN) {
                  client.send(JSON.stringify({ type: "output", data }));
                }
              }
            }
          });

          ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(
              `[pty-server] session=${session.id} exited: code=${exitCode} signal=${signal}`
            );
            session.status = "completed";
            session.exitCode = exitCode;
            session.endedAt = new Date().toISOString();

            const proc = activeProcesses.get(session.id);
            if (proc) {
              for (const client of proc.clients) {
                if (client.readyState === client.OPEN) {
                  client.send(JSON.stringify({ type: "exit", code: exitCode }));
                }
              }
            }
            // Don't delete from activeProcesses yet — allow reconnection to see output
          });
        } catch (err) {
          console.error(`[pty-server] SPAWN FAILED for ${agentName}:`, err.message);
          console.error(`[pty-server]   shell: ${agentDef.shell}`);
          console.error(`[pty-server]   args: ${JSON.stringify(agentDef.args)}`);
          console.error(`[pty-server]   cwd: ${cwd}`);
          console.error(`[pty-server]   full error:`, err);
          session.status = "failed";
          session.endedAt = new Date().toISOString();
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to start ${agentName}: ${err.message}. Check that '${agentName}' is installed and the working directory exists.`,
            })
          );
        }
        break;
      }

      case "reconnect": {
        const sessionId = msg.sessionId;
        const proc = activeProcesses.get(sessionId);
        if (proc) {
          currentSessionId = sessionId;
          proc.clients.add(ws);
          console.log(`[pty-server] client reconnected to session=${sessionId}`);

          // Send session info
          const session = sessions.get(sessionId);
          if (session) {
            ws.send(JSON.stringify({ type: "session", session }));
          }

          // Replay buffered output
          for (const chunk of proc.outputBuffer) {
            ws.send(JSON.stringify({ type: "output", data: chunk }));
          }
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Session ${sessionId} not found or expired`,
            })
          );
        }
        break;
      }

      case "input": {
        if (currentSessionId) {
          const proc = activeProcesses.get(currentSessionId);
          if (proc?.ptyProcess) {
            const session = sessions.get(currentSessionId);
            if (session) {
              session.inputBytes += Buffer.byteLength(msg.data);
            }
            proc.ptyProcess.write(msg.data);
          }
        }
        break;
      }

      case "resize": {
        if (currentSessionId && msg.cols && msg.rows) {
          const proc = activeProcesses.get(currentSessionId);
          if (proc?.ptyProcess) {
            try {
              proc.ptyProcess.resize(msg.cols, msg.rows);
            } catch (e) {
              console.log("[pty-server] resize error:", e.message);
            }
          }
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("[pty-server] client disconnected");
    // Remove this client from the session but DON'T kill the process
    if (currentSessionId) {
      const proc = activeProcesses.get(currentSessionId);
      if (proc) {
        proc.clients.delete(ws);
        console.log(
          `[pty-server] session=${currentSessionId} still has ${proc.clients.size} clients`
        );
        // Process keeps running even with 0 clients — user can reconnect
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[pty-server] listening on http://localhost:${PORT} (HTTP + WebSocket)`);
});
