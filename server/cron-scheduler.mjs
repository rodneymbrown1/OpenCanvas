/**
 * Cron Scheduler for Calendar Events
 *
 * Runs inside the pty-server process. Watches ~/.open-canvas/calendar/calendar.yaml
 * for changes and manages node-cron jobs for scheduled events.
 *
 * Job types:
 *   - "reminder" → writes notification to notifications.yaml
 *   - "prompt"   → spawns a PTY session with the prompt (via callback)
 *   - "command"  → executes a shell command in the target project (allowlisted)
 *
 * Hardening:
 *   - Project-level locking prevents concurrent agent tasks on the same project
 *   - Agent sessions have a configurable timeout (default: 30 minutes)
 *   - Prompt delivery waits for agent ready signal instead of hardcoded delay
 *   - Execution audit records are written to event history
 *   - Command payloads are validated against an allowlist
 *   - Full status lifecycle: pending → running → completed/failed
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
const HISTORY_PATH = path.join(CALENDAR_DIR, "history.yaml");

// ── Configuration ───────────────────────────────────────────────────────────

const AGENT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes default
const COMMAND_TIMEOUT_MS = 60_000; // 60 seconds for command actions

// Allowed command prefixes for "command" action type.
// Commands must start with one of these to be executed.
const COMMAND_ALLOWLIST = [
  "npm ", "npx ", "yarn ", "pnpm ",
  "node ", "python ", "python3 ",
  "git ", "gh ",
  "ls ", "cat ", "head ", "tail ", "wc ",
  "curl ", "wget ",
  "echo ", "printf ",
  "test ", "jest ", "vitest ", "pytest ",
  "eslint ", "prettier ", "tsc ",
  "docker ", "docker-compose ",
  "make ", "cargo ", "go ",
];

// ── Active state ────────────────────────────────────────────────────────────

// Active cron jobs: eventId -> cron.ScheduledTask
const activeJobs = new Map();

// Project locks: projectPath -> { eventId, sessionId }
const projectLocks = new Map();

// Active agent sessions: eventId -> { ptyProcess, timeout, session }
const activeAgentSessions = new Map();

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

function updateEventStatus(eventId, status, execution) {
  const data = readYaml(CALENDAR_PATH);
  if (!data?.events) return;
  const event = data.events.find((e) => e.id === eventId);
  if (event) {
    event.status = status;
    event.updatedAt = new Date().toISOString();
    if (execution) {
      event.execution = { ...(event.execution || {}), ...execution };
    }
    writeYaml(CALENDAR_PATH, data);
  }
}

// ── Execution Audit ─────────────────────────────────────────────────────────

function writeAuditRecord(event, execution) {
  const data = readYaml(HISTORY_PATH) || { events: [] };
  const history = data.events || [];

  history.push({
    ...event,
    execution,
    archivedAt: new Date().toISOString(),
  });

  // Keep last 500 history entries
  if (history.length > 500) {
    data.events = history.slice(-500);
  } else {
    data.events = history;
  }

  writeYaml(HISTORY_PATH, data);
  console.log(`[cron-scheduler] audit: ${event.id} — ${execution.exitCode === 0 ? "success" : "exit=" + execution.exitCode}`);
}

// ── Project Locking ─────────────────────────────────────────────────────────

function acquireProjectLock(projectPath, eventId) {
  const lockKey = projectPath || "__global__";
  if (projectLocks.has(lockKey)) {
    const holder = projectLocks.get(lockKey);
    console.log(`[cron-scheduler] project locked: ${lockKey} held by event ${holder.eventId}`);
    return false;
  }
  projectLocks.set(lockKey, { eventId, acquiredAt: new Date().toISOString() });
  console.log(`[cron-scheduler] lock acquired: ${lockKey} by event ${eventId}`);
  return true;
}

function releaseProjectLock(projectPath, eventId) {
  const lockKey = projectPath || "__global__";
  const holder = projectLocks.get(lockKey);
  if (holder && holder.eventId === eventId) {
    projectLocks.delete(lockKey);
    console.log(`[cron-scheduler] lock released: ${lockKey} by event ${eventId}`);
  }
}

// ── Command Validation ──────────────────────────────────────────────────────

function isCommandAllowed(payload) {
  const trimmed = payload.trim();
  return COMMAND_ALLOWLIST.some((prefix) => trimmed.startsWith(prefix));
}

// ── Agent Installation Check ────────────────────────────────────────────────

function isAgentAvailable(agentName) {
  try {
    const { execSync } = require("node:child_process");
    const result = execSync(`which ${agentName} 2>/dev/null`, { timeout: 3000, encoding: "utf-8" });
    return result.trim().length > 0;
  } catch {
    return false;
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
      const agentName = action.agent || "claude";

      // ── Gap 2: Verify agent is installed before spawning ──
      if (!isAgentAvailable(agentName)) {
        const errMsg = `Agent "${agentName}" is not installed. Install it or choose a different agent.`;
        console.error(`[cron-scheduler] ${errMsg}`);
        addNotification(event.id, `Failed: ${event.title}`, errMsg);
        updateEventStatus(event.id, "failed", {
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          error: errMsg,
        });
        return;
      }

      // ── Gap 5: Acquire project lock ──
      const projectPath = action.projectPath || OC_HOME;
      if (!acquireProjectLock(projectPath, event.id)) {
        const errMsg = `Project "${projectPath}" is locked by another running task. Skipping.`;
        addNotification(event.id, `Skipped: ${event.title}`, errMsg);
        updateEventStatus(event.id, "missed", {
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          error: errMsg,
        });
        return;
      }

      // ── Gap 12: Set status to "running" ──
      const executionStart = new Date().toISOString();
      updateEventStatus(event.id, "running", {
        startedAt: executionStart,
      });

      addNotification(
        event.id,
        `Agent task started: ${event.title}`,
        `Running ${agentName} in ${projectPath}: ${action.payload}`
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

        // Enrich with Open Canvas agent skill when no explicit project path
        const agentSkillPath = path.join(CALENDAR_DIR, "open-canvas-agent-skill.md");
        if (!action.projectPath && fs.existsSync(agentSkillPath)) {
          const skill = fs.readFileSync(agentSkillPath, "utf-8");
          prompt = `${skill}\n\n${prompt}`;
        } else if (!action.projectPath) {
          // Fallback to project-manager skills
          const pmSkillsPath = path.join(OC_HOME, "shared-data", "project-manager-skills.md");
          if (fs.existsSync(pmSkillsPath)) {
            prompt = `[Context: You are a scheduled agent task. Read ${pmSkillsPath} for instructions on cross-project operations. Project list is in ~/.open-canvas/global.yaml under projects[]. Your working directory is ${OC_HOME}.]\n\n${prompt}`;
          }
        }

        // ── Gap 3 + 4 + 6: Spawn with exit tracking, timeout, and ready detection ──
        spawnSessionCallback({
          agent: agentName,
          cwd: projectPath,
          prompt,
          eventId: event.id,
          timeout: AGENT_SESSION_TIMEOUT_MS,
          onComplete: (result) => {
            // Release project lock
            releaseProjectLock(projectPath, event.id);
            activeAgentSessions.delete(event.id);

            const endedAt = new Date().toISOString();
            const startMs = new Date(executionStart).getTime();
            const durationMs = Date.now() - startMs;

            const execution = {
              sessionId: result.sessionId,
              startedAt: executionStart,
              endedAt,
              exitCode: result.exitCode,
              durationMs,
              outputSummary: result.lastOutput?.join("\n")?.slice(-500) || "",
              error: result.timedOut ? `Timed out after ${AGENT_SESSION_TIMEOUT_MS / 60000}m` : undefined,
            };

            // ── Gap 12: Set final status based on exit ──
            const finalStatus = result.timedOut
              ? "failed"
              : result.exitCode === 0
                ? "completed"
                : "failed";

            updateEventStatus(event.id, finalStatus, execution);

            // ── Gap 10: Write audit trail ──
            writeAuditRecord(event, execution);

            // ── Gap 3: Completion notification ──
            const statusLabel = result.timedOut
              ? "timed out"
              : result.exitCode === 0
                ? "completed"
                : `failed (exit ${result.exitCode})`;

            addNotification(
              event.id,
              `Task ${statusLabel}: ${event.title}`,
              `Agent ${agentName} ${statusLabel} in ${Math.round(durationMs / 1000)}s.${
                result.lastOutput?.length
                  ? "\nLast output: " + result.lastOutput.slice(-3).join(" | ").slice(0, 200)
                  : ""
              }`
            );
          },
        });
      } else {
        // No spawn callback — can't execute
        releaseProjectLock(projectPath, event.id);
        const errMsg = "PTY spawn callback not available";
        updateEventStatus(event.id, "failed", {
          startedAt: executionStart,
          endedAt: new Date().toISOString(),
          error: errMsg,
        });
        addNotification(event.id, `Failed: ${event.title}`, errMsg);
      }
      break;
    }

    case "command": {
      // ── Gap 11: Validate command against allowlist ──
      if (!isCommandAllowed(action.payload)) {
        const errMsg = `Command blocked: "${action.payload.slice(0, 60)}..." is not in the allowed command list. Allowed prefixes: ${COMMAND_ALLOWLIST.slice(0, 5).join(", ")}...`;
        console.error(`[cron-scheduler] ${errMsg}`);
        addNotification(event.id, `Blocked: ${event.title}`, errMsg);
        updateEventStatus(event.id, "failed", {
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          error: errMsg,
        });
        return;
      }

      const cmdStart = new Date().toISOString();
      updateEventStatus(event.id, "running", { startedAt: cmdStart });

      addNotification(
        event.id,
        `Command: ${event.title}`,
        `Executing: ${action.payload} in ${action.projectPath || "home"}`
      );

      const cwd = action.projectPath || OC_HOME;

      // Validate cwd exists
      if (!fs.existsSync(cwd)) {
        const errMsg = `Working directory does not exist: ${cwd}`;
        updateEventStatus(event.id, "failed", {
          startedAt: cmdStart,
          endedAt: new Date().toISOString(),
          error: errMsg,
        });
        addNotification(event.id, `Failed: ${event.title}`, errMsg);
        return;
      }

      execFile("/bin/zsh", ["-l", "-c", action.payload], { cwd, timeout: COMMAND_TIMEOUT_MS }, (err, stdout, stderr) => {
        const endedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(cmdStart).getTime();

        if (err) {
          console.error(`[cron-scheduler] command failed for ${event.id}:`, err.message);
          const execution = {
            startedAt: cmdStart,
            endedAt,
            exitCode: err.code || 1,
            durationMs,
            outputSummary: (stderr || err.message).slice(0, 500),
            error: err.message,
          };
          updateEventStatus(event.id, "failed", execution);
          writeAuditRecord(event, execution);
          addNotification(event.id, `Command failed: ${event.title}`, stderr || err.message);
        } else {
          console.log(`[cron-scheduler] command succeeded for ${event.id}`);
          const execution = {
            startedAt: cmdStart,
            endedAt,
            exitCode: 0,
            durationMs,
            outputSummary: stdout.trim().slice(0, 500),
          };
          updateEventStatus(event.id, "completed", execution);
          writeAuditRecord(event, execution);
          if (stdout.trim()) {
            addNotification(event.id, `Command done: ${event.title}`, stdout.trim().slice(0, 500));
          }
        }
      });
      break;
    }
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
  // Skip terminal statuses
  if (["completed", "cancelled", "running"].includes(event.status)) return;

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

  // Use setTimeout for one-time future events
  const timeout = setTimeout(() => {
    console.log(`[cron-scheduler] one-time job fired: ${event.id} — ${event.title}`);
    executeJob(event);
    activeJobs.delete(event.id);
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
    projectLocks: Object.fromEntries(projectLocks),
    activeSessions: activeAgentSessions.size,
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
