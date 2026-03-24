import fs from "fs";
import path from "path";
import { ConfigManager } from "./ConfigManager";
import type {
  RunConfig,
  ServiceDef,
  ServiceType,
  ServiceTopology,
  ValidationResult,
} from "./types";

const RUN_CONFIG_FILENAME = "run-config.yaml";
const CURRENT_VERSION = 1;

/**
 * Manages run-config.yaml — the standardized service topology and run commands
 * for a project. Agents create and update this file as they build out services.
 */
export class RunConfigManager extends ConfigManager<RunConfig> {
  private workDir: string;

  constructor(workDir: string) {
    super(path.join(workDir, RUN_CONFIG_FILENAME));
    this.workDir = workDir;
  }

  getDefaults(): RunConfig {
    return {
      version: CURRENT_VERSION,
      project_name: path.basename(this.workDir),
      services: {},
    };
  }

  validate(config: RunConfig): ValidationResult {
    const errors: string[] = [];

    if (!config.version || config.version < 1) {
      errors.push("version must be >= 1");
    }
    if (!config.project_name) {
      errors.push("project_name is required");
    }

    const serviceNames = new Set(Object.keys(config.services));
    for (const [name, svc] of Object.entries(config.services)) {
      if (!svc.command) errors.push(`service "${name}": command is required`);
      if (!svc.cwd) errors.push(`service "${name}": cwd is required`);
      if (!svc.type) errors.push(`service "${name}": type is required`);
      if (svc.depends_on) {
        for (const dep of svc.depends_on) {
          if (!serviceNames.has(dep)) {
            errors.push(`service "${name}": depends_on "${dep}" not found`);
          }
        }
      }
    }

    // Check for circular dependencies
    if (errors.length === 0) {
      const cycle = this.detectCycle(config.services);
      if (cycle) {
        errors.push(`circular dependency detected: ${cycle}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Service CRUD ────────────────────────────────────────────────────────

  addService(name: string, service: ServiceDef): RunConfig {
    return this.update((config) => {
      config.services[name] = service;
      config.metadata = {
        ...config.metadata,
        last_modified_by: "agent",
        last_modified_at: new Date().toISOString(),
        created_by: config.metadata?.created_by || "agent",
        created_at: config.metadata?.created_at || new Date().toISOString(),
      };
      return config;
    });
  }

  removeService(name: string): RunConfig {
    return this.update((config) => {
      delete config.services[name];
      // Remove from other services' depends_on
      for (const svc of Object.values(config.services)) {
        if (svc.depends_on) {
          svc.depends_on = svc.depends_on.filter((d) => d !== name);
        }
      }
      return config;
    });
  }

  // ── Dependency Graph ────────────────────────────────────────────────────

  /** Topological sort of services based on depends_on. */
  getStartOrder(): string[] {
    const config = this.read();
    return this.topologicalSort(config.services);
  }

  /** Get the full service topology (definitions + computed start order). */
  getTopology(): ServiceTopology {
    const config = this.read();
    return {
      services: config.services,
      startOrder: this.topologicalSort(config.services),
    };
  }

  // ── Auto-Detection ──────────────────────────────────────────────────────

  /**
   * Scan the project filesystem to detect services and generate a RunConfig.
   * Enhanced version of the old `detectStartCommand()` from pty-server.mjs.
   * Detects multiple services (frontend, backend, database configs, etc.).
   */
  detectServices(): RunConfig {
    const config = this.getDefaults();
    const services: Record<string, ServiceDef> = {};

    // Scan root and immediate subdirectories for recognizable project files
    const rootEntries = this.safeReaddir(this.workDir);

    // Check root-level package.json
    const rootPkg = this.readPackageJson(this.workDir);
    if (rootPkg) {
      const rootService = this.packageJsonToService(rootPkg, ".");
      if (rootService) {
        services[rootService.name] = rootService.def;
      }
    }

    // Check subdirectories
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const subDir = path.join(this.workDir, entry.name);

      // Node.js project
      const pkg = this.readPackageJson(subDir);
      if (pkg) {
        const svc = this.packageJsonToService(pkg, entry.name);
        if (svc) services[svc.name] = svc.def;
        continue;
      }

      // Python (Django/FastAPI/Flask)
      if (this.detectPython(subDir, entry.name, services)) continue;

      // Rust
      if (fs.existsSync(path.join(subDir, "Cargo.toml"))) {
        services[entry.name] = {
          type: "api",
          command: "cargo run",
          cwd: entry.name,
        };
        continue;
      }

      // Go
      if (fs.existsSync(path.join(subDir, "go.mod"))) {
        services[entry.name] = {
          type: "api",
          command: "go run .",
          cwd: entry.name,
        };
        continue;
      }
    }

    // Also check root-level Python/Rust/Go if no package.json found at root
    if (!rootPkg) {
      this.detectPython(this.workDir, ".", services);
      if (fs.existsSync(path.join(this.workDir, "Cargo.toml"))) {
        services["app"] = { type: "api", command: "cargo run", cwd: "." };
      }
      if (fs.existsSync(path.join(this.workDir, "go.mod"))) {
        services["app"] = { type: "api", command: "go run .", cwd: "." };
      }
    }

    // Docker Compose
    const composeFile = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]
      .find((f) => fs.existsSync(path.join(this.workDir, f)));
    if (composeFile) {
      // Don't auto-add docker compose if we already found individual services
      // But note it in environment
      config.environment = {
        ...config.environment,
        required_tools: [...(config.environment?.required_tools || []), "docker"],
      };
    }

    // Infer dependencies: if there's a "backend"/"api" and a "frontend"/"client", frontend depends on backend
    const backendNames = Object.entries(services)
      .filter(([, s]) => s.type === "api" || s.type === "database")
      .map(([n]) => n);
    for (const [name, svc] of Object.entries(services)) {
      if (svc.type === "web" && backendNames.length > 0) {
        svc.depends_on = backendNames;
      }
    }

    config.services = services;
    config.metadata = {
      created_by: "auto-detect",
      created_at: new Date().toISOString(),
      last_modified_by: "auto-detect",
      last_modified_at: new Date().toISOString(),
    };

    return config;
  }

  /** Detect services and write run-config.yaml. Returns the generated config. */
  detectAndWrite(): RunConfig {
    const config = this.detectServices();
    if (Object.keys(config.services).length > 0) {
      this.write(config);
    }
    return config;
  }

  // ── Agent Prompt Serialization ──────────────────────────────────────────

  /** Serialize the run config to a human/agent-readable format. */
  toAgentPrompt(): string {
    const config = this.read();
    const lines: string[] = [
      `# Run Configuration: ${config.project_name}`,
      "",
    ];

    const order = this.topologicalSort(config.services);
    if (order.length === 0) {
      lines.push("No services configured.");
      return lines.join("\n");
    }

    lines.push(`Start order: ${order.join(" → ")}`, "");

    for (const name of order) {
      const svc = config.services[name];
      lines.push(`## ${name} (${svc.type})`);
      lines.push(`  command: ${svc.command}`);
      lines.push(`  cwd: ${svc.cwd}`);
      if (svc.port) lines.push(`  port: ${svc.port}`);
      if (svc.depends_on?.length) lines.push(`  depends_on: ${svc.depends_on.join(", ")}`);
      if (svc.env) {
        lines.push(`  env:`);
        for (const [k, v] of Object.entries(svc.env)) {
          lines.push(`    ${k}=${v}`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private readPackageJson(dir: string): Record<string, unknown> | null {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      return null;
    }
  }

  private packageJsonToService(
    pkg: Record<string, unknown>,
    relDir: string
  ): { name: string; def: ServiceDef } | null {
    const scripts = (pkg.scripts || {}) as Record<string, string>;
    const deps = {
      ...(pkg.dependencies as Record<string, string> || {}),
      ...(pkg.devDependencies as Record<string, string> || {}),
    };

    // Determine service type
    let type: ServiceType = "web";
    let command = "";

    const isNext = "next" in deps;
    const isReact = "react" in deps && !isNext;
    const isVite = "vite" in deps;
    const isExpress = "express" in deps;
    const isFastify = "fastify" in deps;
    const isNest = "@nestjs/core" in deps;

    if (isExpress || isFastify || isNest) {
      type = "api";
    } else if (isNext || isReact || isVite) {
      type = "web";
    }

    // Determine start command
    if (scripts.dev) {
      command = "npm run dev";
    } else if (scripts.start) {
      command = "npm start";
    } else {
      return null; // No runnable scripts
    }

    // Derive a service name from the directory or package name
    const name = relDir === "."
      ? (type === "api" ? "backend" : "frontend")
      : path.basename(relDir);

    return {
      name,
      def: { type, command, cwd: relDir },
    };
  }

  private detectPython(
    dir: string,
    relDir: string,
    services: Record<string, ServiceDef>
  ): boolean {
    // Django
    if (fs.existsSync(path.join(dir, "manage.py"))) {
      const name = relDir === "." ? "backend" : path.basename(relDir);
      services[name] = {
        type: "api",
        command: "python manage.py runserver",
        cwd: relDir,
        port: 8000,
      };
      return true;
    }

    // FastAPI / Flask — look for app/main.py or app.py
    const mainPy = [
      path.join(dir, "app", "main.py"),
      path.join(dir, "main.py"),
      path.join(dir, "app.py"),
    ].find((p) => fs.existsSync(p));

    if (mainPy) {
      const content = fs.readFileSync(mainPy, "utf-8");
      const isFastAPI = content.includes("FastAPI") || content.includes("fastapi");
      const isFlask = content.includes("Flask") || content.includes("flask");

      if (isFastAPI) {
        const modulePath = mainPy.endsWith("app/main.py") ? "app.main:app" : "main:app";
        const name = relDir === "." ? "backend" : path.basename(relDir);
        services[name] = {
          type: "api",
          command: `uvicorn ${modulePath} --reload`,
          cwd: relDir,
          port: 8000,
        };
        return true;
      }

      if (isFlask) {
        const name = relDir === "." ? "backend" : path.basename(relDir);
        services[name] = {
          type: "api",
          command: "flask run",
          cwd: relDir,
          port: 5000,
        };
        return true;
      }
    }

    return false;
  }

  private safeReaddir(dir: string): fs.Dirent[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private topologicalSort(services: Record<string, ServiceDef>): string[] {
    const names = Object.keys(services);
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (name: string, stack: Set<string>) => {
      if (visited.has(name)) return;
      if (stack.has(name)) return; // cycle — skip
      stack.add(name);

      const deps = services[name]?.depends_on || [];
      for (const dep of deps) {
        if (services[dep]) visit(dep, stack);
      }

      stack.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of names) {
      visit(name, new Set());
    }

    return result;
  }

  private detectCycle(services: Record<string, ServiceDef>): string | null {
    const names = Object.keys(services);
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const visit = (name: string, path: string[]): string | null => {
      if (inStack.has(name)) {
        const cycleStart = path.indexOf(name);
        return [...path.slice(cycleStart), name].join(" → ");
      }
      if (visited.has(name)) return null;

      visited.add(name);
      inStack.add(name);
      path.push(name);

      for (const dep of services[name]?.depends_on || []) {
        if (services[dep]) {
          const cycle = visit(dep, path);
          if (cycle) return cycle;
        }
      }

      inStack.delete(name);
      path.pop();
      return null;
    };

    for (const name of names) {
      const cycle = visit(name, []);
      if (cycle) return cycle;
    }

    return null;
  }
}
