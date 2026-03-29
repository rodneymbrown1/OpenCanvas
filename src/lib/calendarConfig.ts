import fs from "fs";
import path from "path";
import YAML from "yaml";
import { nanoid } from "nanoid";
import { OC_HOME, SHARED_DATA_DIR } from "./globalConfig";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentType = "claude" | "codex" | "gemini" | "user";
export type EventTarget = "agent" | "user" | "both";
export type ActionType = "prompt" | "command" | "reminder";
export type EventStatus = "pending" | "running" | "triggered" | "completed" | "failed" | "missed" | "cancelled";

export interface EventAction {
  type: ActionType;
  payload: string;
  projectPath?: string;
  agent?: string;
}

export interface EventSource {
  agent: AgentType;
  projectPath?: string;
  sessionId?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string;       // ISO 8601
  endTime?: string;        // ISO 8601
  allDay?: boolean;
  recurrence?: string;     // cron expression for recurring events
  source: EventSource;
  target: EventTarget;
  action?: EventAction;
  status: EventStatus;
  googleCalendarId?: string;
  tags?: string[];
  execution?: ExecutionRecord;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  durationMs?: number;
  outputSummary?: string; // last N lines of agent output
  error?: string;
}

export interface CalendarNotification {
  id: string;
  eventId: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface CronJobState {
  eventId: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  status: "active" | "paused" | "stopped";
}

// ── Paths ────────────────────────────────────────────────────────────────────

export const CALENDAR_DIR = path.join(OC_HOME, "calendar");
export const CALENDAR_EVENTS_PATH = path.join(CALENDAR_DIR, "calendar.yaml");
export const CRON_STATE_PATH = path.join(CALENDAR_DIR, "cron-state.yaml");
export const NOTIFICATIONS_PATH = path.join(CALENDAR_DIR, "notifications.yaml");
export const HISTORY_PATH = path.join(CALENDAR_DIR, "history.yaml");
export const CALENDAR_MD_PATH = path.join(CALENDAR_DIR, "CALENDAR.md");
export const CALENDAR_SKILLS_PATH = path.join(CALENDAR_DIR, "skills.md");
export const AGENT_SKILL_PATH = path.join(CALENDAR_DIR, "open-canvas-agent-skill.md");

// ── Seed Content ─────────────────────────────────────────────────────────────

const SEED_CALENDAR_MD = `# Calendar Agent Context

You are the Calendar Agent for Open Canvas. You manage a global calendar that spans all projects.

## Capabilities
- Create, update, and delete calendar events
- Parse natural language date/time expressions
- Schedule agent prompts and reminders via cron jobs
- Sync with Google Calendar (when MCP server is configured)

## Conventions
- All times are stored in ISO 8601 format
- Recurring events use cron expressions
- Events can target the user, an agent, or both
- Action items include: prompts (sent to agents), commands (executed in projects), reminders (notifications)

## User Patterns
<!-- This section evolves as the calendar agent learns user preferences -->
`;

const SEED_SKILLS_MD = `# Calendar Skills

## Available Actions
- **create_event**: Create a new calendar event with title, time, and optional action
- **list_events**: List upcoming events, optionally filtered by project or date range
- **update_event**: Modify an existing event's details or status
- **delete_event**: Remove an event from the calendar
- **schedule_prompt**: Schedule an agent prompt to run at a specific time in a project
- **set_reminder**: Create a reminder notification for the user
- **sync_google**: Sync events with Google Calendar (when connected)

## Agent Task Execution

When an agent task fires from the calendar, a real PTY session is spawned running the
selected agent CLI (claude, codex, or gemini). The agent operates exactly as if a user
opened a terminal — full file system access, command execution, and project awareness.

### How Agent Tasks Work
1. User creates an "Agent Task" event on the calendar with a prompt and optional project scope
2. The cron scheduler fires at the scheduled time
3. A PTY session spawns running the agent CLI in the target directory
4. The prompt is sent to the agent automatically
5. The agent has full autonomy to read files, run commands, and complete the task

### Project Discovery (for auto-detect mode)
When no explicit project is specified, the agent should:
1. Read \`~/.open-canvas/global.yaml\` → \`projects[]\` for registered projects
2. Each project entry has \`name\`, \`path\`, and \`lastOpened\`
3. Infer the relevant project from the task description
4. Read the project's \`.open-canvas/skills.md\` and \`.open-canvas/PROJECT.md\` for context
5. cd into the project directory before starting work

### Cross-Project Operations
- Read \`~/.open-canvas/shared-data/project-manager-skills.md\` for cross-project guidance
- Shared data directory: \`~/.open-canvas/shared-data/\`
- After completing work, the agent may update the event status or create notifications

## Calendar Connections

### Connecting Google Calendar
1. Ensure \`google_calendar_client_id\` and \`google_calendar_client_secret\` are set in API Keys
2. POST to \`/api/calendar/connections\` with \`{action: "initiate-oauth", provider: "google"}\`
3. User completes OAuth flow in browser
4. Events sync automatically every 5 minutes

### Syncing
- Trigger sync: POST \`/api/calendar/sync\` with \`{action: "sync"}\`
- Push single event: POST \`/api/calendar/sync\` with \`{action: "push-event", connectionId, eventId}\`
- Direction options: bidirectional, pull-only, push-only
- Conflict resolution: newest-wins (default), remote-wins, local-wins

### Managing Connections
- List: GET \`/api/calendar/connections\`
- Remove: POST \`/api/calendar/connections\` with \`{action: "remove", connectionId}\`
- List remote calendars: POST \`/api/calendar/connections\` with \`{action: "list-calendars", connectionId}\`

## Natural Language Parsing
Supports expressions like:
- "tomorrow at 3pm"
- "next Thursday at 6pm"
- "every weekday at 9am"
- "in 30 minutes"
- "March 25 at noon"
`;

// ── Agent Skill Seed Content ─────────────────────────────────────────────────

const SEED_AGENT_SKILL_MD = `# Open Canvas Agent Skill

You are an AI coding agent running as a scheduled task inside Open Canvas — a local browser IDE that wraps terminal coding agents (Claude, Codex, Gemini) in a workspace with live preview, file management, and project tracking.

## Your Environment

You were spawned by the Open Canvas calendar scheduler. You have full access to the file system and can run any commands. You are operating inside a real terminal session.

## The .open-canvas Directory Tree

\\\`\\\`\\\`
~/.open-canvas/                           # Open Canvas home
├── global.yaml                           # Global configuration
│   ├── projects[]                        # Registered projects (name, path, lastOpened)
│   ├── defaults.agent                    # Default agent (claude/codex/gemini)
│   ├── defaults.permissions              # Global permissions (read/write/execute/web)
│   └── api_keys                          # API keys (Google Calendar, etc.)
│
├── shared-data/                          # Data shared across all projects
│   ├── raw/                              # Raw uploaded files (PDFs, docs)
│   ├── formatted/                        # Processed markdown versions
│   ├── project-manager-skills.md         # Instructions for cross-project operations
│   └── skills.md                         # Global skills shared across projects
│
├── calendar/                             # Calendar system
│   ├── calendar.yaml                     # Active events
│   ├── cron-state.yaml                   # Scheduler job tracking
│   ├── notifications.yaml                # Notification queue
│   ├── history.yaml                      # Archived events with execution audit trails
│   ├── connections.yaml                  # External calendar connections (Google OAuth)
│   └── open-canvas-agent-skill.md        # This file
│
└── projects/                             # Per-project workspaces
    └── <project-name>/
        ├── run-config.yaml               # Project runtime config
        ├── skills/                        # Project-specific skills
        └── data/                          # Project data files
\\\`\\\`\\\`

## Per-Project Structure

Each registered project has its own .open-canvas/ directory:

\\\`\\\`\\\`
<project-root>/
├── .open-canvas/
│   ├── PROJECT.md                        # Project architecture and context
│   ├── skills.md                         # Project conventions and patterns
│   └── open-canvas.yaml                  # Project config
└── ... (project files)
\\\`\\\`\\\`

## What You Can Do

### Project Discovery
1. Read ~/.open-canvas/global.yaml → projects[] for all registered projects
2. Each entry has name, path, and lastOpened
3. Read a project's .open-canvas/PROJECT.md for architecture context
4. Read a project's .open-canvas/skills.md for coding conventions

### File Operations
- Read, write, create, delete any file on the system
- Navigate between projects by changing directories

### Command Execution
- Run any shell commands: npm, git, python, docker, etc.
- Run tests, linters, build tools

### Cross-Project Work
- When a task spans multiple projects, plan first
- Use ~/.open-canvas/shared-data/ for shared data
- Work through projects sequentially to avoid conflicts

## Task Completion

- Write results to stdout — they are captured in the execution audit trail
- Exit cleanly (exit 0 = success, non-zero = failure)
- Your exit code determines whether the event is marked "completed" or "failed"
- Your session has a timeout (default 30 minutes) — plan accordingly
`;

// ── Project Manager Seed Content ─────────────────────────────────────────────

const PM_SKILLS_PATH = path.join(SHARED_DATA_DIR, "project-manager-skills.md");
const PM_INDEX_PATH = path.join(SHARED_DATA_DIR, "index.md");

const SEED_PM_SKILLS_MD = `# Project Manager Agent Skills

You are an AI agent operating at the Open Canvas project-manager level.
You can work across all registered projects.

## Project Index
Projects are registered in \`~/.open-canvas/global.yaml\` under \`projects[]\`.
Each entry has: \`name\`, \`path\`, \`lastOpened\`.

## How to Start
1. Read \`~/.open-canvas/global.yaml\` to find all registered projects
2. From the task prompt, determine which project(s) are relevant
3. Read the target project's \`.open-canvas/skills.md\` for conventions
4. Read the target project's \`.open-canvas/PROJECT.md\` for architecture context
5. cd into the project directory and begin work

## Cross-Project Operations
- When a task spans multiple projects, plan your approach before starting
- Use \`~/.open-canvas/shared-data/\` for data shared between projects
- Work through projects sequentially to avoid conflicts

## Reporting
After completing a scheduled task:
- Write results to stdout (they are captured in the session log)
- For important outcomes, consider creating a file summary in the project

## Common Patterns
- Code review across repos: iterate through projects, run linting/tests, summarize
- Dependency updates: check each project for outdated deps
- Research tasks: use available tools to search, browse, and compile findings
- Documentation sync: ensure PROJECT.md files are current
- Status reports: gather git log summaries across projects
`;

const SEED_PM_INDEX_MD = `# Open Canvas Shared Data Index

## Purpose
This directory contains data and instructions shared across all projects.

## Key Files
- \`project-manager-skills.md\` - Instructions for agents operating at project-manager scope
- \`skills.md\` - Global skills shared across all projects
- \`raw/\` - Raw uploaded data files
- \`formatted/\` - Processed/formatted data files

## Related
- Global config: \`~/.open-canvas/global.yaml\`
- Calendar: \`~/.open-canvas/calendar/\`
- Per-project config: \`<project>/.open-canvas/\`
`;

// ── Directory Setup ──────────────────────────────────────────────────────────

export function ensureCalendarDir(): void {
  fs.mkdirSync(CALENDAR_DIR, { recursive: true });

  if (!fs.existsSync(CALENDAR_EVENTS_PATH)) {
    const doc = new YAML.Document({ events: [] });
    atomicWrite(CALENDAR_EVENTS_PATH, doc.toString());
  }

  if (!fs.existsSync(CRON_STATE_PATH)) {
    const doc = new YAML.Document({ jobs: [] });
    atomicWrite(CRON_STATE_PATH, doc.toString());
  }

  if (!fs.existsSync(NOTIFICATIONS_PATH)) {
    const doc = new YAML.Document({ notifications: [] });
    atomicWrite(NOTIFICATIONS_PATH, doc.toString());
  }

  if (!fs.existsSync(HISTORY_PATH)) {
    const doc = new YAML.Document({ events: [] });
    atomicWrite(HISTORY_PATH, doc.toString());
  }

  if (!fs.existsSync(CALENDAR_MD_PATH)) {
    atomicWrite(CALENDAR_MD_PATH, SEED_CALENDAR_MD);
  }

  if (!fs.existsSync(CALENDAR_SKILLS_PATH)) {
    atomicWrite(CALENDAR_SKILLS_PATH, SEED_SKILLS_MD);
  }

  // Seed agent skill document
  if (!fs.existsSync(AGENT_SKILL_PATH)) {
    atomicWrite(AGENT_SKILL_PATH, SEED_AGENT_SKILL_MD);
  }

  // Seed project-manager docs in shared-data
  fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });

  if (!fs.existsSync(PM_SKILLS_PATH)) {
    atomicWrite(PM_SKILLS_PATH, SEED_PM_SKILLS_MD);
  }

  if (!fs.existsSync(PM_INDEX_PATH)) {
    atomicWrite(PM_INDEX_PATH, SEED_PM_INDEX_MD);
  }
}

