"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Globe, Database, Terminal, Server, Wifi, ExternalLink, X } from "lucide-react";

interface PortInfo {
  port: number;
  pid: number;
  process: string;
  user: string;
  type: string;
  label: string;
}

function getPortCategory(port: number, label: string): { icon: typeof Globe; color: string } {
  if ([27017, 3306, 5432, 6379].includes(port)) return { icon: Database, color: "text-purple-400" };
  if ([9229].includes(port)) return { icon: Terminal, color: "text-yellow-400" };
  if (label.includes("PTY") || label.includes("Node")) return { icon: Terminal, color: "text-orange-400" };
  if (port >= 3000 && port <= 9999) return { icon: Globe, color: "text-blue-400" };
  return { icon: Server, color: "text-[var(--text-muted)]" };
}

export default function PortsView() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPorts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ports");
      if (res.ok) {
        const data = await res.json();
        setPorts(data.ports || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  const [killing, setKilling] = useState<number | null>(null);

  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  const killPort = async (pid: number, port: number) => {
    const name = ports.find((p) => p.port === port);
    if (!confirm(`Kill process "${name?.process}" on port ${port} (PID ${pid})?`)) return;
    setKilling(port);
    try {
      await fetch("/api/ports/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, port }),
      });
      // Wait briefly then refresh
      await new Promise((r) => setTimeout(r, 500));
      await fetchPorts();
    } catch {}
    setKilling(null);
  };

  const devPorts = ports.filter((p) => p.label);
  const otherPorts = ports.filter((p) => !p.label);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Ports</h1>
        <button
          onClick={fetchPorts}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wifi size={16} className="text-[var(--accent)]" />
            <span className="text-xs text-[var(--text-muted)]">Active Ports</span>
          </div>
          <p className="text-2xl font-bold">{ports.length}</p>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Globe size={16} className="text-blue-400" />
            <span className="text-xs text-[var(--text-muted)]">Dev Servers</span>
          </div>
          <p className="text-2xl font-bold">{devPorts.length}</p>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Database size={16} className="text-purple-400" />
            <span className="text-xs text-[var(--text-muted)]">Databases</span>
          </div>
          <p className="text-2xl font-bold">
            {ports.filter((p) => [27017, 3306, 5432, 6379].includes(p.port)).length}
          </p>
        </div>
      </div>

      {/* Known dev ports */}
      {devPorts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Dev Services ({devPorts.length})
          </h2>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden divide-y divide-[var(--border)]">
            {devPorts.map((p) => {
              const { icon: Icon, color } = getPortCategory(p.port, p.label);
              return (
                <div key={p.port} className="px-4 py-3 flex items-center gap-4">
                  <Icon size={16} className={color} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-[var(--text-primary)]">
                        :{p.port}
                      </span>
                      <span className="text-xs text-[var(--accent)]">{p.label}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {p.process} &middot; PID {p.pid}
                      {p.user && ` &middot; ${p.user}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.port >= 3000 && p.port <= 9999 && !p.label.includes("PTY") && !p.label.includes("debugger") && (
                      <a
                        href={`http://localhost:${p.port}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <ExternalLink size={11} />
                        Open
                      </a>
                    )}
                    <button
                      onClick={() => killPort(p.pid, p.port)}
                      disabled={killing === p.port}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-40"
                      title={`Kill port ${p.port}`}
                    >
                      <X size={11} />
                      Kill
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other ports */}
      {otherPorts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Other Ports ({otherPorts.length})
          </h2>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden divide-y divide-[var(--border)]">
            {otherPorts.map((p) => (
              <div key={p.port} className="px-4 py-2.5 flex items-center gap-4">
                <Server size={14} className="text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--text-secondary)]">
                      :{p.port}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {p.process}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  PID {p.pid}
                </span>
                <button
                  onClick={() => killPort(p.pid, p.port)}
                  disabled={killing === p.port}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-40"
                  title={`Kill port ${p.port}`}
                >
                  <X size={11} />
                  Kill
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && ports.length === 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-12 text-center space-y-3">
          <Wifi size={40} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-[var(--text-secondary)]">No listening ports detected</p>
        </div>
      )}
    </div>
  );
}
