export type AgentType = "claude" | "codex" | "gemini" | "shell";

export interface TerminalTab {
  id: string;
  sessionId: string | null;
  agent: AgentType;
  label: string;
  status: "disconnected" | "connecting" | "connected" | "exited";
  createdAt: string;
  /** If set, the terminal should resume this prior session on spawn */
  resumeSessionId?: string;
}

export interface SessionHistoryEntry {
  /** PTY session ID (8-char UUID) */
  sessionId: string;
  /** Agent that ran the session */
  agent: AgentType;
  /** Last known tab label */
  label: string;
  /** Working directory at session creation */
  cwd: string;
  /** ISO timestamp of session creation */
  createdAt: string;
  /** ISO timestamp of session end (null if still running) */
  endedAt: string | null;
  /** Process exit code */
  exitCode: number | null;
  /** Duration in seconds */
  durationSeconds: number | null;
  /** Last 5 lines of clean output for preview */
  lastOutputPreview: string[];
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
