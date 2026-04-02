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
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addProjectToGroup,
  removeProjectFromGroup,
  getKanban,
  setKanbanItemStatus,
  reorderKanbanColumn,
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
├── build_app.md       # How to build apps in this project (read)
├── dynamic_skills.md  # Add new skills here as needed (read/write)
└── open-canvas.md     # This file (read)

apps/                  # App source code lives here (read/write)
data/                  # Project data files (read/write)
run.sh                 # Root-level launch script — always create/maintain this
open-canvas.yaml       # Project config — agent settings, permissions (read only)
\`\`\`

## Key APIs (PTY server on localhost:40001)

- \`GET  /api/config\`         — read project config
- \`GET  /api/skills?scope=project&cwd={path}\` — read skills
- \`POST /api/skills\`         — append or update skills
- \`GET  /api/services?cwd={path}\` — list running services
- \`POST /api/services\`       — start/stop services
- \`PATCH /api/config/api-keys\` — add API keys

## Port Rules

Open Canvas allocates ports in the range **41000–49999** for project apps.
- **Never** hardcode port numbers like 3000, 8080, or 5173.
- The \`$PORT\` env var is pre-allocated and injected before your process starts — use it.
- Always pass \`$PORT\` to the framework: \`--port $PORT\`, \`PORT=$PORT npm start\`, etc.
- Print the URL (e.g. \`http://localhost:PORT\`) when the app starts so Open Canvas detects it.

## Other Rules

- Place app code in \`apps/\`.
- Always create/update \`run.sh\` at the project root — Open Canvas runs it directly for speed.
- Document conventions in \`.open-canvas/skills.md\` as you discover them.
- Your process is tagged with \`OC_PROJECT\` and \`OC_SERVICE\` env vars for discovery.
- Before starting an app, check if it's already running and kill it first.
`;

const RUN_APP_SKILLS = `# Run App

## How to Run the App

Open Canvas will try to execute \`run.sh\` at the project root directly (no agent
overhead — this is the fast path). If you are asked to start the app manually,
follow these steps in order:

1. If there is a \`run.sh\` in the project root, execute it: \`bash run.sh\`
2. If no \`run.sh\` exists, look in the \`apps/\` folder. Figure out the app type,
   start it, then **create a \`run.sh\`** at the project root for next time.

## Port Rules (critical)

Open Canvas pre-allocates a port in the **41000–49999** range and injects it as:
- \`$PORT\` — use this in run.sh and app startup commands
- \`$OC_PORT\` — same value, alternate name

**run.sh must pass \`$PORT\` to the framework.** Examples:

\`\`\`bash
# Vite / Node.js
exec npx vite --port "\${PORT}" --host

# npm start with PORT env
exec PORT="\${PORT}" npm start

# Python HTTP server (for static HTML)
exec python3 -m http.server "\${PORT}"

# npx serve (for static files)
exec npx serve -p "\${PORT}" .
\`\`\`

Never hardcode ports like 3000, 8080, or 5173 — those conflict with other apps.

## Process Lifecycle

Before starting the app:
1. Check if it's already running: \`lsof -iTCP -sTCP:LISTEN -P -n | grep "\$OC_PROJECT"\`
2. If running, kill it before restarting.
3. Always print the URL (e.g. \`http://localhost:\$PORT\`) when the app starts — this
   is how Open Canvas detects the port and shows the live preview.

Your process runs with these env vars (set by Open Canvas):
- \`OC_PROJECT\` — project name (used for port registry tagging)
- \`OC_SERVICE\` — service name (usually "app")
- \`PORT\` / \`OC_PORT\` — pre-allocated port in the 41000-49999 range
`;

