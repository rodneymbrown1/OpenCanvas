import type { RunConfig, ServiceDef, ServiceStatus, ServiceTopology } from "./types";

/**
 * Client-side service orchestrator. Reads a RunConfig, computes start order,
 * and communicates with the PTY server's /services/* endpoints.
 *
 * NOTE: This runs in Next.js API routes (server-side), not in the browser.
 * Browser code should call /api/services/* which delegates here.
 */
export class ServiceManager {
  private runConfig: RunConfig;
  private ptyBaseUrl: string;

  constructor(runConfig: RunConfig, ptyPort: number = 3001) {
    this.runConfig = runConfig;
    this.ptyBaseUrl = `http://localhost:${ptyPort}`;
  }

  // ── Topology ────────────────────────────────────────────────────────────

  getTopology(): ServiceTopology {
    return {
      services: this.runConfig.services,
      startOrder: this.getStartOrder(),
    };
  }

  getStartOrder(): string[] {
    return topologicalSort(this.runConfig.services);
  }

  // ── Start / Stop ────────────────────────────────────────────────────────

  /** Start all services in dependency order via PTY server. */
  async startAll(cwd: string, projectName?: string): Promise<Record<string, ServiceStatus>> {
    const topology = this.getTopology();

    const res = await fetch(`${this.ptyBaseUrl}/services/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        services: topology.services,
        startOrder: topology.startOrder,
        cwd,
        projectName: projectName || this.runConfig.project_name,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "PTY server unreachable" }));
      throw new Error(err.error || `PTY server returned ${res.status}`);
    }

    const data = await res.json();
    return data.services || {};
  }

  /** Stop all services for a project. */
  async stopAll(cwd: string): Promise<{ stopped: string[]; count: number }> {
    const res = await fetch(`${this.ptyBaseUrl}/services/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    });

    if (!res.ok) {
      throw new Error("Failed to stop services");
    }

    return res.json();
  }

  /** Stop a specific service. */
  async stopService(cwd: string, serviceName: string): Promise<void> {
    await fetch(`${this.ptyBaseUrl}/services/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, service: serviceName }),
    });
  }

  // ── Status ──────────────────────────────────────────────────────────────

  /** Get live status of all services for a project. */
  async getStatus(cwd: string): Promise<Record<string, ServiceStatus>> {
    const res = await fetch(
      `${this.ptyBaseUrl}/services/status?cwd=${encodeURIComponent(cwd)}`
    );

    if (!res.ok) {
      return {};
    }

    const data = await res.json();
    return data.services || {};
  }
}

// ── Topological Sort ──────────────────────────────────────────────────────

function topologicalSort(services: Record<string, ServiceDef>): string[] {
  const names = Object.keys(services);
  const visited = new Set<string>();
  const result: string[] = [];

  const visit = (name: string, stack: Set<string>) => {
    if (visited.has(name)) return;
    if (stack.has(name)) return; // cycle — skip
    stack.add(name);

    const deps = services[name]?.depends_on || [];
    for (const dep of deps) {
      if (services[dep]) visit(dep, stack);
    }

    stack.delete(name);
    visited.add(name);
    result.push(name);
  };

  for (const name of names) {
    visit(name, new Set());
  }

  return result;
}
