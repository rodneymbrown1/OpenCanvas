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
    const saved: string[] = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(targetDir, file.name);
      fs.writeFileSync(filePath, buffer);
      saved.push(filePath);
    }

    return NextResponse.json({
      uploaded: saved.length,
      files: saved.map((p) => path.basename(p)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
