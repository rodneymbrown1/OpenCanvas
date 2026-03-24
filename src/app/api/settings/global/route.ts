import { NextRequest, NextResponse } from "next/server";
import { readGlobalConfig, writeGlobalConfig } from "@/lib/globalConfig";

export async function GET() {
  try {
    const config = readGlobalConfig();
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      { error: "Failed to read global config" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const updates = await req.json();
    const config = readGlobalConfig();

    // Deep merge updates into defaults
    if (updates.defaults) {
      config.defaults = { ...config.defaults, ...updates.defaults };
      if (updates.defaults.permissions) {
        config.defaults.permissions = {
          ...config.defaults.permissions,
          ...updates.defaults.permissions,
        };
      }
    }

    writeGlobalConfig(config);
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      { error: "Failed to update global config" },
      { status: 500 }
    );
  }
}
