import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "open-canvas.yaml");

export async function GET() {
  try {
    const content = fs.readFileSync(CONFIG_PATH, "utf-8");
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { content } = await req.json();
    fs.writeFileSync(CONFIG_PATH, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