const BUILD_APP_SKILLS = `# Build App

## Overview

When building apps in this Open Canvas project, follow these rules so the app
can be run instantly by the Open Canvas fast path (no agent spin-up needed).

## Port Rules (critical)

Open Canvas allocates ports in the **41000–49999** range.
- **Never** hardcode 3000, 8080, 5173, or any fixed port.
- Read the port from the \`$PORT\` env var that Open Canvas injects at startup.
- Always pass \`$PORT\` to the framework (see examples in \`skills/run_app.md\`).

## Always Create run.sh

Every app (including static HTML pages) must have a \`run.sh\` at the **project
root** that starts the app using \`$PORT\`. Open Canvas executes this file directly
to launch the app — no agent involved, startup in ~1 second.

Template for a **new project** \`run.sh\`:

\`\`\`bash
#!/usr/bin/env bash
set -e
cd "\$(dirname "\$0")"
PORT="\${PORT:-41000}"

# Install dependencies if needed (uncomment as appropriate)
# npm install
# pip install -r requirements.txt

# Start the app
exec <your-start-command> --port "\$PORT"
\`\`\`

### App type → run.sh command

| App type | Command |
|---|---|
| Vite / React / Vue | \`exec npx vite --port "\$PORT" --host\` |
| Create React App | \`exec PORT="\$PORT" npm start\` |
| Next.js | \`exec npx next dev --port "\$PORT"\` |
| Express / Node.js | \`exec PORT="\$PORT" node server.js\` |
| FastAPI / uvicorn | \`exec uvicorn app.main:app --port "\$PORT" --host 0.0.0.0\` |
| Flask | \`exec flask run --port "\$PORT" --host 0.0.0.0\` |
| Static HTML | \`exec python3 -m http.server "\$PORT"\` |
| Static files (npm) | \`exec npx serve -p "\$PORT" .\` |

## File Structure

\`\`\`
project-root/
├── run.sh          ← always create/update this
├── apps/
│   └── my-app/     ← app source code goes here
│       └── run.sh  ← optional per-app run.sh (gets auto-copied to root)
├── data/
└── skills/
\`\`\`

## After Building

1. Verify \`run.sh\` exists at the project root and uses \`$PORT\`.
2. Make it executable: \`chmod +x run.sh\`
3. Test it: \`PORT=41000 bash run.sh\` — confirm the app starts and prints its URL.
`;

const CALENDAR_SKILL = `# Open Canvas Calendar

The Open Canvas Calendar lives at **localhost:40001** (PTY server). Use it to
schedule tasks, set reminders, and create automated events that Open Canvas will
execute on your behalf.

## Create an Event

\`\`\`http
POST http://localhost:40001/api/calendar
Content-Type: application/json

{
  "action": "create",
  "event": {
    "title": "string (required)",
    "startTime": "ISO-8601 string (required) — e.g. 2026-04-02T09:00:00.000Z",
    "endTime": "ISO-8601 string (optional)",
    "allDay": false,
    "description": "optional notes",
    "recurrence": "cron expression (optional) — e.g. '0 9 * * 1' for every Monday at 9 AM",
    "source": { "agent": "claude", "projectPath": "/path/to/project" },
    "target": "user | agent | both",
    "action": {
      "type": "prompt | command | reminder",
      "payload": "the prompt text, shell command, or reminder message",
      "projectPath": "/path/to/project",
      "agent": "claude"
    },
    "tags": ["optional", "tag", "list"]
  }
}
\`\`\`

Response: \`{ "event": { "id": "...", ...fullEvent } }\`

## Event Fields

| Field | Type | Notes |
|---|---|---|
| \`title\` | string | Required. Short label shown in the UI. |
| \`startTime\` | ISO-8601 | Required. When the event fires or starts. |
| \`endTime\` | ISO-8601 | Optional. If omitted, event is treated as a point-in-time. |
| \`allDay\` | boolean | Set true to make it a full-day event (startTime date only). |
| \`recurrence\` | cron string | Repeating schedule, e.g. \`"0 8 * * *"\` = daily at 8 AM. |
| \`source.agent\` | string | Who created it: \`"claude"\`, \`"codex"\`, \`"gemini"\`, \`"user"\`. |
| \`source.projectPath\` | string | Absolute path of the originating project. |
| \`target\` | string | Who it's for: \`"user"\`, \`"agent"\`, or \`"both"\`. |
| \`action.type\` | string | \`"prompt"\` = send a prompt to an agent; \`"command"\` = run a shell command; \`"reminder"\` = show a notification. |
| \`action.payload\` | string | The prompt text, command string, or reminder message. |
| \`action.projectPath\` | string | Project context for the action. |
| \`tags\` | string[] | Freeform labels for filtering. |

## Action Types

- **prompt** — At \`startTime\`, Open Canvas sends \`action.payload\` as a prompt
  to an agent running in \`action.projectPath\`. Good for scheduled code tasks.
- **command** — Runs a shell command in the project directory.
- **reminder** — Pops a UI notification for the user. No code execution.

## Update an Event

\`\`\`http
POST http://localhost:40001/api/calendar
Content-Type: application/json

{ "action": "update", "id": "<event-id>", "updates": { "title": "New title" } }
\`\`\`

## Delete an Event

\`\`\`http
POST http://localhost:40001/api/calendar
Content-Type: application/json

{ "action": "delete", "id": "<event-id>" }
\`\`\`

## List / Query Events

\`\`\`http
GET http://localhost:40001/api/calendar
GET http://localhost:40001/api/calendar?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z
GET http://localhost:40001/api/calendar?project=/path/to/project
GET http://localhost:40001/api/calendar?status=pending
\`\`\`

## Status Values

\`pending\` → \`running\` → \`completed\` | \`failed\` | \`missed\` | \`cancelled\`

## Quick Examples

### Remind me tomorrow morning
\`\`\`json
{
  "action": "create",
  "event": {
    "title": "Morning standup reminder",
    "startTime": "2026-04-02T09:00:00.000Z",
    "source": { "agent": "claude" },
    "target": "user",
    "action": { "type": "reminder", "payload": "Time for standup!" }
  }
}
\`\`\`

### Schedule a daily agent task
\`\`\`json
{
  "action": "create",
  "event": {
    "title": "Daily dependency audit",
    "startTime": "2026-04-02T07:00:00.000Z",
    "recurrence": "0 7 * * *",
    "source": { "agent": "claude", "projectPath": "/Users/you/projects/myapp" },
    "target": "agent",
    "action": {
      "type": "prompt",
      "payload": "Check for outdated npm packages and open a summary in the terminal.",
      "projectPath": "/Users/you/projects/myapp",
      "agent": "claude"
    }
  }
}
\`\`\`
`;

