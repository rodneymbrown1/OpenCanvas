import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

const HANDOFF_DIR = ".open-canvas";
const HANDOFF_FILE = "AGENT_HANDOFF.md";

/**
 * Generate a context handoff file when switching between coding agents.
 * This file helps the new agent understand what was happening in the project.
 */
export async function generateContextHandoff(
  workDir: string,
  fromAgent: string,
  toAgent: string,
  fromSessionId?: string,
  ptyPort: number = 40001
): Promise<string> {
  const handoffDir = path.join(workDir, HANDOFF_DIR);
  fs.mkdirSync(handoffDir, { recursive: true });

  const sections: string[] = [];

  // Header
  sections.push(`# Agent Handoff: ${fromAgent} → ${toAgent}`);
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push(`Project: ${path.basename(workDir)}`);
  sections.push(`Path: ${workDir}`);
  sections.push("");

  // Git status
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    sections.push(`## Current Branch`);
    sections.push(`\`${branch}\``);
    sections.push("");

    const status = execSync("git status --short", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (status) {
      sections.push(`## Uncommitted Changes`);
      sections.push("```");
      sections.push(status);
      sections.push("```");
      sections.push("");
    }

    const recentCommits = execSync("git log --oneline -5", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (recentCommits) {
      sections.push(`## Recent Commits`);
      sections.push("```");
      sections.push(recentCommits);
      sections.push("```");
      sections.push("");
    }

    const diffNames = execSync("git diff --name-only HEAD", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (diffNames) {
      sections.push(`## Recently Modified Files`);
      sections.push("```");
      sections.push(diffNames);
      sections.push("```");
      sections.push("");
    }
  } catch {
    sections.push(`## Git Status`);
    sections.push("_Not a git repository or git not available_");
    sections.push("");
  }

  // Previous agent's last output
  if (fromSessionId) {
    try {
      const res = await fetch(
        `http://localhost:${ptyPort}/sessions/${fromSessionId}`
      );
      if (res.ok) {
        const data = await res.json();
        const lastOutput = data.session?.lastOutput;
        if (lastOutput && lastOutput.length > 0) {
          sections.push(`## Last Output from ${fromAgent}`);
          sections.push("```");
          sections.push(lastOutput.join("\n"));
          sections.push("```");
          sections.push("");
        }
      }
    } catch {
      // PTY server not reachable — skip
    }
  }

  // Reference existing context files
  const contextFiles = [
    "CLAUDE.md",
    "GEMINI.md",
    ".cursorrules",
    "skills.md",
    "PROJECT_CONTEXT.md",
    "README.md",
  ];
  const found: string[] = [];
  for (const f of contextFiles) {
    const fp = path.join(workDir, f);
    if (fs.existsSync(fp)) found.push(f);
    // Also check .open-canvas subdirectory
    const fp2 = path.join(handoffDir, f);
    if (fs.existsSync(fp2)) found.push(`.open-canvas/${f}`);
  }
  if (found.length > 0) {
    sections.push(`## Existing Context Files`);
    sections.push(
      "The following context files exist in this project and may contain useful information:"
    );
    for (const f of found) {
      sections.push(`- \`${f}\``);
    }
    sections.push("");
  }

  // Write the handoff file
  const content = sections.join("\n");
  const handoffPath = path.join(handoffDir, HANDOFF_FILE);
  atomicWrite(handoffPath, content);

  return handoffPath;
}
