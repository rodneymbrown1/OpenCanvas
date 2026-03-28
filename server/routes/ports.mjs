// server/routes/ports.mjs — Port scanning, killing, registry, and PTY status
// Translates: src/app/api/ports/**/*.ts, src/app/api/pty-status/route.ts

import { logError } from "../logger.mjs";
import { exec, execSync, spawn } from "child_process";
import { createConnection } from "net";
import { PortRegistry } from "../../src/lib/core/PortRegistry.js";
import { readConfig } from "../../src/lib/config.js";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Known ports label map ────────────────────────────────────────────────────
const KNOWN_PORTS = {
  3000: "Next.js / React",
  3001: "Open Canvas PTY Server",
  3002: "Next.js (alt)",
  4200: "Angular",
  4321: "Astro",
  5000: "Flask / Vite preview",
  5173: "Vite",
  5174: "Vite (alt)",
  5500: "Live Server",
  6006: "Storybook",
  8000: "Django / FastAPI / Python",
  8080: "Webpack / Generic dev",
  8081: "Metro (React Native)",
  8443: "HTTPS dev",
  8787: "Cloudflare Workers",
  8888: "Jupyter Notebook",
  9000: "PHP / SonarQube",
  9090: "Prometheus",
  9229: "Node.js debugger",
  19000: "Expo",
  19006: "Expo web",
  24678: "Vite HMR",
  27017: "MongoDB",
  3306: "MySQL",
  5432: "PostgreSQL",
  6379: "Redis",
};

// ── Cached async port scanner ────────────────────────────────────────────────
let cachedPorts = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 3000;
let scanInFlight = null;

function parseLsofOutput(output) {
  const ports = [];
  const lines = output.trim().split("\n").slice(1);
  const seen = new Set();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const processName = parts[0];
    const pid = parseInt(parts[1], 10);
    const user = parts[2];
    const nameField = parts[8] || "";

    const portMatch = nameField.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    if (seen.has(port)) continue;
    seen.add(port);

    ports.push({
      port,
      pid,
      process: processName,
      user,
      type: "TCP",
      label: KNOWN_PORTS[port] || "",
    });
  }

  return ports.sort((a, b) => a.port - b.port);
}

function parseNetstatOutput(output) {
  const ports = [];
  const seen = new Set();

  for (const line of output.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const addrPort = parts[1];
    const pid = parseInt(parts[4], 10);
    const portMatch = addrPort.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    if (seen.has(port)) continue;
    seen.add(port);

    ports.push({
      port,
      pid,
      process: "unknown",
      user: "",
      type: "TCP",
      label: KNOWN_PORTS[port] || "",
    });
  }

  return ports.sort((a, b) => a.port - b.port);
}

function scanPortsAsync() {
  if (Date.now() - cacheTimestamp < CACHE_TTL_MS && cachedPorts.length > 0) {
    return Promise.resolve(cachedPorts);
  }

  if (scanInFlight) return scanInFlight;

  scanInFlight = new Promise((resolve) => {
    const platform = process.platform;

    if (platform === "darwin" || platform === "linux") {
      exec(
        "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || true",
        { timeout: 5000 },
        (err, stdout) => {
          scanInFlight = null;
          if (err) {
            resolve(cachedPorts);
            return;
          }
          cachedPorts = parseLsofOutput(stdout);
          cacheTimestamp = Date.now();
          resolve(cachedPorts);
        }
      );
    } else if (platform === "win32") {
      exec(
        "netstat -ano -p TCP | findstr LISTENING",
        { timeout: 5000 },
        (err, stdout) => {
          scanInFlight = null;
          if (err) {
            resolve(cachedPorts);
            return;
          }
          cachedPorts = parseNetstatOutput(stdout);
          cacheTimestamp = Date.now();
          resolve(cachedPorts);
        }
      );
    } else {
      scanInFlight = null;
      resolve([]);
    }
  });

  return scanInFlight;
}

let pollCount = 0;

