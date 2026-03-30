
import { useState, useEffect } from "react";
import { Save, Eye, EyeOff, Plus, Trash2, Key } from "lucide-react";

interface ApiKeyEntry {
  id: string;
  label: string;
  value: string;
  category: "ai" | "calendar" | "custom";
}

const SUGGESTED_KEYS: { id: string; label: string; placeholder: string; category: "ai" }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-...", category: "ai" },
  { id: "openai", label: "OpenAI (Codex)", placeholder: "sk-...", category: "ai" },
  { id: "google", label: "Google (Gemini)", placeholder: "AIza...", category: "ai" },
];

function getCategory(id: string): "ai" | "calendar" | "custom" {
  const suggested = SUGGESTED_KEYS.find((k) => k.id === id);
  return suggested?.category || "custom";
}

function getLabel(id: string): string {
  const suggested = SUGGESTED_KEYS.find((k) => k.id === id);
  return suggested?.label || id;
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newKeyId, setNewKeyId] = useState("");
  const [customKeyId, setCustomKeyId] = useState("");

  useEffect(() => {
    fetch("/api/config/api-keys")
      .then((r) => r.json())
      .then((data) => {
        if (data.api_keys) setKeys(data.api_keys);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    await fetch("/api/config/api-keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_keys: keys }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const removeKey = async (id: string) => {
    const updated = { ...keys };
    delete updated[id];
    setKeys(updated);
    await fetch("/api/config/api-keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", key: id }),
    });
  };

  const addKey = () => {
    const id = newKeyId === "__custom" ? customKeyId.trim() : newKeyId;
    if (!id || keys[id] !== undefined) return;
    setKeys({ ...keys, [id]: "" });
    setNewKeyId("");
    setCustomKeyId("");
    setShowAdd(false);
  };

  // Group keys by category
  const keyEntries: ApiKeyEntry[] = Object.entries(keys).map(([id, value]) => ({
    id,
    label: getLabel(id),
    value,
    category: getCategory(id),
  }));

  const aiKeys = keyEntries.filter((k) => k.category === "ai");
  const calendarKeys = keyEntries.filter((k) => k.category === "calendar");
  const customKeys = keyEntries.filter((k) => k.category === "custom");

  // Available keys to add (not already added)
  const availableToAdd = SUGGESTED_KEYS.filter((s) => keys[s.id] === undefined);

  const inputClass =
    "flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]";

  const renderGroup = (title: string, entries: ApiKeyEntry[]) => {
    if (entries.length === 0) return null;
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          {title}
        </h3>
        {entries.map((entry) => {
          const suggested = SUGGESTED_KEYS.find((s) => s.id === entry.id);
          return (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[var(--text-muted)]">{entry.label}</label>
                <button
                  onClick={() => removeKey(entry.id)}
                  className="text-[var(--text-muted)] hover:text-red-400 p-0.5"
                  title="Remove key"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type={visible[entry.id] ? "text" : "password"}
                  value={entry.value}
                  onChange={(e) => setKeys({ ...keys, [entry.id]: e.target.value })}
                  placeholder={suggested?.placeholder || "Enter value..."}
                  className={inputClass}
                />
                <button
                  onClick={() => setVisible({ ...visible, [entry.id]: !visible[entry.id] })}
                  className="px-3 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  {visible[entry.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Key size={20} className="text-[var(--accent)]" />
        <h1 className="text-xl font-bold">API Keys</h1>
        <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
          root scope
        </span>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        API keys are stored globally at ~/.open-canvas and shared across all projects.
        Keys for AI providers are used in API mode. Calendar keys enable external calendar connections.
      </p>

      <div className="space-y-6">
        {renderGroup("AI Providers", aiKeys)}
        {renderGroup("Calendar Connections", calendarKeys)}
        {renderGroup("Custom", customKeys)}
      </div>

      {keyEntries.length === 0 && !showAdd && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-8 text-center space-y-3">
          <Key size={32} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-sm text-[var(--text-secondary)]">No API keys configured</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Add your first key
          </button>
        </div>
      )}

      {/* Add Key */}
      {showAdd ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium">Add API Key</h3>
          <select
            value={newKeyId}
            onChange={(e) => setNewKeyId(e.target.value)}
            className={`w-full ${inputClass}`}
          >
            <option value="">Select a key type...</option>
            {availableToAdd.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="__custom">Custom key...</option>
          </select>
          {newKeyId === "__custom" && (
            <input
              type="text"
              value={customKeyId}
              onChange={(e) => setCustomKeyId(e.target.value)}
              placeholder="Key name (e.g., my_service_api_key)"
              className={`w-full ${inputClass}`}
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={addKey}
              disabled={!newKeyId || (newKeyId === "__custom" && !customKeyId.trim())}
              className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Plus size={14} />
              Add
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewKeyId(""); setCustomKeyId(""); }}
              className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        keyEntries.length > 0 && (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={14} />
            Add Key
          </button>
        )
      )}

      {/* Save */}
      {keyEntries.length > 0 && (
        <button
          onClick={save}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Save size={14} />
          {saved ? "Saved!" : "Save Keys"}
        </button>
      )}
    </div>
  );
}
