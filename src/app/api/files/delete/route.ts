import { NextRequest, NextResponse } from "next/server";
import { existsSync, rmSync, statSync } from "fs";

export async function POST(req: NextRequest) {
  const { path: filePath } = await req.json();

  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Does not exist" }, { status: 404 });
  }

  try {
    const stat = statSync(filePath);
    rmSync(filePath, { recursive: stat.isDirectory(), force: true });
    return NextResponse.json({ path: filePath, deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
