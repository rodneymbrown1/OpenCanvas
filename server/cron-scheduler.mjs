/**
 * Cron Scheduler for Calendar Events
 *
 * Runs inside the pty-server process. Watches ~/.open-canvas/calendar/calendar.yaml
 * for changes and manages node-cron jobs for scheduled events.
 *
 * Job types:
 *   - "reminder" → writes notification to notifications.yaml
 *   - "prompt"   → spawns a PTY session with the prompt (via callback)
 *   - "command"  → executes a shell command in the target project
 */

import cron from "node-cron";
import { watch } from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");
const CALENDAR_DIR = path.join(OC_HOME, "calendar");
const CALENDAR_PATH = path.join(CALENDAR_DIR, "calendar.yaml");
const NOTIFICATIONS_PATH = path.join(CALENDAR_DIR, "notifications.yaml");
const CRON_STATE_PATH = path.join(CALENDAR_DIR, "cron-state.yaml");

// Active cron jobs: eventId -> cron.ScheduledTask
const activeJobs = new Map();

// Callback for spawning PTY sessions (set by pty-server)
let spawnSessionCallback = null;

// ── File Helpers ─────────────────────────────────────────────────────────────

function readYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeYaml(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, stringify(data), "utf-8");
}

function readEvents() {
  const data = readYaml(CALENDAR_PATH);
  return data?.events || [];
}

function readCronState() {
  const data = readYaml(CRON_STATE_PATH);
  return data?.jobs || [];
}

function writeCronState(jobs) {
  writeYaml(CRON_STATE_PATH, { jobs });
}

function updateCronJobState(eventId, updates) {
  const jobs = readCronState();
  const idx = jobs.findIndex((j) => j.eventId === eventId);
  if (idx === -1) {
    jobs.push({ eventId, runCount: 0, status: "active", ...updates });
  } else {
    Object.assign(jobs[idx], updates);
  }
  writeCronState(jobs);
}

// ── Notification Writer ──────────────────────────────────────────────────────

function addNotification(eventId, title, message) {
  const data = readYaml(NOTIFICATIONS_PATH) || { notifications: [] };
  const notifications = data.notifications || [];

  notifications.push({
    id: randomUUID().slice(0, 10),
    eventId,
    title,
    message,
    timestamp: new Date().toISOString(),
    read: false,
  });

  writeYaml(NOTIFICATIONS_PATH, { notifications });
  console.log(`[cron-scheduler] notification: ${title}`);
}

// ── Event Update ─────────────────────────────────────────────────────────────

function updateEventStatus(eventId, status) {
  const data = readYaml(CALENDAR_PATH);
  if (!data?.events) return;
  const event = data.events.find((e) => e.id === eventId);
  if (event) {
    event.status = status;
    event.updatedAt = new Date().toISOString();
    writeYaml(CALENDAR_PATH, data);
  }
}

// ── Job Execution ────────────────────────────────────────────────────────────

