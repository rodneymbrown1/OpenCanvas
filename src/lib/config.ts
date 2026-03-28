import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface AgentPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  web: boolean;
}

export interface AgentConfig {
  mode: "cli" | "api";
  permissions: AgentPermissions;
  dangerouslyAllowEdits?: boolean;
}

export interface McpServer {
  name: string;
  command: string;
  args: string[];
}

export interface SessionConfig {
  lastSessionId: string | null;
  lastAgent: string;
  lastWorkDir: string;
  connectedAt: string | null;
}

export interface OpenCanvasConfig {
  workspace: { root: string };
  agent: {
    active: "claude" | "codex" | "gemini";
    claude: AgentConfig;
    codex: AgentConfig;
    gemini: AgentConfig;
  };
  api_keys: Record<string, string>;
  mcp_servers: McpServer[];
  server: {
    port: number;
    pty_port: number;
    auth_token: string;
  };
  preferences: {
    persist_jobs: boolean;
    default_stack: string;
    theme: string;
  };
  session?: SessionConfig;
}

// ── Hardcoded Defaults ────────────────────────────────────────────────────
// These are the baseline — no file on disk needed.

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");

const DEFAULT_AGENT: AgentConfig = {
  mode: "cli",
  permissions: { read: true, write: true, execute: true, web: true },
  dangerouslyAllowEdits: false,
};

export const DEFAULT_APP_CONFIG: OpenCanvasConfig = {
  workspace: { root: path.join(OC_HOME, "projects") },
  agent: {
    active: "claude",
    claude: { ...DEFAULT_AGENT, dangerouslyAllowEdits: true },
    codex: { ...DEFAULT_AGENT },
    gemini: { ...DEFAULT_AGENT },
  },
  api_keys: {},
  mcp_servers: [],
  server: { port: 3000, pty_port: 3001, auth_token: "" },
  preferences: { persist_jobs: true, default_stack: "", theme: "light" },
  session: {
    lastSessionId: null,
    lastAgent: "claude",
    lastWorkDir: path.join(OC_HOME, "projects"),
    connectedAt: null,
  },
};

// ── Runtime cache file lives in ~/.open-canvas/ (never in the repo) ───────

export const APP_CONFIG_CACHE_PATH = path.join(OC_HOME, "app-config.yaml");

// Cache parsed config — writeConfig() invalidates.
let _configCache: OpenCanvasConfig | null = null;
let _configMtime = 0;

/**
 * Deep merge source into target (source wins for scalars, recurse for objects).
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      (result as any)[key] = deepMerge(tv as any, sv as any);
    } else if (sv !== undefined) {
      (result as any)[key] = sv;
    }
  }
  return result;
}

/**
 * Read the app config.
 * Built from: hardcoded defaults ← ~/.open-canvas/app-config.yaml overrides.
 * If the cache file doesn't exist, returns pure defaults (no file required).
 */
export function readConfig(): OpenCanvasConfig {
  // Check if the cache file exists
  if (!fs.existsSync(APP_CONFIG_CACHE_PATH)) {
    if (!_configCache) _configCache = { ...DEFAULT_APP_CONFIG };
    return _configCache;
  }

  try {
    const stat = fs.statSync(APP_CONFIG_CACHE_PATH);
    const mtime = stat.mtimeMs;
    if (_configCache && mtime === _configMtime) {
      return _configCache;
    }
    const raw = fs.readFileSync(APP_CONFIG_CACHE_PATH, "utf-8");
    const overrides = (YAML.parse(raw) as Partial<OpenCanvasConfig>) || {};
    _configCache = deepMerge(DEFAULT_APP_CONFIG, overrides);
    _configMtime = mtime;
    return _configCache;
  } catch {
    _configCache = { ...DEFAULT_APP_CONFIG };
    return _configCache;
  }
}

/**
 * Write config to the cache file at ~/.open-canvas/app-config.yaml.
 * Only user overrides and runtime state are persisted — never in the repo.
 */
export function writeConfig(config: OpenCanvasConfig): void {
  fs.mkdirSync(OC_HOME, { recursive: true });
  const doc = new YAML.Document(config);
  fs.writeFileSync(APP_CONFIG_CACHE_PATH, doc.toString(), "utf-8");
  _configCache = null;
  _configMtime = 0;
}

export function updateConfig(
  updater: (config: OpenCanvasConfig) => OpenCanvasConfig
): OpenCanvasConfig {
  const config = readConfig();
  const updated = updater(config);
  writeConfig(updated);
  return updated;
}

// ── Per-Project Config ────────────────────────────────────────────────────

export function projectConfigPath(workDir: string): string {
  return path.join(workDir, "open-canvas.yaml");
}

export function readProjectConfig(workDir: string): Partial<OpenCanvasConfig> {
  const p = projectConfigPath(workDir);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return (YAML.parse(raw) as Partial<OpenCanvasConfig>) || {};
  } catch {
    return {};
  }
}

export function readProjectConfigRaw(workDir: string): string {
  const p = projectConfigPath(workDir);
  if (!fs.existsSync(p)) return "";
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

export function writeProjectConfig(workDir: string, config: Partial<OpenCanvasConfig>): void {
  const p = projectConfigPath(workDir);
  const doc = new YAML.Document(config);
  fs.writeFileSync(p, doc.toString(), "utf-8");
}

export function writeProjectConfigRaw(workDir: string, content: string): void {
  const p = projectConfigPath(workDir);
  fs.writeFileSync(p, content, "utf-8");
}

export function updateProjectConfig(
  workDir: string,
  updater: (config: Partial<OpenCanvasConfig>) => Partial<OpenCanvasConfig>
): Partial<OpenCanvasConfig> {
  const config = readProjectConfig(workDir);
  const updated = updater(config);
  writeProjectConfig(workDir, updated);
  return updated;
}
