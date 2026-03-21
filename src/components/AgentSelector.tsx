"use client";

import { useState, useEffect } from "react";

type AgentType = "claude" | "codex" | "gemini";

interface AgentSelectorProps {
  value: AgentType;
  onChange: (agent: AgentType) => void;
}

const AGENTS: { id: AgentType; label: string; color: string }[] = [
  { id: "claude", label: "Claude", color: "bg-orange-500" },
  { id: "codex", label: "Codex", color: "bg-green-500" },
  { id: "gemini", label: "Gemini", color: "bg-blue-500" },
];

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-[var(--bg-primary)] rounded-lg p-0.5 border border-[var(--border)]">
      {AGENTS.map((agent) => (
        <button
          key={agent.id}
          onClick={() => onChange(agent.id)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            value === agent.id
              ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              value === agent.id ? agent.color : "bg-[var(--text-muted)]"
            }`}
          />
          {agent.label}
        </button>
      ))}
    </div>
  );
}

export function useActiveAgent(): [AgentType, (a: AgentType) => void] {
  const [agent, setAgent] = useState<AgentType>("claude");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.agent?.active) {
          setAgent(config.agent.active);
        }
      })
      .catch(() => {});
  }, []);

  const updateAgent = (newAgent: AgentType) => {
    setAgent(newAgent);
    fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: { active: newAgent } }),
    }).catch(() => {});
  };

  return [agent, updateAgent];
}
