"use client";

import { useState } from "react";
import { BarChart3, DollarSign, Zap, Clock } from "lucide-react";
import { AgentSelector, useActiveAgent } from "@/components/AgentSelector";

interface UsageMetric {
  label: string;
  value: string;
  icon: typeof BarChart3;
  color: string;
}

export default function UsagePage() {
  const [agent, setAgent] = useActiveAgent();

  // Placeholder metrics — will be connected to real agent CLI usage commands
  const metrics: UsageMetric[] = [
    {
      label: "Tokens Used",
      value: "--",
      icon: Zap,
      color: "text-yellow-400",
    },
    {
      label: "Estimated Cost",
      value: "--",
      icon: DollarSign,
      color: "text-green-400",
    },
    {
      label: "Sessions Today",
      value: "--",
      icon: BarChart3,
      color: "text-blue-400",
    },
    {
      label: "Avg Session Time",
      value: "--",
      icon: Clock,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usage</h1>
        <AgentSelector value={agent} onChange={setAgent} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <m.icon size={16} className={m.color} />
              <span className="text-xs text-[var(--text-muted)]">
                {m.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold mb-4">Usage History</h2>
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-50" />
          <p>Usage data will appear here as you use coding agents.</p>
          <p className="text-xs mt-1">
            Pulls data from{" "}
            {agent === "claude"
              ? "`claude usage`"
              : agent === "codex"
              ? "OpenAI API"
              : "Google AI API"}
          </p>
        </div>
      </div>
    </div>
  );
}
