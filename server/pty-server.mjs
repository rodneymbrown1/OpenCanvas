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
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import pty from "@homebridge/node-pty-prebuilt-multiarch";
import { initCronScheduler } from "./cron-scheduler.mjs";
import {
  cleanupStale as registryCleanup,
  markRunning as registryMarkRunning,
  markStopped as registryMarkStopped,
  releaseProject as registryReleaseProject,
} from "./port-registry.mjs";

// ── API Route Modules (migrated from Next.js API routes) ──────────────────
import { handle as handleFiles } from "./routes/files.mjs";
import { handle as handleConfig } from "./routes/config.mjs";
import { handle as handleSettings } from "./routes/settings.mjs";
import { handle as handleProjects } from "./routes/projects.mjs";
import { handle as handleCalendar } from "./routes/calendar.mjs";
import { handle as handlePorts } from "./routes/ports.mjs";
import { handle as handleData } from "./routes/data.mjs";
import { handle as handleAgents } from "./routes/agents.mjs";
import { handle as handleSkills } from "./routes/skills.mjs";
import { handle as handleServices } from "./routes/services.mjs";
import { handle as handleFolderPicker } from "./routes/folder-picker.mjs";
import { handle as handleContextHandoff } from "./routes/context-handoff.mjs";
import { handle as handleCalendarConnections } from "./routes/calendar-connections.mjs";
import { handle as handleVoiceRouting } from "./routes/voice-routing.mjs";
import { handle as handleSessionHistory, appendHistory } from "./routes/session-history.mjs";
import { handle as handleUpdates } from "./routes/updates.mjs";

const apiRouteHandlers = [
  handleFiles, handleConfig, handleSettings, handleProjects,
  handleCalendar, handleCalendarConnections, handlePorts, handleData, handleAgents,
  handleSkills, handleServices, handleFolderPicker, handleContextHandoff,
  handleVoiceRouting, handleSessionHistory, handleUpdates,
];

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
  calendar: { shell: "/bin/zsh", args: ["-l", "-c", "claude"] }, // calendar agent uses claude
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
    label: agent.charAt(0).toUpperCase() + agent.slice(1),
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

/** Record a completed session to persistent history */
function recordSessionHistory(session) {
  try {
    const startMs = new Date(session.startedAt).getTime();
    const endMs = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    appendHistory(session.cwd, {
      sessionId: session.id,
      agent: session.agent,
      label: session.label || `${session.agent.charAt(0).toUpperCase() + session.agent.slice(1)}`,
      cwd: session.cwd,
      createdAt: session.startedAt,
      endedAt: session.endedAt,
      exitCode: session.exitCode,
      durationSeconds: Math.round((endMs - startMs) / 1000),
      lastOutputPreview: (session.lastOutput || []).slice(-5),
    });
  } catch (err) {
    console.error(`[pty-server] Failed to record session history:`, err.message);
  }
}

// ── HTTP Server (for /sessions API) ────────────────────────────────────────

// ── Static file serving for production ─────────────────────────────────────
const DIST_DIR = path.join(process.cwd(), "dist");
const MIME_TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".map": "application/json",
};

