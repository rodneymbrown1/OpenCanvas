import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import YAML from "yaml";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  path: string;
  lastOpened?: string;
  description?: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  color?: string;
  projectPaths: string[];
}

export type KanbanStatus = "todo" | "in-progress" | "done";

export interface KanbanItem {
  type: "project" | "group";
  id: string; // project path OR group UUID
}

export interface KanbanBoard {
  todo: KanbanItem[];
  "in-progress": KanbanItem[];
  done: KanbanItem[];
}

export interface GlobalPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  web: boolean;
}

export interface AppSettings {
  verbose_logging: boolean;
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
  app_settings: AppSettings;
  api_keys: Record<string, string>;
  projects: ProjectEntry[];
  groups?: ProjectGroup[];
  kanban?: KanbanBoard;
}

// ── Paths ────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
export const OC_HOME = path.join(HOME, ".open-canvas");
export const GLOBAL_CONFIG_PATH = path.join(OC_HOME, "global.yaml");
export const SHARED_DATA_DIR = path.join(OC_HOME, "shared-data");

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_APP_SETTINGS: AppSettings = {
  verbose_logging: false,
};

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
  app_settings: { ...DEFAULT_APP_SETTINGS },
  api_keys: {},
  projects: [],
  groups: [],
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
    atomicWrite(configPath, doc.toString());
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
    return {
      ...DEFAULT_GLOBAL_CONFIG,
      ...parsed,
      app_settings: { ...DEFAULT_APP_SETTINGS, ...parsed.app_settings },
    };
  } catch {
    return DEFAULT_GLOBAL_CONFIG;
  }
}

export function writeGlobalConfig(config: GlobalConfig, home?: string): void {
  const h = home || config.open_canvas_home || OC_HOME;
  const configPath = path.join(h, "global.yaml");
  const doc = new YAML.Document(config);
  atomicWrite(configPath, doc.toString());
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
  // Remove from any groups
  if (config.groups) {
    for (const group of config.groups) {
      group.projectPaths = group.projectPaths.filter((p) => p !== projectPath);
    }
  }
  // Remove from kanban board
  if (config.kanban) {
    for (const col of ["todo", "in-progress", "done"] as KanbanStatus[]) {
      config.kanban[col] = (config.kanban[col] ?? []).filter(
        (i) => !(i.type === "project" && i.id === projectPath)
      );
    }
  }
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

// ── Project Groups ────────────────────────────────────────────────────────────

export function listGroups(): ProjectGroup[] {
  const config = readGlobalConfig();
  return config.groups || [];
}

export function createGroup(name: string, color?: string): ProjectGroup {
  const config = readGlobalConfig();
  const group: ProjectGroup = {
    id: randomUUID(),
    name,
    color,
    projectPaths: [],
  };
  if (!config.groups) config.groups = [];
  config.groups.push(group);
  writeGlobalConfig(config);
  return group;
}

export function updateGroup(
  id: string,
  updates: Partial<Pick<ProjectGroup, "name" | "color">>
): ProjectGroup | null {
  const config = readGlobalConfig();
  if (!config.groups) return null;
  const group = config.groups.find((g) => g.id === id);
  if (!group) return null;
  if (updates.name !== undefined) group.name = updates.name;
  if (updates.color !== undefined) group.color = updates.color;
  writeGlobalConfig(config);
  return group;
}

export function deleteGroup(id: string): void {
  const config = readGlobalConfig();
  if (!config.groups) return;
  config.groups = config.groups.filter((g) => g.id !== id);
  // Remove from kanban board
  if (config.kanban) {
    for (const col of ["todo", "in-progress", "done"] as KanbanStatus[]) {
      config.kanban[col] = (config.kanban[col] ?? []).filter(
        (i) => !(i.type === "group" && i.id === id)
      );
    }
  }
  writeGlobalConfig(config);
}

export function addProjectToGroup(groupId: string, projectPath: string): boolean {
  const config = readGlobalConfig();
  if (!config.groups) return false;
  // Remove from any other group first (a project can only be in one group)
  for (const group of config.groups) {
    group.projectPaths = group.projectPaths.filter((p) => p !== projectPath);
  }
  const target = config.groups.find((g) => g.id === groupId);
  if (!target) return false;
  target.projectPaths.push(projectPath);
  writeGlobalConfig(config);
  return true;
}

export function removeProjectFromGroup(groupId: string, projectPath: string): boolean {
  const config = readGlobalConfig();
  if (!config.groups) return false;
  const group = config.groups.find((g) => g.id === groupId);
  if (!group) return false;
  group.projectPaths = group.projectPaths.filter((p) => p !== projectPath);
  writeGlobalConfig(config);
  return true;
}

// ── Kanban Board ──────────────────────────────────────────────────────────────

const EMPTY_KANBAN: KanbanBoard = { todo: [], "in-progress": [], done: [] };
const KANBAN_COLS: KanbanStatus[] = ["todo", "in-progress", "done"];

/**
 * Read the kanban board, automatically stripping stale references to
 * projects or groups that no longer exist in the registry.
 */
export function getKanban(): KanbanBoard {
  const config = readGlobalConfig();
  const raw = config.kanban ?? EMPTY_KANBAN;

  const validPaths = new Set(config.projects.map((p) => p.path));
  const validGroupIds = new Set((config.groups ?? []).map((g) => g.id));

  const clean = (items: KanbanItem[]): KanbanItem[] =>
    (items ?? []).filter((i) =>
      i.type === "project" ? validPaths.has(i.id) : validGroupIds.has(i.id)
    );

  return {
    todo: clean(raw.todo),
    "in-progress": clean(raw["in-progress"]),
    done: clean(raw.done),
  };
}

/**
 * Add, move, or remove an item from the kanban board.
 * Passing status=null removes the item from all columns.
 * A project/group can only occupy one column at a time.
 */
export function setKanbanItemStatus(item: KanbanItem, status: KanbanStatus | null): void {
  const config = readGlobalConfig();
  if (!config.kanban) config.kanban = { ...EMPTY_KANBAN, todo: [], "in-progress": [], done: [] };

  // Remove from every column first
  for (const col of KANBAN_COLS) {
    config.kanban[col] = (config.kanban[col] ?? []).filter(
      (i) => !(i.type === item.type && i.id === item.id)
    );
  }

  // Add to target column
  if (status) {
    config.kanban[status].push(item);
  }

  writeGlobalConfig(config);
}

/**
 * Reorder an item within a single kanban column.
 */
export function reorderKanbanColumn(
  status: KanbanStatus,
  fromIndex: number,
  toIndex: number
): void {
  const config = readGlobalConfig();
  if (!config.kanban) return;
  const col = config.kanban[status];
  if (!col || fromIndex < 0 || toIndex < 0 || fromIndex >= col.length || toIndex >= col.length) return;
  const [item] = col.splice(fromIndex, 1);
  col.splice(toIndex, 0, item);
  writeGlobalConfig(config);
}
