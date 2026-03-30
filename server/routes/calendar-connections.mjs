// server/routes/calendar-connections.mjs — Calendar connection & sync API routes
// Google Calendar sync is handled via Claude's built-in MCP tools (gcal_*).
// No OAuth, no gcloud CLI, no API keys required.

import { spawn } from "child_process";
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
  // Guided connection flow: spawns Claude to trigger MCP Google Calendar auth.
  // Streams progress via SSE so the UI can show the pipeline.
  if (pathname === "/api/calendar/mcp-connect" && method === "POST") {
    log(CAT, "Starting MCP Google Calendar connection pipeline");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (type, data) => {
      try {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      } catch {}
    };

    sendEvent("progress", "Starting Claude to connect Google Calendar...");

    const child = spawn("claude", [
      "-p",
      "Use the gcal_list_calendars MCP tool to list my Google calendars. If authentication is required, the MCP server will handle it. Return ONLY a JSON array of calendars with {id, summary, primary} fields.",
    ], {
      timeout: 120000, // 2 min for user to complete browser auth
      env: { ...process.env },
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[mcp-connect stdout]", line.slice(0, 200));
        sendEvent("progress", line.slice(0, 200));
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[mcp-connect stderr]", line.slice(0, 200));
        // Auth URLs or prompts show up in stderr
        if (line.includes("http") || line.includes("auth") || line.includes("browser")) {
          sendEvent("auth_action", line);
        }
        sendEvent("progress", line.slice(0, 200));
      }
    });

    child.on("close", (code) => {
      log(CAT, `mcp-connect exited with code ${code}`);
      if (code === 0 && output.includes("[")) {
        // Try to extract calendar info from output
        try {
          const cleaned = output.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "");
          const startIdx = cleaned.indexOf("[");
          if (startIdx !== -1) {
            let depth = 0;
            for (let i = startIdx; i < cleaned.length; i++) {
              if (cleaned[i] === "[") depth++;
              if (cleaned[i] === "]") depth--;
              if (depth === 0) {
                const calendars = JSON.parse(cleaned.slice(startIdx, i + 1));
                const primary = calendars.find((c) => c.primary);
                sendEvent("done", {
                  success: true,
                  calendars,
                  userEmail: primary?.summary || primary?.id || null,
                });
                res.end();
                return;
              }
            }
          }
        } catch {}
        sendEvent("done", { success: true, calendars: [], userEmail: null });
      } else {
        sendEvent("error", output.includes("auth")
          ? "Google Calendar authentication may be required. Check your browser for a Google sign-in prompt."
          : `Connection failed (exit code ${code}). Ensure Claude Code CLI has the Google Calendar MCP server configured.`);
      }
      res.end();
    });

    child.on("error", (err) => {
      logError(CAT, "mcp-connect spawn error:", err.message);
      sendEvent("error", err.code === "ENOENT"
        ? "Claude Code CLI not found. Install it to enable Google Calendar sync."
        : err.message);
      res.end();
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      sendEvent("error", "Connection timed out (2 minutes). Please try again.");
      res.end();
    }, 120000);

    child.on("close", () => clearTimeout(timeout));

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
