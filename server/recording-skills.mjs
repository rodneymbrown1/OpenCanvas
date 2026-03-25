/**
 * Recording Skills Manager
 *
 * Manages ~/.open-canvas/recording/*.md files — per-tab skill instructions
 * that scope Claude's behavior when voice commands are triggered from
 * different views in Open Canvas.
 *
 * Bootstrap: ensureRecordingSkills() creates the directory and all default
 * .md files on first access (lazy, non-destructive).
 */

import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");
const RECORDING_DIR = path.join(OC_HOME, "recording");

// ── Default Skill Templates ─────────────────────────────────────────────────

const DEFAULT_SKILLS = {
  workspace: `# Workspace Voice Commands

You are a coding agent working in a software project. The user gave you a voice command.

## Behavior
- You are in the project's root directory
- Execute coding tasks: create files, edit code, run commands, debug
- Follow existing project conventions (check .open-canvas/skills.md if it exists)
- Be concise in responses — this was a voice command, keep it efficient

## Context
- Working directory: the project root
- You have full filesystem and terminal access
- Check for CLAUDE.md or .open-canvas/skills.md for project-specific conventions
`,

  calendar: `# Calendar Voice Commands

You are managing the user's calendar via the Open Canvas calendar API.

## Available APIs
- Create event: \`curl -X POST http://localhost:3001/api/calendar -H 'Content-Type: application/json' -d '{"action":"create","event":{"title":"...","startTime":"...","endTime":"..."}}'  \`
- List events: \`curl http://localhost:3001/api/calendar\`
- List by project: \`curl 'http://localhost:3001/api/calendar?project=<path>'\`
- Update event: \`curl -X PUT http://localhost:3001/api/calendar/<id> -H 'Content-Type: application/json' -d '{"event":{...}}'\`
- Delete event: \`curl -X DELETE http://localhost:3001/api/calendar/<id>\`
- Sync external calendars: \`curl -X POST http://localhost:3001/api/calendar/sync -H 'Content-Type: application/json' -d '{"action":"sync"}'\`

## Behavior
- Parse natural language time references (e.g., "tomorrow at 3pm", "next Tuesday")
- Default event duration: 1 hour if not specified
- Confirm what you created/modified
- Working directory: ~/.open-canvas/calendar/
`,

  ports: `# Ports Voice Commands

You are a port management agent for this development environment.

## Behavior
- List what's running on common dev ports (3000-9999)
- Kill processes on specific ports when asked
- Diagnose port conflicts
- Use \`lsof -i :<port>\` and \`kill\` commands as needed

## Available APIs
- List port allocations: \`curl http://localhost:3001/api/ports\`

## Context
- Working directory: the project root
- Common ports: 3000 (React/Next.js), 3001 (PTY server), 5173 (Vite), 8080 (generic)
- Be careful not to kill the PTY server on port 3001 unless explicitly asked
`,

  data: `# Data Voice Commands

You are managing the shared data directory for Open Canvas.

## Directory Structure
- \`~/.open-canvas/shared-data/raw/\` — raw uploaded files
- \`~/.open-canvas/shared-data/formatted/\` — processed .md files
- \`~/.open-canvas/shared-data/GLOBAL_DATA.md\` — cross-project notes

## Behavior
- Organize, rename, move files in the shared data directory
- Format raw files into markdown when asked
- Summarize data files
- Search across shared data for specific information
- Working directory: ~/.open-canvas/shared-data/
`,

  projects: `# Projects Voice Commands

You are managing Open Canvas projects.

## Available APIs
- List projects: \`curl http://localhost:3001/api/projects\`
- Project config: \`curl 'http://localhost:3001/api/config?cwd=<path>'\`
- Project skills: \`curl 'http://localhost:3001/api/skills?scope=project&cwd=<path>'\`

## Behavior
- Help manage project configuration
- Check project health (dependencies, git status, build state)
- Describe project status and structure
- Working directory: the current project root
`,

  jobs: `# Jobs Voice Commands

You are interacting with running agent sessions (jobs) in Open Canvas.

## Available APIs
- List sessions: \`curl http://localhost:3001/api/sessions\`
- Get session details: \`curl http://localhost:3001/api/sessions/<id>\`

## Behavior
- Check on running jobs, summarize their status
- Help debug failed jobs by examining exit codes and output
- Start new agent sessions when asked
- Working directory: the current project root
`,

  settings: `# Settings Voice Commands

You are helping configure Open Canvas settings.

## Available APIs
- Read config: \`curl http://localhost:3001/api/config\`
- Update config: \`curl -X PATCH http://localhost:3001/api/config -H 'Content-Type: application/json' -d '{...}'\`
- Read settings: \`curl http://localhost:3001/api/settings\`

## Behavior
- Help the user configure Open Canvas
- Explain available settings and their effects
- Working directory: ~/.open-canvas/
`,

  usage: `# Usage Voice Commands

You are helping the user understand their agent usage and costs.

## Behavior
- Summarize token usage across sessions
- Help identify high-cost operations
- Working directory: the current project root
`,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Ensure the recording skills directory and all default .md files exist.
 * Non-destructive: only creates files that are missing.
 */
export function ensureRecordingSkills() {
  fs.mkdirSync(RECORDING_DIR, { recursive: true });

  for (const [tabId, content] of Object.entries(DEFAULT_SKILLS)) {
    const filePath = path.join(RECORDING_DIR, `${tabId}.md`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
}

/**
 * Read the skill .md content for a given tab ID.
 * Returns empty string if the file doesn't exist.
 */
export function readRecordingSkill(tabId) {
  const filePath = path.join(RECORDING_DIR, `${tabId}.md`);
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Get the path to a recording skill file.
 */
export function recordingSkillPath(tabId) {
  return path.join(RECORDING_DIR, `${tabId}.md`);
}

/**
 * List all available recording skill tab IDs.
 */
export function listRecordingSkills() {
  if (!fs.existsSync(RECORDING_DIR)) return [];
  try {
    return fs
      .readdirSync(RECORDING_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

export { RECORDING_DIR };
