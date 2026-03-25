
import { useState, useEffect } from "react";
import { Save, ArrowLeft } from "lucide-react";

type AgentType = "claude" | "codex" | "gemini";

interface AgentPermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  web: boolean;
}

interface AgentSettings {
  mode: "cli" | "api";
  permissions: AgentPermissions;
}

export function AgentSettingsPage() {
  const [active, setActive] = useState<AgentType>("claude");
  const [settings, setSettings] = useState<Record<AgentType, AgentSettings>>({
    claude: { mode: "cli", permissions: { read: true, write: true, execute: true, web: true } },
    codex: { mode: "cli", permissions: { read: true, write: true, execute: true, web: true } },
    gemini: { mode: "cli", permissions: { read: true, write: true, execute: true, web: true } },
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.agent) {
          setActive(config.agent.active || "claude");
          setSettings({
            claude: config.agent.claude || settings.claude,
            codex: config.agent.codex || settings.codex,
            gemini: config.agent.gemini || settings.gemini,
          });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: { active, ...settings } }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const current = settings[active];

  const togglePerm = (key: keyof AgentPermissions) => {
    setSettings({
      ...settings,
      [active]: {
        ...current,
        permissions: { ...current.permissions, [key]: !current.permissions[key] },
      },
    });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Coding Agents</h1>
      </div>

      {/* Agent selector */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--text-muted)]">Active Agent</label>
        <div className="flex gap-2">
          {(["claude", "codex", "gemini"] as AgentType[]).map((a) => (
            <button
              key={a}
              onClick={() => setActive(a)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active === a
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Mode */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--text-muted)]">Mode</label>
        <div className="flex gap-2">
          {(["cli", "api"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() =>
                setSettings({ ...settings, [active]: { ...current, mode } })
              }
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                current.mode === mode
                  ? "bg-[var(--bg-tertiary)] border border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)]"
              }`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--text-muted)]">
          {current.mode === "cli"
            ? "Uses your authenticated CLI session. No API key needed."
            : "Uses an API key. Configure in Settings > API Keys."}
        </p>
      </div>

      {/* Permissions */}
      <div className="space-y-3">
        <label className="text-xs text-[var(--text-muted)]">Permissions</label>
        {(
          Object.entries(current.permissions) as [keyof AgentPermissions, boolean][]
        ).map(([key, val]) => (
          <div
            key={key}
            className="flex items-center justify-between bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-4 py-3"
          >
            <div>
              <p className="text-sm capitalize">{key}</p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {key === "read" && "Allow agent to read files"}
                {key === "write" && "Allow agent to write and edit files"}
                {key === "execute" && "Allow agent to run shell commands"}
                {key === "web" && "Allow agent to access the internet"}
              </p>
            </div>
            <button
              onClick={() => togglePerm(key)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                val ? "bg-[var(--accent)]" : "bg-[var(--border)]"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  val ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Save */}
      <button
        onClick={save}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Save size={14} />
        {saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}
