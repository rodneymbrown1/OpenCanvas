import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readConfig } from "@/lib/config";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileEntry[];
}

const IGNORED = new Set([
  "node_modules",
  ".next",
  ".git",
  "__pycache__",
  ".DS_Store",
  ".env",
]);

function buildTree(dirPath: string, depth = 0): FileEntry[] {
  if (depth > 5) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: fullPath,
            type: "directory" as const,
            children: buildTree(fullPath, depth + 1),
          };
        }
        return {
          name: entry.name,
          path: fullPath,
          type: "file" as const,
        };
      });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const dirParam = req.nextUrl.searchParams.get("dir");
  const config = readConfig();
  const dir = dirParam || config.workspace.root;

  if (!dir) {
    return NextResponse.json(
      { error: "No workspace directory set" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(dir)) {
    return NextResponse.json(
      { error: "Directory does not exist" },
      { status: 404 }
    );
  }

  const tree = buildTree(dir);
  return NextResponse.json({ root: dir, tree });
}
