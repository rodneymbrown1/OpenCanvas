import fs from "fs";
import path from "path";
import YAML from "yaml";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  path: string;
  lastOpened?: string;
  description?: string;
}

export interface GlobalPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  web: boolean;
}

export interface GlobalConfig {
  open_canvas_home: string;
  shared_data_dir: string;
  defaults: {
    agent: string;
    theme: string;
    stack: string;
    allowAllEdits: boolean;
    permissions: GlobalPermissions;
  };
  projects: ProjectEntry[];
}

// ── Paths ────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
export const OC_HOME = path.join(HOME, ".open-canvas");
export const GLOBAL_CONFIG_PATH = path.join(OC_HOME, "global.yaml");
export const SHARED_DATA_DIR = path.join(OC_HOME, "shared-data");

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  open_canvas_home: OC_HOME,
  shared_data_dir: SHARED_DATA_DIR,
  defaults: {
    agent: "claude",
    theme: "dark",
    stack: "nextjs-tailwind",
    allowAllEdits: false,
    permissions: {
      read: true,
      write: true,
      execute: true,
      web: false,
    },
  },
  projects: [],
};

// ── Read / Write ─────────────────────────────────────────────────────────────

export function isSetUp(): boolean {
  return fs.existsSync(GLOBAL_CONFIG_PATH);
}

export function setupGlobalConfig(customHome?: string): GlobalConfig {
  const home = customHome || OC_HOME;
  const sharedData = path.join(home, "shared-data");
  const configPath = path.join(home, "global.yaml");

  // Create directories — including raw/formatted pipeline dirs
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(sharedData, { recursive: true });
  fs.mkdirSync(path.join(sharedData, "raw"), { recursive: true });
  fs.mkdirSync(path.join(sharedData, "formatted"), { recursive: true });

  const config: GlobalConfig = {
    ...DEFAULT_GLOBAL_CONFIG,
    open_canvas_home: home,
    shared_data_dir: sharedData,
  };

  // Write config if it doesn't exist
  if (!fs.existsSync(configPath)) {
    const doc = new YAML.Document(config);
    fs.writeFileSync(configPath, doc.toString(), "utf-8");
  }

  return readGlobalConfig(home);
}

