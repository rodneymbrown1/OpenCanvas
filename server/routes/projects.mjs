import fs from "fs";
import path from "path";
import {
  isSetUp,
  setupGlobalConfig,
  readGlobalConfig,
  listProjects,
  registerProject,
  removeProject,
  listSharedData,
  OC_HOME,
} from "../../src/lib/globalConfig.js";
import { RunConfigManager } from "../../src/lib/core/RunConfigManager.js";
import { SkillsManager } from "../../src/lib/core/SkillsManager.js";

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

  if (pathname !== "/api/projects") return false;

  if (method === "GET") {
    const configured = isSetUp();
    const config = configured ? readGlobalConfig() : null;
    const projects = configured
      ? listProjects().map((p) => ({ ...p, exists: fs.existsSync(p.path) }))
      : [];
    const sharedData = configured ? listSharedData() : [];

    json(res, {
      configured,
      home: configured ? config?.open_canvas_home : OC_HOME,
      sharedDataDir: config?.shared_data_dir || "",
      projects,
      sharedData,
      defaults: config?.defaults || {},
    });
    return true;
  }

  if (method === "POST") {
    (async () => {
      try {
        const body = await parseBody(req);

        // Setup action
        if (body.action === "setup") {
          const config = setupGlobalConfig(body.customHome);
          json(res, {
            configured: true,
            home: config.open_canvas_home,
            sharedDataDir: config.shared_data_dir,
          });
          return;
        }

        // Register project
        if (body.action === "register") {
          if (!body.path) {
            json(res, { error: "path required" }, 400);
            return;
          }
          if (!isSetUp()) setupGlobalConfig();
          const entry = registerProject(body.path, body.name);
          json(res, { project: entry });
          return;
        }

        // Remove project
        if (body.action === "remove") {
          if (!body.path) {
            json(res, { error: "path required" }, 400);
            return;
          }
          removeProject(body.path);
          json(res, { removed: true });
          return;
        }

        // Create new project
        if (body.action === "create") {
          if (!body.name) {
            json(res, { error: "name required" }, 400);
            return;
          }
          if (!isSetUp()) setupGlobalConfig();
          const config = readGlobalConfig();
          const slug = body.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const projectsDir = path.join(config.open_canvas_home, "projects");
          const projectPath = path.join(projectsDir, slug);

          if (fs.existsSync(projectPath)) {
            json(
              res,
              { error: `Project "${slug}" already exists` },
              409
            );
            return;
          }

          // Create project directory with standard structure
          fs.mkdirSync(path.join(projectPath, "data"), { recursive: true });
          fs.mkdirSync(path.join(projectPath, "apps"), { recursive: true });

          // Auto-generate run-config.yaml skeleton
          const runConfigMgr = new RunConfigManager(projectPath);
          if (!runConfigMgr.exists()) {
            runConfigMgr.write(runConfigMgr.getDefaults());
          }

          // Auto-generate .open-canvas/PROJECT.md and skills.md
          const skillsMgr = new SkillsManager("project", projectPath);
          skillsMgr.ensureFiles();

          // Register in global config
          const entry = registerProject(projectPath, body.name);
          json(res, { project: entry });
          return;
        }

        json(
          res,
          { error: "action required (setup|register|remove|create)" },
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
