import { NextRequest, NextResponse } from "next/server";
import { readCronState, readEvents, ensureCalendarDir } from "@/lib/calendarConfig";

// GET /api/calendar/cron — return cron job status
export async function GET() {
  ensureCalendarDir();
  const jobs = readCronState();
  const events = readEvents();

  // Enrich jobs with event titles
  const enriched = jobs.map((job) => {
    const event = events.find((e) => e.id === job.eventId);
    return {
      ...job,
      eventTitle: event?.title || "Unknown",
      eventStatus: event?.status || "unknown",
    };
  });

  return NextResponse.json({
    jobs: enriched,
    activeCount: jobs.filter((j) => j.status === "active").length,
    totalEvents: events.length,
  });
}
