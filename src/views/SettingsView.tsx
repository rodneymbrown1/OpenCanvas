
import { useState, useEffect } from "react";
import { Key, Bot, Plug, FileText, Globe, Palette, Link2 } from "lucide-react";
import { AgentSettingsPage } from "./SettingsAgentsView";
import { ApiKeysPage } from "./SettingsApiKeysView";
import { McpPage } from "./SettingsMcpView";
import { ConnectionsPage } from "./SettingsConnectionsView";
import { ProjectConfigPanel } from "./ProjectConfigView";
import { GlobalSettingsPage } from "./SettingsGlobalView";
import { OpenCanvasSettingsPage } from "./SettingsOpenCanvasView";

const TABS = [
  { id: "open-canvas", icon: Palette, label: "Open Canvas" },
  { id: "global", icon: Globe, label: "Global Settings" },
  { id: "agents", icon: Bot, label: "Coding Agents" },
  { id: "api-keys", icon: Key, label: "API Keys" },
  { id: "connections", icon: Link2, label: "Connections" },
  { id: "mcp", icon: Plug, label: "MCP Servers" },
  { id: "project", icon: FileText, label: "Project Config" },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

export default function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>(() => {
    // Allow deep-linking to a specific tab via hash, e.g. #connections
    const hash = window.location.hash.replace("#", "") as SettingsTab;
    if (TABS.some((t) => t.id === hash)) return hash;
    return "open-canvas";
  });

  useEffect(() => {
    // Clear hash after reading so it doesn't persist across navigations
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <div className="flex h-full">
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

      <div className="flex-1 overflow-auto">
        {tab === "open-canvas" && <OpenCanvasSettingsPage />}
        {tab === "global" && <GlobalSettingsPage />}
        {tab === "agents" && <AgentSettingsPage />}
        {tab === "api-keys" && <ApiKeysPage />}
        {tab === "connections" && <ConnectionsPage />}
        {tab === "mcp" && <McpPage />}
        {tab === "project" && <ProjectConfigPanel />}
      </div>
    </div>
  );
}
