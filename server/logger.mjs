/**
 * Verbose logging utility for the Open Canvas server.
 *
 * Mirrors the frontend logger (src/lib/logger.ts) with the same category system.
 *
 * Enabled when ANY of these are true (checked once at startup, then live-refreshed):
 *   1. Environment variable VERBOSE_LOG=true
 *   2. global.yaml → app_settings.verbose_logging === true
 *
 * Usage:
 *   import { log, logWarn, logError } from "./logger.mjs";
 *   log("pty",    "Session spawned", { id, agent, cwd });
 *   logWarn("api", "Slow response", { ms: 1200 });
 *   logError("service", "Failed to start", err.message);
 */

import { readGlobalConfig } from "../src/lib/globalConfig.js";

// ── Categories ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  "pty",       // PTY session lifecycle
  "api",       // HTTP route handling
  "service",   // Service orchestration
  "port",      // Port registry operations
  "cron",      // Scheduled tasks
  "skill",     // Skills read/write
  "config",    // Config read/write
  "voice",     // Voice routing / recording
  "git",       // Git repository operations
  "calendar",  // Calendar connection & sync operations
];

// ── Verbose check ───────────────────────────────────────────────────────────

let _cachedVerbose = null;
let _lastCheck = 0;
const CHECK_INTERVAL_MS = 5_000; // re-read config every 5s

function isVerbose() {
  // Env var always wins
  if (process.env.VERBOSE_LOG === "true") return true;

  const now = Date.now();
  if (_cachedVerbose !== null && now - _lastCheck < CHECK_INTERVAL_MS) {
    return _cachedVerbose;
  }
  _lastCheck = now;

  try {
    const config = readGlobalConfig();
    _cachedVerbose = config?.app_settings?.verbose_logging === true;
  } catch {
    _cachedVerbose = false;
  }
  return _cachedVerbose;
}

/** Force re-read of the verbose flag on next call. */
export function resetVerboseCache() {
  _cachedVerbose = null;
  _lastCheck = 0;
}

// ── Logging functions ───────────────────────────────────────────────────────

/**
 * Log a verbose message. No-op when verbose logging is disabled.
 * @param {string} category - One of the CATEGORIES
 * @param {string} message
 * @param {...any} data - Additional data to log
 */
export function log(category, message, ...data) {
  if (!isVerbose()) return;
  const prefix = `[OC:${category.toUpperCase()}]`;
  if (data.length > 0) {
    console.log(prefix, message, ...data);
  } else {
    console.log(prefix, message);
  }
}

/**
 * Log a verbose warning. No-op when verbose logging is disabled.
 */
export function logWarn(category, message, ...data) {
  if (!isVerbose()) return;
  const prefix = `[OC:${category.toUpperCase()}]`;
  if (data.length > 0) {
    console.warn(prefix, message, ...data);
  } else {
    console.warn(prefix, message);
  }
}

/**
 * Log an error. Always logs regardless of verbose flag.
 */
export function logError(category, message, ...data) {
  const prefix = `[OC:${category.toUpperCase()}]`;
  if (data.length > 0) {
    console.error(prefix, message, ...data);
  } else {
    console.error(prefix, message);
  }
}

/** Check if verbose logging is active right now. */
export function isVerboseEnabled() {
  return isVerbose();
}

// ── Persistence error logging ──────────────────────────────────────────────

import fs from "fs";
import path from "path";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const PERSISTENCE_LOG_PATH = path.join(HOME, ".open-canvas", "persistence-errors.log");
const MAX_LOG_LINES = 500;

/**
 * Log a persistence error. Always logs to console AND appends to
 * ~/.open-canvas/persistence-errors.log (ring buffer, last 500 entries).
 *
 * @param {"read"|"write"|"delete"} operation
 * @param {string} filePath
 * @param {Error|string} error
 */
export function logPersistenceError(operation, filePath, error) {
  const msg = error instanceof Error ? error.message : String(error);
  const entry = `[${new Date().toISOString()}] ${operation.toUpperCase()} ${filePath}: ${msg}`;

  // Always log to stderr
  console.error(`[OC:PERSIST]`, entry);

  // Append to ring-buffer log file
  try {
    const dir = path.dirname(PERSISTENCE_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let lines = [];
    if (fs.existsSync(PERSISTENCE_LOG_PATH)) {
      lines = fs.readFileSync(PERSISTENCE_LOG_PATH, "utf-8").split("\n").filter(Boolean);
    }
    lines.push(entry);

    // Keep only the last MAX_LOG_LINES entries
    if (lines.length > MAX_LOG_LINES) {
      lines = lines.slice(lines.length - MAX_LOG_LINES);
    }

    fs.writeFileSync(PERSISTENCE_LOG_PATH, lines.join("\n") + "\n", "utf-8");
  } catch {
    // If we can't write the log file, the console.error above is our fallback
  }
}
