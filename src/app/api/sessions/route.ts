import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

export async function GET() {
  const config = readConfig();
  const port = config.server?.pty_port || 3001;
  try {
    const res = await fetch(`http://localhost:${port}/sessions`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}
