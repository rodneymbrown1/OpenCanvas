import type { CalendarProvider } from "./CalendarProviderInterface.js";
import { GoogleCalendarProvider } from "./GoogleCalendarProvider.js";

const providers = new Map<string, CalendarProvider>();

// Register built-in providers
providers.set("google", new GoogleCalendarProvider());

export function getProvider(id: string): CalendarProvider | undefined {
  return providers.get(id);
}

export function listProviders(): CalendarProvider[] {
  return Array.from(providers.values());
}

export function registerProvider(provider: CalendarProvider): void {
  providers.set(provider.id, provider);
}

export { GoogleCalendarProvider } from "./GoogleCalendarProvider.js";
export type { CalendarProvider, ConnectionConfig, ExternalCalendarEvent, SyncResult } from "./CalendarProviderInterface.js";
