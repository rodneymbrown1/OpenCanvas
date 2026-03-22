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

export interface GlobalConfig {
  open_canvas_home: string;
  shared_data_dir: string;
  defaults: {
    agent: string;
    theme: string;
    stack: string;
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

  // Create directories
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(sharedData, { recursive: true });

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
      .filter((d) => !d.name.startsWith("."))
      .map((d) => {
        const fullPath = path.join(SHARED_DATA_DIR, d.name);
        const stat = fs.statSync(fullPath);
        return { name: d.name, path: fullPath, size: stat.size };
      });
  } catch {
    return [];
  }
}
