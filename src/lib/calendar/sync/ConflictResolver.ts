import type { ConflictStrategy } from "../providers/CalendarProviderInterface.js";

interface ConflictEvent {
  updatedAt: string;
}

/**
 * Determine which version of an event wins during sync conflict.
 * Returns "local" or "remote".
 */
export function resolveConflict(
  strategy: ConflictStrategy,
  local: ConflictEvent,
  remote: ConflictEvent
): "local" | "remote" {
  switch (strategy) {
    case "remote-wins":
      return "remote";
    case "local-wins":
      return "local";
    case "newest-wins":
    default: {
      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(remote.updatedAt).getTime();
      return remoteTime >= localTime ? "remote" : "local";
    }
  }
}
