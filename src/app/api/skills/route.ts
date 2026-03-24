import { NextRequest, NextResponse } from "next/server";
import { SkillsManager } from "@/lib/core/SkillsManager";
import { SHARED_DATA_DIR } from "@/lib/globalConfig";
import type { SkillsScope } from "@/lib/core/types";

function getManager(scope: SkillsScope, cwd?: string): SkillsManager | null {
  if (scope === "global") {
    return new SkillsManager("global", SHARED_DATA_DIR);
  }
  if (scope === "project" && cwd) {
    return new SkillsManager("project", cwd);
  }
  return null;
}

// GET /api/skills?scope=global
// GET /api/skills?scope=project&cwd=...
// GET /api/skills?type=project-doc&cwd=...
// GET /api/skills?type=global-data
export async function GET(req: NextRequest) {
  const scope = (req.nextUrl.searchParams.get("scope") || "project") as SkillsScope;
  const cwd = req.nextUrl.searchParams.get("cwd") || undefined;
  const type = req.nextUrl.searchParams.get("type");

  // Special: project doc
  if (type === "project-doc") {
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const manager = new SkillsManager("project", cwd);
    return NextResponse.json({
      exists: manager.projectDocExists(),
      content: manager.readProjectDoc(),
      path: manager.projectDocPath,
    });
  }

  // Special: global data
  if (type === "global-data") {
    const manager = new SkillsManager("global", SHARED_DATA_DIR);
    return NextResponse.json({
      exists: manager.globalDataExists(),
      content: manager.readGlobalData(),
      path: manager.globalDataPath,
    });
  }

  // Default: skills.md
  const manager = getManager(scope, cwd);
  if (!manager) {
    return NextResponse.json(
      { error: "Invalid scope or missing cwd for project scope" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    exists: manager.skillsExist(),
    content: manager.readSkills(),
    path: manager.skillsPath,
    scope,
  });
}

// POST /api/skills
// Body: { scope, cwd?, content, type?, action?, heading? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const scope = (body.scope || "project") as SkillsScope;
  const cwd = body.cwd;
  const type = body.type as string | undefined;
  const action = body.action as string | undefined;

  // Write project doc
  if (type === "project-doc") {
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const manager = new SkillsManager("project", cwd);
    manager.writeProjectDoc(body.content || "");
    return NextResponse.json({ success: true, path: manager.projectDocPath });
  }

  // Write global data
  if (type === "global-data") {
    const manager = new SkillsManager("global", SHARED_DATA_DIR);
    manager.writeGlobalData(body.content || "");
    return NextResponse.json({ success: true, path: manager.globalDataPath });
  }

  // Ensure skeleton files
  if (action === "ensure") {
    const manager = getManager(scope, cwd);
    if (!manager) {
      return NextResponse.json({ error: "Invalid scope or missing cwd" }, { status: 400 });
    }
    manager.ensureFiles();
    return NextResponse.json({ success: true });
  }

  // Append section
  if (action === "append") {
    const manager = getManager(scope, cwd);
    if (!manager) {
      return NextResponse.json({ error: "Invalid scope or missing cwd" }, { status: 400 });
    }
    if (!body.heading || !body.content) {
      return NextResponse.json(
        { error: "heading and content required for append" },
        { status: 400 }
      );
    }
    manager.appendSection(body.heading, body.content);
    return NextResponse.json({ success: true, path: manager.skillsPath });
  }

  // Default: write skills.md
  const manager = getManager(scope, cwd);
  if (!manager) {
    return NextResponse.json({ error: "Invalid scope or missing cwd" }, { status: 400 });
  }
  manager.writeSkills(body.content || "");
  return NextResponse.json({ success: true, path: manager.skillsPath });
}
