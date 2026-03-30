// server/routes/calendar-connections.mjs — Calendar connection & sync API routes
// Google Calendar sync is handled via Claude's built-in MCP tools (gcal_*).
// No OAuth, no gcloud CLI, no API keys required.

import { spawn, execFile } from "child_process";
import {
  listConnections,
  removeConnection,
  updateConnection,
  getConnection,
} from "../../src/lib/calendar/connections.js";
import { listProviders } from "../../src/lib/calendar/providers/index.js";
import { log, logError } from "../logger.mjs";
import {
  mcpCheckAvailable,
  mcpListEvents,
  mcpCreateEvent,
  mcpUpdateEvent,
  mcpDeleteEvent,
} from "../lib/mcp-calendar.mjs";
import {
  readEvents,
  addEvent as addCalendarEvent,
  updateEvent as updateCalendarEvent,
  getEventById,
} from "../../src/lib/calendarConfig.js";

const CAT = "calendar";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (e) { reject(e); }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/calendar/connections ──────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "GET") {
    log(CAT, "Listing calendar connections");
    const connections = listConnections();
    const safe = connections.map((c) => ({
      ...c,
      credentials: {
        has_access_token: !!c.credentials.access_token,
        has_refresh_token: !!c.credentials.refresh_token,
        token_expiry: c.credentials.token_expiry,
        auth_method: c.credentials.auth_method || "mcp",
      },
    }));
    jsonResponse(res, { connections: safe, providers: listProviders().map((p) => ({ id: p.id, name: p.name })) });
    return true;
  }

  // ── GET /api/calendar/mcp-status ──────────────────────────────────────
  if (pathname === "/api/calendar/mcp-status" && method === "GET") {
    log(CAT, "Checking MCP Google Calendar status");
    const status = await mcpCheckAvailable();
    jsonResponse(res, status);
    return true;
  }

  // ── POST /api/calendar/mcp-connect ────────────────────────────────────
  // Multi-step diagnostic pipeline. Checks each prerequisite, reports
  // step-by-step status, and offers actionable fix suggestions.
  if (pathname === "/api/calendar/mcp-connect" && method === "POST") {
    log(CAT, "Starting MCP Google Calendar diagnostic pipeline");

    const body = await parseBody(req);

    // If action is "fix-scopes", attempt to fix by spawning Claude to reconnect
    if (body.action === "fix-scopes") {
      log(CAT, "Attempting MCP scope fix via Claude reconnect");
      try {
        const result = await new Promise((resolve) => {
          execFile("claude", ["-p",
            "My Google Calendar MCP connection has insufficient OAuth scopes. Please disconnect and reconnect the Google Calendar integration with full read/write calendar permissions. Confirm when done."
          ], { timeout: 60000, encoding: "utf-8" }, (err, stdout) => {
            resolve({ err, stdout });
          });
        });
        jsonResponse(res, {
          ok: true,
          message: result.stdout?.includes("reconnect") || result.stdout?.includes("done") || result.stdout?.includes("success")
            ? "Auth reset requested. Click 'Retry' to test the connection."
            : "Claude attempted to fix permissions. Click 'Retry' to check. If it still fails, open Claude Code in a terminal and ask it to reconnect Google Calendar with full permissions.",
        });
      } catch {
        jsonResponse(res, {
          ok: false,
          message: "Could not fix automatically. Open Claude Code in a terminal and say: 'Reconnect my Google Calendar with full read/write permissions'",
        });
      }
      return true;
    }

    // SSE streaming pipeline
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendStep = (step, status, detail) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "step", step, status, detail })}\n\n`);
      } catch {}
    };

    const sendEvent = (type, data) => {
      try {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      } catch {}
    };

    // ── Step 1: Check Claude CLI ──────────────────────────────────────
    sendStep(1, "running", "Checking Claude Code CLI...");
    const claudeInstalled = await new Promise((resolve) => {
      execFile("which", ["claude"], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim());
      });
    });

    if (!claudeInstalled) {
      sendStep(1, "failed", "Claude Code CLI not found in PATH.");
      sendEvent("fix", { step: 1, message: "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code" });
      res.end();
      return true;
    }
    sendStep(1, "passed", `Claude CLI found at ${claudeInstalled}`);

    // ── Step 2: Check MCP servers ─────────────────────────────────────
    sendStep(2, "running", "Checking MCP server configuration...");
    const mcpList = await new Promise((resolve) => {
      execFile("claude", ["mcp", "list"], {
        timeout: 10000, encoding: "utf-8",
      }, (err, stdout) => resolve(err ? "" : stdout));
    });

    const hasGcalMcp = mcpList.toLowerCase().includes("google") && mcpList.toLowerCase().includes("calendar");
    if (!hasGcalMcp) {
      sendStep(2, "failed", "Google Calendar MCP server not found.");
      sendEvent("fix", { step: 2, message: "Add the Google Calendar MCP server to Claude. Run: claude mcp add google-calendar", command: "claude mcp add google-calendar" });
      res.end();
      return true;
    }
    sendStep(2, "passed", "Google Calendar MCP server is configured.");

    // ── Step 3: Test calendar access ──────────────────────────────────
    sendStep(3, "running", "Testing Google Calendar access (this may open a browser for sign-in)...");

    const testResult = await new Promise((resolve) => {
      const child = spawn("claude", [
        "-p",
        "Use the gcal_list_calendars MCP tool. Return ONLY a JSON array where each element has: {\"id\": \"...\", \"summary\": \"...\", \"primary\": true/false}. No other text.",
      ], { timeout: 120000, env: { ...process.env } });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        // Stream stderr lines as progress (auth prompts show here)
        const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          if (line.includes("http") || line.includes("auth") || line.includes("browser") || line.includes("sign")) {
            sendEvent("progress", line.slice(0, 200));
          }
        }
      });

      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.on("error", (err) => resolve({ code: -1, stdout: "", stderr: err.message }));

      // Timeout
      setTimeout(() => { try { child.kill(); } catch {} }, 120000);
    });

    const allOutput = testResult.stdout + testResult.stderr;
    const lower = allOutput.toLowerCase();

    // Check for scope issues
    if (lower.includes("insufficient") && lower.includes("scope")) {
      sendStep(3, "failed", "Insufficient OAuth scopes. Your Google account is connected but missing Calendar permissions.");
      sendEvent("fix", {
        step: 3,
        message: "Reset MCP auth and reconnect with full Calendar permissions.",
        action: "fix-scopes",
      });
      res.end();
      return true;
    }

    // Check for auth needed
    if (lower.includes("authenticate") || lower.includes("sign in") || lower.includes("authorization required") || lower.includes("credentials")) {
      sendStep(3, "failed", "Google Calendar authentication required.");
      sendEvent("fix", { step: 3, message: "Reset MCP auth to trigger a fresh Google sign-in.", action: "fix-scopes" });
      res.end();
      return true;
    }

    // Try to parse calendar list from output
    let calendars = [];
    try {
      const cleaned = testResult.stdout.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "");
      const startIdx = cleaned.indexOf("[");
      if (startIdx !== -1) {
        let depth = 0;
        for (let i = startIdx; i < cleaned.length; i++) {
          if (cleaned[i] === "[") depth++;
          if (cleaned[i] === "]") depth--;
          if (depth === 0) {
            calendars = JSON.parse(cleaned.slice(startIdx, i + 1));
            break;
          }
        }
      }
    } catch {}

    if (calendars.length > 0) {
      const primary = calendars.find((c) => c.primary);
      sendStep(3, "passed", `Access verified. Found ${calendars.length} calendar(s).`);

      // ── Step 4: Done ──────────────────────────────────────────────────
      sendStep(4, "passed", "Google Calendar connected successfully!");
      sendEvent("done", {
        success: true,
        calendars,
        userEmail: primary?.summary || primary?.id || null,
      });
    } else {
      // Claude returned something but we couldn't parse calendars
      sendStep(3, "failed", "Could not retrieve calendar list.");
      sendEvent("fix", {
        step: 3,
        message: allOutput.slice(0, 300) || "Unknown error. Check Claude Code MCP configuration.",
        raw: true,
      });
    }

    res.end();
    return true;
  }

  // ── POST /api/calendar/mcp-sync ─────────────────────────────────────
  if (pathname === "/api/calendar/mcp-sync" && method === "POST") {
    const body = await parseBody(req);

    // Pull events from Google Calendar into Open Canvas
    if (body.action === "pull") {
      const calendarId = body.calendarId || "primary";
      const now = new Date();
      const from = body.from || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const to = body.to || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      log(CAT, `MCP pull: ${calendarId} from ${from} to ${to}`);
      try {
        const remoteEvents = await mcpListEvents(calendarId, from, to);
        if (!Array.isArray(remoteEvents)) {
          jsonResponse(res, { error: "Invalid response from Google Calendar" }, 500);
          return true;
        }

        const localEvents = readEvents();
        let pulled = 0;
        let updated = 0;
        const errors = [];

        for (const remote of remoteEvents) {
          try {
            const externalRef = `mcp:${remote.id}`;
            const existing = localEvents.find((e) => e.googleCalendarId === externalRef);

            if (existing) {
              updateCalendarEvent(existing.id, {
                title: remote.summary || existing.title,
                description: remote.description || existing.description,
                startTime: remote.start || existing.startTime,
                endTime: remote.end || existing.endTime,
                allDay: remote.allDay || false,
              });
              updated++;
            } else {
              addCalendarEvent({
                title: remote.summary || "(No title)",
                description: remote.description || undefined,
                startTime: remote.start || new Date().toISOString(),
                endTime: remote.end || undefined,
                allDay: remote.allDay || false,
                source: { agent: "user" },
                target: "user",
                googleCalendarId: externalRef,
                tags: ["synced"],
              });
              pulled++;
            }
          } catch (eventErr) {
            errors.push(`Event "${remote.summary}": ${eventErr.message}`);
          }
        }

        log(CAT, `MCP pull complete: ${pulled} new, ${updated} updated, ${errors.length} errors`);
        jsonResponse(res, { pulled, updated, errors });
      } catch (err) {
        logError(CAT, "MCP pull failed:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    // Push a local event to Google Calendar
    if (body.action === "push") {
      const { eventId } = body;
      if (!eventId) {
        jsonResponse(res, { error: "eventId required" }, 400);
        return true;
      }

      const event = getEventById(eventId);
      if (!event) {
        jsonResponse(res, { error: "Event not found" }, 404);
        return true;
      }

      try {
        const calendarId = body.calendarId || "primary";

        if (event.googleCalendarId && event.googleCalendarId.startsWith("mcp:")) {
          const remoteId = event.googleCalendarId.replace("mcp:", "");
          await mcpUpdateEvent(calendarId, remoteId, event);
          log(CAT, `MCP push-update: ${eventId} → ${remoteId}`);
          jsonResponse(res, { pushed: true, action: "updated", googleCalendarId: event.googleCalendarId });
        } else {
          const result = await mcpCreateEvent(calendarId, event);
          const gcalId = `mcp:${result.id}`;
          updateCalendarEvent(eventId, { googleCalendarId: gcalId });
          log(CAT, `MCP push-create: ${eventId} → ${result.id}`);
          jsonResponse(res, { pushed: true, action: "created", googleCalendarId: gcalId });
        }
      } catch (err) {
        logError(CAT, "MCP push failed:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    // Delete a remote event
    if (body.action === "push-delete") {
      const { googleCalendarId } = body;
      if (!googleCalendarId || !googleCalendarId.startsWith("mcp:")) {
        jsonResponse(res, { error: "Valid googleCalendarId required" }, 400);
        return true;
      }

      try {
        const remoteId = googleCalendarId.replace("mcp:", "");
        const calendarId = body.calendarId || "primary";
        await mcpDeleteEvent(calendarId, remoteId);
        log(CAT, `MCP push-delete: ${remoteId}`);
        jsonResponse(res, { deleted: true });
      } catch (err) {
        logError(CAT, "MCP push-delete failed:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    jsonResponse(res, { error: "action required (pull|push|push-delete)" }, 400);
    return true;
  }

  // ── POST /api/calendar/connections ─────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "POST") {
    const body = await parseBody(req);

    // Update connection settings
    if (body.action === "update") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      log(CAT, "Updating connection:", body.connectionId);
      const updated = updateConnection(body.connectionId, body.updates || {});
      if (!updated) {
        jsonResponse(res, { error: "Connection not found" }, 404);
        return true;
      }
      jsonResponse(res, { connection: updated });
      return true;
    }

    // Remove connection
    if (body.action === "remove") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      log(CAT, "Removing connection:", body.connectionId);
      const removed = removeConnection(body.connectionId);
      jsonResponse(res, { removed });
      return true;
    }

    jsonResponse(res, { error: "action required (update|remove)" }, 400);
    return true;
  }

  return false;
}
