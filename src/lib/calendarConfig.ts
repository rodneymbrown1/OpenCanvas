import fs from "fs";
import path from "path";
import YAML from "yaml";
import { nanoid } from "nanoid";
import { OC_HOME } from "./globalConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentType = "claude" | "codex" | "gemini" | "user";
export type EventTarget = "agent" | "user" | "both";
export type ActionType = "prompt" | "command" | "reminder";
export type EventStatus = "pending" | "triggered" | "completed" | "missed" | "cancelled";

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
  createdAt: string;
  updatedAt: string;
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
- **sync_google**: Sync events with Google Calendar (requires MCP server)

## Natural Language Parsing
Supports expressions like:
- "tomorrow at 3pm"
- "next Thursday at 6pm"
- "every weekday at 9am"
- "in 30 minutes"
- "March 25 at noon"
`;

// ── Directory Setup ──────────────────────────────────────────────────────────

export function ensureCalendarDir(): void {
  fs.mkdirSync(CALENDAR_DIR, { recursive: true });

  if (!fs.existsSync(CALENDAR_EVENTS_PATH)) {
    const doc = new YAML.Document({ events: [] });
    fs.writeFileSync(CALENDAR_EVENTS_PATH, doc.toString(), "utf-8");
  }

  if (!fs.existsSync(CRON_STATE_PATH)) {
    const doc = new YAML.Document({ jobs: [] });
    fs.writeFileSync(CRON_STATE_PATH, doc.toString(), "utf-8");
  }

  if (!fs.existsSync(NOTIFICATIONS_PATH)) {
    const doc = new YAML.Document({ notifications: [] });
    fs.writeFileSync(NOTIFICATIONS_PATH, doc.toString(), "utf-8");
  }

  if (!fs.existsSync(HISTORY_PATH)) {
    const doc = new YAML.Document({ events: [] });
    fs.writeFileSync(HISTORY_PATH, doc.toString(), "utf-8");
  }

  if (!fs.existsSync(CALENDAR_MD_PATH)) {
    fs.writeFileSync(CALENDAR_MD_PATH, SEED_CALENDAR_MD, "utf-8");
  }

  if (!fs.existsSync(CALENDAR_SKILLS_PATH)) {
    fs.writeFileSync(CALENDAR_SKILLS_PATH, SEED_SKILLS_MD, "utf-8");
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
  fs.writeFileSync(CALENDAR_EVENTS_PATH, doc.toString(), "utf-8");
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
  fs.writeFileSync(NOTIFICATIONS_PATH, doc.toString(), "utf-8");
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
  fs.writeFileSync(CRON_STATE_PATH, doc.toString(), "utf-8");
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
  fs.writeFileSync(HISTORY_PATH, doc.toString(), "utf-8");
}
