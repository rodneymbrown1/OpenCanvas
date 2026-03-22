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
