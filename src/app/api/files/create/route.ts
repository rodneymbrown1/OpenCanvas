import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";

export async function POST(req: NextRequest) {
  const { path: filePath, type } = await req.json();

  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  if (existsSync(filePath)) {
    return NextResponse.json({ error: "Already exists" }, { status: 409 });
  }

  try {
    if (type === "directory") {
      mkdirSync(filePath, { recursive: true });
    } else {
      writeFileSync(filePath, "", "utf-8");
    }
    return NextResponse.json({ path: filePath, created: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
