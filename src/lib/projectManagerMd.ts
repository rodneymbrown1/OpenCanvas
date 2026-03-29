/**
 * Project Manager markdown context file.
 * Created in OC_HOME on first setup, evolves over time.
 */

import fs from "fs";
import path from "path";
import { OC_HOME } from "./globalConfig";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

export const PROJECT_MANAGER_MD_PATH = path.join(OC_HOME, "PROJECT_MANAGER.md");

const SEED_CONTENT = `# Project Manager Agent Context

You are the Project Manager for Open Canvas, coordinating across all registered projects.

## Capabilities
- Manage project registration, discovery, and lifecycle
- Coordinate cross-project actions and dependencies
- Route calendar events and action items to appropriate projects
- Track project health, status, and recent activity

## Registered Projects
<!-- Auto-updated as projects are added/removed -->

## Cross-Project Patterns
<!-- Evolves as the agent learns coordination patterns -->

## Conventions
- Each project has its own .open-canvas/ directory for project-specific config
- Global shared data lives in ~/.open-canvas/shared-data/
- Calendar events are globally scoped across all projects
- Agent handoffs between projects use AGENT_HANDOFF.md
`;

export function ensureProjectManagerMd(): void {
  if (!fs.existsSync(PROJECT_MANAGER_MD_PATH)) {
    fs.mkdirSync(path.dirname(PROJECT_MANAGER_MD_PATH), { recursive: true });
    atomicWrite(PROJECT_MANAGER_MD_PATH, SEED_CONTENT);
  }
}
