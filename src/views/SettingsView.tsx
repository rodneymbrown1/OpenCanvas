"use client";

import { useState } from "react";
import { Key, Bot, Plug } from "lucide-react";
import { AgentSettingsPage } from "./SettingsAgentsView";
import { ApiKeysPage } from "./SettingsApiKeysView";
import { McpPage } from "./SettingsMcpView";

const TABS = [
  { id: "agents", icon: Bot, label: "Coding Agents" },
  { id: "api-keys", icon: Key, label: "API Keys" },
  { id: "mcp", icon: Plug, label: "MCP Servers" },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

export default function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("agents");

  return (
    <div className="flex h-full">
      {/* Settings sidebar */}
      <div className="w-48 border-r border-[var(--border)] bg-[var(--bg-secondary)] p-3 space-y-1 shrink-0">
        <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 mb-3">
          Settings
        </h2>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              tab === t.id
                ? "bg-[var(--bg-tertiary)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-auto">
        {tab === "agents" && <AgentSettingsPage />}
        {tab === "api-keys" && <ApiKeysPage />}
        {tab === "mcp" && <McpPage />}
      </div>
    </div>
  );
}