function executeJob(event) {
  const action = event.action;
  if (!action) {
    // No action — just create a reminder notification
    addNotification(event.id, event.title, event.description || "Calendar event triggered");
    updateEventStatus(event.id, "triggered");
    return;
  }

  switch (action.type) {
    case "reminder":
      addNotification(
        event.id,
        event.title,
        action.payload || event.description || "Reminder"
      );
      updateEventStatus(event.id, "triggered");
      break;

    case "prompt": {
      addNotification(
        event.id,
        `Agent prompt: ${event.title}`,
        `Sending prompt to ${action.agent || "claude"} in ${action.projectPath || "default project"}: ${action.payload}`
      );
      if (spawnSessionCallback) {
        // Build context-enriched prompt with calendar event metadata
        const contextLines = [
          `[Calendar Event Triggered]`,
          `Title: ${event.title}`,
          `Scheduled: ${event.startTime}`,
          event.description ? `Description: ${event.description}` : null,
          `Type: Scheduled calendar task`,
          event.tags?.length ? `Tags: ${event.tags.join(", ")}` : null,
          action.projectPath ? `Project: ${action.projectPath}` : null,
        ].filter(Boolean);

        let prompt = `${contextLines.join("\n")}\n\n${action.payload}`;

        // Enrich with project-manager context when no explicit project path
        if (!action.projectPath) {
          const pmSkillsPath = path.join(OC_HOME, "shared-data", "project-manager-skills.md");
          if (fs.existsSync(pmSkillsPath)) {
            prompt = `[Context: You are a scheduled agent task. Read ${pmSkillsPath} for instructions on cross-project operations. Project list is in ~/.open-canvas/global.yaml under projects[]. Your working directory is ${OC_HOME}.]\n\n${prompt}`;
          }
        }
        spawnSessionCallback({
          agent: action.agent || "claude",
          cwd: action.projectPath || OC_HOME,
          prompt,
        });
      }
      updateEventStatus(event.id, "triggered");
      break;
    }

    case "command":
      addNotification(
        event.id,
        `Command: ${event.title}`,
        `Executing: ${action.payload} in ${action.projectPath || "home"}`
      );
      const cwd = action.projectPath || OC_HOME;
      execFile("/bin/zsh", ["-l", "-c", action.payload], { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[cron-scheduler] command failed for ${event.id}:`, err.message);
          addNotification(event.id, `Command failed: ${event.title}`, stderr || err.message);
        } else {
          console.log(`[cron-scheduler] command succeeded for ${event.id}`);
          if (stdout.trim()) {
            addNotification(event.id, `Command output: ${event.title}`, stdout.trim().slice(0, 500));
          }
        }
      });
      updateEventStatus(event.id, "triggered");
      break;
  }

  // Update cron state
  updateCronJobState(event.id, {
    lastRun: new Date().toISOString(),
    runCount: (readCronState().find((j) => j.eventId === event.id)?.runCount || 0) + 1,
  });
}

// ── Schedule Management ──────────────────────────────────────────────────────

function stopAllJobs() {
  for (const [id, task] of activeJobs) {
    task.stop();
  }
  activeJobs.clear();
}

function scheduleEvent(event) {
  // Skip completed/cancelled events
  if (event.status === "completed" || event.status === "cancelled") return;

  // Recurring event with cron expression
  if (event.recurrence && cron.validate(event.recurrence)) {
    const task = cron.schedule(event.recurrence, () => {
      console.log(`[cron-scheduler] recurring job fired: ${event.id} — ${event.title}`);
      executeJob(event);
    });
    activeJobs.set(event.id, task);
    updateCronJobState(event.id, { status: "active", nextRun: "recurring" });
    console.log(`[cron-scheduler] scheduled recurring: ${event.id} (${event.recurrence})`);
    return;
  }

  // One-time event — schedule if in the future
  const startMs = new Date(event.startTime).getTime();
  const nowMs = Date.now();
  const delayMs = startMs - nowMs;

  if (delayMs <= 0) {
    // Event is in the past and hasn't been triggered
    if (event.status === "pending") {
      console.log(`[cron-scheduler] missed event: ${event.id} — ${event.title}`);
      updateEventStatus(event.id, "missed");
      addNotification(event.id, `Missed: ${event.title}`, `This event was scheduled for ${event.startTime}`);
    }
    return;
  }

  // Use setTimeout for one-time future events (more accurate than cron for specific times)
  const timeout = setTimeout(() => {
    console.log(`[cron-scheduler] one-time job fired: ${event.id} — ${event.title}`);
    executeJob(event);
    activeJobs.delete(event.id);
    // Mark as completed for non-recurring
    if (!event.recurrence) {
      updateEventStatus(event.id, "completed");
    }
  }, delayMs);

  // Wrap timeout in an object with stop() for consistency
  activeJobs.set(event.id, {
    stop: () => clearTimeout(timeout),
  });

  const fireAt = new Date(startMs).toLocaleString();
  updateCronJobState(event.id, { status: "active", nextRun: event.startTime });
  console.log(`[cron-scheduler] scheduled one-time: ${event.id} at ${fireAt} (in ${Math.round(delayMs / 1000)}s)`);
}

function syncJobs() {
  stopAllJobs();
  const events = readEvents();
  console.log(`[cron-scheduler] syncing ${events.length} events`);
  for (const event of events) {
    scheduleEvent(event);
  }
  console.log(`[cron-scheduler] ${activeJobs.size} active jobs`);
}

// ── File Watcher ─────────────────────────────────────────────────────────────

let watcher = null;
let debounceTimer = null;

function startWatcher() {
  if (!fs.existsSync(CALENDAR_DIR)) {
    fs.mkdirSync(CALENDAR_DIR, { recursive: true });
  }

  watcher = watch(CALENDAR_PATH, {
    persistent: false,
    ignoreInitial: true,
  });

  watcher.on("change", () => {
    // Debounce to avoid rapid re-syncs during writes
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log("[cron-scheduler] calendar.yaml changed, re-syncing...");
      syncJobs();
    }, 500);
  });

  watcher.on("add", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncJobs, 500);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initCronScheduler(onSpawnSession) {
  spawnSessionCallback = onSpawnSession || null;
  console.log("[cron-scheduler] initializing...");

  // Ensure calendar directory exists
  fs.mkdirSync(CALENDAR_DIR, { recursive: true });

  // Initial sync
  syncJobs();

  // Watch for changes
  startWatcher();

  console.log("[cron-scheduler] ready");
}

export function stopCronScheduler() {
  console.log("[cron-scheduler] stopping...");
  stopAllJobs();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  clearTimeout(debounceTimer);
}

export function getCronStatus() {
  return {
    activeJobs: activeJobs.size,
    jobs: readCronState(),
    events: readEvents().length,
  };
}

/**
 * Trigger an event's job immediately (for testing / manual trigger).
 * Accepts a full CalendarEvent object.
 */
export function triggerEventNow(event) {
  console.log(`[cron-scheduler] manual trigger: ${event.id} — ${event.title}`);
  executeJob(event);
}
