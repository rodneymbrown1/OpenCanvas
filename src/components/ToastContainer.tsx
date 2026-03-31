import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToast, type Toast, type ToastType } from "@/lib/ToastContext";

const ICONS: Record<ToastType, React.ReactNode> = {
  error:   <AlertCircle size={15} />,
  success: <CheckCircle2 size={15} />,
  info:    <Info size={15} />,
  warning: <AlertTriangle size={15} />,
};

const COLORS: Record<ToastType, string> = {
  error:   "bg-red-500/10 border-red-500/30 text-red-400",
  success: "bg-green-500/10 border-green-500/30 text-green-400",
  info:    "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-400",
};

function ToastItem({ toast }: { toast: Toast }) {
  const { dismiss } = useToast();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation after mount
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-xs shadow-lg
        max-w-[320px] min-w-[220px] transition-all duration-200
        ${COLORS[toast.type]}
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
      `}
    >
      <span className="mt-px shrink-0">{ICONS[toast.type]}</span>
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 mt-px opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
