import path from "path";
import { ConfigManager } from "./ConfigManager";
import { RunConfigManager } from "./RunConfigManager";
import { SkillsManager } from "./SkillsManager";
import { ServiceManager } from "./ServiceManager";
import type { OpenCanvasConfig } from "./types";

/**
 * Class-based wrapper for per-project Open Canvas configuration.
 * Wraps the existing config.ts functions and composes with
 * RunConfigManager, SkillsManager, and ServiceManager.
 */
export class ProjectConfigManager extends ConfigManager<OpenCanvasConfig> {
  private workDir: string;

  constructor(workDir: string) {
    super(path.join(workDir, "open-canvas.yaml"));
    this.workDir = workDir;
  }

  getDefaults(): OpenCanvasConfig {
    return {
      workspace: { root: this.workDir },
      agent: {
        active: "claude",
        claude: { mode: "cli", permissions: { read: true, write: true, execute: true, web: false } },
        codex: { mode: "cli", permissions: { read: true, write: true, execute: true, web: false } },
        gemini: { mode: "cli", permissions: { read: true, write: true, execute: true, web: false } },
      },
      api_keys: {},
      mcp_servers: [],
      server: {
        port: 3000,
        pty_port: 3001,
        auth_token: "",
      },
      preferences: {
        persist_jobs: true,
        default_stack: "nextjs-tailwind",
        theme: "dark",
      },
    };
  }

  // ── Composed Managers ─────────────────────────────────────────────────

  /** Get the RunConfigManager for this project's run-config.yaml. */
  getRunConfig(): RunConfigManager {
    return new RunConfigManager(this.workDir);
  }

  /** Get the SkillsManager for this project's .open-canvas/ skills. */
  getSkills(): SkillsManager {
    return new SkillsManager("project", this.workDir);
  }

  /**
   * Get a ServiceManager for this project.
   * Reads run-config.yaml and uses the configured PTY port.
   */
  getServices(): ServiceManager | null {
    const runConfigMgr = this.getRunConfig();
    if (!runConfigMgr.exists()) return null;

    const runConfig = runConfigMgr.read();
    const projectConfig = this.read();
    const ptyPort = projectConfig.server?.pty_port || 3001;

    return new ServiceManager(runConfig, ptyPort);
  }

  // ── Convenience ───────────────────────────────────────────────────────

  /** Get the raw YAML content of open-canvas.yaml. */
  readRaw(): string {
    const fs = require("fs");
    if (!this.exists()) return "";
    try {
      return fs.readFileSync(this.configPath, "utf-8");
    } catch {
      return "";
    }
  }

  /** Write raw YAML content to open-canvas.yaml. */
  writeRaw(content: string): void {
    const fs = require("fs");
    fs.writeFileSync(this.configPath, content, "utf-8");
  }
}
