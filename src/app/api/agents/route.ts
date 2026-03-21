import { NextResponse } from "next/server";
import { execSync } from "child_process";

interface AgentStatus {
  id: "claude" | "codex" | "gemini";
  label: string;
  installed: boolean;
  path: string | null;
}

function detectAgent(cmd: string): { installed: boolean; path: string | null } {
  try {
    const result = execSync(`which ${cmd} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return { installed: !!result, path: result || null };
  } catch {
    return { installed: false, path: null };
  }
}

export async function GET() {
  const agents: AgentStatus[] = [
    { id: "claude", label: "Claude Code", ...detectAgent("claude") },
    { id: "codex", label: "Codex", ...detectAgent("codex") },
    { id: "gemini", label: "Gemini", ...detectAgent("gemini") },
  ];

  return NextResponse.json({ agents });
}
