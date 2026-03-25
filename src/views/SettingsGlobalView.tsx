
import { useState, useEffect } from "react";
import { Save, RefreshCw } from "lucide-react";

interface GlobalDefaults {
  agent: string;
  theme: string;
  stack: string;
  allowAllEdits: boolean;
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
    web: boolean;
  };
}

export function GlobalSettingsPage() {
  const [defaults, setDefaults] = useState<GlobalDefaults>({
    agent: "claude",
    theme: "dark",
    stack: "nextjs-tailwind",
    allowAllEdits: false,
    permissions: { read: true, write: true, execute: true, web: false },
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/global")
      .then((r) => r.json())
      .then((data) => {
        if (data.defaults) setDefaults(data.defaults);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    await fetch("/api/settings/global", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaults }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const togglePermission = (key: keyof GlobalDefaults["permissions"]) => {
    setDefaults((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">Global Settings</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          These defaults apply across all projects unless overridden in a
          project&apos;s own config.
        </p>
      </div>

      {/* Default Agent */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Default Agent
        </h2>
        <div className="flex gap-2">
          {(["claude", "codex", "gemini"] as const).map((agent) => (
            <button
              key={agent}
              onClick={() => setDefaults((d) => ({ ...d, agent }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                defaults.agent === agent
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border)]"
              }`}
            >
              {agent.charAt(0).toUpperCase() + agent.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Allow All Edits */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Auto-Approve Edits
        </h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            onClick={() =>
              setDefaults((d) => ({ ...d, allowAllEdits: !d.allowAllEdits }))
            }
            className={`relative w-10 h-5 rounded-full transition-colors ${
              defaults.allowAllEdits
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] border border-[var(--border)]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                defaults.allowAllEdits ? "translate-x-5" : ""
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-[var(--text-secondary)]">
              Allow all edits across terminals
            </span>
            <p className="text-xs text-[var(--text-muted)]">
              When enabled, agents won&apos;t prompt for permission on file
              edits. Applies to all projects.
            </p>
          </div>
        </label>
      </section>

      {/* Default Permissions */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Default Agent Permissions
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Default permission levels for new agent sessions.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { key: "read", label: "Read Files", desc: "Read project files" },
              { key: "write", label: "Write Files", desc: "Create and edit files" },
              { key: "execute", label: "Execute Commands", desc: "Run shell commands" },
              { key: "web", label: "Web Access", desc: "Make HTTP requests" },
            ] as const
          ).map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => togglePermission(key)}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                defaults.permissions[key]
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] bg-[var(--bg-secondary)]"
              }`}
            >
              <span
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                  defaults.permissions[key]
                    ? "border-[var(--accent)] bg-[var(--accent)]"
                    : "border-[var(--text-muted)]"
                }`}
              >
                {defaults.permissions[key] && (
                  <svg
                    width="10"
                    height="8"
                    viewBox="0 0 10 8"
                    fill="none"
                    className="text-white"
                  >
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <div>
                <span className="text-sm text-[var(--text-secondary)]">
                  {label}
                </span>
                <p className="text-xs text-[var(--text-muted)]">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Default Theme
        </h2>
        <div className="flex gap-2">
          {(["dark", "light"] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => setDefaults((d) => ({ ...d, theme }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                defaults.theme === theme
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border)]"
              }`}
            >
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Save */}
      <button
        onClick={save}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Save size={14} />
        {saved ? "Saved!" : "Save Global Settings"}
      </button>
    </div>
  );
}
