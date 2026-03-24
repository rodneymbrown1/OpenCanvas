export type AgentType = "claude" | "codex" | "gemini" | "shell";

export interface TerminalTab {
  id: string;
  sessionId: string | null;
  agent: AgentType;
  label: string;
  status: "disconnected" | "connecting" | "connected" | "exited";
  createdAt: string;
}

export interface ProjectTerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  terminalHeight: number;
}

export const DEFAULT_TERMINAL_HEIGHT = 280;

export function createDefaultProjectState(): ProjectTerminalState {
  return {
    tabs: [],
    activeTabId: null,
    terminalHeight: DEFAULT_TERMINAL_HEIGHT,
  };
}
