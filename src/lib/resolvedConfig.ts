import { readGlobalConfig } from "@/lib/globalConfig";
import { readProjectConfig, type OpenCanvasConfig } from "@/lib/config";

/**
 * Resolve the effective configuration for a project by merging:
 * 1. Hardcoded defaults
 * 2. Global config (~/.open-canvas/global.yaml)
 * 3. Project config ({workDir}/open-canvas.yaml) — highest priority
 */
export function resolvedConfig(workDir: string): Partial<OpenCanvasConfig> & {
  _global: { allowAllEdits: boolean };
} {
  const global = readGlobalConfig();
  const project = readProjectConfig(workDir);

  const defaults: Partial<OpenCanvasConfig> = {
    agent: {
      active: (global.defaults.agent as "claude" | "codex" | "gemini") || "claude",
      claude: {
        mode: "cli",
        permissions: { ...global.defaults.permissions },
      },
      codex: {
        mode: "cli",
        permissions: { ...global.defaults.permissions },
      },
      gemini: {
        mode: "cli",
        permissions: { ...global.defaults.permissions },
      },
    },
    preferences: {
      theme: global.defaults.theme || "dark",
      default_stack: global.defaults.stack || "nextjs-tailwind",
      persist_jobs: true,
    },
  };

  return {
    ...deepMerge(defaults, project),
    _global: {
      allowAllEdits: global.defaults.allowAllEdits ?? false,
    },
  };
}

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
