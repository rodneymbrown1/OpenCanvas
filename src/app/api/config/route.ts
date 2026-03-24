import { NextRequest, NextResponse } from "next/server";
import {
  readConfig,
  updateConfig,
  readProjectConfig,
  updateProjectConfig,
  type OpenCanvasConfig,
} from "@/lib/config";

export async function GET(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");

  try {
    if (workDir) {
      const config = readProjectConfig(workDir);
      const safe = { ...config, api_keys: undefined };
      return NextResponse.json({ ...safe, _projectScoped: true });
    }
    const config = readConfig();
    const safe = { ...config, api_keys: undefined };
    return NextResponse.json(safe);
  } catch {
    return NextResponse.json(
      { error: "Failed to read config" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");

  try {
    const updates = await req.json();

    if (workDir) {
      const updated = updateProjectConfig(workDir, (config) =>
        deepMerge(config, updates)
      );
      return NextResponse.json(updated);
    }

    const updated = updateConfig((config) => deepMerge(config, updates));
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
