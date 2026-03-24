import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { SHARED_DATA_DIR, isSetUp, setupGlobalConfig, ensureSharedDataDirs } from "@/lib/globalConfig";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const workDir = formData.get("workDir") as string;
    const scope = formData.get("scope") as string || "project";

    let rawDir: string;

    if (scope === "global") {
      // Ensure global config is set up
      if (!isSetUp()) setupGlobalConfig();
      ensureSharedDataDirs();
      rawDir = path.join(SHARED_DATA_DIR, "raw");
    } else {
      if (!workDir) {
        return NextResponse.json({ error: "workDir required for project scope" }, { status: 400 });
      }
      rawDir = path.join(workDir, "data", "raw");
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(path.join(workDir, "data", "formatted"), { recursive: true });
    }

    const files = formData.getAll("files");
    // relativePaths[] is sent in parallel with files[] to preserve folder structure
    const relativePaths = formData.getAll("relativePaths");
    const saved: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;

      // Use the explicit relative path if provided, otherwise just the file name
      const relPath = (relativePaths[i] as string) || file.name;

      // Sanitize: prevent path traversal
      const sanitized = relPath.replace(/\.\.\//g, "").replace(/^\//g, "");

      const filePath = path.join(rawDir, sanitized);
      // Create nested directories as needed
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      saved.push(filePath);
    }

    return NextResponse.json({
      uploaded: saved.length,
      scope,
      files: saved.map((p) => path.relative(rawDir, p)),
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
