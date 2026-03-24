import { NextRequest, NextResponse } from "next/server";
import { readProjectConfigRaw, writeProjectConfigRaw } from "@/lib/config";
import fs from "fs";
import path from "path";

/** Fallback: app-level config (backward compat when no workDir provided) */
const APP_CONFIG_PATH = path.join(process.cwd(), "open-canvas.yaml");

export async function GET(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");

  try {
    if (workDir) {
      const content = readProjectConfigRaw(workDir);
      return NextResponse.json({
        content,
        path: path.join(workDir, "open-canvas.yaml"),
        isProjectScoped: true,
      });
    }
    // Fallback: read app-level config
    const content = fs.existsSync(APP_CONFIG_PATH)
      ? fs.readFileSync(APP_CONFIG_PATH, "utf-8")
      : "";
    return NextResponse.json({ content, path: APP_CONFIG_PATH, isProjectScoped: false });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

export async function PUT(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");

  try {
    const { content } = await req.json();
    if (workDir) {
      writeProjectConfigRaw(workDir, content);
    } else {
      fs.writeFileSync(APP_CONFIG_PATH, content, "utf-8");
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
