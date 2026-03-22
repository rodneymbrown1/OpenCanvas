import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { source, destination } = await req.json();

    if (!source || !destination) {
      return NextResponse.json({ error: "source and destination required" }, { status: 400 });
    }

    if (!fs.existsSync(source)) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // If destination is a directory, move into it keeping the filename
    let target = destination;
    if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) {
      target = path.join(destination, path.basename(source));
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(target), { recursive: true });

    // Move (rename)
    fs.renameSync(source, target);

    return NextResponse.json({ moved: true, from: source, to: target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Move failed" },
      { status: 500 }
    );
  }
}
