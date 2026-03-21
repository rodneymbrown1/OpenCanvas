import { NextRequest, NextResponse } from "next/server";
import { readConfig, updateConfig, type OpenCanvasConfig } from "@/lib/config";

export async function GET() {
  try {
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
  try {
    const updates = await req.json();
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
function deepMerge(target: any, source: any): OpenCanvasConfig {
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
