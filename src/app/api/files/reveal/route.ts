import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  const { path: targetPath } = await req.json();

  if (!targetPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  if (!fs.existsSync(targetPath)) {
    return NextResponse.json({ error: "Path does not exist" }, { status: 404 });
  }

  try {
    const platform = process.platform;
    const isDir = fs.statSync(targetPath).isDirectory();

    if (platform === "darwin") {
      // macOS: open -R selects the item in Finder; open opens a directory
      if (isDir) {
        execFileSync("open", [targetPath]);
      } else {
        execFileSync("open", ["-R", targetPath]);
      }
    } else if (platform === "win32") {
      if (isDir) {
        execFileSync("explorer", [targetPath]);
      } else {
        execFileSync("explorer", ["/select,", targetPath]);
      }
    } else {
      // Linux: xdg-open the containing directory
      const dir = isDir ? targetPath : path.dirname(targetPath);
      execFileSync("xdg-open", [dir]);
    }

    return NextResponse.json({ revealed: true, path: targetPath });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reveal: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
