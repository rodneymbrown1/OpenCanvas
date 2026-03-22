import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";

function ptyUrl(path: string) {
  const config = readConfig();
  const port = config.server?.pty_port || 3001;
  return `http://localhost:${port}${path}`;
}

// POST /api/stack?action=start|stop
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const body = await req.json();

  if (action === "start") {
    try {
      const res = await fetch(ptyUrl("/stack/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return NextResponse.json(await res.json(), { status: res.status });
    } catch {
      return NextResponse.json({ error: "PTY server unreachable" }, { status: 503 });
    }
  }

  if (action === "stop") {
    try {
      const res = await fetch(ptyUrl("/stack/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return NextResponse.json(await res.json(), { status: res.status });
    } catch {
      return NextResponse.json({ error: "PTY server unreachable" }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "action param required (start|stop)" }, { status: 400 });
}

// GET /api/stack?cwd=...
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }
  try {
    const res = await fetch(ptyUrl(`/stack/status?cwd=${encodeURIComponent(cwd)}`));
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ running: false });
  }
}
