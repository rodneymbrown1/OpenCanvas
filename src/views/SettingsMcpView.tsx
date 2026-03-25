
import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Save, Plug } from "lucide-react";

interface McpServer {
  name: string;
  command: string;
  args: string[];
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.mcp_servers) setServers(config.mcp_servers);
      })
      .catch(() => {});
  }, []);

  const addServer = () => {
    setServers([...servers, { name: "", command: "", args: [] }]);
  };

  const removeServer = (idx: number) => {
    setServers(servers.filter((_, i) => i !== idx));
  };

  const updateServer = (idx: number, field: keyof McpServer, value: string) => {
    const updated = [...servers];
    if (field === "args") {
      updated[idx] = { ...updated[idx], args: value.split(" ").filter(Boolean) };
    } else {
      updated[idx] = { ...updated[idx], [field]: value };
    }
    setServers(updated);
  };

  const save = async () => {
    await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcp_servers: servers }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">MCP Servers</h1>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Connect to external services like Telegram, Notion, Slack, and more via
        Model Context Protocol servers.
      </p>

      {servers.length === 0 ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-8 text-center space-y-3">
          <Plug size={32} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-sm text-[var(--text-secondary)]">
            No MCP servers configured
          </p>
          <button
            onClick={addServer}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Add your first server
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server, idx) => (
            <div
              key={idx}
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  Server #{idx + 1}
                </span>
                <button
                  onClick={() => removeServer(idx)}
                  className="text-[var(--error)] hover:opacity-80"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <input
                type="text"
                value={server.name}
                onChange={(e) => updateServer(idx, "name", e.target.value)}
                placeholder="Server name"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <input
                type="text"
                value={server.command}
                onChange={(e) => updateServer(idx, "command", e.target.value)}
                placeholder="Command (e.g., npx)"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <input
                type="text"
                value={server.args.join(" ")}
                onChange={(e) => updateServer(idx, "args", e.target.value)}
                placeholder="Args (space-separated)"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={addServer}
          className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Plus size={14} />
          Add Server
        </button>
        <button
          onClick={save}
          className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Save size={14} />
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}
