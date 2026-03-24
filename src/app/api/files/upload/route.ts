import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const targetDir = formData.get("targetDir") as string;

    if (!targetDir) {
      return NextResponse.json({ error: "targetDir required" }, { status: 400 });
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const files = formData.getAll("files");
    const relativePaths = formData.getAll("relativePaths");
    const saved: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!(file instanceof File)) continue;

      const relPath = (relativePaths[i] as string) || file.name;
      const sanitized = relPath.replace(/\.\.\//g, "").replace(/^\//g, "");

      const filePath = path.join(targetDir, sanitized);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      saved.push(filePath);
    }

    return NextResponse.json({
      uploaded: saved.length,
      files: saved.map((p) => path.relative(targetDir, p)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
