import { NextRequest, NextResponse } from "next/server";
import {
  readEvents,
  addEvent,
  updateEvent,
  deleteEvent,
  getEventsByDateRange,
  getEventsByProject,
  ensureCalendarDir,
} from "@/lib/calendarConfig";

// GET /api/calendar — list events with optional filters
export async function GET(req: NextRequest) {
  ensureCalendarDir();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const project = searchParams.get("project");
  const status = searchParams.get("status");

  let events = from && to ? getEventsByDateRange(from, to) : readEvents();

  if (project) {
    events = events.filter(
      (e) => e.source.projectPath === project || e.action?.projectPath === project
    );
  }

  if (status) {
    events = events.filter((e) => e.status === status);
  }

  // Sort by startTime ascending
  events.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  return NextResponse.json({ events });
}

// POST /api/calendar — create, update, or delete events
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "create") {
    if (!body.event?.title || !body.event?.startTime) {
      return NextResponse.json(
        { error: "title and startTime required" },
        { status: 400 }
      );
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
    return NextResponse.json({ event });
  }

  if (body.action === "update") {
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const event = updateEvent(body.id, body.updates || {});
    if (!event) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }
    return NextResponse.json({ event });
  }

  if (body.action === "delete") {
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const deleted = deleteEvent(body.id);
    if (!deleted) {
      return NextResponse.json({ error: "event not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json(
    { error: "action required (create|update|delete)" },
    { status: 400 }
  );
}
