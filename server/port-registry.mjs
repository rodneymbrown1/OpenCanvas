/**
 * Lightweight ESM port registry for use by pty-server.mjs.
 * Reads/writes the same ~/.open-canvas/port-registry.json file
 * as the TypeScript PortRegistry in src/lib/core/PortRegistry.ts.
 */

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";

const HOME = os.homedir();
const REGISTRY_PATH = path.join(HOME, ".open-canvas", "port-registry.json");
export const RESERVED_PORTS = new Set([3000, 3001, 5173]);
const DEFAULT_PORT_RANGE = { min: 3002, max: 9999 };
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// ── Read / Write ────────────────────────────────────────────────────────────

export function readRegistry() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
      const data = JSON.parse(raw);
      if (data.version && data.allocations) return data;
    }
  } catch {
    // Corrupted — start fresh
  }
  return { version: 1, portRange: DEFAULT_PORT_RANGE, allocations: [] };
}

export function writeRegistry(data) {
  const dir = path.dirname(REGISTRY_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = REGISTRY_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, REGISTRY_PATH);
}

// ── Port Checking ───────────────────────────────────────────────────────────

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ── Core Operations ─────────────────────────────────────────────────────────

export async function allocatePort(projectName, projectPath, serviceName, serviceType, preferredPort) {
  const data = readRegistry();

  // Check for existing allocation
  const existing = data.allocations.find(
    (a) => a.projectPath === projectPath && a.serviceName === serviceName
  );
  if (existing) return existing.port;

  // Try preferred port
  if (preferredPort && !RESERVED_PORTS.has(preferredPort)) {
    const taken = data.allocations.some((a) => a.port === preferredPort);
    if (!taken && !(await isPortListening(preferredPort))) {
      data.allocations.push({
        port: preferredPort, projectName, projectPath, serviceName, serviceType,
        allocatedAt: new Date().toISOString(), status: "allocated",
      });
      writeRegistry(data);
      return preferredPort;
    }
  }

  // Deterministic base from project name hash
  const range = data.portRange || DEFAULT_PORT_RANGE;
  const rangeSize = range.max - range.min + 1;
  const base = range.min + (hashString(projectName) % rangeSize);
  const registeredPorts = new Set(data.allocations.map((a) => a.port));

  for (let i = 0; i < rangeSize; i++) {
    const port = range.min + ((base - range.min + i) % rangeSize);
    if (RESERVED_PORTS.has(port)) continue;
    if (registeredPorts.has(port)) continue;
    if (await isPortListening(port)) continue;

    data.allocations.push({
      port, projectName, projectPath, serviceName, serviceType,
      allocatedAt: new Date().toISOString(), status: "allocated",
    });
    writeRegistry(data);
    return port;
  }

  throw new Error("No free ports available in configured range");
}

export function markRunning(port, pid, sessionId) {
  const data = readRegistry();
  const alloc = data.allocations.find((a) => a.port === port);
  if (alloc) {
    alloc.status = "running";
    alloc.pid = pid;
    alloc.sessionId = sessionId;
    alloc.lastSeen = new Date().toISOString();
    writeRegistry(data);
  }
}

export function markStopped(port) {
  const data = readRegistry();
  const alloc = data.allocations.find((a) => a.port === port);
  if (alloc) {
    alloc.status = "allocated";
    delete alloc.pid;
    delete alloc.sessionId;
    writeRegistry(data);
  }
}

export function releaseProject(projectPath) {
  const data = readRegistry();
  data.allocations = data.allocations.filter((a) => a.projectPath !== projectPath);
  writeRegistry(data);
}

export function getProjectPorts(projectPath) {
  return readRegistry().allocations.filter((a) => a.projectPath === projectPath);
}

export function getPortOwner(port) {
  return readRegistry().allocations.find((a) => a.port === port) || null;
}

export function cleanupStale() {
  const data = readRegistry();
  const now = Date.now();
  let removed = 0;
  let marked = 0;

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

  writeRegistry(data);
  return { removed, marked };
}
