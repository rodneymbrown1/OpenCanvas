import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isSetUp, getGlobalDataStatus } from "@/lib/globalConfig";

interface DataFile {
  name: string;
  path: string;
  size: number;
  dir: "raw" | "formatted" | "other";
  isGlobalRef?: boolean;
}

function listFiles(dirPath: string, category: "raw" | "formatted" | "other", baseDir?: string): DataFile[] {
  if (!fs.existsSync(dirPath)) return [];
  const root = baseDir || dirPath;
  try {
    const results: DataFile[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, d.name);
      if (d.isFile()) {
        const stat = fs.lstatSync(fullPath);
        const relName = root !== dirPath ? path.relative(root, fullPath) : d.name;
        results.push({
          name: relName,
          path: fullPath,
          size: stat.size,
          dir: category,
          isGlobalRef: stat.isSymbolicLink(),
        });
      } else if (d.isDirectory() && category !== "other") {
        results.push(...listFiles(fullPath, category, root));
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const workDir = req.nextUrl.searchParams.get("workDir");
  const scope = req.nextUrl.searchParams.get("scope") || "project";

  // Global scope
  if (scope === "global") {
    if (!isSetUp()) {
      return NextResponse.json({
        configured: false,
        totalFiles: 0,
        rawFiles: [],
        formattedFiles: [],
        hasSkillsMd: false,
        unformatted: [],
      });
    }
    const status = getGlobalDataStatus();
    return NextResponse.json({ configured: true, ...status });
  }

  // Project scope
  if (!workDir) {
    return NextResponse.json({ error: "workDir required" }, { status: 400 });
  }

  const dataDir = path.join(workDir, "data");
  const rawDir = path.join(dataDir, "raw");
  const formattedDir = path.join(dataDir, "formatted");

  const rawFiles = listFiles(rawDir, "raw");
  const formattedFiles = listFiles(formattedDir, "formatted");
  const rootFiles = listFiles(dataDir, "other").filter(
    (f) => f.name !== ".DS_Store"
  );

  const manifestPath = path.join(workDir, "CLAUDE.md");
  const hasManifest = fs.existsSync(manifestPath);

  const totalFiles = rawFiles.length + formattedFiles.length + rootFiles.length;

  let phase = "idle";
  if (totalFiles === 0) phase = "idle";
  else if (rawFiles.length > 0 && formattedFiles.length === 0) phase = "raw";
  else if (formattedFiles.length > 0 && !hasManifest) phase = "formatted";
  else if (hasManifest) phase = "ready";

  return NextResponse.json({
    totalFiles,
    rawFiles,
    formattedFiles,
    rootFiles,
    hasManifest,
    phase,
  });
}
