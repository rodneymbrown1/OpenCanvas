import { NextRequest, NextResponse } from "next/server";
import { readEvents, addEvent, updateEvent, ensureCalendarDir } from "@/lib/calendarConfig";

// POST /api/calendar/google — Google Calendar sync operations
export async function POST(req: NextRequest) {
  ensureCalendarDir();
  const body = await req.json();

  if (body.action === "sync") {
    // Placeholder: In production, this would call the Google Calendar MCP server
    // to fetch events and merge them into the local calendar.
    //
    // The MCP server would be invoked via the configured MCP transport,
    // calling tools like "list_events" and "create_event".
    //
    // For now, return a helpful error indicating MCP configuration is needed.
    return NextResponse.json(
      {
        error: "Google Calendar MCP server not configured. Add it in Settings > MCP.",
        hint: "Configure an MCP server named 'google-calendar' to enable sync.",
      },
      { status: 501 }
    );
  }

  if (body.action === "push") {
    if (!body.eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    // Placeholder: Would push a local event to Google Calendar via MCP
    return NextResponse.json(
      {
        error: "Google Calendar MCP server not configured.",
      },
      { status: 501 }
    );
  }

  return NextResponse.json(
    { error: "action required (sync|push)" },
    { status: 400 }
  );
}
