import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (>2MB)" },
        { status: 413 }
      );
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ path: filePath, content });
  } catch {
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
}
