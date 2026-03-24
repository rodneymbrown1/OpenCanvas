import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { source, targetDir } = await req.json();

    if (!source || !targetDir) {
      return NextResponse.json({ error: "source and targetDir required" }, { status: 400 });
    }

    if (!fs.existsSync(source)) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return NextResponse.json({ error: "Target directory not found" }, { status: 404 });
    }

    const linkPath = path.join(targetDir, path.basename(source));

    // Remove existing link/file if present
    if (fs.existsSync(linkPath)) {
      fs.unlinkSync(linkPath);
    }

    // Create symlink, fall back to copy on Windows without dev mode
    try {
      fs.symlinkSync(source, linkPath);
    } catch {
      fs.copyFileSync(source, linkPath);
    }

    return NextResponse.json({ linked: true, source, linkPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Link failed" },
      { status: 500 }
    );
  }
}
