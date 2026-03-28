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
import { log, logWarn, logError } from "./logger.mjs";
import {
  cleanupStale as registryCleanup,
  markRunning as registryMarkRunning,
  markStopped as registryMarkStopped,
  releaseProject as registryReleaseProject,
  allocatePort as registryAllocatePort,
  getProjectPorts as registryGetProjectPorts,
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

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const APP_CONFIG_CACHE_PATH = join(HOME, ".open-canvas", "app-config.yaml");

function loadConfig() {
  // Read from the runtime cache in ~/.open-canvas/ (never from the repo)
  try {
    return parse(readFileSync(APP_CONFIG_CACHE_PATH, "utf-8"));
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

// CLI flags that skip permission prompts per agent
const DANGEROUS_EDIT_FLAGS = {
  claude: "--dangerously-skip-permissions",
  codex: "--full-auto",
  gemini: "--auto-approve",
};

/**
 * Build spawn args for an agent, injecting the dangerous-edits flag
 * if enabled in the project config.
 */
function getAgentArgs(agentName) {
  const agentDef = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.shell;
  const cfg = loadConfig();
  const agentCfg = cfg.agent?.[agentName];
  const dangerouslyAllowEdits = agentCfg?.dangerouslyAllowEdits === true;

  if (!dangerouslyAllowEdits || !DANGEROUS_EDIT_FLAGS[agentName]) {
    return { ...agentDef };
  }

  // The args pattern is ["-l", "-c", "agentCmd"] — append the flag to the command string
  const flag = DANGEROUS_EDIT_FLAGS[agentName];
  const args = agentDef.args.map((a) =>
    a === agentName ? `${agentName} ${flag}` : a
  );
  return { shell: agentDef.shell, args };
}

// ── Rate Limiter (voice jobs) ─────────────────────────────────────────────

const voiceJobTimestamps = [];
const VOICE_RATE_LIMIT = 3;       // max jobs
const VOICE_RATE_WINDOW = 10000;  // per 10 seconds

function isVoiceRateLimited() {
  const now = Date.now();
  // Purge timestamps outside the window
  while (voiceJobTimestamps.length && voiceJobTimestamps[0] < now - VOICE_RATE_WINDOW) {
    voiceJobTimestamps.shift();
  }
  if (voiceJobTimestamps.length >= VOICE_RATE_LIMIT) return true;
  voiceJobTimestamps.push(now);
  return false;
}

// ── Session Store ──────────────────────────────────────────────────────────

const MAX_SESSIONS = 50; // Max sessions kept in memory

const sessions = new Map();

// Strip ANSI escape codes and terminal control sequences for clean text
function stripAnsi(str) {
  return str
    .replace(/\x1B\[[\?>=]?[0-9;]*[a-zA-Z]/g, "")  // CSI sequences (including DEC private mode)
    .replace(/\x1B\][^\x07]*\x07/g, "")              // OSC sequences
    .replace(/\x1B[()][0-9A-Z]/g, "")                // Character set selection
    .replace(/\r/g, "");                               // Carriage returns
}

function pruneCompletedSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  // Sort all completed sessions by startedAt ascending (oldest first)
  const completed = Array.from(sessions.values())
    .filter((s) => s.status !== "running" && s.status !== "starting")
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const toRemove = sessions.size - MAX_SESSIONS;
  for (let i = 0; i < Math.min(toRemove, completed.length); i++) {
    const s = completed[i];
    sessions.delete(s.id);
    // Also clean up any stale activeProcesses entry
    if (activeProcesses?.has(s.id)) activeProcesses.delete(s.id);
    log("pty", `pruned old session ${s.id} (${s.agent}, ended ${s.endedAt})`);
  }
}

function createSession(agent, cwd) {
  pruneCompletedSessions();
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
    logs: [],          // Structured lifecycle events [{ts, event, detail}]
  };
  sessions.set(id, session);
  return session;
}

function sessionLog(session, event, detail) {
  const entry = { ts: new Date().toISOString(), event, detail };
  session.logs.push(entry);
  if (session.logs.length > 100) session.logs.shift();
  log("pty", `session=${session.id} ${event}: ${detail || ""}`);
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
    // Handle /api/stack — map ?action=start/stop to /stack/start, /stack/stop
    // and GET /api/stack?cwd=... to /stack/status?cwd=...
    else if (apiPath.startsWith("/stack")) {
      const action = url.searchParams.get("action");
      if (action) {
        url.searchParams.delete("action");
        req.url = `/stack/${action}` + (url.search ? url.search : "");
      } else if (req.method === "GET") {
        req.url = `/stack/status` + url.search;
      } else {
        req.url = apiPath + url.search;
      }
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
          logError("api", `API route error:`, err);
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

1. Check if the app is already running (lsof -iTCP -sTCP:LISTEN -P -n | grep "$OC_PROJECT"). If running, kill it first.
2. If there is a run.sh in the project root, execute it.
3. If there is no run.sh but there is a project.yaml, read it to understand how to start the app, then start it.
4. If neither exists, look in the apps/ folder. Figure out what the app is, how it works, and start it. Then create a run.sh at the project root so it can be started faster next time.

Important:
- Use dynamic port allocation. Never hardcode port numbers. Use PORT=0 or let the framework pick a random available port.
- Print the URL where the app is running once it starts.
- Do not ask questions. Just figure it out and run it.
- Your process has OC_PROJECT and OC_SERVICE env vars set. These tag the process for Open Canvas port management.`;

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

        // Kill any existing app-start/stack sessions for this cwd (kill-and-restart)
        for (const [id, s] of sessions) {
          if (s.cwd === cwd && (s.role === "app-start" || s.role === "stack") && s.status === "running") {
            const proc = activeProcesses.get(id);
            if (proc?.ptyProcess) {
              log("pty", `app-start: killing existing session=${id}`);
              proc.ptyProcess.kill();
              s.status = "completed";
              s.endedAt = new Date().toISOString();
              if (s.detectedPort) {
                try { registryMarkStopped(s.detectedPort); } catch {}
              }
            }
          }
        }

        // Kill any orphaned app processes registered to this project
        const projectPorts = registryGetProjectPorts(cwd);
        for (const alloc of projectPorts) {
          if (alloc.status === "running" && alloc.pid) {
            try { process.kill(alloc.pid, "SIGTERM"); } catch {}
            try { registryMarkStopped(alloc.port); } catch {}
          }
        }

        const agentName = agent;
        const agentDef = getAgentArgs(agentName);

        const session = createSession(agentName, cwd);
        session.role = "app-start";

        log("pty", `app-start: spawning ${agentName} session=${session.id} cwd=${cwd}`);

        const projectName = path.basename(cwd);
        const ptyProcess = pty.spawn(agentDef.shell, agentDef.args, {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            OC_PROJECT: projectName,
            OC_SERVICE: "app",
          },
        });

        session.pid = ptyProcess.pid;
        session.status = "running";

        activeProcesses.set(session.id, {
          ptyProcess,
          clients: new Set(),
          outputBuffer: [],
        });

        // Wait for agent ready signal, then inject prompt via bracketed paste
        const READY_TIMEOUT = 15000;
        let promptSent = false;
        const readyPattern = /[>❯]\s*$/;

        function sendAppStartPrompt() {
          if (promptSent) return;
          promptSent = true;
          if (readyTimer) clearTimeout(readyTimer);
          // Delay to let any startup messages (e.g. installer notices) clear
          setTimeout(() => {
            ptyProcess.write(`\x1b[200~${APP_START_PROMPT}\x1b[201~`);
            // Send Enter separately after a brief pause to ensure submission
            setTimeout(() => {
              ptyProcess.write("\r");
              log("pty", `app-start: sent prompt to session=${session.id}`);
            }, 200);
          }, 1500);
        }

        const readyTimer = setTimeout(() => {
          if (!promptSent) {
            logWarn("pty", `app-start: ready-detection timed out after ${READY_TIMEOUT}ms, sending anyway`);
            sendAppStartPrompt();
          }
        }, READY_TIMEOUT);

        ptyProcess.onData((data) => {
          // Detect agent ready before prompt injection (check each line)
          if (!promptSent) {
            const clean = stripAnsi(data);
            const cleanLines = clean.split("\n").filter((l) => l.trim());
            for (const cl of cleanLines) {
              if (readyPattern.test(cl.trim())) {
                log("pty", `app-start: agent ready detected for session=${session.id}`);
                sendAppStartPrompt();
                break;
              }
            }
          }
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
                  log("port", `app-start session=${session.id} detected port: ${port}`);
                  // Register in port registry (same as services path)
                  registryAllocatePort(projectName, cwd, "app", "web", port)
                    .then(() => {
                      registryMarkRunning(port, ptyProcess.pid, session.id);
                      log("port", `app-start port=${port} registered for project=${projectName}`);
                    })
                    .catch((err) => logError("port", `app-start registry failed:`, err.message));
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
          log("pty", `app-start session=${session.id} exited: code=${exitCode}`);
          session.status = exitCode === 0 ? "completed" : "failed";
          session.exitCode = exitCode;
          session.endedAt = new Date().toISOString();
          recordSessionHistory(session);
          if (session.detectedPort) {
            try { registryMarkStopped(session.detectedPort); } catch {}
          }
        });

        log("pty", `app-start session spawned: id=${session.id} pid=${ptyProcess.pid}`);
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
          log("pty", `stopping stack session=${found.id} pid=${found.session.pid}`);
          proc.ptyProcess.kill();
          found.session.status = "completed";
          found.session.endedAt = new Date().toISOString();
          if (found.session.detectedPort) {
            try { registryMarkStopped(found.session.detectedPort); } catch {}
          }
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
            log("service", `service:${name} spawning: ${command} in ${serviceCwd}`);

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
                      log("port", `service:${name} detected port: ${port}`);
                      // Register in port registry
                      if (projectName) {
                        try {
                          registryMarkRunning(port, ptyProcess.pid, session.id);
                          log("port", `service:${name} port=${port} registered for project=${projectName}`);
                        } catch (err) {
                          logError("port", `registry markRunning failed:`, err.message);
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
              log("service", `service:${name} exited: code=${exitCode}`);
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
                logWarn("service", `service:${name} ready timeout — proceeding`);
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
            log("service", `stopping ${s.role} session=${id} pid=${s.pid}`);
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
    if (isVoiceRateLimited()) {
      logWarn("voice", `voice-job: RATE LIMITED (max ${VOICE_RATE_LIMIT} per ${VOICE_RATE_WINDOW / 1000}s)`);
      res.writeHead(429);
      res.end(JSON.stringify({ error: "Too many voice jobs. Try again in a few seconds." }));
      return;
    }
    const MAX_BODY = 512 * 1024; // 512 KB
    let body = "";
    let oversized = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { oversized = true; req.destroy(); }
    });
    req.on("end", () => {
      if (oversized) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "Request body too large" }));
        return;
      }
      try {
        const { prompt, agent, cwd, skillContent } = JSON.parse(body);
        log("voice", `voice-job: received POST /voice-job`);
        log("voice", `voice-job:   prompt="${prompt?.substring(0, 150)}${(prompt?.length || 0) > 150 ? "..." : ""}"`);
        log("voice", `voice-job:   agent=${agent || "claude (default)"} cwd=${cwd}`);
        log("voice", `voice-job:   skillContent=${skillContent ? `${skillContent.length} bytes` : "NONE"}`);

        if (!prompt || !cwd) {
          logError("voice", `voice-job: REJECTED — missing prompt or cwd`);
          res.writeHead(400);
          res.end(JSON.stringify({ error: "prompt and cwd required" }));
          return;
        }

        const agentName = agent || "claude";
        if (!AGENT_COMMANDS[agentName]) {
          logError("voice", `voice-job: REJECTED — unknown agent "${agentName}"`);
          res.writeHead(400);
          res.end(JSON.stringify({ error: `unknown agent "${agentName}". Valid: ${Object.keys(AGENT_COMMANDS).join(", ")}` }));
          return;
        }
        const agentDef = getAgentArgs(agentName);
        log("voice", `voice-job:   agentDef shell=${agentDef.shell} args=${JSON.stringify(agentDef.args)}`);

        // Build the full prompt: prepend skill context if provided
        const fullPrompt = skillContent
          ? `<context>\n${skillContent}\n</context>\n\n${prompt}`
          : prompt;

        log("voice", `voice-job:   fullPrompt length=${fullPrompt.length} bytes (skill context ${skillContent ? "injected" : "skipped"})`);

        const session = createSession(agentName, cwd);
        session.role = "voice";
        session.prompt = prompt;

        log("voice", `voice-job: spawning ${agentName} session=${session.id} cwd=${cwd}`);

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
          },
        });

        session.pid = ptyProcess.pid;
        session.status = "running";
        sessionLog(session, "spawned", `pid=${ptyProcess.pid} agent=${agentName}`);

        // Track process for reconnection
        activeProcesses.set(session.id, {
          ptyProcess,
          clients: new Set(),
          outputBuffer: [],
        });

        // Inject prompt once agent CLI is ready (detected from output) or after timeout
        const READY_TIMEOUT = 10000; // 10s max wait
        let promptInjected = false;

        function injectPrompt() {
          if (promptInjected) return;
          promptInjected = true;
          sessionLog(session, "prompt-inject", `${fullPrompt.length} bytes via bracketed paste`);
          // Use bracketed paste mode to prevent control character interpretation
          // The \r (submit) MUST be a separate write after paste-end so the terminal
          // treats it as a keypress, not pasted text.
          ptyProcess.write(`\x1b[200~${fullPrompt}\x1b[201~`);
          session.inputBytes += Buffer.byteLength(fullPrompt);
          setTimeout(() => {
            ptyProcess.write("\r");
            sessionLog(session, "prompt-submitted", "carriage return sent");
          }, 200);
        }

        // Auto-exit: after prompt is injected, wait for the agent to finish
        // processing (output settles again), then send /exit to close the session.
        const COMPLETION_SETTLE_MS = 5000; // 5s of silence after processing = done
        const COMPLETION_TIMEOUT_MS = 120000; // 2 min max for voice job
        let completionTimer = null;
        let completionTimeout = null;

        function scheduleAutoExit() {
          completionTimeout = setTimeout(() => {
            if (session.status === "running") {
              sessionLog(session, "auto-exit-timeout", `${COMPLETION_TIMEOUT_MS / 1000}s max elapsed, sending /exit`);
              ptyProcess.write("/exit\r");
            }
          }, COMPLETION_TIMEOUT_MS);
        }

        function resetCompletionSettle() {
          if (completionTimer) clearTimeout(completionTimer);
          completionTimer = setTimeout(() => {
            if (session.status === "running") {
              sessionLog(session, "auto-exit", "agent output settled, sending /exit");
              if (completionTimeout) clearTimeout(completionTimeout);
              ptyProcess.write("/exit\r");
            }
          }, COMPLETION_SETTLE_MS);
        }

        // Ready detection: wait for the agent's output to settle (no new data for 1.5s)
        // This handles Claude CLI's TUI rendering which uses cursor positioning that
        // makes text pattern matching unreliable after ANSI stripping.
        // Also fall back to absolute timeout in case output never settles.
        let settleTimer = null;
        const SETTLE_MS = 1500;   // no output for 1.5s = ready

        sessionLog(session, "waiting-ready", `settle=${SETTLE_MS}ms, timeout=${READY_TIMEOUT}ms`);

        const readyTimeout = setTimeout(() => {
          if (!promptInjected) {
            if (settleTimer) clearTimeout(settleTimer);
            sessionLog(session, "ready-timeout", `${READY_TIMEOUT}ms elapsed, injecting`);
            injectPrompt();
            scheduleAutoExit();
          }
        }, READY_TIMEOUT);

        ptyProcess.onData((data) => {
          // Reset the settle timer on each output chunk
          if (!promptInjected) {
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
              if (!promptInjected) {
                sessionLog(session, "ready-settled", `output settled after ${SETTLE_MS}ms silence`);
                clearTimeout(readyTimeout);
                injectPrompt();
                // Start watching for completion after injection
                scheduleAutoExit();
              }
            }, SETTLE_MS);
          } else {
            // Prompt already injected — watch for completion settle
            resetCompletionSettle();
          }
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
          // Clean up auto-exit timers
          if (completionTimer) clearTimeout(completionTimer);
          if (completionTimeout) clearTimeout(completionTimeout);
          session.status = exitCode === 0 ? "completed" : "failed";
          session.exitCode = exitCode;
          session.endedAt = new Date().toISOString();
          sessionLog(session, "exited", `code=${exitCode} status=${session.status}`);
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
        log("pty", `injected command to session=${sessionId}: ${command.substring(0, 80)}`);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  // GET /sessions/:id/logs — return structured lifecycle logs for a session
  const logsMatch = req.url?.match(/^\/sessions\/(.+)\/logs$/);
  if (logsMatch && req.method === "GET") {
    const session = sessions.get(logsMatch[1]);
    if (session) {
      res.end(JSON.stringify({
        sessionId: session.id,
        agent: session.agent,
        status: session.status,
        logs: session.logs || [],
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
    }
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

  log("pty", "WebSocket client connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type !== "input") {
      log("pty", `ws received: ${msg.type} ${msg.agent || msg.sessionId || ""}`);
    }

    switch (msg.type) {
      case "spawn": {
        const agentName = msg.agent || "shell";
        const agentDef = getAgentArgs(agentName);
        const cwd = msg.cwd || process.env.HOME;
        const cols = msg.cols || 120;
        const rows = msg.rows || 30;

        // Build args — inject --resume for Claude when restoring from history
        let spawnArgs = [...agentDef.args];
        if (msg.resume && agentName === "claude") {
          // Replace "claude ..." with "claude --resume ..." in the shell -c argument
          spawnArgs = spawnArgs.map((a) =>
            a.startsWith("claude") ? a.replace("claude", "claude --resume") : a
          );
        }

        const session = createSession(agentName, cwd);
        if (msg.resume) {
          session.label = `${agentName.charAt(0).toUpperCase() + agentName.slice(1)} (resumed)`;
        }
        currentSessionId = session.id;

        try {
          log("pty", `spawning: ${agentDef.shell} ${spawnArgs.join(" ")} | agent=${agentName} session=${session.id} cwd=${cwd} (${cols}x${rows})${msg.resume ? ` resume=${msg.resume}` : ""}`);

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

          log("pty", `spawned PID ${ptyProcess.pid} session=${session.id}`);

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
                    log("port", `session=${session.id} detected app port: ${port}`);
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
            log("pty", `session=${session.id} exited: code=${exitCode} signal=${signal}`);
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
          logError("pty", `SPAWN FAILED for ${agentName}: ${err.message}`, { shell: agentDef.shell, args: agentDef.args, cwd, err });
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
          log("pty", `client reconnected to session=${sessionId}`);

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
              logWarn("pty", "resize error:", e.message);
            }
          }
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    log("pty", "WebSocket client disconnected");
    // Remove this client from the session but DON'T kill the process
    if (currentSessionId) {
      const proc = activeProcesses.get(currentSessionId);
      if (proc) {
        proc.clients.delete(ws);
        log("pty", `session=${currentSessionId} still has ${proc.clients.size} clients`);
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
      log("port", `registry cleanup: marked=${result.marked} removed=${result.removed}`);
    }
  } catch (err) {
    logError("port", `registry cleanup failed:`, err.message);
  }

  // Initialize cron scheduler for calendar events
  initCronScheduler((opts) => {
    // Callback to spawn a PTY session when a cron job fires a "prompt" action
    log("cron", `spawning session: agent=${opts.agent}, cwd=${opts.cwd}, event=${opts.eventId || "manual"}`);

    // Validate cwd exists
    if (!fs.existsSync(opts.cwd)) {
      logError("cron", `spawn aborted: cwd does not exist: ${opts.cwd}`);
      if (opts.onComplete) {
        opts.onComplete({ exitCode: 1, timedOut: false, lastOutput: [`Error: directory ${opts.cwd} does not exist`] });
      }
      return;
    }

    const session = createSession(opts.agent, opts.cwd);
    session.role = "cron";
    if (opts.eventId) session.eventId = opts.eventId;

    const agentCmd = getAgentArgs(opts.agent);
    const ptyProcess = pty.spawn(agentCmd.shell, agentCmd.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: opts.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    session.pid = ptyProcess.pid;
    session.status = "running";

    // Track the process
    activeProcesses.set(session.id, {
      ptyProcess,
      clients: new Set(),
      outputBuffer: [],
    });

    let promptSent = false;
    let sessionTimeout = null;
    let completionCalled = false;

    function callCompletion(result) {
      if (completionCalled) return;
      completionCalled = true;
      if (sessionTimeout) clearTimeout(sessionTimeout);
      if (opts.onComplete) {
        opts.onComplete({
          sessionId: session.id,
          exitCode: result.exitCode ?? -1,
          timedOut: result.timedOut || false,
          lastOutput: session.lastOutput,
        });
      }
    }

    // ── Gap 4: Session timeout ──
    if (opts.timeout) {
      sessionTimeout = setTimeout(() => {
        if (session.status === "running") {
          logWarn("cron", `session timeout: ${session.id} after ${opts.timeout / 60000}m`);
          try { ptyProcess.kill(); } catch {}
          session.status = "exited";
          session.exitCode = -1;
          session.endedAt = new Date().toISOString();
          recordSessionHistory(session);
          callCompletion({ exitCode: -1, timedOut: true });
        }
      }, opts.timeout);
    }

    // ── Gap 6: Wait for agent ready signal before sending prompt ──
    // Instead of a hardcoded 3s delay, detect when the agent is ready
    // by watching for common ready indicators in the output
    const READY_PATTERNS = [
      /\$\s*$/,          // shell prompt
      />\s*$/,           // claude/generic prompt
      /❯\s*$/,           // zsh prompt
      /waiting/i,        // "waiting for input"
      /ready/i,          // "ready"
      /\?\s*$/,          // question prompt
    ];
    const MAX_READY_WAIT_MS = 15000; // 15s max wait for ready signal
    let readyTimeout = null;

    function sendPromptWhenReady() {
      if (promptSent || !opts.prompt) return;
      promptSent = true;
      if (readyTimeout) clearTimeout(readyTimeout);
      // Small buffer after detecting ready to avoid racing
      setTimeout(() => {
        ptyProcess.write(opts.prompt + "\r");
        log("cron", `prompt delivered to session ${session.id}`);
      }, 300);
    }

    // Fallback: if we don't detect a ready signal in time, send anyway
    readyTimeout = setTimeout(() => {
      if (!promptSent) {
        logWarn("cron", `ready-wait timeout, sending prompt to ${session.id}`);
        sendPromptWhenReady();
      }
    }, MAX_READY_WAIT_MS);

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

      // Check for ready signal to send prompt
      if (!promptSent && READY_PATTERNS.some((p) => p.test(clean))) {
        sendPromptWhenReady();
      }

      // Buffer for reconnection
      const proc = activeProcesses.get(session.id);
      if (proc) {
        proc.outputBuffer.push(data);
        if (proc.outputBuffer.length > 200) {
          proc.outputBuffer = proc.outputBuffer.slice(-200);
        }
      }
    });

    // ── Gap 3: Track exit and feed back to scheduler ──
    ptyProcess.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      session.endedAt = new Date().toISOString();
      recordSessionHistory(session);
      activeProcesses.delete(session.id);
      callCompletion({ exitCode, timedOut: false });
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
