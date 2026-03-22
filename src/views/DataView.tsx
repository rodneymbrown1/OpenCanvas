"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/SessionContext";
import {
  Upload,
  FileText,
  FolderOpen,
  RefreshCw,
  CheckCircle,
  Clock,
  Globe,
  Link2,
  AlertTriangle,
  FileCheck,
} from "lucide-react";

interface DataFile {
  name: string;
  path: string;
  size: number;
  dir: string;
  formattedPath?: string;
}

interface GlobalDataStatus {
  configured: boolean;
  sharedDataDir?: string;
  rawFiles: DataFile[];
  formattedFiles: DataFile[];
  rootFiles: DataFile[];
  totalFiles: number;
  hasSkillsMd: boolean;
  unformatted: string[];
}

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("scope", "global");
    for (const file of Array.from(files)) formData.append("files", file);
    try {
      const res = await fetch("/api/data/upload", { method: "POST", body: formData });
      if (res.ok) onUploaded();
    } catch {}
    setUploading(false);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
        dragOver ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] hover:border-[var(--text-muted)]"
      }`}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) handleUpload(e.target.files); }} />
      <Upload size={20} className="mx-auto mb-1.5 text-[var(--text-muted)]" />
      <p className="text-xs text-[var(--text-secondary)]">{uploading ? "Uploading..." : "Drop files or click to upload"}</p>
      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Files go to shared-data/raw/</p>
    </div>
  );
}

export default function DataView() {
  const { session } = useSession();
  const { workDir } = session;
  const [status, setStatus] = useState<GlobalDataStatus | null>(null);

  const fetchGlobal = useCallback(async () => {
    try {
      const res = await fetch("/api/data/status?scope=global");
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchGlobal();
    const interval = setInterval(fetchGlobal, 5000);
    return () => clearInterval(interval);
  }, [fetchGlobal]);

  const handleLinkToProject = async (fileName: string) => {
    if (!workDir) return;
    await fetch("/api/data/global", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", fileName, projectDir: workDir }),
    });
  };

  const allFiles = [...(status?.rawFiles || []), ...(status?.formattedFiles || [])];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--accent)]" />
          <h1 className="text-sm font-semibold">Global Shared Data</h1>
          {status?.configured && (
            <span className="text-[10px] text-[var(--text-muted)]">{status.totalFiles} file{status.totalFiles !== 1 ? "s" : ""}</span>
          )}
        </div>
        <button onClick={fetchGlobal} className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {!status?.configured ? (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <Globe size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">Global data not set up</p>
            <p className="text-xs mt-1">Go to Project Manager to set up Open Canvas.</p>
          </div>
        ) : (
          <>
            <div className="text-[11px] text-[var(--text-muted)] px-1 font-mono">{status.sharedDataDir}</div>

            <UploadZone onUploaded={fetchGlobal} />

            {status.hasSkillsMd && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--success)] px-1"><CheckCircle size={12} /> skills.md present</div>
            )}

            {status.unformatted.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 px-1">
                <AlertTriangle size={12} /> {status.unformatted.length} file{status.unformatted.length !== 1 ? "s" : ""} awaiting formatting
              </div>
            )}

            {status.formattedFiles.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">Formatted ({status.formattedFiles.length})</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {status.formattedFiles.map((file) => (
                    <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <FileCheck size={12} className="text-[var(--success)] shrink-0" />
                      <span className="flex-1 truncate text-[var(--text-secondary)]">{file.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{file.size > 1024 ? `${(file.size / 1024).toFixed(0)}KB` : `${file.size}B`}</span>
                      {workDir && (
                        <button onClick={() => handleLinkToProject(file.name)} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors flex items-center gap-0.5">
                          <Link2 size={9} /> Link
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {status.rawFiles.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">Raw ({status.rawFiles.length})</span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {status.rawFiles.map((file) => (
                    <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
                      <span className="flex-1 truncate text-[var(--text-secondary)]">{file.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{file.size > 1024 ? `${(file.size / 1024).toFixed(0)}KB` : `${file.size}B`}</span>
                      {file.formattedPath ? (
                        <span className="text-[10px] text-[var(--success)] flex items-center gap-0.5"><CheckCircle size={9} /> has .md</span>
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-0.5"><Clock size={9} /> unformatted</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {allFiles.length === 0 && (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <FolderOpen size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No shared data yet</p>
                <p className="text-xs mt-1">Upload documents that span multiple projects</p>
              </div>
            )}

            <div className="pt-3 border-t border-[var(--border)]">
              <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                Global data is shared across all projects. Upload raw files here, format them to .md,
                and link into any project. Add a <span className="font-mono">skills.md</span> to customize agent data handling.
                Project data goes directly into the workspace file explorer via drag-and-drop.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
