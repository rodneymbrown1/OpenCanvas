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

const CONFIG_PATH = path.join(process.cwd(), "open-canvas.yaml");

export function readConfig(): OpenCanvasConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return YAML.parse(raw) as OpenCanvasConfig;
}

export function writeConfig(config: OpenCanvasConfig): void {
  const doc = new YAML.Document(config);
  fs.writeFileSync(CONFIG_PATH, doc.toString(), "utf-8");
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
