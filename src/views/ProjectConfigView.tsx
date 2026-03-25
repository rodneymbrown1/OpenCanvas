
import { useState, useEffect } from "react";
import { Save, RefreshCw, FolderOpen } from "lucide-react";
import { useSession } from "@/lib/SessionContext";

export function ProjectConfigPanel() {
  return <ProjectConfigView />;
}

export default function ProjectConfigView() {
  const { session } = useSession();
  const { workDir } = session;

  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [configPath, setConfigPath] = useState("");

  useEffect(() => {
    if (!workDir) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const url = `/api/project-yaml?workDir=${encodeURIComponent(workDir)}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setYaml(data.content || "");
        setConfigPath(data.path || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workDir]);

  const save = async () => {
    if (!workDir) return;
    const url = `/api/project-yaml?workDir=${encodeURIComponent(workDir)}`;
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: yaml }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!workDir) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <FolderOpen size={20} />
          <p className="text-sm">Select a project to view its configuration.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Project Config</h1>
        <span className="text-xs text-[var(--text-muted)] truncate max-w-[300px]" title={configPath}>
          {configPath || "open-canvas.yaml"}
        </span>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Edit the project-specific YAML configuration for{" "}
        <span className="font-medium text-[var(--text-secondary)]">
          {workDir.split("/").pop()}
        </span>
        . This file lives at <code className="text-[var(--accent)]">{workDir}/open-canvas.yaml</code>.
        {!yaml && " No config file exists yet — saving will create one."}
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
            placeholder={`# Project configuration for ${workDir.split("/").pop()}\n# Add agent settings, permissions, MCP servers, etc.\n\nagent:\n  active: claude\n  claude:\n    permissions:\n      read: true\n      write: true\n      execute: true\n`}
            className="w-full h-[500px] bg-transparent p-4 text-sm font-mono text-[var(--text-secondary)] focus:outline-none resize-none placeholder:text-[var(--text-muted)] placeholder:opacity-40"
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
