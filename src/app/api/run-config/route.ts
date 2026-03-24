import { NextRequest, NextResponse } from "next/server";
import { RunConfigManager } from "@/lib/core/RunConfigManager";

// GET /api/run-config?cwd=... — read run-config.yaml
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const manager = new RunConfigManager(cwd);

  if (!manager.exists()) {
    return NextResponse.json({ exists: false, config: null });
  }

  const config = manager.read();
  const validation = manager.validate(config);
  const topology = manager.getTopology();

  return NextResponse.json({
    exists: true,
    config,
    startOrder: topology.startOrder,
    validation,
    agentPrompt: manager.toAgentPrompt(),
  });
}

// POST /api/run-config — write/update or auto-detect
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const body = await req.json();
  const cwd = body.cwd;

  if (!cwd) {
    return NextResponse.json({ error: "cwd required in body" }, { status: 400 });
  }

  const manager = new RunConfigManager(cwd);

  // Auto-detect services from filesystem
  if (action === "detect") {
    const config = manager.detectAndWrite();
    const validation = manager.validate(config);
    return NextResponse.json({
      config,
      startOrder: manager.getStartOrder(),
      validation,
      servicesFound: Object.keys(config.services).length,
    });
  }

  // Add a single service
  if (action === "add-service") {
    const { name, service } = body;
    if (!name || !service) {
      return NextResponse.json(
        { error: "name and service required" },
        { status: 400 }
      );
    }
    const config = manager.addService(name, service);
    return NextResponse.json({ config });
  }

  // Remove a service
  if (action === "remove-service") {
    const { name } = body;
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const config = manager.removeService(name);
    return NextResponse.json({ config });
  }

  // Default: write full config
  if (body.config) {
    const validation = manager.validate(body.config);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid config", validation },
        { status: 400 }
      );
    }
    manager.write(body.config);
    return NextResponse.json({ config: body.config, validation });
  }

  return NextResponse.json(
    { error: "Provide config in body, or use ?action=detect|add-service|remove-service" },
    { status: 400 }
  );
}
