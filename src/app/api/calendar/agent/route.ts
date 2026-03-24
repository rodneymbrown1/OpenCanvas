import { NextRequest, NextResponse } from "next/server";
import {
  detectCalendarIntent,
  routeToCalendar,
} from "@/lib/calendarAgent";
import type { AgentType } from "@/lib/calendarConfig";

// POST /api/calendar/agent — handle calendar intent from agents
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "detect") {
    // Check if text contains calendar intent
    if (!body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const hasIntent = detectCalendarIntent(body.text);
    return NextResponse.json({ hasIntent });
  }

  if (body.action === "create-from-intent") {
    // Parse intent and create calendar event
    if (!body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const event = routeToCalendar(
      body.text,
      (body.sourceAgent as AgentType) || "claude",
      body.sourceProject,
      body.sourceSessionId
    );
    return NextResponse.json({ event });
  }

  return NextResponse.json(
    { error: "action required (detect|create-from-intent)" },
    { status: 400 }
  );
}
