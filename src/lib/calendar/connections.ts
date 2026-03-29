import fs from "fs";
import path from "path";
import YAML from "yaml";
import { nanoid } from "nanoid";
import { CALENDAR_DIR, ensureCalendarDir } from "../calendarConfig.js";
import type { ConnectionConfig, SyncDirection, ConflictStrategy } from "./providers/CalendarProviderInterface.js";

/** Atomic write: tmp file + rename. Crash-safe. */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

const CONNECTIONS_PATH = path.join(CALENDAR_DIR, "connections.yaml");

interface ConnectionsFile {
  connections: ConnectionConfig[];
}

function readConnectionsFile(): ConnectionsFile {
  ensureCalendarDir();
  if (!fs.existsSync(CONNECTIONS_PATH)) {
    return { connections: [] };
  }
  try {
    const raw = fs.readFileSync(CONNECTIONS_PATH, "utf-8");
    const parsed = YAML.parse(raw) as ConnectionsFile | null;
    return parsed || { connections: [] };
  } catch {
    return { connections: [] };
  }
}

function writeConnectionsFile(data: ConnectionsFile): void {
  ensureCalendarDir();
  const doc = new YAML.Document(data);
  atomicWrite(CONNECTIONS_PATH, doc.toString());
}

export function listConnections(): ConnectionConfig[] {
  return readConnectionsFile().connections;
}

export function getConnection(id: string): ConnectionConfig | undefined {
  return listConnections().find((c) => c.id === id);
}

export function addConnection(
  provider: string,
  credentials: Record<string, string>,
  settings?: {
    direction?: SyncDirection;
    calendars?: string[];
    conflict_resolution?: ConflictStrategy;
  }
): ConnectionConfig {
  const data = readConnectionsFile();
  const connection: ConnectionConfig = {
    id: `${provider}-${nanoid(6)}`,
    provider,
    enabled: true,
    credentials,
    settings: {
      direction: settings?.direction || "bidirectional",
      calendars: settings?.calendars || ["primary"],
      conflict_resolution: settings?.conflict_resolution || "newest-wins",
    },
    sync_state: {
      last_sync: undefined,
      sync_token: undefined,
      error: null,
    },
  };
  data.connections.push(connection);
  writeConnectionsFile(data);
  return connection;
}

export function updateConnection(
  id: string,
  updates: Partial<ConnectionConfig>
): ConnectionConfig | null {
  const data = readConnectionsFile();
  const idx = data.connections.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  data.connections[idx] = {
    ...data.connections[idx],
    ...updates,
    // Deep merge credentials and settings
    credentials: { ...data.connections[idx].credentials, ...(updates.credentials || {}) },
    settings: { ...data.connections[idx].settings, ...(updates.settings || {}) },
    sync_state: { ...data.connections[idx].sync_state, ...(updates.sync_state || {}) },
  };
  writeConnectionsFile(data);
  return data.connections[idx];
}

export function removeConnection(id: string): boolean {
  const data = readConnectionsFile();
  const filtered = data.connections.filter((c) => c.id !== id);
  if (filtered.length === data.connections.length) return false;
  data.connections = filtered;
  writeConnectionsFile(data);
  return true;
}

export function updateSyncState(
  id: string,
  syncState: Partial<ConnectionConfig["sync_state"]>
): void {
  const data = readConnectionsFile();
  const conn = data.connections.find((c) => c.id === id);
  if (!conn) return;
  conn.sync_state = { ...conn.sync_state, ...syncState };
  writeConnectionsFile(data);
}
