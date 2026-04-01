import fs from "fs";
import path from "path";
import net from "net";
import { OC_HOME } from "@/lib/globalConfig";
import type {
  PortAllocation,
  PortAllocationStatus,
  PortRegistryData,
  ServiceType,
} from "./types";

const REGISTRY_PATH = path.join(OC_HOME, "port-registry.json");
const RESERVED_PORTS = new Set([40000, 40001]);
const DEFAULT_PORT_RANGE = { min: 41000, max: 49999 };
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ── Helpers ─────────────────────────────────────────────────────────────────

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

// ── PortRegistry ────────────────────────────────────────────────────────────

export class PortRegistry {
  private registryPath: string;

  constructor(registryPath?: string) {
    this.registryPath = registryPath || REGISTRY_PATH;
  }

  // ── Read / Write ──────────────────────────────────────────────────────────

  read(): PortRegistryData {
    try {
      if (fs.existsSync(this.registryPath)) {
        const raw = fs.readFileSync(this.registryPath, "utf-8");
        const data = JSON.parse(raw) as PortRegistryData;
        if (data.version && data.allocations) return data;
      }
    } catch {
      // Corrupted — start fresh
    }
    return { version: 1, portRange: DEFAULT_PORT_RANGE, allocations: [] };
  }

  write(data: PortRegistryData): void {
    const dir = path.dirname(this.registryPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.registryPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.registryPath);
  }

  private update(fn: (data: PortRegistryData) => PortRegistryData): PortRegistryData {
    const data = fn(this.read());
    this.write(data);
    return data;
  }

  // ── Port Allocation ───────────────────────────────────────────────────────

  /**
   * Allocate a port for a project service. Returns the existing allocation if
   * one already exists for this project+service, otherwise finds a free port.
   */
  async allocatePort(
    projectName: string,
    projectPath: string,
    serviceName: string,
    serviceType: ServiceType,
    preferredPort?: number
  ): Promise<number> {
    const data = this.read();

    // Check for existing allocation for this project+service
    const existing = data.allocations.find(
      (a) => a.projectPath === projectPath && a.serviceName === serviceName
    );
    if (existing) {
      return existing.port;
    }

    // Try preferred port first
    if (preferredPort && !RESERVED_PORTS.has(preferredPort)) {
      const taken = data.allocations.some((a) => a.port === preferredPort);
      if (!taken) {
        const listening = await isPortListening(preferredPort);
        if (!listening) {
          this.addAllocation(data, {
            port: preferredPort,
            projectName,
            projectPath,
            serviceName,
            serviceType,
            allocatedAt: new Date().toISOString(),
            status: "allocated",
          });
          return preferredPort;
        }
      }
    }

    // Deterministic base from project name hash
    const range = data.portRange || DEFAULT_PORT_RANGE;
    const rangeSize = range.max - range.min + 1;
    const base = range.min + (hashString(projectName) % rangeSize);

    // Scan for free port starting from the hash-based base
    const port = await this.findFreePort(data, base, range);

    this.addAllocation(data, {
      port,
      projectName,
      projectPath,
      serviceName,
      serviceType,
      allocatedAt: new Date().toISOString(),
      status: "allocated",
    });

    return port;
  }

  private async findFreePort(
    data: PortRegistryData,
    startFrom: number,
    range: { min: number; max: number }
  ): Promise<number> {
    const registeredPorts = new Set(data.allocations.map((a) => a.port));

    for (let i = 0; i < range.max - range.min + 1; i++) {
      const port = range.min + ((startFrom - range.min + i) % (range.max - range.min + 1));
      if (RESERVED_PORTS.has(port)) continue;
      if (registeredPorts.has(port)) continue;

      const listening = await isPortListening(port);
      if (!listening) return port;
    }

    throw new Error("No free ports available in configured range");
  }

  private addAllocation(data: PortRegistryData, allocation: PortAllocation): void {
    data.allocations.push(allocation);
    this.write(data);
  }

  // ── Release ───────────────────────────────────────────────────────────────

  releasePort(port: number): void {
    this.update((data) => {
      data.allocations = data.allocations.filter((a) => a.port !== port);
      return data;
    });
  }

  releaseProject(projectPath: string): void {
    this.update((data) => {
      data.allocations = data.allocations.filter((a) => a.projectPath !== projectPath);
      return data;
    });
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  getProjectPorts(projectPath: string): PortAllocation[] {
    return this.read().allocations.filter((a) => a.projectPath === projectPath);
  }

  getPortOwner(port: number): PortAllocation | null {
    return this.read().allocations.find((a) => a.port === port) || null;
  }

  getAllocations(): PortAllocation[] {
    return this.read().allocations;
  }

  // ── Status Updates ────────────────────────────────────────────────────────

  markRunning(port: number, pid: number, sessionId?: string): void {
    this.update((data) => {
      const alloc = data.allocations.find((a) => a.port === port);
      if (alloc) {
        alloc.status = "running";
        alloc.pid = pid;
        alloc.sessionId = sessionId;
        alloc.lastSeen = new Date().toISOString();
      }
      return data;
    });
  }

  markStopped(port: number): void {
    this.update((data) => {
      const alloc = data.allocations.find((a) => a.port === port);
      if (alloc) {
        alloc.status = "allocated";
        alloc.pid = undefined;
        alloc.sessionId = undefined;
      }
      return data;
    });
  }

  updateLastSeen(port: number): void {
    this.update((data) => {
      const alloc = data.allocations.find((a) => a.port === port);
      if (alloc) {
        alloc.lastSeen = new Date().toISOString();
      }
      return data;
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Check all "running" allocations: verify PID is alive. Mark dead ones as
   * "stale", then remove stale entries older than the threshold.
   */
  cleanupStale(): { removed: number; marked: number } {
    const now = Date.now();
    let removed = 0;
    let marked = 0;

    this.update((data) => {
      for (const alloc of data.allocations) {
        if (alloc.status === "running" && alloc.pid) {
          if (!isPidAlive(alloc.pid)) {
            alloc.status = "stale";
            alloc.lastSeen = new Date().toISOString();
            marked++;
          }
        }
      }

      const before = data.allocations.length;
      data.allocations = data.allocations.filter((a) => {
        if (a.status !== "stale") return true;
        const lastSeen = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        return now - lastSeen < STALE_THRESHOLD_MS;
      });
      removed = before - data.allocations.length;

      return data;
    });

    return { removed, marked };
  }
}
