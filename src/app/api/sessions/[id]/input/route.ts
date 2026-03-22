import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const config = readConfig();
  const port = config.server?.pty_port || 3001;
  const body = await req.json();

  try {
    const res = await fetch(`http://localhost:${port}/sessions/${id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "PTY server unreachable" },
      { status: 503 }
    );
  }
}