// Singleton registry for /api/ports/registry
const registry = new PortRegistry();

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/ports ─────────────────────────────────────────────────────
  if (pathname === "/api/ports" && method === "GET") {
    const ports = await scanPortsAsync();

    try {
      const reg = new PortRegistry();

      pollCount++;
      if (pollCount % 10 === 0) {
        reg.cleanupStale();
      }

      const allocations = reg.getAllocations();
      const allocMap = new Map(allocations.map((a) => [a.port, a]));

      for (const p of ports) {
        const alloc = allocMap.get(p.port);
        if (alloc) {
          p.projectName = alloc.projectName;
          p.serviceName = alloc.serviceName;
          if (alloc.status === "running") {
            reg.updateLastSeen(p.port);
          }
        }
      }
    } catch {
      // Registry unavailable — return ports without tags
    }

    jsonResponse(res, { ports });
    return true;
  }

  // ── POST /api/ports/kill ───────────────────────────────────────────────
  if (pathname === "/api/ports/kill" && method === "POST") {
    const { pid, port } = await parseBody(req);

    if (!pid || !port) {
      jsonResponse(res, { error: "Missing pid or port" }, 400);
      return true;
    }

    try {
      const platform = process.platform;

      if (platform === "win32") {
        execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
      } else {
        try {
          execSync(`kill ${pid}`, { timeout: 3000 });
        } catch {
          execSync(`kill -9 ${pid}`, { timeout: 3000 });
        }
      }

      jsonResponse(res, { killed: true, pid, port });
    } catch (err) {
      jsonResponse(
        res,
        { error: `Failed to kill PID ${pid}: ${String(err)}` },
        500
      );
    }
    return true;
  }

  // ── GET /api/ports/registry ────────────────────────────────────────────
  if (pathname === "/api/ports/registry" && method === "GET") {
    try {
      const allocations = registry.getAllocations();
      jsonResponse(res, { allocations });
    } catch (err) {
      logError("port", " GET failed:", err);
      jsonResponse(res, { allocations: [] });
    }
    return true;
  }

  // ── POST /api/ports/registry?action=... ────────────────────────────────
  if (pathname === "/api/ports/registry" && method === "POST") {
    const action = url.searchParams.get("action");

    try {
      const body = await parseBody(req);

      if (action === "project-ports") {
        const { projectPath } = body;
        if (!projectPath) {
          jsonResponse(res, { error: "projectPath required" }, 400);
          return true;
        }
        registry.cleanupStale();
        const allocations = registry.getProjectPorts(projectPath);
        jsonResponse(res, { allocations });
        return true;
      }

      if (action === "allocate") {
        const {
          projectName,
          projectPath,
          serviceName,
          serviceType,
          preferredPort,
        } = body;
        if (!projectName || !projectPath || !serviceName || !serviceType) {
          jsonResponse(
            res,
            {
              error:
                "projectName, projectPath, serviceName, serviceType required",
            },
            400
          );
          return true;
        }
        const port = await registry.allocatePort(
          projectName,
          projectPath,
          serviceName,
          serviceType,
          preferredPort
        );
        jsonResponse(res, { port });
        return true;
      }

      if (action === "release") {
        const { port, projectPath } = body;
        if (port) {
          registry.releasePort(port);
        } else if (projectPath) {
          registry.releaseProject(projectPath);
        } else {
          jsonResponse(res, { error: "port or projectPath required" }, 400);
          return true;
        }
        jsonResponse(res, { ok: true });
        return true;
      }

      if (action === "cleanup") {
        const result = registry.cleanupStale();
        jsonResponse(res, result);
        return true;
      }

      jsonResponse(res, { error: "Unknown action" }, 400);
    } catch (err) {
      logError("port", " POST failed:", err);
      jsonResponse(
        res,
        { error: err instanceof Error ? err.message : "Internal error" },
        500
      );
    }
    return true;
  }

  // ── GET /api/pty-status ────────────────────────────────────────────────
  if (pathname === "/api/pty-status" && method === "GET") {
    const config = readConfig();
    const port = config.server?.pty_port || 3001;

    const running = await new Promise((resolve) => {
      const sock = createConnection({ port, host: "127.0.0.1" }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        sock.destroy();
        resolve(false);
      });
      sock.setTimeout(1000, () => {
        sock.destroy();
        resolve(false);
      });
    });

    jsonResponse(res, { running, port });
    return true;
  }

  // ── POST /api/pty-status ───────────────────────────────────────────────
  if (pathname === "/api/pty-status" && method === "POST") {
    const projectRoot = process.cwd();
    const serverPath = [projectRoot, "server", "pty-server.mjs"].join("/");

    try {
      const child = spawn("node", [serverPath], {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();

      // Wait for it to start
      await new Promise((resolve) => setTimeout(resolve, 1500));

      jsonResponse(res, { started: true, pid: child.pid });
    } catch (err) {
      jsonResponse(res, { started: false, error: String(err) }, 500);
    }
    return true;
  }

  return false;
}
