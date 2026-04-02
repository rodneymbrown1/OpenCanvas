
import { useState, useEffect } from "react";
import { Save, RefreshCw, Power } from "lucide-react";
import type { AppSettings } from "@/lib/globalConfig";
import { logger } from "@/lib/logger";
import { useToast } from "@/lib/ToastContext";

const DEFAULT_SETTINGS: AppSettings = {
  verbose_logging: false,
};

export function OpenCanvasSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/settings/global")
      .then((r) => r.json())
      .then((data) => {
        if (data.app_settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...data.app_settings });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await fetch("/api/settings/global", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_settings: settings }),
      });

      // Sync verbose flag immediately — prints confirmation to console
      if (settings.verbose_logging) {
        logger.enable();
      } else {
        logger.disable();
      }

      // Sync poll debug flag immediately
      if (settings.poll_debug_logging) {
        logger.enablePollDebug();
      } else {
        logger.disablePollDebug();
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast("Settings saved", { type: "success" });
    } catch {
      toast("Failed to save settings", { type: "error" });
    }
  };

  const shutdown = async (killApps: boolean) => {
    setShuttingDown(true);
    setShowShutdownConfirm(false);
    try {
      await fetch("/api/settings/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ killApps }),
      });
    } catch {
      // Expected — server shuts down, connection drops
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">Open Canvas Settings</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          App-level settings for Open Canvas. These can also be set via
          environment variables in <code className="text-[var(--accent)]">.env.local</code> —
          settings here take precedence.
        </p>
      </div>

      {/* Verbose Logging */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Debugging
        </h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            onClick={() =>
              setSettings((s) => ({ ...s, verbose_logging: !s.verbose_logging }))
            }
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.verbose_logging
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] border border-[var(--border)]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.verbose_logging ? "translate-x-5" : ""
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-[var(--text-secondary)]">
              Verbose Logging
            </span>
            <p className="text-xs text-[var(--text-muted)]">
              Enables colored, categorized console logs for pages, navigation,
              sessions, terminals, and API calls. Useful for debugging.
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Env var: <code className="text-[var(--accent)]">VITE_VERBOSE_LOG</code>
            </p>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <button
            onClick={() =>
              setSettings((s) => ({ ...s, poll_debug_logging: !s.poll_debug_logging }))
            }
            className={`relative w-10 h-5 rounded-full transition-colors ${
              settings.poll_debug_logging
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] border border-[var(--border)]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.poll_debug_logging ? "translate-x-5" : ""
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-[var(--text-secondary)]">
              Poll Debug Logging
            </span>
            <p className="text-xs text-[var(--text-muted)]">
              Logs every poll cycle for the jobs, stack, services, ports, and
              file-tree loops — timing, skips, backoff delays, and tab-resume events.
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Env var: <code className="text-[var(--accent)]">VITE_POLL_DEBUG</code>
            </p>
          </div>
        </label>
      </section>

      {/* Environment info */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Environment
        </h2>
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text-muted)]">Config file</span>
            <code className="text-[var(--text-secondary)]">~/.open-canvas/global.yaml</code>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text-muted)]">Env override</span>
            <code className="text-[var(--text-secondary)]">.env.local</code>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text-muted)]">Console access</span>
            <code className="text-[var(--text-secondary)]">window.__ocLogger</code>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          See <code className="text-[var(--accent)]">.env.example</code> for all
          available environment variables and their defaults.
        </p>
      </section>

      {/* Save */}
      <button
        onClick={save}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <Save size={14} />
        {saved ? "Saved!" : "Save Settings"}
      </button>

      {/* Shutdown */}
      <section className="space-y-3 pt-4 border-t border-[var(--border)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Application
        </h2>
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-4 space-y-3">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Shut Down Open Canvas</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Stops the PTY server (port 40001) and Vite (port 40000). You will need to
              restart manually from the command line.
            </p>
          </div>

          {!showShutdownConfirm ? (
            <button
              onClick={() => setShowShutdownConfirm(true)}
              disabled={shuttingDown}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Power size={14} />
              {shuttingDown ? "Shutting down..." : "Shut Down"}
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Also kill running project apps?
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Project apps running on ports 41000–49999 can be left running or
                shut down together with Open Canvas.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => shutdown(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                >
                  <Power size={12} />
                  Shut Down Everything
                </button>
                <button
                  onClick={() => shutdown(false)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors"
                >
                  Open Canvas Only
                </button>
                <button
                  onClick={() => setShowShutdownConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
