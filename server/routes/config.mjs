import {
  readConfig,
  updateConfig,
  readProjectConfig,
  updateProjectConfig,
  readProjectConfigRaw,
  writeProjectConfigRaw,
  APP_CONFIG_CACHE_PATH,
} from "../../src/lib/config.js";
import {
  readGlobalConfig,
  writeGlobalConfig,
} from "../../src/lib/globalConfig.js";
import { RunConfigManager } from "../../src/lib/core/RunConfigManager.js";
import { SkillsManager } from "../../src/lib/core/SkillsManager.js";
import fs from "fs";
import path from "path";
import { atomicWriteSync, withFileLock } from "../lib/safe-write.mjs";
import { logPersistenceError } from "../logger.mjs";

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

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}

// Runtime config cache lives in ~/.open-canvas/, not in the repo
const APP_CONFIG_PATH = APP_CONFIG_CACHE_PATH;

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // --- /api/config/api-keys (root-scoped API key management) ---
  if (pathname === "/api/config/api-keys") {
    if (method === "GET") {
      try {
        const globalConfig = readGlobalConfig();
        const keys = globalConfig.api_keys || {};
        // Mask values for display
        const masked = {};
        for (const [k, v] of Object.entries(keys)) {
          if (typeof v === "string" && v.length > 8) {
            masked[k] = v.slice(0, 4) + "..." + v.slice(-4);
          } else {
            masked[k] = v ? "****" : "";
          }
        }
        json(res, { api_keys: masked, _rootScoped: true });
      } catch {
        json(res, { error: "Failed to read API keys" }, 500);
      }
      return true;
    }

    if (method === "PATCH") {
      (async () => {
        try {
          const body = await parseBody(req);
          const globalConfig = readGlobalConfig();

          if (body.action === "remove" && body.key) {
            delete globalConfig.api_keys[body.key];
          } else if (body.api_keys && typeof body.api_keys === "object") {
            globalConfig.api_keys = { ...globalConfig.api_keys, ...body.api_keys };
          }

          writeGlobalConfig(globalConfig);
          json(res, { ok: true, keys: Object.keys(globalConfig.api_keys) });
        } catch (err) {
          logPersistenceError("write", "global.yaml", err);
          json(res, { error: "Failed to update API keys" }, 500);
        }
      })();
      return true;
    }

    return false;
  }

  // --- /api/config ---
  if (pathname === "/api/config") {
    if (method === "GET") {
      const workDir = url.searchParams.get("workDir");
      try {
        if (workDir) {
          const config = readProjectConfig(workDir);
          const safe = { ...config, api_keys: undefined };
          json(res, { ...safe, _projectScoped: true });
        } else {
          const config = readConfig();
          // Merge api_keys from global config
          const globalConfig = readGlobalConfig();
          const globalKeys = globalConfig.api_keys || {};
          // Mask keys for display
          const maskedKeys = {};
          for (const [k, v] of Object.entries(globalKeys)) {
            if (typeof v === "string" && v.length > 8) {
              maskedKeys[k] = v.slice(0, 4) + "..." + v.slice(-4);
            } else {
              maskedKeys[k] = v ? "****" : "";
            }
          }
          json(res, { ...config, api_keys: maskedKeys });
        }
      } catch {
        json(res, { error: "Failed to read config" }, 500);
      }
      return true;
    }

    if (method === "PATCH") {
      const workDir = url.searchParams.get("workDir");
      (async () => {
        try {
          const updates = await parseBody(req);

          // Route api_keys to global config (root scope)
          if (updates.api_keys) {
            await withFileLock(APP_CONFIG_PATH, () => {
              const globalConfig = readGlobalConfig();
              globalConfig.api_keys = { ...globalConfig.api_keys, ...updates.api_keys };
              writeGlobalConfig(globalConfig);
            });
            delete updates.api_keys;
          }

          // Apply remaining updates to project/app config
          if (Object.keys(updates).length > 0) {
            const configPath = workDir
              ? path.join(workDir, "open-canvas.yaml")
              : APP_CONFIG_PATH;
            await withFileLock(configPath, () => {
              if (workDir) {
                const updated = updateProjectConfig(workDir, (config) =>
                  deepMerge(config, updates)
                );
                json(res, updated);
              } else {
                const updated = updateConfig((config) =>
                  deepMerge(config, updates)
                );
                json(res, updated);
              }
            });
          } else {
            json(res, { ok: true });
          }
        } catch (err) {
          logPersistenceError("write", APP_CONFIG_PATH, err);
          json(res, { error: "Failed to update config" }, 500);
        }
      })();
      return true;
    }

    return false;
  }

  // --- /api/project-yaml ---
  if (pathname === "/api/project-yaml") {
    if (method === "GET") {
      const workDir = url.searchParams.get("workDir");
      try {
        if (workDir) {
          const content = readProjectConfigRaw(workDir);
          json(res, {
            content,
            path: path.join(workDir, "open-canvas.yaml"),
            isProjectScoped: true,
          });
        } else {
          const content = fs.existsSync(APP_CONFIG_PATH)
            ? fs.readFileSync(APP_CONFIG_PATH, "utf-8")
            : "";
          json(res, {
            content,
            path: APP_CONFIG_PATH,
            isProjectScoped: false,
          });
        }
      } catch {
        json(res, { content: "" });
      }
      return true;
    }

    if (method === "PUT") {
      (async () => {
        const workDir = url.searchParams.get("workDir");
        try {
          const { content } = await parseBody(req);
          if (workDir) {
            writeProjectConfigRaw(workDir, content);
          } else {
            atomicWriteSync(APP_CONFIG_PATH, content);
          }
          json(res, { ok: true });
        } catch (err) {
          logPersistenceError("write", workDir ? `${workDir}/open-canvas.yaml` : APP_CONFIG_PATH, err);
          json(res, { error: "Failed to save" }, 500);
        }
      })();
      return true;
    }

    return false;
  }

  // --- /api/run-config ---
  if (pathname === "/api/run-config") {
    if (method === "GET") {
      const cwd = url.searchParams.get("cwd");
      if (!cwd) {
        json(res, { error: "cwd required" }, 400);
        return true;
      }

      const manager = new RunConfigManager(cwd);

      if (!manager.exists()) {
        json(res, { exists: false, config: null });
        return true;
      }

      const config = manager.read();
      const validation = manager.validate(config);
      const topology = manager.getTopology();

      json(res, {
        exists: true,
        config,
        startOrder: topology.startOrder,
        validation,
        agentPrompt: manager.toAgentPrompt(),
      });
      return true;
    }

    if (method === "POST") {
      (async () => {
        try {
          const action = url.searchParams.get("action");
          const body = await parseBody(req);
          const cwd = body.cwd;

          if (!cwd) {
            json(res, { error: "cwd required in body" }, 400);
            return;
          }

          const manager = new RunConfigManager(cwd);

          // Auto-detect services from filesystem
          if (action === "detect") {
            const config = manager.detectAndWrite();
            const validation = manager.validate(config);
            const servicesFound = Object.keys(config.services).length;

            let skillsGenerated = false;
            if (servicesFound > 0) {
              try {
                const skillsMgr = new SkillsManager("project", cwd);
                skillsMgr.ensureFiles();
                const runSection =
                  SkillsManager.generateRunSection(config);
                skillsMgr.appendSection("Running the App", runSection);
                skillsGenerated = true;
              } catch (err) {
                console.error(
                  "[api/run-config] skills generation failed:",
                  err
                );
              }
            }

            json(res, {
              config,
              startOrder: manager.getStartOrder(),
              validation,
              servicesFound,
              skillsGenerated,
            });
            return;
          }

          // Add a single service
          if (action === "add-service") {
            const { name, service } = body;
            if (!name || !service) {
              json(res, { error: "name and service required" }, 400);
              return;
            }
            const config = manager.addService(name, service);
            json(res, { config });
            return;
          }

          // Remove a service
          if (action === "remove-service") {
            const { name } = body;
            if (!name) {
              json(res, { error: "name required" }, 400);
              return;
            }
            const config = manager.removeService(name);
            json(res, { config });
            return;
          }

          // Default: write full config
          if (body.config) {
            const validation = manager.validate(body.config);
            if (!validation.valid) {
              json(res, { error: "Invalid config", validation }, 400);
              return;
            }
            manager.write(body.config);
            json(res, { config: body.config, validation });
            return;
          }

          json(
            res,
            {
              error:
                "Provide config in body, or use ?action=detect|add-service|remove-service",
            },
            400
          );
        } catch (err) {
          json(res, { error: String(err) }, 500);
        }
      })();
      return true;
    }

    return false;
  }

  return false;
}
