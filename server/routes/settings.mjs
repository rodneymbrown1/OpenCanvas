import { execSync } from "child_process";
import {
  readGlobalConfig,
  writeGlobalConfig,
} from "../../src/lib/globalConfig.js";
import { readRegistry } from "../port-registry.mjs";

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

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // POST /api/settings/shutdown — gracefully shut down the app
  if (pathname === "/api/settings/shutdown" && method === "POST") {
    (async () => {
      let killApps = false;
      try {
        const body = await parseBody(req);
        killApps = body.killApps === true;
      } catch {}

      json(res, { shutdown: true, message: "Open Canvas is shutting down..." });
      console.log(`[pty-server] Shutdown requested (killApps=${killApps})`);

      setTimeout(() => {
        // Helper: kill every PID listening on a given port via lsof
        function killPort(port) {
          try {
            const out = execSync(`lsof -ti:${port}`, { encoding: "utf8" }).trim();
            for (const pid of out.split("\n").filter(Boolean)) {
              try { process.kill(parseInt(pid, 10), "SIGTERM"); } catch {}
            }
          } catch {}
        }

        if (killApps) {
          // Kill all project app processes registered in the port registry (41000-49999)
          try {
            const registry = readRegistry();
            for (const alloc of registry.allocations) {
              if (alloc.pid) {
                try { process.kill(alloc.pid, "SIGTERM"); } catch {}
              }
              // Belt-and-suspenders: also kill by port in case PID is stale
              killPort(alloc.port);
            }
          } catch (e) {
            console.warn("[pty-server] Error killing project apps:", e.message);
          }
        }

        // Always kill port 40000 (Vite dev server — separate process from us)
        killPort(40000);

        // Port 40001 (PTY server) is this process — process.exit handles it
        process.exit(0);
      }, 500);
    })();
    return true;
  }

  if (pathname !== "/api/settings/global") return false;

  if (method === "GET") {
    try {
      const config = readGlobalConfig();
      json(res, config);
    } catch {
      json(res, { error: "Failed to read global config" }, 500);
    }
    return true;
  }

  if (method === "PATCH") {
    (async () => {
      try {
        const updates = await parseBody(req);
        const config = readGlobalConfig();

        // Deep merge updates into defaults
        if (updates.defaults) {
          config.defaults = { ...config.defaults, ...updates.defaults };
          if (updates.defaults.permissions) {
            config.defaults.permissions = {
              ...config.defaults.permissions,
              ...updates.defaults.permissions,
            };
          }
        }

        // Merge app_settings
        if (updates.app_settings) {
          config.app_settings = {
            ...config.app_settings,
            ...updates.app_settings,
          };
        }

        writeGlobalConfig(config);
        json(res, config);
      } catch {
        json(res, { error: "Failed to update global config" }, 500);
      }
    })();
    return true;
  }

  return false;
}
