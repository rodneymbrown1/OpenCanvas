import { NextRequest, NextResponse } from "next/server";
import { generateContextHandoff } from "@/lib/contextSharing";

export async function POST(req: NextRequest) {
  try {
    const { workDir, fromAgent, toAgent, fromSessionId } = await req.json();

    if (!workDir || !fromAgent || !toAgent) {
      return NextResponse.json(
        { error: "workDir, fromAgent, and toAgent are required" },
        { status: 400 }
      );
    }

    const handoffPath = await generateContextHandoff(
      workDir,
      fromAgent,
      toAgent,
      fromSessionId
    );

    return NextResponse.json({ ok: true, path: handoffPath });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to generate handoff: ${err}` },
      { status: 500 }
    );
  }
}