// ── Events CRUD ──────────────────────────────────────────────────────────────

export function readEvents(): CalendarEvent[] {
  ensureCalendarDir();
  try {
    const raw = fs.readFileSync(CALENDAR_EVENTS_PATH, "utf-8");
    const parsed = YAML.parse(raw) as { events: CalendarEvent[] } | null;
    return parsed?.events || [];
  } catch {
    return [];
  }
}

function writeEvents(events: CalendarEvent[]): void {
  ensureCalendarDir();
  const doc = new YAML.Document({ events });
  atomicWrite(CALENDAR_EVENTS_PATH, doc.toString());
}

export function addEvent(
  event: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "status">
): CalendarEvent {
  const events = readEvents();
  const now = new Date().toISOString();
  const newEvent: CalendarEvent = {
    ...event,
    id: nanoid(10),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  events.push(newEvent);
  writeEvents(events);
  return newEvent;
}

export function updateEvent(
  id: string,
  updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>
): CalendarEvent | null {
  const events = readEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return null;

  events[idx] = {
    ...events[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeEvents(events);
  return events[idx];
}

export function deleteEvent(id: string): boolean {
  const events = readEvents();
  const filtered = events.filter((e) => e.id !== id);
  if (filtered.length === events.length) return false;
  writeEvents(filtered);
  return true;
}

export function getEventById(id: string): CalendarEvent | null {
  const events = readEvents();
  return events.find((e) => e.id === id) || null;
}

export function getEventsByDateRange(from: string, to: string): CalendarEvent[] {
  const events = readEvents();
  const fromDate = new Date(from).getTime();
  const toDate = new Date(to).getTime();
  return events.filter((e) => {
    const start = new Date(e.startTime).getTime();
    return start >= fromDate && start <= toDate;
  });
}

export function getEventsByProject(projectPath: string): CalendarEvent[] {
  const events = readEvents();
  return events.filter(
    (e) => e.source.projectPath === projectPath || e.action?.projectPath === projectPath
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

export function readNotifications(): CalendarNotification[] {
  ensureCalendarDir();
  try {
    const raw = fs.readFileSync(NOTIFICATIONS_PATH, "utf-8");
    const parsed = YAML.parse(raw) as { notifications: CalendarNotification[] } | null;
    return parsed?.notifications || [];
  } catch {
    return [];
  }
}

function writeNotifications(notifications: CalendarNotification[]): void {
  ensureCalendarDir();
  const doc = new YAML.Document({ notifications });
  atomicWrite(NOTIFICATIONS_PATH, doc.toString());
}

export function addNotification(
  eventId: string,
  title: string,
  message: string
): CalendarNotification {
  const notifications = readNotifications();
  const notification: CalendarNotification = {
    id: nanoid(10),
    eventId,
    title,
    message,
    timestamp: new Date().toISOString(),
    read: false,
  };
  notifications.push(notification);
  writeNotifications(notifications);
  return notification;
}

export function dismissNotification(id: string): boolean {
  const notifications = readNotifications();
  const n = notifications.find((n) => n.id === id);
  if (!n) return false;
  n.read = true;
  writeNotifications(notifications);
  return true;
}

export function getUnreadNotifications(): CalendarNotification[] {
  return readNotifications().filter((n) => !n.read);
}

// ── Cron State ───────────────────────────────────────────────────────────────

export function readCronState(): CronJobState[] {
  ensureCalendarDir();
  try {
    const raw = fs.readFileSync(CRON_STATE_PATH, "utf-8");
    const parsed = YAML.parse(raw) as { jobs: CronJobState[] } | null;
    return parsed?.jobs || [];
  } catch {
    return [];
  }
}

export function writeCronState(jobs: CronJobState[]): void {
  ensureCalendarDir();
  const doc = new YAML.Document({ jobs });
  atomicWrite(CRON_STATE_PATH, doc.toString());
}

export function updateCronJob(
  eventId: string,
  updates: Partial<CronJobState>
): void {
  const jobs = readCronState();
  const idx = jobs.findIndex((j) => j.eventId === eventId);
  if (idx === -1) {
    jobs.push({
      eventId,
      runCount: 0,
      status: "active",
      ...updates,
    });
  } else {
    jobs[idx] = { ...jobs[idx], ...updates };
  }
  writeCronState(jobs);
}

// ── History ──────────────────────────────────────────────────────────────────

export function archiveEvent(event: CalendarEvent): void {
  ensureCalendarDir();
  let history: CalendarEvent[] = [];
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    const parsed = YAML.parse(raw) as { events: CalendarEvent[] } | null;
    history = parsed?.events || [];
  } catch {
    // ignore
  }
  history.push(event);
  const doc = new YAML.Document({ events: history });
  atomicWrite(HISTORY_PATH, doc.toString());
}
