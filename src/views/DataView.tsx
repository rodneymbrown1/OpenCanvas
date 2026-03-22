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
  isGlobalRef?: boolean;
  formattedPath?: string;
}

interface ProjectDataStatus {
  totalFiles: number;
  rawFiles: DataFile[];
  formattedFiles: DataFile[];
  rootFiles: DataFile[];
  hasManifest: boolean;
  phase: string;
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

type Scope = "project" | "global";

function UploadZone({ scope, workDir, onUploaded }: { scope: Scope; workDir: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("scope", scope);
    if (scope === "project") formData.append("workDir", workDir);
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
      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">→ {scope === "global" ? "shared-data" : "data"}/raw/</p>
    </div>
  );
}

function FileList({ files, label, emptyLabel }: { files: DataFile[]; label: string; emptyLabel?: string }) {
  if (files.length === 0) {
    if (emptyLabel) return <p className="text-xs text-[var(--text-muted)] py-2 px-3">{emptyLabel}</p>;
    return null;
  }
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{label} ({files.length})</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {files.map((file) => (
          <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            {file.isGlobalRef ? (
              <Link2 size={12} className="text-[var(--accent)] shrink-0" />
            ) : (
              <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
            )}
            <span className="flex-1 truncate text-[var(--text-secondary)]">{file.name}</span>
            <span className="text-[var(--text-muted)] text-[10px]">
              {file.size > 1024 ? `${(file.size / 1024).toFixed(0)}KB` : `${file.size}B`}
            </span>
            {file.dir === "formatted" ? (
              <span className="flex items-center gap-0.5 text-[var(--success)] text-[10px]"><FileCheck size={10} /> md</span>
            ) : file.formattedPath ? (
              <span className="flex items-center gap-0.5 text-[var(--success)] text-[10px]"><CheckCircle size={10} /> has .md</span>
            ) : (
              <span className="flex items-center gap-0.5 text-[var(--text-muted)] text-[10px]"><Clock size={10} /> raw</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DataView() {
  const { session } = useSession();
  const { workDir } = session;
  const [scope, setScope] = useState<Scope>("project");
  const [projectStatus, setProjectStatus] = useState<ProjectDataStatus | null>(null);
  const [globalStatus, setGlobalStatus] = useState<GlobalDataStatus | null>(null);

  const fetchProject = useCallback(async () => {
    if (!workDir) return;
    try {
      const res = await fetch(`/api/data/status?workDir=${encodeURIComponent(workDir)}&scope=project`);
      if (res.ok) setProjectStatus(await res.json());
    } catch {}
  }, [workDir]);

  const fetchGlobal = useCallback(async () => {
    try {
      const res = await fetch("/api/data/status?scope=global");
      if (res.ok) setGlobalStatus(await res.json());
    } catch {}
  }, []);

  const refresh = useCallback(() => { fetchProject(); fetchGlobal(); }, [fetchProject, fetchGlobal]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleLinkToProject = async (fileName: string) => {
    if (!workDir) return;
    await fetch("/api/data/global", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", fileName, projectDir: workDir }),
    });
    fetchProject();
  };

  const pFiles = [...(projectStatus?.rawFiles || []), ...(projectStatus?.formattedFiles || [])];
  const gFiles = [...(globalStatus?.rawFiles || []), ...(globalStatus?.formattedFiles || [])];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Data Manager</h1>
          <div className="flex rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] p-0.5">
            <button onClick={() => setScope("project")} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${scope === "project" ? "bg-[var(--bg-tertiary)] text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
              Project
            </button>
            <button onClick={() => setScope("global")} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${scope === "global" ? "bg-[var(--bg-tertiary)] text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
              <Globe size={10} /> Global
            </button>
          </div>
        </div>
        <button onClick={refresh} className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {scope === "project" && (
          <>
            {!workDir ? (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Select a workspace folder first.</div>
            ) : (
              <>
                <UploadZone scope="project" workDir={workDir} onUploaded={fetchProject} />
                {projectStatus?.hasManifest && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--success)] px-1"><CheckCircle size={12} /> CLAUDE.md manifest present</div>
                )}
                <FileList files={pFiles} label="Project Data" emptyLabel="No data files yet. Upload documents to get started." />

                {/* Link global data into project */}
                {globalStatus?.configured && gFiles.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                    <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center gap-1"><Globe size={10} /> Link Global Data</span>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {gFiles.map((file) => {
                        const linked = pFiles.some((pf) => pf.name === file.name || pf.name === file.name.replace(/\.[^.]+$/, ".md"));
                        return (
                          <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <Globe size={11} className="text-[var(--accent)] shrink-0" />
                            <span className="flex-1 truncate text-[var(--text-secondary)]">{file.name}</span>
                            {file.dir === "formatted" && <span className="text-[10px] text-[var(--success)]">.md</span>}
                            {linked ? (
                              <span className="text-[10px] text-[var(--text-muted)]">linked</span>
                            ) : (
                              <button onClick={() => handleLinkToProject(file.name)} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors">
                                Link
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {scope === "global" && (
          <>
            {!globalStatus?.configured ? (
              <div className="text-center py-8 text-[var(--text-muted)]">
                <Globe size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Global data not set up</p>
                <p className="text-xs mt-1">Go to Project Manager to set up Open Canvas.</p>
              </div>
            ) : (
              <>
                <div className="text-[11px] text-[var(--text-muted)] px-1 font-mono">{globalStatus.sharedDataDir}</div>
                <UploadZone scope="global" workDir="" onUploaded={fetchGlobal} />
                {globalStatus.hasSkillsMd && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--success)] px-1"><CheckCircle size={12} /> skills.md present</div>
                )}
                {globalStatus.unformatted.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 px-1">
                    <AlertTriangle size={12} /> {globalStatus.unformatted.length} file{globalStatus.unformatted.length !== 1 ? "s" : ""} unformatted
                  </div>
                )}
                <FileList files={globalStatus.formattedFiles} label="Formatted (.md)" emptyLabel="No formatted files yet." />
                <FileList files={globalStatus.rawFiles} label="Raw (unprocessed)" />
                {gFiles.length === 0 && (
                  <div className="text-center py-8 text-[var(--text-muted)]">
                    <FolderOpen size={28} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No global data yet</p>
                    <p className="text-xs mt-1">Upload shared documents that span multiple projects</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