export function readGlobalConfig(home?: string): GlobalConfig {
  const configPath = home
    ? path.join(home, "global.yaml")
    : GLOBAL_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    return DEFAULT_GLOBAL_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(raw) as Partial<GlobalConfig>;
    return { ...DEFAULT_GLOBAL_CONFIG, ...parsed };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

export function writeGlobalConfig(config: GlobalConfig, home?: string): void {
  const h = home || config.open_canvas_home || OC_HOME;
  const configPath = path.join(h, "global.yaml");
  fs.mkdirSync(h, { recursive: true });
  const doc = new YAML.Document(config);
  fs.writeFileSync(configPath, doc.toString(), "utf-8");
}

// ── Project Registry ─────────────────────────────────────────────────────────

export function registerProject(
  projectPath: string,
  name?: string
): ProjectEntry {
  const config = readGlobalConfig();
  const absPath = path.resolve(projectPath);

  // Check if already registered
  const existing = config.projects.find((p) => p.path === absPath);
  if (existing) {
    existing.lastOpened = new Date().toISOString();
    writeGlobalConfig(config);
    return existing;
  }

  const entry: ProjectEntry = {
    name: name || path.basename(absPath),
    path: absPath,
    lastOpened: new Date().toISOString(),
  };

  config.projects.push(entry);
  writeGlobalConfig(config);
  return entry;
}

export function removeProject(projectPath: string): void {
  const config = readGlobalConfig();
  config.projects = config.projects.filter((p) => p.path !== projectPath);
  writeGlobalConfig(config);
}

export function listProjects(): ProjectEntry[] {
  const config = readGlobalConfig();
  return config.projects.sort(
    (a, b) =>
      new Date(b.lastOpened || 0).getTime() -
      new Date(a.lastOpened || 0).getTime()
  );
}

export function listSharedData(): { name: string; path: string; size: number }[] {
  if (!fs.existsSync(SHARED_DATA_DIR)) return [];
  try {
    return fs
      .readdirSync(SHARED_DATA_DIR, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && d.name !== "raw" && d.name !== "formatted")
      .map((d) => {
        const fullPath = path.join(SHARED_DATA_DIR, d.name);
        const stat = fs.statSync(fullPath);
        return { name: d.name, path: fullPath, size: stat.size };
      });
  } catch {
    return [];
  }
}

// ── Global Data Pipeline ─────────────────────────────────────────────────

interface GlobalDataFile {
  name: string;
  path: string;
  size: number;
  dir: "raw" | "formatted" | "root";
  formattedPath?: string; // path to formatted .md if it exists
}

export interface GlobalDataStatus {
  sharedDataDir: string;
  rawFiles: GlobalDataFile[];
  formattedFiles: GlobalDataFile[];
  rootFiles: GlobalDataFile[];
  totalFiles: number;
  hasSkillsMd: boolean;
  unformatted: string[]; // raw files with no matching formatted .md
}

function listDirFiles(dir: string, category: "raw" | "formatted" | "root", baseDir?: string): GlobalDataFile[] {
  if (!fs.existsSync(dir)) return [];
  const root = baseDir || dir;
  try {
    const results: GlobalDataFile[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const fullPath = path.join(dir, d.name);
      if (d.isFile()) {
        const stat = fs.statSync(fullPath);
        // Use relative path from root dir as display name for nested files
        const relName = root !== dir ? path.relative(root, fullPath) : d.name;
        results.push({ name: relName, path: fullPath, size: stat.size, dir: category });
      } else if (d.isDirectory() && category !== "root") {
        // Recurse into subdirectories for raw/formatted (not root level)
        results.push(...listDirFiles(fullPath, category, root));
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function ensureSharedDataDirs(): void {
  fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(SHARED_DATA_DIR, "raw"), { recursive: true });
  fs.mkdirSync(path.join(SHARED_DATA_DIR, "formatted"), { recursive: true });
}

export function getGlobalDataStatus(): GlobalDataStatus {
  // Auto-create shared-data dirs if missing
  ensureSharedDataDirs();

  const rawDir = path.join(SHARED_DATA_DIR, "raw");
  const formattedDir = path.join(SHARED_DATA_DIR, "formatted");

  const rawFiles = listDirFiles(rawDir, "raw");
  const formattedFiles = listDirFiles(formattedDir, "formatted");
  const rootFiles = listDirFiles(SHARED_DATA_DIR, "root").filter(
    (f) => f.name !== ".DS_Store" && f.name !== "skills.md"
  );

  const hasSkillsMd = fs.existsSync(path.join(SHARED_DATA_DIR, "skills.md"));

  // Build set of formatted base names (without .md extension)
  const formattedNames = new Set(
    formattedFiles.map((f) => f.name.replace(/\.md$/, ""))
  );

  // Find raw files that have no corresponding formatted version
  const unformatted = rawFiles
    .filter((f) => {
      const baseName = f.name.replace(/\.[^.]+$/, "");
      return !formattedNames.has(baseName);
    })
    .map((f) => f.name);

  // Annotate raw files with their formatted counterpart path if it exists
  for (const raw of rawFiles) {
    const baseName = raw.name.replace(/\.[^.]+$/, "");
    const fmtPath = path.join(formattedDir, baseName + ".md");
    if (fs.existsSync(fmtPath)) {
      raw.formattedPath = fmtPath;
    }
  }

  return {
    sharedDataDir: SHARED_DATA_DIR,
    rawFiles,
    formattedFiles,
    rootFiles,
    totalFiles: rawFiles.length + formattedFiles.length + rootFiles.length,
    hasSkillsMd,
    unformatted,
  };
}

/**
 * Link a global data file into a project.
 * Creates a reference file (symlink on unix, copy on windows) in the project's data/ dir.
 * Points to the formatted .md if available, otherwise the raw file.
 */
export function linkGlobalToProject(fileName: string, projectDataDir: string): string {
  const formattedDir = path.join(SHARED_DATA_DIR, "formatted");
  const rawDir = path.join(SHARED_DATA_DIR, "raw");

  const baseName = fileName.replace(/\.[^.]+$/, "");
  const formattedPath = path.join(formattedDir, baseName + ".md");
  const rawPath = path.join(rawDir, fileName);

  // Prefer formatted .md, fall back to raw
  const sourcePath = fs.existsSync(formattedPath) ? formattedPath : rawPath;
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Global file not found: ${fileName}`);
  }

  // Create project data dir if needed
  fs.mkdirSync(projectDataDir, { recursive: true });

  const linkName = fs.existsSync(formattedPath)
    ? baseName + ".md"
    : fileName;
  const targetPath = path.join(projectDataDir, linkName);

  // Create symlink (falls back to copy on error)
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    fs.symlinkSync(sourcePath, targetPath);
  } catch {
    // Symlink failed (e.g., Windows without dev mode) — fall back to copy
    fs.copyFileSync(sourcePath, targetPath);
  }

  return targetPath;
}
