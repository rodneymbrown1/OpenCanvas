import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function UpdateBanner() {
  const [behind, setBehind] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    try {
      const res = await fetch("/api/updates/check");
      const data = await res.json();
      if (data.updateAvailable) {
        setBehind(data.behind);
        setDismissed(false);
        setPullResult(null);
      } else {
        setBehind(0);
      }
    } catch {
      // silently ignore — network/server not ready
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
    const id = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForUpdates]);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const res = await fetch("/api/updates/pull", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPullResult("Updated! Restart Open Canvas to apply changes.");
        setBehind(0);
      } else {
        setPullResult(`Update failed: ${data.error}`);
      }
    } catch {
      setPullResult("Update failed: could not reach server.");
    } finally {
      setUpdating(false);
    }
  };

  if (behind === 0 && !pullResult) return null;
  if (dismissed) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5 text-xs"
      style={{
        background: pullResult?.startsWith("Updated")
          ? "var(--accent-green, #22c55e)"
          : "var(--accent-blue, #3b82f6)",
        color: "#fff",
      }}
    >
      <span>
        {pullResult
          ? pullResult
          : `Open Canvas is ${behind} commit${behind > 1 ? "s" : ""} behind origin/main.`}
      </span>
      <span className="flex items-center gap-2">
        {!pullResult && (
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="underline font-medium hover:opacity-80 disabled:opacity-50 flex items-center gap-1"
          >
            {updating && <RefreshCw size={12} className="animate-spin" />}
            {updating ? "Updating…" : "Update now"}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="opacity-70 hover:opacity-100 ml-2"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
