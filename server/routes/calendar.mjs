// server/routes/calendar.mjs — Calendar API routes
// Translates: src/app/api/calendar/**/*.ts

import {
  readEvents,
  addEvent,
  updateEvent,
  deleteEvent,
  getEventsByDateRange,
  getEventsByProject,
  ensureCalendarDir,
  readCronState,
  getUnreadNotifications,
  readNotifications,
  dismissNotification,
} from "../../src/lib/calendarConfig.js";

import { expandCron } from "../../src/lib/calendarCronExpander.js";
import { triggerEventNow } from "../cron-scheduler.mjs";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/calendar ──────────────────────────────────────────────────
  if (pathname === "/api/calendar" && method === "GET") {
    ensureCalendarDir();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const project = url.searchParams.get("project");
    const status = url.searchParams.get("status");

    let events = from && to ? getEventsByDateRange(from, to) : readEvents();

    if (project) {
      events = events.filter(
        (e) =>
          e.source.projectPath === project ||
          e.action?.projectPath === project
      );
    }

    if (status) {
      events = events.filter((e) => e.status === status);
    }

    // Expand recurring (cron) events into individual occurrences
    const expand = url.searchParams.get("expand") === "true";
    if (expand && from && to) {
      const expanded = [];
      const nonRecurring = [];

      for (const e of events) {
        if (e.recurrence) {
          const occurrences = expandCron(e.recurrence, from, to);
          for (let i = 0; i < occurrences.length; i++) {
            const duration = e.endTime
              ? new Date(e.endTime).getTime() - new Date(e.startTime).getTime()
              : 0;
            const occStart = occurrences[i];
            expanded.push({
              ...e,
              id: `${e.id}_occ_${i}`,
              startTime: occStart,
              endTime: duration
                ? new Date(new Date(occStart).getTime() + duration).toISOString()
                : undefined,
              _parentId: e.id,
              _occurrence: true,
            });
          }
        } else {
          nonRecurring.push(e);
        }
      }

      events = [...nonRecurring, ...expanded];
    }

    events.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    jsonResponse(res, { events });
    return true;
  }

  // ── POST /api/calendar ─────────────────────────────────────────────────
  if (pathname === "/api/calendar" && method === "POST") {
    const body = await parseBody(req);

    if (body.action === "create") {
      if (!body.event?.title || !body.event?.startTime) {
        jsonResponse(res, { error: "title and startTime required" }, 400);
        return true;
      }
      const event = addEvent({
        title: body.event.title,
        description: body.event.description,
        startTime: body.event.startTime,
        endTime: body.event.endTime,
        allDay: body.event.allDay,
        recurrence: body.event.recurrence,
        source: body.event.source || { agent: "user" },
        target: body.event.target || "user",
        action: body.event.action,
        googleCalendarId: body.event.googleCalendarId,
        tags: body.event.tags,
      });
      jsonResponse(res, { event });
      return true;
    }

    if (body.action === "update") {
      if (!body.id) {
        jsonResponse(res, { error: "id required" }, 400);
        return true;
      }
      const event = updateEvent(body.id, body.updates || {});
      if (!event) {
        jsonResponse(res, { error: "event not found" }, 404);
        return true;
      }
      jsonResponse(res, { event });
      return true;
    }

    if (body.action === "delete") {
      if (!body.id) {
        jsonResponse(res, { error: "id required" }, 400);
        return true;
      }
      const deleted = deleteEvent(body.id);
      if (!deleted) {
        jsonResponse(res, { error: "event not found" }, 404);
        return true;
      }
      jsonResponse(res, { deleted: true });
      return true;
    }

    jsonResponse(res, { error: "action required (create|update|delete)" }, 400);
    return true;
  }

  // ── GET /api/calendar/cron ─────────────────────────────────────────────
  if (pathname === "/api/calendar/cron" && method === "GET") {
    ensureCalendarDir();
    const jobs = readCronState();
    const events = readEvents();

    const enriched = jobs.map((job) => {
      const event = events.find((e) => e.id === job.eventId);
      return {
        ...job,
        eventTitle: event?.title || "Unknown",
        eventStatus: event?.status || "unknown",
      };
    });

    jsonResponse(res, {
      jobs: enriched,
      activeCount: jobs.filter((j) => j.status === "active").length,
      totalEvents: events.length,
    });
    return true;
  }

  // ── GET /api/calendar/notifications ────────────────────────────────────
  if (pathname === "/api/calendar/notifications" && method === "GET") {
    ensureCalendarDir();
    const unreadOnly = url.searchParams.get("unread") !== "false";
    const notifications = unreadOnly
      ? getUnreadNotifications()
      : readNotifications();
    jsonResponse(res, { notifications });
    return true;
  }

  // ── POST /api/calendar/notifications ───────────────────────────────────
  if (pathname === "/api/calendar/notifications" && method === "POST") {
    const body = await parseBody(req);

    if (body.action === "dismiss") {
      if (!body.id) {
        jsonResponse(res, { error: "id required" }, 400);
        return true;
      }
      const dismissed = dismissNotification(body.id);
      if (!dismissed) {
        jsonResponse(res, { error: "notification not found" }, 404);
        return true;
      }
      jsonResponse(res, { dismissed: true });
      return true;
    }

    jsonResponse(res, { error: "action required (dismiss)" }, 400);
    return true;
  }

  // ── POST /api/calendar/trigger-test ─────────────────────────────────
  // Creates a test event and triggers it immediately (E2E testing)
  if (pathname === "/api/calendar/trigger-test" && method === "POST") {
    ensureCalendarDir();
    const body = await parseBody(req);

    const title = body.title || "Calendar E2E Test";
    const prompt = body.prompt || "You are a test event triggered by the calendar system. Confirm you received this by saying: Calendar trigger test successful.";
    const agent = body.agent || "claude";
    const projectPath = body.projectPath || undefined;

    // Create the event in calendar.yaml so it's visible in the UI
    const event = addEvent({
      title,
      description: `Test event triggered manually at ${new Date().toISOString()}`,
      startTime: new Date().toISOString(),
      source: { agent: "user" },
      target: "agent",
      action: {
        type: "prompt",
        payload: prompt,
        agent,
        projectPath,
      },
      tags: ["test", "trigger-test"],
    });

    // Trigger the job immediately (bypasses scheduler timing)
    triggerEventNow(event);

    jsonResponse(res, {
      triggered: true,
      eventId: event.id,
      title: event.title,
      agent,
      message: "Event created and triggered. Check /api/sessions for the spawned cron session.",
    });
    return true;
  }

  return false;
}
