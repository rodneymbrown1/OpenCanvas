import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface DataFile {
  name: string;
  path: string;
  size: number;
  dir: "raw" | "formatted" | "other";
}

function listFiles(dirPath: string, category: "raw" | "formatted" | "other"): DataFile[] {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith("."))
      .map((d) => {
        const fullPath = path.join(dirPath, d.name);
        const stat = fs.statSync(fullPath);
        return {
          name: d.name,
          path: fullPath,
          size: stat.size,
          dir: category,
        };
      });
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");
  if (!workDir) {
    return NextResponse.json({ error: "workDir required" }, { status: 400 });
  }

  const dataDir = path.join(workDir, "data");
  const rawDir = path.join(dataDir, "raw");
  const formattedDir = path.join(dataDir, "formatted");

  const rawFiles = listFiles(rawDir, "raw");
  const formattedFiles = listFiles(formattedDir, "formatted");

  // Also check for loose files in data/ root
  const rootFiles = listFiles(dataDir, "other").filter(
    (f) => f.name !== ".DS_Store"
  );

  const manifestPath = path.join(workDir, "CLAUDE.md");
  const hasManifest = fs.existsSync(manifestPath);

  const totalFiles = rawFiles.length + formattedFiles.length + rootFiles.length;

  // Derive phase
  let phase = "idle";
  if (totalFiles === 0) {
    phase = "idle";
  } else if (rawFiles.length > 0 && formattedFiles.length === 0) {
    phase = "raw";
  } else if (formattedFiles.length > 0 && !hasManifest) {
    phase = "formatted";
  } else if (hasManifest) {
    phase = "ready";
  }

  return NextResponse.json({
    totalFiles,
    rawFiles,
    formattedFiles,
    rootFiles,
    hasManifest,
    phase,
  });
}
