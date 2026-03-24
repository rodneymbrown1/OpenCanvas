import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { RunConfigManager } from "@/lib/core/RunConfigManager";
import { ServiceManager } from "@/lib/core/ServiceManager";

function getPtyPort(): number {
  try {
    const config = readConfig();
    return config.server?.pty_port || 3001;
  } catch {
    return 3001;
  }
}

// POST /api/services?action=start|stop
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const body = await req.json();
  const cwd = body.cwd;

  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const ptyPort = getPtyPort();

  if (action === "start") {
    // Read run-config.yaml to get services and start order
    const runConfigMgr = new RunConfigManager(cwd);

    if (!runConfigMgr.exists()) {
      return NextResponse.json(
        { error: "No run-config.yaml found. Use /api/run-config?action=detect to generate one." },
        { status: 404 }
      );
    }

    const runConfig = runConfigMgr.read();
    const validation = runConfigMgr.validate(runConfig);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid run-config.yaml", validation },
        { status: 400 }
      );
    }

    if (Object.keys(runConfig.services).length === 0) {
      return NextResponse.json(
        { error: "No services defined in run-config.yaml" },
        { status: 400 }
      );
    }

    try {
      const svcMgr = new ServiceManager(runConfig, ptyPort);
      const statuses = await svcMgr.startAll(cwd);
      return NextResponse.json({
        services: statuses,
        startOrder: svcMgr.getStartOrder(),
      });
    } catch (err) {
      console.error("[api/services] start failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to start services" },
        { status: 503 }
      );
    }
  }

  if (action === "stop") {
    const serviceName = body.service as string | undefined;
    try {
      const ptyUrl = `http://localhost:${ptyPort}`;
      const res = await fetch(`${ptyUrl}/services/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, service: serviceName }),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (err) {
      console.error("[api/services] stop failed:", err);
      return NextResponse.json(
        { error: "PTY server unreachable" },
        { status: 503 }
      );
    }
  }

  return NextResponse.json(
    { error: "action param required (start|stop)" },
    { status: 400 }
  );
}

// GET /api/services?cwd=... — get all service statuses
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const ptyPort = getPtyPort();

  // Get live service statuses from PTY server
  try {
    const ptyUrl = `http://localhost:${ptyPort}`;
    const res = await fetch(
      `${ptyUrl}/services/status?cwd=${encodeURIComponent(cwd)}`
    );
    const liveData = await res.json();

    // Also read run-config.yaml for static service definitions
    const runConfigMgr = new RunConfigManager(cwd);
    let runConfig = null;
    let startOrder: string[] = [];

    if (runConfigMgr.exists()) {
      runConfig = runConfigMgr.read();
      startOrder = runConfigMgr.getStartOrder();

      // Merge: add stopped services from config that aren't in live data
      for (const name of Object.keys(runConfig.services)) {
        if (!liveData.services?.[name]) {
          liveData.services = liveData.services || {};
          liveData.services[name] = {
            name,
            state: "stopped",
            port: runConfig.services[name].port,
          };
        }
        // Add type from config to live status
        if (liveData.services[name]) {
          liveData.services[name].type = runConfig.services[name].type;
        }
      }
    }

    return NextResponse.json({
      services: liveData.services || {},
      hasRunConfig: runConfigMgr.exists(),
      startOrder,
    });
  } catch {
    // PTY server not running — return static info from run-config.yaml
    const runConfigMgr = new RunConfigManager(cwd);
    if (runConfigMgr.exists()) {
      const config = runConfigMgr.read();
      const services: Record<string, unknown> = {};
      for (const [name, svc] of Object.entries(config.services)) {
        services[name] = {
          name,
          state: "stopped",
          port: svc.port,
          type: svc.type,
        };
      }
      return NextResponse.json({
        services,
        hasRunConfig: true,
        startOrder: runConfigMgr.getStartOrder(),
      });
    }
    return NextResponse.json({
      services: {},
      hasRunConfig: false,
      startOrder: [],
    });
  }
}
