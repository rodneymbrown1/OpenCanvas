/**
 * /api/services routes — service management with port allocation
 * Migrated from src/app/api/services/route.ts
 */
import { log, logError } from "../logger.mjs";

import { readConfig } from "../../src/lib/config.js";
import { RunConfigManager } from "../../src/lib/core/RunConfigManager.js";
import { ServiceManager } from "../../src/lib/core/ServiceManager.js";
import { PortRegistry } from "../../src/lib/core/PortRegistry.js";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function getPtyPort() {
  try {
    const config = readConfig();
    return config.server?.pty_port || 3001;
  } catch {
    return 3001;
  }
}

export async function handle(req, res, url) {
  if (!url.pathname.startsWith("/api/services")) return false;

  const ptyPort = getPtyPort();

  // POST /api/services?action=start|stop
  if (req.method === "POST") {
    const action = url.searchParams.get("action");
    const body = await parseBody(req);
    const cwd = body.cwd;

    if (!cwd) return json(res, { error: "cwd required" }, 400), true;

    if (action === "start") {
      const runConfigMgr = new RunConfigManager(cwd);

      if (!runConfigMgr.exists()) {
        return json(res, { error: "No run-config.yaml found. Use /api/run-config?action=detect to generate one." }, 404), true;
      }

      const runConfig = runConfigMgr.read();
      const validation = runConfigMgr.validate(runConfig);
      if (!validation.valid) {
        return json(res, { error: "Invalid run-config.yaml", validation }, 400), true;
      }

      if (Object.keys(runConfig.services).length === 0) {
        return json(res, { error: "No services defined in run-config.yaml" }, 400), true;
      }

      try {
        const registry = new PortRegistry();
        const projectName = runConfig.project_name;

        for (const [name, svc] of Object.entries(runConfig.services)) {
          if (svc.auto_port || !svc.port) {
            const allocatedPort = await registry.allocatePort(projectName, cwd, name, svc.type, svc.port);
            svc.env = { ...svc.env, PORT: String(allocatedPort) };
            svc.port = allocatedPort;
          } else if (svc.port) {
            await registry.allocatePort(projectName, cwd, name, svc.type, svc.port);
          }
        }

        const svcMgr = new ServiceManager(runConfig, ptyPort);
        const statuses = await svcMgr.startAll(cwd, projectName);

        for (const [, status] of Object.entries(statuses)) {
          if (status.port && status.pid) {
            registry.markRunning(status.port, status.pid, status.sessionId);
          }
        }

        return json(res, { services: statuses, startOrder: svcMgr.getStartOrder(), projectName }), true;
      } catch (err) {
        logError("service", " start failed:", err);
        return json(res, { error: err instanceof Error ? err.message : "Failed to start services" }, 503), true;
      }
    }

    if (action === "stop") {
      const serviceName = body.service;
      try {
        const ptyUrl = `http://localhost:${ptyPort}`;
        const r = await fetch(`${ptyUrl}/services/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, service: serviceName }),
        });
        const data = await r.json();

        try {
          const registry = new PortRegistry();
          if (serviceName) {
            const projectPorts = registry.getProjectPorts(cwd);
            const match = projectPorts.find((a) => a.serviceName === serviceName);
            if (match) registry.markStopped(match.port);
          } else {
            registry.releaseProject(cwd);
          }
        } catch {}

        return json(res, data, r.status), true;
      } catch (err) {
        logError("service", " stop failed:", err);
        return json(res, { error: "PTY server unreachable" }, 503), true;
      }
    }

    return json(res, { error: "action param required (start|stop)" }, 400), true;
  }

  // GET /api/services?cwd=...
  if (req.method === "GET") {
    const cwd = url.searchParams.get("cwd");
    if (!cwd) return json(res, { error: "cwd required" }, 400), true;

    const ptyUrl = `http://localhost:${ptyPort}`;

    try {
      const r = await fetch(`${ptyUrl}/services/status?cwd=${encodeURIComponent(cwd)}`);
      const liveData = await r.json();

      const runConfigMgr = new RunConfigManager(cwd);
      let runConfig = null;
      let startOrder = [];

      if (runConfigMgr.exists()) {
        runConfig = runConfigMgr.read();
        startOrder = runConfigMgr.getStartOrder();

        for (const name of Object.keys(runConfig.services)) {
          if (!liveData.services?.[name]) {
            liveData.services = liveData.services || {};
            liveData.services[name] = { name, state: "stopped", port: runConfig.services[name].port };
          }
          if (liveData.services[name]) {
            liveData.services[name].type = runConfig.services[name].type;
          }
        }
      }

      return json(res, {
        services: liveData.services || {},
        hasRunConfig: runConfigMgr.exists(),
        startOrder,
        projectName: runConfig?.project_name,
      }), true;
    } catch {
      const runConfigMgr = new RunConfigManager(cwd);
      if (runConfigMgr.exists()) {
        const config = runConfigMgr.read();
        const services = {};
        for (const [name, svc] of Object.entries(config.services)) {
          services[name] = { name, state: "stopped", port: svc.port, type: svc.type };
        }
        return json(res, { services, hasRunConfig: true, startOrder: runConfigMgr.getStartOrder() }), true;
      }
      return json(res, { services: {}, hasRunConfig: false, startOrder: [] }), true;
    }
  }

  return false;
}
