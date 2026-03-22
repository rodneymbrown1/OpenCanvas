import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { SHARED_DATA_DIR, isSetUp, setupGlobalConfig } from "@/lib/globalConfig";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const workDir = formData.get("workDir") as string;
    const scope = formData.get("scope") as string || "project";

    let rawDir: string;

    if (scope === "global") {
      // Ensure global config is set up
      if (!isSetUp()) setupGlobalConfig();
      rawDir = path.join(SHARED_DATA_DIR, "raw");
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(path.join(SHARED_DATA_DIR, "formatted"), { recursive: true });
    } else {
      if (!workDir) {
        return NextResponse.json({ error: "workDir required for project scope" }, { status: 400 });
      }
      rawDir = path.join(workDir, "data", "raw");
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(path.join(workDir, "data", "formatted"), { recursive: true });
    }

    const files = formData.getAll("files");
    const saved: string[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(rawDir, file.name);
      fs.writeFileSync(filePath, buffer);
      saved.push(filePath);
    }

    return NextResponse.json({
      uploaded: saved.length,
      scope,
      files: saved.map((p) => path.basename(p)),
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
