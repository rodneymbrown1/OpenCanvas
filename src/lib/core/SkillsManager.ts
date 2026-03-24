import fs from "fs";
import path from "path";
import type { SkillsScope } from "./types";
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