function serveStatic(req, res) {
  if (!fs.existsSync(DIST_DIR)) return false;
  let filePath = path.join(DIST_DIR, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!fs.existsSync(filePath)) {
    // SPA fallback — serve index.html for non-file routes
    filePath = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(filePath)) return false;
  }
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  if (ext === ".js" || ext === ".css" || ext === ".woff2") {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL for searchParams support
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Try API route modules first ──────────────────────────────────────
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");

    // Map /api/sessions → internal /sessions, /api/stack → internal /stack, etc.
    const apiPath = url.pathname.replace(/^\/api/, "");

    // Handle /api/sessions, /api/sessions/:id, /api/sessions/:id/input
    if (apiPath === "/sessions" || apiPath.startsWith("/sessions/")) {
      req.url = apiPath + url.search;
      // Fall through to existing PTY session handlers below
    }
    // Handle /api/voice-job
    else if (apiPath === "/voice-job") {
      req.url = apiPath + url.search;
      // Fall through to PTY voice-job handler below
    }
    // Handle /api/stack
    else if (apiPath.startsWith("/stack")) {
      req.url = apiPath + url.search;
      // Fall through to existing PTY stack handlers below
    }
    // Handle /api/pty-status — these are in the ports route module
    else {
      // Try each API route module
      for (const handler of apiRouteHandlers) {
        try {
          const handled = await handler(req, res, url);
          if (handled) return;
        } catch (err) {
          console.error(`[pty-server] API route error:`, err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
          return;
        }
      }
      // No API handler matched
      res.writeHead(404);
      res.end(JSON.stringify({ error: "API route not found" }));
      return;
    }
  }

  // ── Existing PTY server routes ───────────────────────────────────────
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/sessions") {
    res.end(JSON.stringify({ sessions: getAllSessions() }));
    return;
  }

  // The prompt sent to the agent to start the app — simple, human-language, not over-engineered
  const APP_START_PROMPT = `Look at this project and start the app. Follow these steps in order:

1. If there is a run.sh in the project root, execute it.
2. If there is no run.sh but there is a project.yaml, read it to understand how to start the app, then start it.
3. If neither exists, look in the apps/ folder. Figure out what the app is, how it works, and start it. Then create a run.sh at the project root so it can be started faster next time.

Important:
- Use dynamic port allocation. Never hardcode port numbers. Use PORT=0 or let the framework pick a random available port.
- Print the URL where the app is running once it starts.
- Do not ask questions. Just figure it out and run it.`;

  // POST /stack/start — spawn the user's coding agent to find and start the app
  if (req.url === "/stack/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { agent, cwd } = JSON.parse(body);
        if (!agent || !cwd) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "agent and cwd required" }));
          return;
        }

        // Check if there's already an app-start session running for this cwd
        for (const [, s] of sessions) {
          if (s.cwd === cwd && (s.role === "app-start" || s.role === "stack") && s.status === "running") {
            res.end(JSON.stringify({ session: s, alreadyRunning: true }));
            return;
          }
        }

        const agentName = agent;
        const agentDef = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.claude;

        const session = createSession(agentName, cwd);
        session.role = "app-start";

        console.log(`[pty-server] app-start: spawning ${agentName} session=${session.id} cwd=${cwd}`);

        const ptyProcess = pty.spawn(agentDef.shell, agentDef.args, {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });

        session.pid = ptyProcess.pid;
        session.status = "running";

        activeProcesses.set(session.id, {
          ptyProcess,
          clients: new Set(),
          outputBuffer: [],
        });

        // Send the app-start prompt after agent initializes
        setTimeout(() => {
          ptyProcess.write(APP_START_PROMPT + "\r");
          console.log(`[pty-server] app-start: sent prompt to session=${session.id}`);
        }, 3000);

        ptyProcess.onData((data) => {
          session.outputBytes += Buffer.byteLength(data);
          session.outputLines += (data.match(/\n/g) || []).length;
          const clean = stripAnsi(data);
          const lines = clean.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            session.lastOutput.push(line.trim());
            if (session.lastOutput.length > 30) session.lastOutput.shift();
            // Detect port from agent/app output
            if (!session.detectedPort) {
              const portMatch = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
              if (portMatch) {
                const port = parseInt(portMatch[1], 10);
                if (port >= 1024 && port <= 65535 && port !== 3000 && port !== 3001) {
                  session.detectedPort = port;
                  console.log(`[pty-server] app-start session=${session.id} detected port: ${port}`);
                }
              }
            }
          }
          const proc = activeProcesses.get(session.id);
          if (proc) {
            proc.outputBuffer.push(data);
            if (proc.outputBuffer.length > 200) proc.outputBuffer.shift();
            for (const client of proc.clients) {
              if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({ type: "output", data }));
              }
            }
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[pty-server] app-start session=${session.id} exited: code=${exitCode}`);
          session.status = exitCode === 0 ? "completed" : "failed";
          session.exitCode = exitCode;
          session.endedAt = new Date().toISOString();
          recordSessionHistory(session);
        });

        console.log(`[pty-server] app-start session spawned: id=${session.id} pid=${ptyProcess.pid}`);
        res.end(JSON.stringify({ session }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /stack/stop — stop the stack session for a given cwd
  if (req.url === "/stack/stop" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { cwd } = JSON.parse(body);

        // Find the running app-start or stack session for this cwd
        let found = null;
        for (const [id, s] of sessions) {
          if (s.cwd === cwd && (s.role === "app-start" || s.role === "stack") && s.status === "running") {
            found = { id, session: s };
            break;
          }
        }

        if (!found) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "No running stack session for this directory" }));
          return;
        }

        const proc = activeProcesses.get(found.id);
        if (proc?.ptyProcess) {
          console.log(`[pty-server] stopping stack session=${found.id} pid=${found.session.pid}`);
          proc.ptyProcess.kill();
          found.session.status = "completed";
          found.session.endedAt = new Date().toISOString();
        }

        res.end(JSON.stringify({ stopped: true, sessionId: found.id }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /stack/status?cwd=... — check if stack is running for a directory
  if (req.url?.startsWith("/stack/status") && req.method === "GET") {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const cwd = url.searchParams.get("cwd");

    for (const [, s] of sessions) {
      if (s.cwd === cwd && (s.role === "app-start" || s.role === "stack") && s.status === "running") {
        res.end(JSON.stringify({ running: true, session: s }));
        return;
      }
    }

    res.end(JSON.stringify({ running: false }));
    return;
  }

  // ── Multi-Service Endpoints ──────────────────────────────────────────────

  // POST /services/start — start multiple named services in dependency order
  if (req.url === "/services/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { services, startOrder, cwd, projectName } = JSON.parse(body);
        if (!services || !startOrder || !cwd) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "services, startOrder, and cwd required" }));
          return;
        }

        const results = {};
        let failed = false;

        // Helper to spawn a single service
        function spawnService(name, svcDef) {
          return new Promise((resolve) => {
            const serviceCwd = path.resolve(cwd, svcDef.cwd || ".");
            const session = createSession("service", serviceCwd);
            session.role = `service:${name}`;
            session.serviceName = name;

            const command = svcDef.command;
            console.log(`[pty-server] service:${name} spawning: ${command} in ${serviceCwd}`);

            const serviceEnv = {
              ...process.env,
              ...svcDef.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            };
            // Tag process with Open Canvas project info
            if (projectName) {
              serviceEnv.OC_PROJECT = projectName;
              serviceEnv.OC_SERVICE = name;
            }

            const ptyProcess = pty.spawn("/bin/zsh", ["-l", "-c", command], {
              name: "xterm-256color",
              cols: 120,
              rows: 30,
              cwd: serviceCwd,
              env: serviceEnv,
            });

            session.pid = ptyProcess.pid;
            session.status = "running";

            activeProcesses.set(session.id, {
              ptyProcess,
              clients: new Set(),
              outputBuffer: [],
            });

            const readyPattern = svcDef.ready_pattern
              ? new RegExp(svcDef.ready_pattern)
              : null;
            let resolved = false;

            ptyProcess.onData((data) => {
              session.outputBytes += Buffer.byteLength(data);
              session.outputLines += (data.match(/\n/g) || []).length;
              const clean = stripAnsi(data);
              const lines = clean.split("\n").filter((l) => l.trim());
              for (const line of lines) {
                session.lastOutput.push(line.trim());
                if (session.lastOutput.length > 30) session.lastOutput.shift();
                if (!session.detectedPort) {
                  const portMatch = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/);
                  if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    if (port >= 3000 && port <= 65535) {
                      session.detectedPort = port;
                      console.log(`[pty-server] service:${name} detected port: ${port}`);
                      // Register in port registry
                      if (projectName) {
                        try {
                          registryMarkRunning(port, ptyProcess.pid, session.id);
                        } catch (err) {
                          console.error(`[pty-server] registry markRunning failed:`, err.message);
                        }
                      }
                    }
                  }
                }
                // Resolve when ready_pattern matches or port detected
                if (!resolved && (
                  (readyPattern && readyPattern.test(line)) ||
                  session.detectedPort
                )) {
                  resolved = true;
                  resolve({ name, session, status: "running" });
                }
              }
              const proc = activeProcesses.get(session.id);
              if (proc) {
                proc.outputBuffer.push(data);
                if (proc.outputBuffer.length > 200) proc.outputBuffer.shift();
                for (const client of proc.clients) {
                  if (client.readyState === client.OPEN) {
                    client.send(JSON.stringify({ type: "output", data }));
                  }
                }
              }
            });

            ptyProcess.onExit(({ exitCode }) => {
              console.log(`[pty-server] service:${name} exited: code=${exitCode}`);
              session.status = "completed";
              session.exitCode = exitCode;
              session.endedAt = new Date().toISOString();
              recordSessionHistory(session);
              if (!resolved) {
                resolved = true;
                resolve({ name, session, status: exitCode === 0 ? "completed" : "error" });
              }
            });

            // Timeout: don't wait forever for ready_pattern — resolve after 15s regardless
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                console.log(`[pty-server] service:${name} ready timeout — proceeding`);
                resolve({ name, session, status: "running" });
              }
            }, 15000);
          });
        }

        // Start services in dependency order (sequentially)
        async function startAll() {
          for (const name of startOrder) {
            const svcDef = services[name];
            if (!svcDef) continue;

            // Skip if already running for this cwd
            let alreadyRunning = false;
            for (const [, s] of sessions) {
              if (s.role === `service:${name}` && s.cwd === path.resolve(cwd, svcDef.cwd || ".") && s.status === "running") {
                results[name] = { name, sessionId: s.id, state: "running", port: s.detectedPort, pid: s.pid, alreadyRunning: true };
                alreadyRunning = true;
                break;
              }
            }
            if (alreadyRunning) continue;

            const result = await spawnService(name, svcDef);
            results[name] = {
              name,
              sessionId: result.session.id,
              state: result.status,
              port: result.session.detectedPort,
              pid: result.session.pid,
            };
            if (result.status === "error") {
              failed = true;
              break; // Stop starting dependents if a dependency failed
            }
          }
        }

        startAll().then(() => {
          res.end(JSON.stringify({ services: results, failed }));
        }).catch((err) => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });

      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /services/stop — stop all service sessions for a cwd, or a specific service
  if (req.url === "/services/stop" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { cwd, service: serviceName } = JSON.parse(body);
        if (!cwd) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "cwd required" }));
          return;
        }

        const stopped = [];
        for (const [id, s] of sessions) {
          if (s.status !== "running") continue;
          if (!s.role?.startsWith("service:")) continue;

          // Match by cwd (the service's resolved cwd starts with the project cwd)
          const projectCwd = path.resolve(cwd);
          const sessionCwd = path.resolve(s.cwd);
          if (!sessionCwd.startsWith(projectCwd)) continue;

          // If specific service requested, match name
          if (serviceName && s.role !== `service:${serviceName}`) continue;

          const proc = activeProcesses.get(id);
          if (proc?.ptyProcess) {
            console.log(`[pty-server] stopping ${s.role} session=${id} pid=${s.pid}`);
            proc.ptyProcess.kill();
            s.status = "completed";
            s.endedAt = new Date().toISOString();
            stopped.push({ name: s.serviceName || s.role, sessionId: id });
            // Update port registry
            if (s.detectedPort) {
              try { registryMarkStopped(s.detectedPort); } catch {}
            }
          }
        }

        res.end(JSON.stringify({ stopped, count: stopped.length }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /services/status?cwd=... — get status of all service sessions for a project
  if (req.url?.startsWith("/services/status") && req.method === "GET") {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const cwd = url.searchParams.get("cwd");

    if (!cwd) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "cwd required" }));
      return;
    }

    const projectCwd = path.resolve(cwd);
    const services = {};

    for (const [, s] of sessions) {
      if (!s.role?.startsWith("service:")) continue;
      const sessionCwd = path.resolve(s.cwd);
      if (!sessionCwd.startsWith(projectCwd)) continue;

      const name = s.serviceName || s.role.replace("service:", "");
      // Only report the most recent session per service name
      if (!services[name] || new Date(s.startedAt) > new Date(services[name].startedAt)) {
        services[name] = {
          name,
          state: s.status === "running" ? "running" : s.status === "starting" ? "starting" : "stopped",
          port: s.detectedPort,
          pid: s.pid,
          sessionId: s.id,
        };
      }
    }

    res.end(JSON.stringify({ services }));
    return;
  }

  // POST /voice-job — spawn a background agent session with a voice-transcribed prompt
  if (req.url === "/voice-job" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { prompt, agent, cwd, skillContent } = JSON.parse(body);
        if (!prompt || !cwd) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "prompt and cwd required" }));
          return;
        }

        const agentName = agent || "claude";
        const agentDef = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.claude;

        // Build the full prompt: prepend skill context if provided
        const fullPrompt = skillContent
          ? `<context>\n${skillContent}\n</context>\n\n${prompt}`
          : prompt;

        const session = createSession(agentName, cwd);
        session.role = "voice";
        session.prompt = prompt;
        session.tabId = JSON.parse(body).tabId || undefined;

        console.log(`[pty-server] voice-job: spawning ${agentName} session=${session.id} cwd=${cwd}${session.tabId ? ` tab=${session.tabId}` : ""}`);
        console.log(`[pty-server] voice-job: prompt="${prompt.substring(0, 120)}${prompt.length > 120 ? "..." : ""}"`);

        const ptyProcess = pty.spawn(agentDef.shell, agentDef.args, {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            OC_INPUT_MODE: "voice",
            OC_VOICE_TAB: session.tabId || "",
          },
        });

        session.pid = ptyProcess.pid;
        session.status = "running";

        // Track process for reconnection
        activeProcesses.set(session.id, {
          ptyProcess,
          clients: new Set(),
          outputBuffer: [],
        });

        // Send the skill-enhanced prompt after agent initializes
        setTimeout(() => {
          ptyProcess.write(fullPrompt + "\r");
          console.log(`[pty-server] voice-job: sent prompt to session=${session.id}`);
        }, 3000);

        ptyProcess.onData((data) => {
          session.outputBytes += Buffer.byteLength(data);
          session.outputLines += (data.match(/\n/g) || []).length;
          const clean = stripAnsi(data);
          const lines = clean.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            session.lastOutput.push(line.trim());
            if (session.lastOutput.length > 20) session.lastOutput.shift();
          }
          const proc = activeProcesses.get(session.id);
          if (proc) {
            proc.outputBuffer.push(data);
            if (proc.outputBuffer.length > 200) proc.outputBuffer.shift();
            for (const client of proc.clients) {
              if (client.readyState === 1) {
                client.send(JSON.stringify({ type: "output", data }));
              }
            }
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          session.status = exitCode === 0 ? "completed" : "failed";
          session.exitCode = exitCode;
          session.endedAt = new Date().toISOString();
          console.log(`[pty-server] voice-job: session=${session.id} exited code=${exitCode}`);
          recordSessionHistory(session);
        });

        res.end(JSON.stringify({ session }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
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

  // GET /sessions/:id/output — return last output lines for context sharing
  const outputMatch = req.url?.match(/^\/sessions\/(.+)\/output$/);
  if (outputMatch && req.method === "GET") {
    const session = sessions.get(outputMatch[1]);
    if (session) {
      res.end(JSON.stringify({
        sessionId: session.id,
        agent: session.agent,
        output: session.lastOutput,
        status: session.status,
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
    }
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

  // ── Static file serving (production) ──────────────────────────────────
  if (serveStatic(req, res)) return;

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

        // Build args — inject --resume for Claude when restoring from history
        let spawnArgs = [...agentDef.args];
        if (msg.resume && agentName === "claude") {
          // Replace "claude" with "claude --resume" in the shell -c argument
          spawnArgs = spawnArgs.map((a) =>
            a === "claude" ? "claude --resume" : a
          );
        }

        const session = createSession(agentName, cwd);
        if (msg.resume) {
          session.label = `${agentName.charAt(0).toUpperCase() + agentName.slice(1)} (resumed)`;
        }
        currentSessionId = session.id;

        try {
          console.log(
            `[pty-server] spawning: ${agentDef.shell} ${spawnArgs.join(" ")} | agent=${agentName} session=${session.id} cwd=${cwd} (${cols}x${rows})${msg.resume ? ` resume=${msg.resume}` : ""}`
          );

          const ptyProcess = pty.spawn(agentDef.shell, spawnArgs, {
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

            // Persist to session history
            recordSessionHistory(session);

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

  // Cleanup stale port registry entries on startup
  try {
    const result = registryCleanup();
    if (result.removed > 0 || result.marked > 0) {
      console.log(`[pty-server] port registry cleanup: marked=${result.marked} removed=${result.removed}`);
    }
  } catch (err) {
    console.error(`[pty-server] port registry cleanup failed:`, err.message);
  }

  // Initialize cron scheduler for calendar events
  initCronScheduler((opts) => {
    // Callback to spawn a PTY session when a cron job fires a "prompt" action
    console.log(`[pty-server] cron spawning session: agent=${opts.agent}, cwd=${opts.cwd}`);
    const session = createSession(opts.agent, opts.cwd);
    session.role = "cron";
    const agentCmd = AGENT_COMMANDS[opts.agent] || AGENT_COMMANDS.claude;
    const ptyProcess = pty.spawn(agentCmd.shell, agentCmd.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: opts.cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    session.pid = ptyProcess.pid;
    session.status = "running";
    // Send the prompt after a short delay to let the agent initialize
    setTimeout(() => {
      if (opts.prompt) {
        ptyProcess.write(opts.prompt + "\r");
      }
    }, 3000);
    ptyProcess.onData((data) => {
      session.outputBytes += data.length;
      session.outputLines += (data.match(/\n/g) || []).length;
      const clean = stripAnsi(data);
      if (clean.trim()) {
        session.lastOutput.push(...clean.split("\n").filter(Boolean));
        if (session.lastOutput.length > 20) {
          session.lastOutput = session.lastOutput.slice(-20);
        }
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      session.endedAt = new Date().toISOString();
      recordSessionHistory(session);
    });
  });
});

// ── Graceful shutdown: record still-running sessions to history ────────────
function gracefulShutdown(signal) {
  console.log(`[pty-server] ${signal} received, recording running sessions...`);
  for (const session of sessions.values()) {
    if (session.status === "running" || session.status === "starting") {
      session.endedAt = new Date().toISOString();
      session.status = "completed";
      recordSessionHistory(session);
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
