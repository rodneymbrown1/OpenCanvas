
import { useState, useEffect } from "react";
import { X, Check, Loader2, AlertCircle, Terminal } from "lucide-react";
import type { AgentType } from "@/lib/types/terminal";

/** Agent types that require the connect modal (shell connects directly) */
type ModalAgentType = Exclude<AgentType, "shell">;

interface AgentInfo {
  id: ModalAgentType;
  label: string;
  installed: boolean;
  path: string | null;
}

interface ConnectAgentModalProps {
  /** Pre-selected agent, or null to let user pick */
  agent?: ModalAgentType | null;
  onClose: () => void;
  /** Called with the selected agent when user clicks Connect */
  onConnected: (agent: AgentType) => void;
}

const INSTALL_INSTRUCTIONS: Record<ModalAgentType, string[]> = {
  claude: [
    "Install Claude Code: npm install -g @anthropic-ai/claude-code",
    "Run 'claude' in your terminal to authenticate",
    "Once authenticated, click Connect below",
  ],
  codex: [
    "Install Codex: npm install -g @openai/codex",
    "Set your OpenAI API key or authenticate via CLI",
    "Once ready, click Connect below",
  ],
  gemini: [
    "Install Gemini CLI: npm install -g @google/gemini-cli",
    "Authenticate with your Google account",
    "Once authenticated, click Connect below",
  ],
};

export function ConnectAgentModal({
  agent: initialAgent,
  onClose,
  onConnected,
}: ConnectAgentModalProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<ModalAgentType>(initialAgent || "claude");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.agents);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const currentAgent = agents.find((a) => a.id === selectedAgent);
  const isInstalled = currentAgent?.installed ?? false;

  const handleConnect = () => {
    setConnecting(true);
    setTimeout(() => {
      onConnected(selectedAgent);
    }, 500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-[450px] max-w-[90vw] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Terminal size={14} />
            New Terminal
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={16} className="animate-spin" />
              Detecting installed agents...
            </div>
          ) : (
            <>
              {/* Agent picker */}
              <div className="space-y-2">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                  Select Agent
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedAgent(a.id)}
                      className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-sm font-medium transition-colors ${
                        selectedAgent === a.id
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                      }`}
                    >
                      <span>{a.label}</span>
                      <span
                        className={`text-[10px] ${
                          a.installed ? "text-green-400" : "text-[var(--text-muted)]"
                        }`}
                      >
                        {a.installed ? "Ready" : "Not found"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detection status for selected agent */}
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  isInstalled
                    ? "bg-green-500/10 text-green-400"
                    : "bg-yellow-500/10 text-yellow-400"
                }`}
              >
                {isInstalled ? (
                  <>
                    <Check size={16} />
                    {currentAgent?.label} detected at {currentAgent?.path}
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} />
                    {selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)} not found
                    on this system
                  </>
                )}
              </div>

              {/* Install instructions if not found */}
              {!isInstalled && (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    To get started:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-[var(--text-secondary)]">
                    {INSTALL_INSTRUCTIONS[selectedAgent].map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={handleConnect}
            disabled={!isInstalled || connecting}
            className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              isInstalled
                ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
            }`}
          >
            {connecting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Connecting...
              </>
            ) : (
              `Connect ${selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
