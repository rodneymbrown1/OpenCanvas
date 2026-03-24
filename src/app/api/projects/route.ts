import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
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
  const projects = configured
    ? listProjects().map((p) => ({ ...p, exists: fs.existsSync(p.path) }))
    : [];
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

  // Create new project
  if (body.action === "create") {
    if (!body.name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (!isSetUp()) setupGlobalConfig();
    const config = readGlobalConfig();
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const projectsDir = path.join(config.open_canvas_home, "projects");
    const projectPath = path.join(projectsDir, slug);

    if (fs.existsSync(projectPath)) {
      return NextResponse.json({ error: `Project "${slug}" already exists` }, { status: 409 });
    }

    // Create project directory with standard structure
    fs.mkdirSync(path.join(projectPath, "data"), { recursive: true });
    fs.mkdirSync(path.join(projectPath, "apps"), { recursive: true });

    // Register in global config
    const entry = registerProject(projectPath, body.name);
    return NextResponse.json({ project: entry });
  }

  return NextResponse.json({ error: "action required (setup|register|remove|create)" }, { status: 400 });
}
