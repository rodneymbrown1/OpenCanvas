/**
 * Verbose logging utility for Open Canvas.
 *
 * Priority order (highest wins):
 *   1. Settings → Open Canvas → Verbose Logging (persisted to global.yaml)
 *   2. VITE_VERBOSE_LOG=true in .env
 *   3. localStorage key "oc-verbose" set to "true"
 *   4. window.__ocLogger.enable() from browser console
 *
 * When toggled via Settings UI, the value is written to both global.yaml
 * (server-persisted) and localStorage (instant client-side effect).
 */

type LogCategory =
  | "page"
  | "context"
  | "api"
  | "terminal"
  | "nav"
  | "hydration"
  | "session"
  | "project"
  | "git"
  | "calendar";

const CATEGORY_COLORS: Record<LogCategory, string> = {
  page: "#4ade80",      // green
  context: "#60a5fa",   // blue
  api: "#f59e0b",       // amber
  terminal: "#a78bfa",  // purple
  nav: "#38bdf8",       // sky
  hydration: "#f87171", // red
  session: "#fb923c",   // orange
  project: "#34d399",   // emerald
  git: "#f472b6",       // pink
  calendar: "#06b6d4",  // cyan
};

function isVerbose(): boolean {
  // Check env var (Vite exposes VITE_* vars via import.meta.env)
  try {
    if (import.meta.env?.VITE_VERBOSE_LOG === "true") return true;
  } catch {
    // import.meta.env not available (e.g. in tests)
  }
  // Check localStorage — covers both manual toggle and Settings UI sync
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem("oc-verbose") === "true";
    } catch {
      return false;
    }
  }
  return false;
}

/** Sync verbose flag from server config on app init (non-blocking). */
function syncFromServer() {
  if (typeof window === "undefined") return;
  fetch("/api/settings/global")
    .then((r) => r.json())
    .then((data) => {
      const serverFlag = data.app_settings?.verbose_logging;
      if (typeof serverFlag === "boolean") {
        // Server config is the source of truth — sync to localStorage
        if (serverFlag) {
          localStorage.setItem("oc-verbose", "true");
        } else if (!import.meta.env?.VITE_VERBOSE_LOG) {
          // Only clear if env var isn't forcing it on
          localStorage.removeItem("oc-verbose");
        }
      }
    })
    .catch(() => {});
}

function log(category: LogCategory, message: string, ...data: unknown[]) {
  if (!isVerbose()) return;
  const color = CATEGORY_COLORS[category];
  const prefix = `%c[OC:${category.toUpperCase()}]`;
  const style = `color:${color};font-weight:bold`;
  if (data.length > 0) {
    console.log(prefix, style, message, ...data);
  } else {
    console.log(prefix, style, message);
  }
}

function warn(category: LogCategory, message: string, ...data: unknown[]) {
  if (!isVerbose()) return;
  const prefix = `[OC:${category.toUpperCase()}]`;
  if (data.length > 0) {
    console.warn(prefix, message, ...data);
  } else {
    console.warn(prefix, message);
  }
}

function error(category: LogCategory, message: string, ...data: unknown[]) {
  // Errors always log regardless of verbose flag
  const prefix = `[OC:${category.toUpperCase()}]`;
  if (data.length > 0) {
    console.error(prefix, message, ...data);
  } else {
    console.error(prefix, message);
  }
}

export const logger = {
  /** Log a page/view load */
  page: (message: string, ...data: unknown[]) => log("page", message, ...data),
  /** Log context provider state changes */
  context: (message: string, ...data: unknown[]) => log("context", message, ...data),
  /** Log API calls */
  api: (message: string, ...data: unknown[]) => log("api", message, ...data),
  /** Log terminal operations */
  terminal: (message: string, ...data: unknown[]) => log("terminal", message, ...data),
  /** Log navigation/routing changes */
  nav: (message: string, ...data: unknown[]) => log("nav", message, ...data),
  /** Log hydration-related events */
  hydration: (message: string, ...data: unknown[]) => log("hydration", message, ...data),
  /** Log session state changes */
  session: (message: string, ...data: unknown[]) => log("session", message, ...data),
  /** Log project state changes */
  project: (message: string, ...data: unknown[]) => log("project", message, ...data),
  /** Log git operations */
  git: (message: string, ...data: unknown[]) => log("git", message, ...data),
  /** Log calendar connection & sync operations */
  calendar: (message: string, ...data: unknown[]) => log("calendar", message, ...data),

  /** Warnings (only when verbose) */
  warn: (category: LogCategory, message: string, ...data: unknown[]) =>
    warn(category, message, ...data),
  /** Errors (always logged) */
  error: (category: LogCategory, message: string, ...data: unknown[]) =>
    error(category, message, ...data),

  /** Enable verbose logging (persists to both localStorage and server config) */
  enable: () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("oc-verbose", "true");
      fetch("/api/settings/global", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_settings: { verbose_logging: true } }),
      }).catch(() => {});
      console.log("%c[OC] Verbose logging enabled", "color:#4ade80;font-weight:bold");
    }
  },
  /** Disable verbose logging (persists to both localStorage and server config) */
  disable: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("oc-verbose");
      fetch("/api/settings/global", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_settings: { verbose_logging: false } }),
      }).catch(() => {});
      console.log("%c[OC] Verbose logging disabled", "color:#f87171;font-weight:bold");
    }
  },
  /** Check if verbose logging is active */
  isEnabled: isVerbose,
  /** Re-sync from server config */
  sync: syncFromServer,
};

// On load: sync from server and expose on window
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__ocLogger = logger;
  syncFromServer();
}
