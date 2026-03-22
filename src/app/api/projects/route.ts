import { NextRequest, NextResponse } from "next/server";
import {
  isSetUp,
  setupGlobalConfig,
  readGlobalConfig,
  listProjects,
  registerProject,
  removeProject,
  listSharedData,
  OC_HOME,
} from "@/lib/globalConfig";

// GET /api/projects — list projects + global config status
export async function GET() {
  const configured = isSetUp();
  const config = configured ? readGlobalConfig() : null;
  const projects = configured ? listProjects() : [];
  const sharedData = configured ? listSharedData() : [];

  return NextResponse.json({
    configured,
    home: configured ? config?.open_canvas_home : OC_HOME,
    sharedDataDir: config?.shared_data_dir || "",
    projects,
    sharedData,
    defaults: config?.defaults || {},
  });
}

// POST /api/projects — register a project or set up global config
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Setup action
  if (body.action === "setup") {
    const config = setupGlobalConfig(body.customHome);
    return NextResponse.json({
      configured: true,
      home: config.open_canvas_home,
      sharedDataDir: config.shared_data_dir,
    });
  }

  // Register project
  if (body.action === "register") {
    if (!body.path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    // Ensure global config exists
    if (!isSetUp()) setupGlobalConfig();
    const entry = registerProject(body.path, body.name);
    return NextResponse.json({ project: entry });
  }

  // Remove project
  if (body.action === "remove") {
    if (!body.path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    removeProject(body.path);
    return NextResponse.json({ removed: true });
  }

  return NextResponse.json({ error: "action required (setup|register|remove)" }, { status: 400 });
}
