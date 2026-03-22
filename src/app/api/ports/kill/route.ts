import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(req: NextRequest) {
  const { pid, port } = await req.json();

  if (!pid || !port) {
    return NextResponse.json({ error: "Missing pid or port" }, { status: 400 });
  }

  try {
    const platform = process.platform;

    if (platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      // Send SIGTERM first (graceful), fall back to SIGKILL
      try {
        execSync(`kill ${pid}`, { timeout: 3000 });
      } catch {
        execSync(`kill -9 ${pid}`, { timeout: 3000 });
      }
    }

    return NextResponse.json({ killed: true, pid, port });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to kill PID ${pid}: ${String(err)}` },
      { status: 500 }
    );
  }
}
