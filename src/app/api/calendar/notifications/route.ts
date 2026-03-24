import { NextRequest, NextResponse } from "next/server";
import {
  getUnreadNotifications,
  readNotifications,
  dismissNotification,
  ensureCalendarDir,
} from "@/lib/calendarConfig";

// GET /api/calendar/notifications — list notifications
export async function GET(req: NextRequest) {
  ensureCalendarDir();
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") !== "false";

  const notifications = unreadOnly ? getUnreadNotifications() : readNotifications();
  return NextResponse.json({ notifications });
}

// POST /api/calendar/notifications — dismiss a notification
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "dismiss") {
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const dismissed = dismissNotification(body.id);
    if (!dismissed) {
      return NextResponse.json({ error: "notification not found" }, { status: 404 });
    }
    return NextResponse.json({ dismissed: true });
  }

  return NextResponse.json(
    { error: "action required (dismiss)" },
    { status: 400 }
  );
}