const PROJECT_NOTES_SKILL = `# Project Notes & Knowledge Base

## Purpose

Every project has a living knowledge base in its \`data/\` directory. Use it to
capture meeting notes, ideas, decisions, and context — organized so future
sessions can pick up exactly where you left off.

## When This Applies

- User shares meeting notes, recaps, or action items
- User mentions an idea, feature request, or brainstorm
- User explains background context, constraints, or goals
- User makes a decision or records a rationale
- User asks you to "remember" or "note" something about the project
- You complete a significant milestone and want to document it

## Data Directory Structure

\`\`\`
data/
├── _index.md          # Living project brief — ALWAYS keep this updated
├── meetings/          # Meeting notes (one file per meeting: YYYY-MM-DD-topic.md)
├── ideas/             # Ideas and brainstorming (one file per theme)
├── decisions/         # Decisions and their rationale (decision-log.md)
├── context/           # Background context, research, constraints
└── tasks/             # Action items and follow-ups
\`\`\`

## The _index.md (Project Knowledge Brief)

This is the most important file. It gives any future session instant context.
Update it whenever you add new data. Structure:

\`\`\`markdown
# <Project Name> — Knowledge Brief

## What This Project Is
<One paragraph describing the project purpose, who it's for, and what problem it solves>

## Current Status
<Current phase, what's in progress, what's done>

## Key Decisions
- <Decision 1 with date>
- <Decision 2 with date>

## Open Questions / Next Steps
- <Item 1>
- <Item 2>

## Data Summary
- meetings/: <N> files — <date range>
- ideas/: <N> files
- decisions/: decision-log.md (<N> entries)
- context/: <brief description>
\`\`\`

## How to Organize Notes

**Meeting notes** → \`data/meetings/YYYY-MM-DD-topic.md\`
Format: attendees, agenda, discussion summary, decisions made, action items.

**Ideas** → \`data/ideas/<theme>.md\`
Group related ideas in one file. Add to it over time rather than creating many files.

**Decisions** → \`data/decisions/decision-log.md\`
Append entries: date, decision, rationale, alternatives considered.

**Context / research** → \`data/context/<topic>.md\`
Background info, constraints, domain knowledge, external references.

**Action items** → \`data/tasks/action-items.md\`
Running list. Mark completed items with ~~strikethrough~~, add dates.

## Rules

1. **Always create \`data/_index.md\` first** if it doesn't exist — ask the user
   one focused question to understand the project purpose before writing.
2. **Update \`_index.md\`** after every new note — keep "Current Status" and
   "Open Questions / Next Steps" fresh.
3. **Prefer appending to existing files** over creating new ones — cohesive
   themes beat fragmented files.
4. **Infer project purpose** from \`.open-canvas/PROJECT.md\`, existing \`data/\`
   files, and \`CLAUDE.md\` before asking the user.
5. **Never overwrite** existing notes — always append or merge.
6. **Date-stamp all entries** (ISO format: YYYY-MM-DD).
`;

