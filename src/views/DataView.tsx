
import { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "@/components/FileExplorer";
import { FileEditModal } from "@/components/FileEditModal";
import {
  Globe,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  FileText,
  FolderOpen,
} from "lucide-react";

export default function DataView() {
  const [globalDataDir, setGlobalDataDir] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // File preview state
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  // File edit state
  const [editFile, setEditFile] = useState<{ path: string; isNew?: boolean } | null>(null);

  // Layout
  const [showExplorer, setShowExplorer] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [draggingExplorer, setDraggingExplorer] = useState(false);

  // Bootstrap: ensure global data dir exists
  const bootstrap = useCallback(async () => {
    setInitializing(true);
    try {
      const res = await fetch("/api/data/status?scope=global");
      if (res.ok) {
        const data = await res.json();
        setConfigured(data.configured);
        setGlobalDataDir(data.sharedDataDir || null);
      }
    } catch {}
    setInitializing(false);
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // If not configured, auto-setup
  const handleSetup = async () => {
    setInitializing(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      await bootstrap();
    } catch {}
    setInitializing(false);
  };

  // Load file content when preview path changes
  useEffect(() => {
    if (!previewPath) return;
    setPreviewLoading(true);
    fetch(`/api/files/read?path=${encodeURIComponent(previewPath)}`)
      .then((r) => r.json())
      .then((data) => {
        setPreviewContent(data.content || data.error || "");
        setPreviewLoading(false);
      })
      .catch(() => {
        setPreviewContent("Failed to load file");
        setPreviewLoading(false);
      });
  }, [previewPath]);

  // Explorer resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingExplorer) return;
      setExplorerWidth(Math.max(150, Math.min(e.clientX - 56, 500)));
    },
    [draggingExplorer]
  );
  const handleMouseUp = useCallback(() => setDraggingExplorer(false), []);

  useEffect(() => {
    if (draggingExplorer) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [draggingExplorer, handleMouseMove, handleMouseUp]);

  const previewFileName = previewPath?.split("/").pop() || "";

  // Loading state
  if (initializing) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Globe size={28} className="mx-auto text-[var(--accent)] opacity-60" />
          <p className="text-xs text-[var(--text-muted)]">Loading global data...</p>
        </div>
      </div>
    );
  }

  // Not configured — offer setup
  if (!configured || !globalDataDir) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-sm">
          <Globe size={36} className="mx-auto text-[var(--accent)] opacity-50" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Global Shared Data</h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Set up your global data directory to share files across all projects.
            This creates a managed folder for documents, references, and shared resources.
          </p>
          <button
            onClick={handleSetup}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <FolderOpen size={14} />
            Initialize Global Data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${draggingExplorer ? "select-none cursor-col-resize" : ""}`}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title={showExplorer ? "Hide Explorer" : "Show Explorer"}
          >
            {showExplorer ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <Globe size={14} className="text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">Global Shared Data</span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[300px]">{globalDataDir}</span>
        </div>
        <button
          onClick={bootstrap}
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Main split pane */}
      <div className="flex flex-1 min-h-0">
        {/* File explorer (resizable) */}
        {showExplorer && (
          <>
            <div
              style={{ width: explorerWidth }}
              className="border-r border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden shrink-0"
            >
              <FileExplorer
                rootDir={globalDataDir}
                onFilePreview={setPreviewPath}
                onFileEdit={(path, isNew) => setEditFile({ path, isNew })}
                pollInterval={3000}
              />
            </div>
            <div
              className="w-1 bg-[var(--border)] cursor-col-resize hover:bg-[var(--accent)] transition-colors shrink-0"
              onMouseDown={() => setDraggingExplorer(true)}
            />
          </>
        )}

        {/* File preview pane */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-primary)] flex flex-col">
          {previewPath ? (
            <>
              {/* Preview header */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={13} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-xs font-medium text-[var(--text-secondary)] truncate">{previewFileName}</span>
                  <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[300px]">{previewPath}</span>
                </div>
                <button
                  onClick={() => setPreviewPath(null)}
                  className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
              {/* Preview content */}
              <div className="flex-1 overflow-auto p-4">
                {previewLoading ? (
                  <div className="text-xs text-[var(--text-muted)]">Loading...</div>
                ) : (
                  <pre className="text-xs leading-5 text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono">
                    {previewContent}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <Globe size={32} className="mx-auto text-[var(--text-muted)] opacity-30" />
                <p className="text-sm text-[var(--text-muted)]">Select a file to preview</p>
                <p className="text-xs text-[var(--text-muted)] opacity-70 max-w-xs leading-relaxed">
                  Drag and drop files or folders into the explorer to add them to your global shared data.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {editFile && <FileEditModal filePath={editFile.path} isNew={editFile.isNew} onClose={() => setEditFile(null)} />}
    </div>
  );
}
