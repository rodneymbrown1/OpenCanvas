import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { linkGlobalToProject } from "@/lib/globalConfig";

// POST /api/data/global — link a global file to a project
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, fileName, projectDir } = body;

    if (action === "link") {
      if (!fileName || !projectDir) {
        return NextResponse.json(
          { error: "fileName and projectDir required" },
          { status: 400 }
        );
      }
      const dataDir = path.join(projectDir, "data", "formatted");
      const linkedPath = linkGlobalToProject(fileName, dataDir);
      return NextResponse.json({ linked: true, path: linkedPath });
    }

    return NextResponse.json(
      { error: "action required (link)" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
