"use client";

import { useState, useEffect } from "react";
import { Save, RefreshCw } from "lucide-react";

export function ProjectConfigPanel() {
  return <ProjectConfigView />;
}

export default function ProjectConfigView() {
  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/project-yaml")
      .then((r) => r.json())
      .then((data) => {
        setYaml(data.content || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    await fetch("/api/project-yaml", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: yaml }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Project Config</h1>
        <span className="text-xs text-[var(--text-muted)]">
          open-canvas.yaml
        </span>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Edit the project YAML directly. Changes here are reflected in Settings
        and vice versa. This is the same file the coding agents reference.
      </p>

      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : (
          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            className="w-full h-[500px] bg-transparent p-4 text-sm font-mono text-[var(--text-secondary)] focus:outline-none resize-none"
            spellCheck={false}
          />
        )}
      </div>

      <button
        onClick={save}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Save size={14} />
        {saved ? "Saved!" : "Save Changes"}
      </button>
    </div>
  );
}
