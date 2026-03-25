import fs from "fs";
import path from "path";
import type { SkillsScope, RunConfig } from "./types";
import { SHARED_DATA_DIR } from "@/lib/globalConfig";

const PROJECT_DIR_NAME = ".open-canvas";
const SKILLS_FILENAME = "skills.md";
const PROJECT_DOC_FILENAME = "PROJECT.md";
const GLOBAL_DATA_FILENAME = "GLOBAL_DATA.md";

// ── Templates ───────────────────────────────────────────────────────────────

const PROJECT_SKILLS_TEMPLATE = `# Project Skills

> This file is maintained by coding agents. It documents conventions,
> patterns, and instructions specific to this project.

## Stack

<!-- Agents: fill in the tech stack as you discover or set it up -->

## Conventions

<!-- Agents: document coding conventions, naming patterns, etc. -->

## Architecture

<!-- Agents: document key architectural decisions -->

## Open Canvas Integration

This project is managed by Open Canvas. You have access to shared services.

### Settings & Config
- Global config: \`~/.open-canvas/global.yaml\`
- Calendar data: \`~/.open-canvas/calendar/\`
- Shared data: \`~/.open-canvas/shared-data/\`
- PTY server: \`http://localhost:3001\`

### Adding API Keys
To add an API key to Open Canvas, send a PATCH request:
\`\`\`
PATCH http://localhost:3001/api/config/api-keys
Content-Type: application/json
{"api_keys": {"key_name": "key_value"}}
\`\`\`
The key will appear in Settings > API Keys and be available to all projects.

### Calendar Operations
- Create event: \`POST /api/calendar\` with \`{action: "create", event: {title, startTime, ...}}\`
- List events: \`GET /api/calendar\`
- Filter by project: \`GET /api/calendar?project={workDir}\`

### Calendar Connections
- List connections: \`GET /api/calendar/connections\`
- Initiate OAuth: \`POST /api/calendar/connections\` with \`{action: "initiate-oauth", provider: "google"}\`
- Sync: \`POST /api/calendar/sync\` with \`{action: "sync"}\`

To connect Google Calendar, the user needs \`google_calendar_client_id\` and \`google_calendar_client_secret\` in API Keys.
`;

const PROJECT_DOC_TEMPLATE = `# Project Documentation

> This file is maintained by coding agents. It documents the project's
> architecture, setup, and current state.

## Overview

<!-- Agents: describe what this project does -->

## Structure

<!-- Agents: document the directory structure and key files -->

## Development

<!-- Agents: document how to work with this project -->
`;

const GLOBAL_DATA_TEMPLATE = `# Global Data

> This file is shared across all projects. Agents can modify it when
> instructed to update global data.

## Shared Context

<!-- Add any context that should be available to all projects -->

## Notes

<!-- Add cross-project notes here -->
`;

/**
 * Manages skills.md and PROJECT.md files at both global and project scope.
 * Agents read and write these files to document and learn project conventions.
 */
export class SkillsManager {
  private scope: SkillsScope;
  private basePath: string;

  constructor(scope: SkillsScope, basePath: string) {
    this.scope = scope;
    // Global scope uses shared-data dir directly
    // Project scope uses {projectRoot}/.open-canvas/
    this.basePath = scope === "global" ? basePath : path.join(basePath, PROJECT_DIR_NAME);
  }

  // ── Skills.md ───────────────────────────────────────────────────────────

  get skillsPath(): string {
    return path.join(this.basePath, SKILLS_FILENAME);
  }

  readSkills(): string {
    if (!fs.existsSync(this.skillsPath)) return "";
    try {
      return fs.readFileSync(this.skillsPath, "utf-8");
    } catch {
      return "";
    }
  }

  writeSkills(content: string): void {
    fs.mkdirSync(this.basePath, { recursive: true });
    fs.writeFileSync(this.skillsPath, content, "utf-8");
  }

  /** Append a section to skills.md under a heading. Creates the heading if it doesn't exist. */
  appendSection(heading: string, content: string): void {
    let existing = this.readSkills();
    const headingLine = `## ${heading}`;

    if (existing.includes(headingLine)) {
      // Find the heading and append content before the next heading or end of file
      const headingIdx = existing.indexOf(headingLine);
      const afterHeading = existing.indexOf("\n## ", headingIdx + headingLine.length);
      const insertIdx = afterHeading === -1 ? existing.length : afterHeading;
      existing =
        existing.slice(0, insertIdx).trimEnd() +
        "\n\n" +
        content.trim() +
        "\n" +
        existing.slice(insertIdx);
    } else {
      // Append new section at end
      existing = existing.trimEnd() + "\n\n" + headingLine + "\n\n" + content.trim() + "\n";
    }

    this.writeSkills(existing);
  }

