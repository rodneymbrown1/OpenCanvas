
import { useState, useEffect } from "react";
import { Save, ArrowLeft, Eye, EyeOff } from "lucide-react";

const KEY_DEFS = [
  { id: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI (Codex)", placeholder: "sk-..." },
  { id: "google", label: "Google (Gemini)", placeholder: "AIza..." },
];

export function ApiKeysPage() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_keys: keys }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">API Keys</h1>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        API keys are only needed if you set an agent&apos;s mode to &quot;API&quot;.
        In CLI mode, your authenticated terminal session is used instead.
      </p>

      <div className="space-y-4">
        {KEY_DEFS.map((def) => (
          <div key={def.id} className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">
              {def.label}
            </label>
            <div className="flex gap-2">
              <input
                type={visible[def.id] ? "text" : "password"}
                value={keys[def.id] || ""}
                onChange={(e) =>
                  setKeys({ ...keys, [def.id]: e.target.value })
                }
                placeholder={def.placeholder}
                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={() =>
                  setVisible({ ...visible, [def.id]: !visible[def.id] })
                }
                className="px-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                {visible[def.id] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Save size={14} />
        {saved ? "Saved!" : "Save Keys"}
      </button>
    </div>
  );
}
