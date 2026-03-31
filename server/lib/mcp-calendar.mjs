/**
 * mcp-calendar.mjs — Bridge between Open Canvas server and agent MCP
 * Google Calendar tools.
 *
 * Spawns `<agent> -p "prompt"` as a child process, instructs the agent to call
 * a specific gcal_* MCP tool, and parses the structured JSON response.
 *
 * Supports Claude, Codex, and Gemini. Zero OAuth setup — the agent handles
 * all Google auth via its built-in MCP.
 */

import { execFile } from "node:child_process";
import { log, logError } from "../logger.mjs";

const CAT = "calendar";

const VALID_AGENTS = ["claude", "codex", "gemini"];

function validateAgent(agentName) {
  if (!VALID_AGENTS.includes(agentName)) {
    throw Object.assign(
      new Error(`Unsupported agent: ${agentName}. Must be one of: ${VALID_AGENTS.join(", ")}`),
      { code: "INVALID_AGENT" }
    );
  }
}

// ── Serialization queue ─────────────────────────────────────────────────────
// Prevent concurrent agent processes from competing

let queueTail = Promise.resolve();

function enqueue(fn) {
  const prev = queueTail;
  let resolve;
  queueTail = new Promise((r) => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

// ── Core execution ──────────────────────────────────────────────────────────

/**
 * Execute a prompt via `<agent> -p` and return the raw stdout.
 */
function agentExec(agentName, prompt, timeoutMs = 30000) {
  validateAgent(agentName);
  return new Promise((resolve, reject) => {
    logError(CAT, `MCP bridge [${agentName}]: executing (timeout=${timeoutMs}ms)`);
    log(CAT, `MCP bridge prompt: ${prompt.slice(0, 200)}...`);

    execFile(agentName, ["-p", prompt], {
      timeout: timeoutMs,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024, // 1MB
    }, (err, stdout, stderr) => {
      if (err) {
        logError(CAT, `MCP bridge [${agentName}] exec error: code=${err.code} killed=${err.killed} signal=${err.signal}`);
        if (stderr) logError(CAT, `MCP bridge stderr: ${stderr.slice(0, 500)}`);
        if (err.code === "ENOENT") {
          return reject(Object.assign(new Error(`${agentName} CLI not found in PATH`), { code: "AGENT_NOT_FOUND" }));
        }
        if (err.killed || err.signal === "SIGTERM") {
          return reject(Object.assign(new Error("MCP request timed out"), { code: "MCP_TIMEOUT" }));
        }
        return reject(Object.assign(new Error(`${agentName} CLI error: ${err.message}`), { code: "MCP_EXEC_ERROR" }));
      }

      logError(CAT, `MCP bridge [${agentName}] stdout length=${stdout.length}`);
      logError(CAT, `MCP bridge [${agentName}] stdout preview: ${stdout.slice(0, 300)}`);
      if (stderr) logError(CAT, `MCP bridge [${agentName}] stderr: ${stderr.slice(0, 300)}`);

      // Check for auth/scope signals in output
      const lower = (stdout + stderr).toLowerCase();
      if (lower.includes("insufficient") && lower.includes("scope")) {
        return reject(Object.assign(
          new Error(`Insufficient Google OAuth scopes. Reconnect Google Calendar in ${agentName} with full permissions.`),
          { code: "MCP_SCOPE_ERROR" }
        ));
      }
      if (lower.includes("authenticate") || lower.includes("sign in") || lower.includes("authorization required")) {
        return reject(Object.assign(
          new Error(`Google Calendar requires authentication. Run '${agentName}' in a terminal and ask it to connect your Google Calendar.`),
          { code: "MCP_AUTH_REQUIRED" }
        ));
      }

      resolve(stdout);
    });
  });
}

/**
 * Extract the first JSON object or array from text that may contain
 * markdown code fences, prose, or other non-JSON content.
 */
function extractJSON(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();

  // Find first [ or {
  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");

  let start;
  let openChar;
  let closeChar;

  if (startObj === -1 && startArr === -1) {
    throw Object.assign(new Error("No JSON found in response"), { code: "MCP_PARSE_ERROR" });
  }

  if (startArr === -1 || (startObj !== -1 && startObj < startArr)) {
    start = startObj;
    openChar = "{";
    closeChar = "}";
  } else {
    start = startArr;
    openChar = "[";
    closeChar = "]";
  }

  // Find matching closing bracket
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;

    if (depth === 0) {
      const jsonStr = cleaned.slice(start, i + 1);
      return JSON.parse(jsonStr);
    }
  }

  throw Object.assign(new Error("Malformed JSON in response"), { code: "MCP_PARSE_ERROR" });
}

/**
 * Execute a prompt via an agent and parse JSON from the response.
 */
async function mcpCall(agentName, prompt, timeoutMs = 30000) {
  const raw = await agentExec(agentName, prompt, timeoutMs);
  try {
    const parsed = extractJSON(raw);
    logError(CAT, `MCP call [${agentName}]: parsed JSON OK — type=${Array.isArray(parsed) ? "array" : typeof parsed}${Array.isArray(parsed) ? `, length=${parsed.length}` : ""}`);
    return parsed;
  } catch (parseErr) {
    logError(CAT, `MCP call [${agentName}]: JSON parse FAILED: ${parseErr.message}`);
    logError(CAT, `MCP call raw output (first 800 chars): ${raw.slice(0, 800)}`);
    throw parseErr;
  }
}

// ── Exported MCP functions ──────────────────────────────────────────────────

/**
 * Check if Google Calendar MCP is available and return calendar info.
 * Returns {available, calendars, userEmail, error}
 */
export function mcpCheckAvailable(agentName = "claude") {
  return enqueue(async () => {
    try {
      const calendars = await mcpCall(
        agentName,
        `Use the gcal_list_calendars MCP tool. Return ONLY a JSON array where each element has: {"id": "...", "summary": "...", "primary": true/false}. No other text.`,
        15000
      );

      if (!Array.isArray(calendars) || calendars.length === 0) {
        return { available: false, calendars: [], userEmail: null, error: "No calendars found" };
      }

      // Primary calendar summary is usually the user's email
      const primary = calendars.find((c) => c.primary);
      const userEmail = primary?.summary || primary?.id || null;

      return { available: true, calendars, userEmail, error: null };
    } catch (err) {
      logError(CAT, `MCP availability check failed [${agentName}]:`, err.message);
      return { available: false, calendars: [], userEmail: null, error: err.message };
    }
  });
}

/**
 * List calendars.
 */
export function mcpListCalendars(agentName = "claude") {
  return enqueue(() =>
    mcpCall(
      agentName,
      `Use the gcal_list_calendars MCP tool. Return ONLY a JSON array where each element has: {"id": "...", "summary": "...", "primary": true/false}. No other text.`,
      30000
    )
  );
}

/**
 * List events from a Google Calendar within a date range.
 */
export function mcpListEvents(agentName = "claude", calendarId = "primary", timeMin, timeMax) {
  return enqueue(() =>
    mcpCall(
      agentName,
      `Use the gcal_list_events MCP tool with calendarId="${calendarId}", timeMin="${timeMin}", timeMax="${timeMax}". Return ONLY a JSON array where each element has: {"id": "...", "summary": "...", "description": "...", "start": "...", "end": "...", "allDay": true/false, "status": "...", "htmlLink": "..."}. For start/end, use ISO 8601 strings. No other text.`,
      60000
    )
  );
}

/**
 * Create an event on Google Calendar. Returns the created event.
 */
export function mcpCreateEvent(agentName = "claude", calendarId = "primary", event) {
  const startStr = event.allDay
    ? `date: "${event.startTime.split("T")[0]}"`
    : `dateTime: "${event.startTime}"`;
  const endStr = event.endTime
    ? (event.allDay ? `date: "${event.endTime.split("T")[0]}"` : `dateTime: "${event.endTime}"`)
    : startStr;

  return enqueue(() =>
    mcpCall(
      agentName,
      `Use the gcal_create_event MCP tool with calendarId="${calendarId}", summary="${(event.title || "").replace(/"/g, '\\"')}", description="${(event.description || "").replace(/"/g, '\\"')}", start={${startStr}}, end={${endStr}}. Return ONLY a JSON object with: {"id": "...", "summary": "...", "htmlLink": "..."}. No other text.`,
      30000
    )
  );
}

/**
 * Update an event on Google Calendar.
 */
export function mcpUpdateEvent(agentName = "claude", calendarId = "primary", eventId, updates) {
  const parts = [];
  if (updates.title) parts.push(`summary="${updates.title.replace(/"/g, '\\"')}"`);
  if (updates.description !== undefined) parts.push(`description="${(updates.description || "").replace(/"/g, '\\"')}"`);
  if (updates.startTime) {
    const startStr = updates.allDay
      ? `date: "${updates.startTime.split("T")[0]}"`
      : `dateTime: "${updates.startTime}"`;
    parts.push(`start={${startStr}}`);
  }
  if (updates.endTime) {
    const endStr = updates.allDay
      ? `date: "${updates.endTime.split("T")[0]}"`
      : `dateTime: "${updates.endTime}"`;
    parts.push(`end={${endStr}}`);
  }

  const updateStr = parts.join(", ");

  return enqueue(() =>
    mcpCall(
      agentName,
      `Use the gcal_update_event MCP tool with calendarId="${calendarId}", eventId="${eventId}", ${updateStr}. Return ONLY a JSON object with: {"id": "...", "updated": true}. No other text.`,
      30000
    )
  );
}

/**
 * Delete an event from Google Calendar.
 */
export function mcpDeleteEvent(agentName = "claude", calendarId = "primary", eventId) {
  return enqueue(() =>
    mcpCall(
      agentName,
      `Use the gcal_delete_event MCP tool with calendarId="${calendarId}", eventId="${eventId}". Return ONLY a JSON object with: {"deleted": true}. No other text.`,
      30000
    )
  );
}
