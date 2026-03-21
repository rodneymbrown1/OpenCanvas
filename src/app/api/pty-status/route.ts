import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { spawn } from "child_process";
import { createConnection } from "net";

export async function GET() {
  const config = readConfig();
  const port = config.server?.pty_port || 3001;

  const running = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });

  return NextResponse.json({ running, port });
}

export async function POST() {
  const projectRoot = process.cwd();
  const serverPath = [projectRoot, "server", "pty-server.mjs"].join("/");

  try {
    const child = spawn("node", [serverPath], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();

    // Wait for it to start
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return NextResponse.json({ started: true, pid: child.pid });
  } catch (err) {
    return NextResponse.json(
      { started: false, error: String(err) },
      { status: 500 }
    );
  }
}
