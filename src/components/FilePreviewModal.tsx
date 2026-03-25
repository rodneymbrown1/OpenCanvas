
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FilePreviewModalProps {
  filePath: string;
  onClose: () => void;
}

export function FilePreviewModal({ filePath, onClose }: FilePreviewModalProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  const fileName = filePath.split("/").pop() || filePath;
  const isMarkdown = /\.md$/i.test(fileName);

  useEffect(() => {
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content || data.error || "");
        setLoading(false);
      })
      .catch(() => {
        setContent("Failed to load file");
        setLoading(false);
      });
  }, [filePath]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {fileName}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] truncate max-w-md">
              {filePath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-xs text-[var(--text-muted)]">Loading...</div>
          ) : isMarkdown ? (
            <div className="markdown-body text-sm text-[var(--text-secondary)] leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="text-xs leading-5 text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
