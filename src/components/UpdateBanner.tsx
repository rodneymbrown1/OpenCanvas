import { useState, useEffect, useCallback } from "react";
import { RefreshCw, X, CheckCircle, AlertCircle, GitBranch } from "lucide-react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface VerifyResult {
  remoteUrl: string;
  branch: string;
  expectedRemote: string;
}

type ModalStep = "verify" | "pulling" | "success" | "error";

function UpdateModal({
  onClose,
  onUpdated,
}: {
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [step, setStep] = useState<ModalStep>("verify");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");
  const [pullOutput, setPullOutput] = useState("");

  // Verify remote on open
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/updates/verify");
        const data = await res.json();
        if (data.ok) {
          setVerify(data);
        } else {
          setStep("error");
          setError(data.error || "Could not verify remote.");
        }
      } catch {
        setStep("error");
        setError("Could not reach server.");
      }
    })();
  }, []);

  const handlePull = async () => {
    setStep("pulling");
    try {
      const res = await fetch("/api/updates/pull", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPullOutput(data.stdout || "Already up to date.");
        setStep("success");
        onUpdated();
      } else {
        setStep("error");
        setError(data.error || "Pull failed.");
      }
    } catch {
      setStep("error");
      setError("Could not reach server.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
        style={{
          background: "var(--bg-secondary, #1e1e1e)",
          color: "var(--text-primary, #fff)",
          border: "1px solid var(--border, #333)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border, #333)" }}
        >
          <div className="flex items-center gap-2 font-medium text-sm">
            <GitBranch size={16} />
            Update Open Canvas
          </div>
          <button
            onClick={onClose}
            className="opacity-70 hover:opacity-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 text-sm space-y-3">
          {/* Remote verification */}
          <div className="space-y-2">
            <div className="font-medium text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Git Configuration
            </div>
            {verify ? (
              <div className="space-y-1.5 text-xs" style={{ fontFamily: "monospace" }}>
                <div className="flex items-start gap-2">
                  <CheckCircle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent-green, #22c55e)" }} />
                  <div>
                    <div style={{ color: "var(--text-muted)" }}>Remote (origin):</div>
                    <div>{verify.remoteUrl}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent-green, #22c55e)" }} />
                  <div>
                    <div style={{ color: "var(--text-muted)" }}>Branch:</div>
                    <div>main</div>
                  </div>
                </div>
              </div>
            ) : step === "error" ? null : (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <RefreshCw size={12} className="animate-spin" />
                Verifying git remote...
              </div>
            )}
          </div>

          {/* Pull status */}
          {step === "pulling" && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <RefreshCw size={12} className="animate-spin" />
              Running git pull origin main...
            </div>
          )}

          {step === "success" && (
            <div
              className="rounded px-3 py-2 text-xs"
              style={{ background: "rgba(34,197,94,0.15)", color: "var(--accent-green, #22c55e)" }}
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle size={14} />
                Updated successfully!
              </div>
              {pullOutput && (
                <pre className="mt-1 opacity-80 whitespace-pre-wrap" style={{ fontFamily: "monospace" }}>
                  {pullOutput}
                </pre>
              )}
              <div className="mt-2" style={{ color: "var(--text-muted)" }}>
                Restart Open Canvas to apply changes.
              </div>
            </div>
          )}

          {step === "error" && (
            <div
              className="rounded px-3 py-2 text-xs"
              style={{ background: "rgba(239,68,68,0.15)", color: "var(--error, #ef4444)" }}
            >
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle size={14} />
                Update failed
              </div>
              <div className="mt-1 opacity-80">{error}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--border, #333)" }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs"
            style={{
              background: "var(--bg-tertiary, #2a2a2a)",
              color: "var(--text-secondary)",
            }}
          >
            {step === "success" ? "Close" : "Cancel"}
          </button>
          {step === "verify" && verify && (
            <button
              onClick={handlePull}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: "var(--accent-blue, #3b82f6)",
                color: "#fff",
              }}
            >
              Pull Latest
            </button>
          )}
          {step === "error" && (
            <button
              onClick={handlePull}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: "var(--accent-blue, #3b82f6)",
                color: "#fff",
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function UpdateBanner() {
  const [behind, setBehind] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const checkForUpdates = useCallback(async () => {
    try {
      const res = await fetch("/api/updates/check");
      const data = await res.json();
      if (data.updateAvailable) {
        setBehind(data.behind);
        setDismissed(false);
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

  if (behind === 0 || dismissed) return null;

  return (
    <>
      <div
        className="flex items-center justify-between px-4 py-1.5 text-xs"
        style={{
          background: "var(--accent-blue, #3b82f6)",
          color: "#fff",
        }}
      >
        <span>
          Please update to the latest version —{" "}
          <button
            onClick={() => setShowModal(true)}
            className="underline font-medium hover:opacity-80"
          >
            click here
          </button>
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="opacity-70 hover:opacity-100 ml-2"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {showModal && (
        <UpdateModal
          onClose={() => setShowModal(false)}
          onUpdated={() => {
            setBehind(0);
          }}
        />
      )}
    </>
  );
}