  skillsExist(): boolean {
    return fs.existsSync(this.skillsPath);
  }

  // ── PROJECT.md (project scope only) ─────────────────────────────────────

  get projectDocPath(): string {
    return path.join(this.basePath, PROJECT_DOC_FILENAME);
  }

  readProjectDoc(): string {
    if (this.scope === "global") return "";
    if (!fs.existsSync(this.projectDocPath)) return "";
    try {
      return fs.readFileSync(this.projectDocPath, "utf-8");
    } catch {
      return "";
    }
  }

  writeProjectDoc(content: string): void {
    if (this.scope === "global") return;
    fs.mkdirSync(this.basePath, { recursive: true });
    fs.writeFileSync(this.projectDocPath, content, "utf-8");
  }

  projectDocExists(): boolean {
    return this.scope === "project" && fs.existsSync(this.projectDocPath);
  }

  // ── GLOBAL_DATA.md (global scope only) ──────────────────────────────────

  get globalDataPath(): string {
    return path.join(
      this.scope === "global" ? this.basePath : SHARED_DATA_DIR,
      GLOBAL_DATA_FILENAME
    );
  }

  readGlobalData(): string {
    if (!fs.existsSync(this.globalDataPath)) return "";
    try {
      return fs.readFileSync(this.globalDataPath, "utf-8");
    } catch {
      return "";
    }
  }

  writeGlobalData(content: string): void {
    const dir = path.dirname(this.globalDataPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.globalDataPath, content, "utf-8");
  }

  globalDataExists(): boolean {
    return fs.existsSync(this.globalDataPath);
  }

  // ── Run Section Generation ──────────────────────────────────────────────

  /**
   * Generate a "Running the App" section from a RunConfig.
   * Documents each service with its command, port, dependencies, and env.
   */
  static generateRunSection(runConfig: RunConfig): string {
    const lines: string[] = [];
    const serviceNames = Object.keys(runConfig.services);

    if (serviceNames.length === 0) {
      return "No runnable services detected.";
    }

    lines.push(`Project: **${runConfig.project_name}**`);
    lines.push("");

    // Compute start order via simple topo sort
    const order = SkillsManager.simpleTopoSort(runConfig.services);
    if (order.length > 1) {
      lines.push(`**Start order:** ${order.join(" → ")}`);
      lines.push("");
    }

    for (const name of order) {
      const svc = runConfig.services[name];
      if (!svc) continue;

      lines.push(`### ${name} (${svc.type})`);
      lines.push("");
      lines.push("```bash");
      if (svc.cwd && svc.cwd !== ".") {
        lines.push(`cd ${svc.cwd}`);
      }
      lines.push(svc.command);
      lines.push("```");
      lines.push("");

      if (svc.port) {
        lines.push(`- **Port:** ${svc.port}`);
      }
      if (svc.depends_on && svc.depends_on.length > 0) {
        lines.push(`- **Depends on:** ${svc.depends_on.join(", ")}`);
      }
      if (svc.env && Object.keys(svc.env).length > 0) {
        lines.push(`- **Environment:** ${Object.entries(svc.env).map(([k, v]) => `\`${k}=${v}\``).join(", ")}`);
      }
      if (svc.ready_pattern) {
        lines.push(`- **Ready when output matches:** \`${svc.ready_pattern}\``);
      }
      lines.push("");
    }

    if (runConfig.environment?.required_tools?.length) {
      lines.push(`**Required tools:** ${runConfig.environment.required_tools.join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private static simpleTopoSort(services: Record<string, { depends_on?: string[] }>): string[] {
    const names = Object.keys(services);
    const visited = new Set<string>();
    const result: string[] = [];
    const visit = (name: string, stack: Set<string>) => {
      if (visited.has(name) || stack.has(name)) return;
      stack.add(name);
      for (const dep of services[name]?.depends_on || []) {
        if (services[dep]) visit(dep, stack);
      }
      stack.delete(name);
      visited.add(name);
      result.push(name);
    };
    for (const name of names) visit(name, new Set());
    return result;
  }

  // ── Ensure Files ────────────────────────────────────────────────────────

  /** Create skeleton files if they don't exist. */
  ensureFiles(): void {
    fs.mkdirSync(this.basePath, { recursive: true });

    if (!this.skillsExist()) {
      this.writeSkills(
        this.scope === "global" ? "# Global Skills\n\n" : PROJECT_SKILLS_TEMPLATE
      );
    }

    if (this.scope === "project" && !this.projectDocExists()) {
      this.writeProjectDoc(PROJECT_DOC_TEMPLATE);
    }

    if (this.scope === "global" && !this.globalDataExists()) {
      this.writeGlobalData(GLOBAL_DATA_TEMPLATE);
    }
  }
}
