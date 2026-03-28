
import { useState, useEffect, useRef } from "react";
import { X, Save, Loader2 } from "lucide-react";

interface FileEditModalProps {
  filePath: string;
  isNew?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditModal({ filePath, isNew, onClose, onSaved }: FileEditModalProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileName = filePath.split("/").pop() || filePath;

  useEffect(() => {
    if (isNew) {
      // New file — start with empty content, focus immediately
      setTimeout(() => textareaRef.current?.focus(), 50);
      return;
    }
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || "");
        setLoading(false);
        setTimeout(() => textareaRef.current?.focus(), 50);
      })
      .catch(() => {
        setContent("");
        setLoading(false);
      });
  }, [filePath, isNew]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      if (res.ok) {
        setDirty(false);
        onSaved?.();
        onClose();
      }
    } catch {}
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl+S to save
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (dirty || isNew) handleSave();
    }
    // Escape to close (if not dirty)
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!dirty) {
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !dirty) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-[750px] max-w-[92vw] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {isNew ? "New File" : "Edit File"}{dirty ? " *" : ""}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] truncate max-w-md">
              {fileName}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSave}
              disabled={saving || (!dirty && !isNew)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-0 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full py-12">
              <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="w-full h-full min-h-[300px] max-h-[calc(85vh-120px)] resize-none bg-[var(--bg-primary)] text-[var(--text-secondary)] text-xs leading-5 font-mono p-4 outline-none border-none"
              placeholder={isNew ? "Start typing..." : ""}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--border)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-muted)]">
            {navigator.platform.includes("Mac") ? "\u2318S" : "Ctrl+S"} to save
          </span>
          {dirty && (
            <span className="text-[10px] text-[var(--warning,var(--accent))]">Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}
