import fs from "fs";
import path from "path";
import YAML from "yaml";
import type { ValidationResult } from "./types";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * Abstract base class for YAML configuration management.
 * Encapsulates the read/write/merge pattern used across global and project configs.
 */
export abstract class ConfigManager<T extends object> {
  constructor(protected configPath: string) {}

  /** Return the default config when no file exists. */
  abstract getDefaults(): T;

  /** Optional schema validation. Override in subclasses for stricter checks. */
  validate(_config: T): ValidationResult {
    return { valid: true, errors: [] };
  }

  /** Check if the config file exists on disk. */
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /** Read and parse the YAML config, merging with defaults. */
  read(): T {
    if (!this.exists()) {
      return this.getDefaults();
    }
    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed = YAML.parse(raw) as Partial<T>;
      return this.merge(this.getDefaults(), parsed);
    } catch {
      return this.getDefaults();
    }
  }

  /** Write a config object to disk as YAML. */
  write(config: T): void {
    const doc = new YAML.Document(config);
    atomicWrite(this.configPath, doc.toString());
  }

  /** Read-modify-write pattern. */
  update(updater: (config: T) => T): T {
    const config = this.read();
    const updated = updater(config);
    this.write(updated);
    return updated;
  }

  /** Delete the config file from disk. */
  delete(): void {
    if (this.exists()) {
      fs.unlinkSync(this.configPath);
    }
  }

  /** Deep merge source into target, source wins. */
  protected merge(target: T, source: Partial<T>): T {
    return deepMerge(target, source) as T;
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
