"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/SessionContext";
import { useProject } from "@/lib/ProjectContext";
import {
  Upload,
  FileText,
  FolderOpen,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

interface DataFile {
  name: string;
  path: string;
  size: number;
  dir: "raw" | "formatted" | "other";
}

interface DataStatus {
  totalFiles: number;
  rawFiles: DataFile[];
  formattedFiles: DataFile[];
  hasManifest: boolean;
  phase: string;
}

export default function DataView() {
  const { session } = useSession();
  const { workDir } = session;

  const [status, setStatus] = useState<DataStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = useCallback(async () => {
    if (!workDir) return;
    try {
      const res = await fetch(`/api/data/status?workDir=${encodeURIComponent(workDir)}`);
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // API not ready yet
    }
  }, [workDir]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleUpload = async (files: FileList | File[]) => {
    if (!workDir || files.length === 0) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("workDir", workDir);
    for (const file of Array.from(files)) {
      formData.append("files", file);
    }

    try {
      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const allFiles = [...(status?.rawFiles || []), ...(status?.formattedFiles || [])];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Data Manager</h1>
          {status && (
            <span className="text-xs text-[var(--text-muted)]">
              {status.totalFiles} file{status.totalFiles !== 1 ? "s" : ""}
            </span>
          )}
          {status?.hasManifest && (
            <span className="flex items-center gap-1 text-xs text-[var(--success)]">
              <CheckCircle size={11} /> CLAUDE.md
            </span>
          )}
        </div>
        <button
          onClick={fetchStatus}
          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!workDir ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
            Select a workspace folder first.
          </div>
        ) : (
          <>
            {/* Upload dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                dragOver
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--border)] hover:border-[var(--text-muted)]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleUpload(e.target.files);
                }}
              />
              <Upload size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                {uploading ? "Uploading..." : "Drop files here or click to upload"}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                PDF, DOCX, TXT, CSV, MD — files go to data/raw/
              </p>
            </div>

            {/* File list */}
            {allFiles.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Project Data</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {allFiles.map((file) => (
                    <div key={file.path} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                      <span className="flex-1 truncate text-[var(--text-secondary)]">{file.name}</span>
                      <span className="text-[var(--text-muted)]">
                        {file.size > 1024 ? `${(file.size / 1024).toFixed(0)}KB` : `${file.size}B`}
                      </span>
                      {file.dir === "formatted" ? (
                        <span className="flex items-center gap-1 text-[var(--success)]">
                          <CheckCircle size={11} /> formatted
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[var(--text-muted)]">
                          <Clock size={11} /> raw
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {allFiles.length === 0 && !loading && (
              <div className="text-center py-12 text-[var(--text-muted)]">
                <FolderOpen size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">No data files yet</p>
                <p className="text-xs mt-1">Upload documents to get started</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
