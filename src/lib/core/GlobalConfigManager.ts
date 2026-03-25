import fs from "fs";
import path from "path";
import { ConfigManager } from "./ConfigManager";
import { SkillsManager } from "./SkillsManager";
import type { GlobalConfig, ProjectEntry } from "./types";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const DEFAULT_OC_HOME = path.join(HOME, ".open-canvas");
const DEFAULT_SHARED_DATA = path.join(DEFAULT_OC_HOME, "shared-data");

/**
 * Class-based wrapper for global Open Canvas configuration.
 * Wraps the existing globalConfig.ts functions as methods on a class
 * that extends the ConfigManager base.
 */
export class GlobalConfigManager extends ConfigManager<GlobalConfig> {
  private home: string;

  constructor(home?: string) {
    const h = home || DEFAULT_OC_HOME;
    super(path.join(h, "global.yaml"));
    this.home = h;
  }

  getDefaults(): GlobalConfig {
    return {
      open_canvas_home: this.home,
      shared_data_dir: path.join(this.home, "shared-data"),
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
      app_settings: { verbose_logging: false },
      api_keys: {},
      projects: [],
    };
  }

  // ── Setup ─────────────────────────────────────────────────────────────

  setup(): GlobalConfig {
    const sharedData = path.join(this.home, "shared-data");

    fs.mkdirSync(this.home, { recursive: true });
    fs.mkdirSync(sharedData, { recursive: true });
    fs.mkdirSync(path.join(sharedData, "raw"), { recursive: true });
    fs.mkdirSync(path.join(sharedData, "formatted"), { recursive: true });

    if (!this.exists()) {
      this.write(this.getDefaults());
    }

    return this.read();
  }

  // ── Project Registry ──────────────────────────────────────────────────

  registerProject(projectPath: string, name?: string): ProjectEntry {
    const absPath = path.resolve(projectPath);
    return this.update((config) => {
      const existing = config.projects.find((p) => p.path === absPath);
      if (existing) {
        existing.lastOpened = new Date().toISOString();
        return config;
      }
      config.projects.push({
        name: name || path.basename(absPath),
        path: absPath,
        lastOpened: new Date().toISOString(),
      });
      return config;
    }).projects.find((p) => p.path === absPath)!;
  }

  removeProject(projectPath: string): void {
    this.update((config) => {
      config.projects = config.projects.filter((p) => p.path !== projectPath);
      return config;
    });
  }

  listProjects(): ProjectEntry[] {
    return this.read().projects.sort(
      (a, b) =>
        new Date(b.lastOpened || 0).getTime() -
        new Date(a.lastOpened || 0).getTime()
    );
  }

  // ── Skills ────────────────────────────────────────────────────────────

  getSkills(): SkillsManager {
    const config = this.read();
    return new SkillsManager("global", config.shared_data_dir || DEFAULT_SHARED_DATA);
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  get ocHome(): string {
    return this.home;
  }

  get sharedDataDir(): string {
    return this.read().shared_data_dir || DEFAULT_SHARED_DATA;
  }
}
