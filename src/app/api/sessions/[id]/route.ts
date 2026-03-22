import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const config = readConfig();
  const port = config.server?.pty_port || 3001;
  try {
    const res = await fetch(`http://localhost:${port}/sessions/${id}`);
    if (!res.ok) {
      return NextResponse.json({ session: null }, { status: 404 });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ session: null }, { status: 503 });
  }
}
