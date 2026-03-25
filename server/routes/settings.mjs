import {
  readGlobalConfig,
  writeGlobalConfig,
} from "../../src/lib/globalConfig.js";

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
