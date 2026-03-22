import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const workDir = formData.get("workDir") as string;

    if (!workDir) {
      return NextResponse.json({ error: "workDir required" }, { status: 400 });
    }

    const rawDir = path.join(workDir, "data", "raw");

    // Ensure directories exist
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(path.join(workDir, "data", "formatted"), { recursive: true });

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
