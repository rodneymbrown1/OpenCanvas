/**
 * Voice Skills Manager
 *
 * Manages ~/.open-canvas/recording/skills/*.md — capability files that give
 * the voice agent full awareness of the Open Canvas ecosystem.
 *
 * The agent receives ALL skills composed into a single context string.
 * No tab-based routing — the agent determines intent natively from the
 * user's message and the skills it has.
 *
 * Bootstrap: ensureVoiceSkills() creates the skills/ directory and all
 * default .md files on first access (lazy, non-destructive).
 */

import fs from "node:fs";
import path from "node:path";
import { log, logWarn } from "./logger.mjs";
import { atomicWriteSync } from "./lib/safe-write.mjs";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");
const RECORDING_DIR = path.join(OC_HOME, "recording");
const SKILLS_DIR = path.join(RECORDING_DIR, "skills");

// ── Default Skill File Contents ─────────────────────────────────────────────
// These are written to disk on first boot. Once on disk, the files are the
// source of truth — users/agents can edit them without touching server code.

const DEFAULT_VOICE_SKILLS = {
  "oc-system": `# Open Canvas Voice Agent

You are a voice-activated coding agent in Open Canvas. The user gave you a voice command.
Your working directory is ~/.open-canvas/recording/ but you can and should navigate
anywhere in the OC tree to fulfill the request.

## Voice Session Rules
- Be concise. This is a voice command, not a chat session.
- Confirm what you did in 1-2 sentences.
- If truly ambiguous, ask ONE clarifying question. Otherwise, use best judgment.
- You have full filesystem and terminal access.

## Open Canvas Directory Structure

\`\`\`
~/.open-canvas/
├── global.yaml              # All registered projects (name, path, lastOpened)
├── projects/                # All projects
│   └── <slug>/
│       ├── .open-canvas/
│       │   ├── PROJECT.md   # Project architecture doc
│       │   └── skills.md    # Project conventions & patterns
│       ├── apps/            # Application source code
│       ├── data/            # Project-specific data
│       ├── skills/          # Project-level skills (run_app.md, etc.)
│       ├── run-config.yaml  # Service definitions (how to start/stop)
│       └── project.yaml     # Project manifest (name, description, stack)
├── recording/               # You are here
│   └── skills/              # Your capability files (this folder)
├── calendar/
│   ├── calendar.yaml        # All events (YAML, ISO 8601 timestamps)
│   ├── cron-state.yaml      # Cron job scheduling state
│   └── CALENDAR.md          # Calendar agent context
├── shared-data/
│   ├── raw/                 # Raw uploaded files
│   ├── formatted/           # Processed markdown documents
│   └── GLOBAL_DATA.md       # Cross-project notes
├── session-history/         # Per-project agent session logs
└── port-registry.json       # Port allocation tracking
\`\`\`

## How to Find Things
- List all projects: \`cat ~/.open-canvas/global.yaml\` (look at the \`projects:\` array)
- List project groups: same file, look at the \`groups:\` array (each group has id, name, color, projectPaths)
- Kanban board: same file → \`kanban: { todo, in-progress, done }\` — each column has KanbanItem[] with type+id
- Find a specific project: parse the projects array for matching name
- Find which group a project is in: check groups[].projectPaths for the project's path
- Find project/group kanban status: check which column of kanban[].items contains the project path or group id
- Read project conventions: \`cat <project-path>/.open-canvas/skills.md\`
- Read project architecture: \`cat <project-path>/.open-canvas/PROJECT.md\`
- Check how to run a project: \`cat <project-path>/skills/run_app.md\`
- Current calendar events: \`curl http://localhost:3001/api/calendar\`

## Available APIs (localhost:3001)
Use these where filesystem alone is insufficient:

| API | Methods | Purpose |
|-----|---------|---------|
| \`/api/calendar\` | GET, POST, PUT, DELETE | Calendar event CRUD (use this, don't edit YAML directly) |
| \`/api/projects\` | GET, POST | List projects, create/register/remove projects |
| \`/api/config\` | GET, PATCH | Read/write Open Canvas configuration |
| \`/api/sessions\` | GET | List all agent sessions (running + completed) |
| \`/api/ports\` | GET | List port allocations |
| \`/api/skills\` | GET, POST | Read/write project skill files |

## What You Can Do
You handle ANY voice request. Your capabilities include:
- **Calendar** — Create, list, update, delete events and reminders
- **Projects** — Create new projects, navigate existing ones, check status
- **Coding** — Write code, fix bugs, edit files, refactor, run commands in any project
- **Data** — Organize, search, and manage shared data files
- **Jobs** — Check on running agent sessions, review completed ones
- **Ports** — Check what's running on ports, kill processes
- **Settings** — Configure Open Canvas preferences
- **Usage** — Review token usage and costs
- **Kanban** — Update project/group board status (todo / in-progress / done)
- **Project Groups** — Organize projects into named groups, move projects between groups

For coding tasks, always \`cd\` into the project directory first and read
\`.open-canvas/skills.md\` for that project's conventions before making changes.
`,

  calendar: `# Calendar

## When This Applies
User mentions scheduling, meetings, events, reminders, calendar, "tomorrow at", "next week",
"remind me", dates, times, or anything time-related they want tracked.

## How to Do It

Use the Calendar API at localhost:3001. Do NOT manually edit calendar.yaml.

### Create Event
\`\`\`bash
curl -X POST http://localhost:3001/api/calendar \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"create","event":{"title":"...","startTime":"2026-03-28T15:00:00","endTime":"2026-03-28T16:00:00"}}'
\`\`\`

### List Events
\`\`\`bash
curl http://localhost:3001/api/calendar
# Filter by date range:
curl 'http://localhost:3001/api/calendar?from=2026-03-28T00:00:00&to=2026-03-29T00:00:00'
# Filter by project:
curl 'http://localhost:3001/api/calendar?project=<project-path>'
\`\`\`

### Update Event
\`\`\`bash
curl -X PUT http://localhost:3001/api/calendar/<id> \\
  -H 'Content-Type: application/json' \\
  -d '{"event":{"title":"new title","startTime":"..."}}'
\`\`\`

### Delete Event
\`\`\`bash
curl -X DELETE http://localhost:3001/api/calendar/<id>
\`\`\`

## Agent Tasks (Action Events)

When the user says "agent task", "automated task", "have the agent do X", or anything that
should run autonomously at the scheduled time, add an \`action\` object to the event.

**Action types:**
- \`"prompt"\` — Spawns an agent session and sends the payload as a prompt (most common)
- \`"command"\` — Runs a shell command (must be in the allowlist: npm, git, python, curl, etc.)
- \`"reminder"\` — Creates a notification with the payload as the message

### Create an Agent Task
\`\`\`bash
curl -X POST http://localhost:3001/api/calendar \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"create","event":{
    "title":"...",
    "startTime":"2026-03-28T15:00:00",
    "endTime":"2026-03-28T16:00:00",
    "target":"agent",
    "action":{
      "type":"prompt",
      "payload":"The instruction for the agent to execute",
      "agent":"claude",
      "projectPath":"/optional/path/to/project"
    }
  }}'
\`\`\`

### Create a Reminder
\`\`\`bash
curl -X POST http://localhost:3001/api/calendar \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"create","event":{
    "title":"...",
    "startTime":"2026-03-28T15:00:00",
    "target":"user",
    "action":{"type":"reminder","payload":"Don'\\''t forget to review the PR"}
  }}'
\`\`\`

### Action Field Reference
| Field | Required | Description |
|-------|----------|-------------|
| \`type\` | Yes | \`"prompt"\`, \`"command"\`, or \`"reminder"\` |
| \`payload\` | Yes | The prompt text, shell command, or reminder message |
| \`agent\` | No | Agent to use for prompt type (default: \`"claude"\`) |
| \`projectPath\` | No | Working directory for the agent/command |

### Target Field
- \`"user"\` — Regular event or reminder for the user (default)
- \`"agent"\` — Agent task that runs autonomously at the scheduled time
- \`"both"\` — Notify user AND run agent task

## Rules
- Parse natural language times ("tomorrow 3pm", "next Tuesday", "in 2 hours")
- Default duration: 1 hour unless specified
- All times in ISO 8601 format
- Always confirm what was created/modified with the event details
- For recurring events, use the recurrence field with cron syntax
- If the user says "agent task", "automated", or "have it run" — always set \`target: "agent"\` and include an \`action\` with \`type: "prompt"\`
- Use the user's words as the \`action.payload\` — rephrase into a clear agent instruction
- If the user mentions a specific project, set \`action.projectPath\` to that project's path
`,

  projects: `# Projects

## When This Applies
User mentions creating a project, listing projects, switching projects, project status,
project health, or anything about managing their development projects.

## How to Do It

### List All Projects
\`\`\`bash
curl http://localhost:3001/api/projects
\`\`\`
Or directly: \`cat ~/.open-canvas/global.yaml\` and read the \`projects:\` array.

### Create a New Project
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"create","name":"<project-name>"}'
\`\`\`

This creates the standard structure at \`~/.open-canvas/projects/<slug>/\`:
\`\`\`
<slug>/
├── .open-canvas/
│   ├── PROJECT.md    # Architecture doc (populate this)
│   └── skills.md     # Conventions (populate this)
├── apps/             # Application source code
├── data/             # Project-specific data
├── skills/           # Project skills
│   ├── run_app.md
│   └── dynamic_skills.md
└── run-config.yaml   # Service definitions
\`\`\`

### After Creating a Project
1. \`cd\` into the new project directory
2. Update \`.open-canvas/PROJECT.md\` with the project description and purpose
3. Update \`.open-canvas/skills.md\` with relevant conventions
4. If a specific tech stack was requested, scaffold the app in \`apps/\`

### Register an External Project
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"register","name":"...","path":"/absolute/path/to/project"}'
\`\`\`

### Check Project Health
\`\`\`bash
cd <project-path>
cat .open-canvas/PROJECT.md     # Architecture overview
cat .open-canvas/skills.md      # Conventions
cat run-config.yaml             # Service definitions
git status                      # Git state
\`\`\`

## Rules
- Project names become URL-safe slugs (lowercase, hyphens)
- Always confirm the created project path to the user
- If the user asks to "open" or "switch to" a project, find it in global.yaml and report its path
- For group operations (move to group, create group, list by group) — see the project-groups skill
`,

  workspace: `# Workspace / Coding

## When This Applies
User mentions writing code, fixing bugs, editing files, refactoring, running commands,
debugging, adding features, building something, deploying, testing, or any development task.

## How to Do It

1. **Determine the project** — If not specified, check \`~/.open-canvas/global.yaml\` for the most recently opened project (\`lastOpened\` field).
2. **Navigate there** — \`cd <project-path>\`
3. **Read conventions** — \`cat .open-canvas/skills.md\` for project patterns and rules
4. **Read architecture** — \`cat .open-canvas/PROJECT.md\` if you need structural context
5. **Check run config** — \`cat run-config.yaml\` or \`cat skills/run_app.md\` if you need to run/start the app
6. **Execute the task** — Write code, fix bugs, run commands as needed
7. **Confirm** — Briefly state what was done

## Rules
- Always read \`.open-canvas/skills.md\` before making code changes
- Follow existing project conventions (indentation, naming, patterns)
- Check for CLAUDE.md files at project root for additional conventions
- If the project has a specific tech stack, respect it
- For running apps, check \`skills/run_app.md\` or \`run-config.yaml\` for the correct commands
`,

  data: `# Data Management

## When This Applies
User mentions shared data, uploading files, organizing documents, searching across projects,
formatting files, or anything about the shared data repository.

## How to Do It

The shared data directory is at \`~/.open-canvas/shared-data/\`:
\`\`\`
shared-data/
├── raw/           # Raw uploaded files (unprocessed)
├── formatted/     # Processed markdown documents, organized by topic
└── GLOBAL_DATA.md # Cross-project notes and summaries
\`\`\`

### Common Operations
- **List data:** \`ls ~/.open-canvas/shared-data/formatted/\`
- **Search across data:** \`grep -r "keyword" ~/.open-canvas/shared-data/\`
- **Read global notes:** \`cat ~/.open-canvas/shared-data/GLOBAL_DATA.md\`
- **Format a raw file:** Read from \`raw/\`, convert to markdown, save to \`formatted/\`
- **Organize:** Move files into appropriate subdirectories under \`formatted/\`

## Rules
- Raw uploads go in \`raw/\`, processed markdown goes in \`formatted/\`
- Maintain the existing directory organization under \`formatted/\`
- When summarizing, include file paths so the user can find things later
`,

  jobs: `# Jobs / Sessions

## When This Applies
User asks about running jobs, agent sessions, what's currently executing, session status,
or wants to check on background tasks.

## How to Do It

### List All Sessions
\`\`\`bash
curl http://localhost:3001/api/sessions
\`\`\`
Returns all sessions with: id, agent, status (running/completed/failed), cwd, startedAt, endedAt, exitCode.

### Get Session Details
\`\`\`bash
curl http://localhost:3001/api/sessions/<id>
\`\`\`

### Get Session Output (last N lines)
\`\`\`bash
curl http://localhost:3001/api/sessions/<id>/output
\`\`\`

### Check Session History
Session history files are at \`~/.open-canvas/session-history/\` — one JSON file per project path.

## Rules
- Summarize session status concisely: how many running, how many completed, any failures
- For failed sessions, report the exit code and last output lines
- Session IDs are UUIDs — use short prefixes when referencing them to the user
`,

  ports: `# Port Management

## When This Applies
User asks about what's running on a port, port conflicts, killing processes on ports,
or anything about network port usage.

## How to Do It

### List Port Allocations
\`\`\`bash
curl http://localhost:3001/api/ports
\`\`\`

### Check a Specific Port
\`\`\`bash
lsof -i :<port>
\`\`\`

### Kill a Process on a Port
\`\`\`bash
lsof -ti :<port> | xargs kill
\`\`\`

### Common Development Ports
- 3000 — React / Next.js dev server
- 3001 — Open Canvas PTY server (be careful with this one)
- 5173 — Vite dev server
- 8080 — Generic backend

## Rules
- Do NOT kill the PTY server on port 3001 unless explicitly asked
- Always confirm what was killed and on which port
- Check \`~/.open-canvas/port-registry.json\` for registered allocations
`,

  settings: `# Settings

## When This Applies
User asks about configuration, changing settings, preferences, defaults, or Open Canvas setup.

## How to Do It

### Read Current Config
\`\`\`bash
curl http://localhost:3001/api/config
\`\`\`

### Update Config
\`\`\`bash
curl -X PATCH http://localhost:3001/api/config \\
  -H 'Content-Type: application/json' \\
  -d '{"key":"value"}'
\`\`\`

### Read Settings
\`\`\`bash
curl http://localhost:3001/api/settings
\`\`\`

### Direct Config File
Global config is at \`~/.open-canvas/global.yaml\` — contains registered projects, defaults (agent, theme, stack), app settings.

## Rules
- Explain what a setting does before changing it
- Confirm the change after applying it
`,

  kanban: `# Kanban Board

## When This Applies
User says "mark X as done", "X is done", "start working on X", "X is in progress",
"add X to the board", "move X to [column]", "what's on the board",
"update project status", "show me what's in progress".

## Data Model
The kanban board has 3 columns: **todo**, **in-progress**, **done**.
Each item has a \`type\` ("project" or "group") and an \`id\` (project path or group UUID).

Key design: a project and its containing group can BOTH appear on the board as separate items
with independent statuses. This is intentional — they are orthogonal states.

## View Current Board
\`\`\`bash
curl http://localhost:3001/api/projects
# Look at "kanban": { "todo": [...], "in-progress": [...], "done": [...] }
# Each item: { "type": "project"|"group", "id": "/path" or "uuid" }
\`\`\`

## Add / Move to Column
\`\`\`bash
# Add or move a project to in-progress
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"kanban-set","type":"project","id":"/path/to/project","status":"in-progress"}'

# Add a group to done
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"kanban-set","type":"group","id":"<group-uuid>","status":"done"}'
\`\`\`
Note: a project/group can only be in ONE column. Moving it automatically removes it from its previous column.

## Remove From Board
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"kanban-set","type":"project","id":"/path/to/project","status":null}'
\`\`\`

## Find IDs
- Project paths: \`cat ~/.open-canvas/global.yaml\` → \`projects[].path\`
- Group IDs: same file → \`groups[].id\` and \`groups[].name\`

## Status Values
- \`"todo"\` — not started
- \`"in-progress"\` — currently being worked on
- \`"done"\` — completed / shipped

## Rules
- "mark X as done" / "X is done" / "finish X" → status: "done"
- "I'm starting X" / "working on X" / "X is in progress" → status: "in-progress"
- "add X to the board" (no status specified) → default to "todo"
- "move X to [column]" → set the appropriate status
- Match project/group names case-insensitively
- When reporting board state, list all 3 columns with their items by name (not raw paths)
`,

  "project-groups": `# Project Groups

## When This Applies
User mentions grouping projects, moving a project to a group, creating a group, asking which
group a project is in, or organizing projects into categories.

## Data Model
Groups are stored in \`~/.open-canvas/global.yaml\` under the \`groups:\` key.
Each group has: id, name, color (hex), projectPaths (array of absolute paths).
Projects themselves remain flat in the \`projects:\` array — groups just reference paths.

## How to Do It

### List All Groups (and which projects are in them)
\`\`\`bash
curl http://localhost:3001/api/projects
# Look at the "groups" array in the response
\`\`\`
Or directly: \`cat ~/.open-canvas/global.yaml\` and read the \`groups:\` array.

### Create a New Group
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"create-group","name":"Clients","color":"#22c55e"}'
\`\`\`

### Add a Project to a Group
First find the group's id (from \`curl /api/projects\`), then:
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"add-to-group","groupId":"<id>","projectPath":"/path/to/project"}'
\`\`\`
Note: a project can only be in ONE group. Adding it to a new group automatically removes it from any previous group.

### Remove a Project from Its Group (ungroup)
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"remove-from-group","groupId":"<id>","projectPath":"/path/to/project"}'
\`\`\`

### Rename or Recolor a Group
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"update-group","groupId":"<id>","name":"New Name","color":"#6366f1"}'
\`\`\`

### Delete a Group
\`\`\`bash
curl -X POST http://localhost:3001/api/projects \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"delete-group","groupId":"<id>"}'
\`\`\`
Projects in the group are NOT deleted — they just become ungrouped.

## Rules
- When the user says "put X in the Y group" or "move X to Y" — find the project path from global.yaml, find the group id, then call add-to-group
- When the user says "create a group called X" — call create-group with a reasonable color
- When listing projects, mention their group (if any) so the user understands the organization
- If the group doesn't exist yet, offer to create it first, then add the project
- Always confirm what group the project ended up in
`,

  usage: `# Usage & Cost Tracking

## When This Applies
User asks about token usage, costs, how much they've spent, expensive operations, or usage analytics.

## How to Do It

### Check Session History for Usage Data
Session logs are at \`~/.open-canvas/session-history/\` — each file contains sessions with outputBytes, inputBytes, and duration.

\`\`\`bash
# List all session history files
ls ~/.open-canvas/session-history/

# Read a specific project's sessions
cat ~/.open-canvas/session-history/<project-file>.json
\`\`\`

### Analyze Usage
- Sum up outputBytes and inputBytes across sessions
- Identify longest-running sessions (durationSeconds)
- Flag sessions with high byte counts as potentially expensive
- Group by project to show per-project costs

## Rules
- Present usage data in a clear summary format
- Highlight any unusually expensive sessions
- Note that byte counts are approximate proxies for token usage
`,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Ensure the recording/skills/ directory and all default .md files exist.
 * Non-destructive: only creates files that are missing.
 */
export function ensureVoiceSkills() {
  log("skill", ` ensureVoiceSkills: SKILLS_DIR=${SKILLS_DIR}`);
  fs.mkdirSync(SKILLS_DIR, { recursive: true });

  let created = 0;
  let skipped = 0;
  for (const [name, content] of Object.entries(DEFAULT_VOICE_SKILLS)) {
    const filePath = path.join(SKILLS_DIR, `${name}.md`);
    if (!fs.existsSync(filePath)) {
      atomicWriteSync(filePath, content);
      created++;
      log("skill", `   created: ${name}.md (${content.length} bytes)`);
    } else {
      skipped++;
    }
  }
  log("skill", ` ensureVoiceSkills: created=${created} skipped=${skipped} (already exist)`);
}

// ── Skill Context Cache ────────────────────────────────────────────────────

let _cachedContext = null;   // { content: string, mtimeKey: string }

/** Build a cache key from all skill file mtimes */
function _skillMtimeKey() {
  try {
    const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")).sort();
    return files.map((f) => {
      const stat = fs.statSync(path.join(SKILLS_DIR, f));
      return `${f}:${stat.mtimeMs}`;
    }).join("|");
  } catch {
    return "";
  }
}

/**
 * Compose all skill files into a single context string.
 * Reads oc-system.md first (master context), then all other skills alphabetically.
 * Results are cached and invalidated when any skill file's mtime changes.
 */
export function composeVoiceContext() {
  ensureVoiceSkills();

  const mtimeKey = _skillMtimeKey();
  if (_cachedContext && _cachedContext.mtimeKey === mtimeKey) {
    log("skill", ` composeVoiceContext: returning cached (${_cachedContext.content.length} bytes)`);
    return _cachedContext.content;
  }

  log("skill", ` composeVoiceContext: composing all skills (cache miss)...`);

  const systemPath = path.join(SKILLS_DIR, "oc-system.md");
  let context = "";

  // Lead with the master context
  if (fs.existsSync(systemPath)) {
    context = fs.readFileSync(systemPath, "utf-8");
    log("skill", `   loaded oc-system.md (${context.length} bytes)`);
  } else {
    logWarn("skill", `   WARNING: oc-system.md not found at ${systemPath}`);
  }

  // Append all other skill files
  const skillFiles = fs.readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "oc-system.md")
    .sort();

  log("skill", `   found ${skillFiles.length} domain skill files: ${skillFiles.join(", ")}`);

  for (const file of skillFiles) {
    const content = fs.readFileSync(path.join(SKILLS_DIR, file), "utf-8");
    context += "\n\n---\n\n" + content;
    log("skill", `   appended ${file} (${content.length} bytes)`);
  }

  log("skill", ` composeVoiceContext: DONE — total context ${context.length} bytes`);
  _cachedContext = { content: context, mtimeKey };
  return context;
}

/**
 * List all available voice skill names.
 */
export function listVoiceSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  try {
    return fs
      .readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/**
 * Legacy compat — ensures skills exist (delegates to ensureVoiceSkills).
 */
export function ensureRecordingSkills() {
  ensureVoiceSkills();
}

/**
 * Legacy compat — list recording skills.
 */
export function listRecordingSkills() {
  return listVoiceSkills();
}

export { RECORDING_DIR, SKILLS_DIR };