const DYNAMIC_SKILLS_TEMPLATE = `# Dynamic Skills

Add skills to this file when you discover something worth remembering — patterns,
solutions, or conventions specific to this project.

## When to add a skill

- You solved a tricky problem (e.g. CORS config, build tool quirk, API auth)
- You discovered a project convention not documented elsewhere
- You completed a significant feature and want to capture the pattern
- You found a performance trick or important limitation

## Format

Use markdown headings (##) for each skill. Be concise — a skill is a note to
your future self, not documentation. Example:

\`\`\`markdown
## Auth uses JWT in httpOnly cookies
The backend sets tokens via Set-Cookie; never store in localStorage.

## Tailwind purge config must include apps/**/*.tsx
Without this, production builds strip used classes from dynamic class names.
\`\`\`
`;

// Ensure skills/ directory and default skill files exist for a project.
// Static skills (run_app.md, build_app.md, open-canvas.md) are ALWAYS
// overwritten so all projects stay up-to-date when the system evolves.
// dynamic_skills.md is only written on creation — it belongs to the agent.
function ensureSkills(projectPath) {
  const skillsDir = path.join(projectPath, "skills");
  const runAppPath = path.join(skillsDir, "run_app.md");
  const buildAppPath = path.join(skillsDir, "build_app.md");
  const dynamicSkillsPath = path.join(skillsDir, "dynamic_skills.md");
  const openCanvasPath = path.join(skillsDir, "open-canvas.md");
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");

  fs.mkdirSync(skillsDir, { recursive: true });
  // Ensure data/ subdirectories exist for the notes skill
  ["meetings", "ideas", "decisions", "context", "tasks"].forEach((sub) => {
    fs.mkdirSync(path.join(projectPath, "data", sub), { recursive: true });
  });

  // Static immutable system skills — always overwrite for backwards compat
  atomicWriteSync(runAppPath, RUN_APP_SKILLS);
  atomicWriteSync(buildAppPath, BUILD_APP_SKILLS);
  atomicWriteSync(openCanvasPath, OPEN_CANVAS_SKILL);
  atomicWriteSync(path.join(skillsDir, "calendar.md"), CALENDAR_SKILL);
  atomicWriteSync(path.join(skillsDir, "project_notes.md"), PROJECT_NOTES_SKILL);

  // Agent-owned skills — only create if missing
  if (!fs.existsSync(dynamicSkillsPath)) {
    atomicWriteSync(dynamicSkillsPath, DYNAMIC_SKILLS_TEMPLATE);
  }

  // CLAUDE.md at project root — tells Claude Code to read skills on startup.
  // Only create if missing so agents/users can customize it freely.
  if (!fs.existsSync(claudeMdPath)) {
    atomicWriteSync(claudeMdPath, `# Project Instructions

Read all files in the \`skills/\` folder before starting any task:
- \`skills/open-canvas.md\` — Open Canvas environment & port rules
- \`skills/run_app.md\`    — how to run this app
- \`skills/build_app.md\`  — how to build apps in this project
- \`skills/calendar.md\`   — how to create/update/delete Open Canvas calendar events
- \`skills/project_notes.md\` — how to capture and organize project knowledge in \`data/\`
- \`skills/dynamic_skills.md\` — project-specific patterns (add to this as you learn)
- \`.open-canvas/skills.md\` — project conventions

Also read \`data/_index.md\` if it exists — it is the living project brief with
current status, key decisions, and open questions.

**Port rule**: always use \$PORT (41000-49999 range). Never hardcode 3000/5173/8080.
**run.sh rule**: always create/maintain \`run.sh\` at the project root using \$PORT.
**Calendar rule**: use \`POST http://localhost:40001/api/calendar\` to schedule events or reminders — see \`skills/calendar.md\` for the full API.
**Notes rule**: when the user shares notes, ideas, or context — capture them in \`data/\` per \`skills/project_notes.md\` and update \`data/_index.md\`.
`);
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

    const groups = configured ? listGroups() : [];
    const kanban = configured ? getKanban() : { todo: [], "in-progress": [], done: [] };

    json(res, {
      configured,
      home: configured ? config?.open_canvas_home : OC_HOME,
      sharedDataDir: config?.shared_data_dir || "",
      projects,
      sharedData,
      groups,
      kanban,
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

        // Create group
        if (body.action === "create-group") {
          if (!body.name) {
            json(res, { error: "name required" }, 400);
            return;
          }
          const group = createGroup(body.name, body.color);
          json(res, { group });
          return;
        }

        // Update group (rename / recolor)
        if (body.action === "update-group") {
          if (!body.groupId) {
            json(res, { error: "groupId required" }, 400);
            return;
          }
          const updates = {};
          if (body.name !== undefined) updates.name = body.name;
          if (body.color !== undefined) updates.color = body.color;
          const group = updateGroup(body.groupId, updates);
          if (!group) {
            json(res, { error: "group not found" }, 404);
            return;
          }
          json(res, { group });
          return;
        }

        // Delete group
        if (body.action === "delete-group") {
          if (!body.groupId) {
            json(res, { error: "groupId required" }, 400);
            return;
          }
          deleteGroup(body.groupId);
          json(res, { deleted: true });
          return;
        }

        // Add project to group
        if (body.action === "add-to-group") {
          if (!body.groupId || !body.projectPath) {
            json(res, { error: "groupId and projectPath required" }, 400);
            return;
          }
          const ok = addProjectToGroup(body.groupId, body.projectPath);
          if (!ok) {
            json(res, { error: "group not found" }, 404);
            return;
          }
          json(res, { added: true });
          return;
        }

        // Remove project from group (ungroup)
        if (body.action === "remove-from-group") {
          if (!body.groupId || !body.projectPath) {
            json(res, { error: "groupId and projectPath required" }, 400);
            return;
          }
          removeProjectFromGroup(body.groupId, body.projectPath);
          json(res, { removed: true });
          return;
        }

        // Set kanban status (add, move, or remove an item from the board)
        // status: "todo" | "in-progress" | "done" | null (null = remove from board)
        if (body.action === "kanban-set") {
          if (!body.type || !body.id) {
            json(res, { error: "type and id required" }, 400);
            return;
          }
          if (body.type !== "project" && body.type !== "group") {
            json(res, { error: 'type must be "project" or "group"' }, 400);
            return;
          }
          const validStatuses = ["todo", "in-progress", "done", null];
          if (!validStatuses.includes(body.status ?? null)) {
            json(res, { error: 'status must be "todo", "in-progress", "done", or null' }, 400);
            return;
          }
          setKanbanItemStatus({ type: body.type, id: body.id }, body.status || null);
          json(res, { ok: true, kanban: getKanban() });
          return;
        }

        // Reorder items within a kanban column
        if (body.action === "kanban-reorder") {
          if (!body.status || body.fromIndex === undefined || body.toIndex === undefined) {
            json(res, { error: "status, fromIndex, and toIndex required" }, 400);
            return;
          }
          reorderKanbanColumn(body.status, body.fromIndex, body.toIndex);
          json(res, { ok: true, kanban: getKanban() });
          return;
        }

        json(
          res,
          { error: "action required (setup|register|remove|create|create-group|update-group|delete-group|add-to-group|remove-from-group)" },
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
