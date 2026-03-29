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
import { atomicWriteSync } from "../lib/safe-write.mjs";

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

const OPEN_CANVAS_SKILL = `# Open Canvas

Open Canvas is a local browser-based IDE that integrates terminal coding agents
(Claude, Codex, Gemini) with workspace management, live app preview, and project
tracking. You are running inside an Open Canvas project.

## What You Can Touch

\`\`\`
.open-canvas/
├── skills.md          # Project conventions & patterns (read/write)
├── PROJECT.md         # Project documentation (read/write)
└── GLOBAL_DATA.md     # Cross-project shared context (read/write)

skills/
├── run_app.md         # How to run the app (read)
├── dynamic_skills.md  # Add new skills here as needed (read/write)
└── open-canvas.md     # This file (read)

apps/                  # App source code lives here (read/write)
data/                  # Project data files (read/write)
run-config.yaml        # Service topology — defines how to start services (read/write)
open-canvas.yaml       # Project config — agent settings, permissions (read only)
\`\`\`

## Key APIs (PTY server on localhost:3001)

- \`GET  /api/config\`         — read project config
- \`GET  /api/skills?scope=project&cwd={path}\` — read skills
- \`POST /api/skills\`         — append or update skills
- \`GET  /api/services?cwd={path}\` — list running services
- \`POST /api/services\`       — start/stop services from run-config.yaml
- \`PATCH /api/config/api-keys\` — add API keys

## Rules

- Never hardcode ports — use PORT=0 or let the framework pick one.
- Place app code in \`apps/\`.
- Document conventions in \`.open-canvas/skills.md\` as you discover them.
- Create or update \`run-config.yaml\` when adding services.
- Your process is tagged with \`OC_PROJECT\` and \`OC_SERVICE\` env vars for discovery.
- Before starting an app, check if it's already running and kill it first.
- Always print the URL when the app starts so Open Canvas can detect the port.
`;

const RUN_APP_SKILLS = `# Project Skills

## How to Run the App

When asked to start or run the app, follow these steps in order:

1. If there is a \`run.sh\` in the project root, execute it.
2. If there is no \`run.sh\` but there is a \`project.yaml\`, read it to understand how to start the app, then start it.
3. If neither exists, look in the \`apps/\` folder. Figure out what the app is, how it works, and start it. Then create a \`run.sh\` at the project root so it can be started faster next time.

## Port Allocation

Never hardcode port numbers. Multiple apps may run simultaneously on this machine. Use PORT=0 or let the framework pick an available port. Always print the URL where the app is running.

## Building Apps

When creating or modifying apps in this project:
- Always use dynamic port allocation — never hardcode ports like 3000, 8080, etc.
- Use the framework's built-in port configuration (e.g. PORT env var, --port 0, etc.)
- Place app source code in the \`apps/\` folder.
- Create or update \`run.sh\` at the project root so the app can be started easily.

## Process Lifecycle

Before starting the app:
1. Check if it's already running: \`lsof -iTCP -sTCP:LISTEN -P -n\`
2. If you find a process for this project, kill it before restarting.
3. Open Canvas automatically registers your port when it detects it in stdout.

Your process runs with these env vars (set by Open Canvas):
- \`OC_PROJECT\` — project name (used for port registry tagging)
- \`OC_SERVICE\` — service name (usually "app")

Always print the URL (e.g., \`http://localhost:PORT\`) when the app starts — this is how Open Canvas detects the port.
`;

// Ensure skills/ directory and default skill files exist for a project
function ensureSkills(projectPath) {
  const skillsDir = path.join(projectPath, "skills");
  const runAppPath = path.join(skillsDir, "run_app.md");
  const dynamicSkillsPath = path.join(skillsDir, "dynamic_skills.md");
  const openCanvasPath = path.join(skillsDir, "open-canvas.md");
  fs.mkdirSync(skillsDir, { recursive: true });
  if (!fs.existsSync(runAppPath)) {
    atomicWriteSync(runAppPath, RUN_APP_SKILLS);
  }
  if (!fs.existsSync(dynamicSkillsPath)) {
    atomicWriteSync(dynamicSkillsPath, "dynamically add skills as you see fit\n");
  }
  if (!fs.existsSync(openCanvasPath)) {
    atomicWriteSync(openCanvasPath, OPEN_CANVAS_SKILL);
  }
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname !== "/api/projects") return false;

  if (method === "GET") {
    const configured = isSetUp();
    const config = configured ? readGlobalConfig() : null;
    const projects = configured
      ? listProjects().map((p) => {
          const exists = fs.existsSync(p.path);
          if (exists) ensureSkills(p.path);
          return { ...p, exists };
        })
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
          ensureSkills(body.path);
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
          ensureSkills(projectPath);

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
