import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, GitBranch, RefreshCw, ArrowUp, ArrowDown, Upload, Download,
  Plus, Trash2, Check, FileText, Settings, History, Archive,
  Globe, Loader2, AlertCircle, ChevronRight, Copy,
} from "lucide-react";
import type {
  GitRepoStatus, GitBranch as GitBranchType, GitRemote, GitLogEntry,
  GitFileChange, GitStashEntry, GitConfig,
} from "../lib/types/git";
import { logger } from "../lib/logger";

type Tab = "status" | "changes" | "branches" | "remotes" | "stash" | "log" | "settings";

interface Props {
  repoPath: string;
  onClose: () => void;
  onRefresh: () => void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "status", label: "Status", icon: <GitBranch size={14} /> },
  { id: "changes", label: "Changes", icon: <FileText size={14} /> },
  { id: "branches", label: "Branches", icon: <GitBranch size={14} /> },
  { id: "remotes", label: "Remotes", icon: <Globe size={14} /> },
  { id: "stash", label: "Stash", icon: <Archive size={14} /> },
  { id: "log", label: "Log", icon: <History size={14} /> },
  { id: "settings", label: "Settings", icon: <Settings size={14} /> },
];

// ── SSE stream consumer ──────────────────────────────────────────────────────

async function consumeSSE(
  url: string,
  body: object,
  onProgress: (line: string) => void,
  onDone: () => void,
  onError: (msg: string, authRequired?: boolean) => void,
) {
  logger.git(`SSE start: ${url}`, body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reader = res.body?.getReader();
  if (!reader) { onError("No response stream"); return; }
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "progress") onProgress(String(evt.data));
        else if (evt.type === "done") { logger.git(`SSE done: ${url}`); onDone(); }
        else if (evt.type === "error") { logger.error("git", `SSE error: ${url}`, evt.data); onError(evt.data?.message || String(evt.data), evt.data?.authRequired); }
      } catch {}
    }
  }
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export default function GitManagerModal({ repoPath, onClose, onRefresh }: Props) {
  const [tab, setTab] = useState<Tab>("status");

  const repoName = repoPath.split("/").pop() || repoPath;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-[720px] max-w-[92vw] max-h-[80vh] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-[var(--accent)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Git: {repoName}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar tabs */}
          <div className="w-[140px] border-r border-[var(--border)] py-2 flex-shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  tab === t.id
                    ? "bg-[var(--bg-tertiary)] text-[var(--accent)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-4 min-h-[400px]">
            {tab === "status" && <StatusPanel repoPath={repoPath} onRefresh={onRefresh} />}
            {tab === "changes" && <ChangesPanel repoPath={repoPath} onRefresh={onRefresh} />}
            {tab === "branches" && <BranchesPanel repoPath={repoPath} />}
            {tab === "remotes" && <RemotesPanel repoPath={repoPath} />}
            {tab === "stash" && <StashPanel repoPath={repoPath} />}
            {tab === "log" && <LogPanel repoPath={repoPath} />}
            {tab === "settings" && <SettingsPanel repoPath={repoPath} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────────────────────

function Spinner() {
  return <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />;
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded bg-[var(--error)]/10 text-[var(--error)] text-xs">
      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span>{msg}</span>
    </div>
  );
}

function SuccessMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-[var(--success)]/10 text-[var(--success)] text-xs">
      <Check size={13} /> {msg}
    </div>
  );
}

function ProgressBox({ lines, progressRef }: { lines: string[]; progressRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={progressRef} className="mt-2 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] max-h-[120px] overflow-y-auto">
      {lines.map((l, i) => (
        <p key={i} className="text-[10px] font-mono text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap break-all">{l}</p>
      ))}
    </div>
  );
}

const btnPrimary = "px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5";
const btnSecondary = "px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 flex items-center gap-1.5";
const btnDanger = "px-3 py-1.5 text-xs rounded border border-[var(--error)]/30 text-[var(--error)] hover:bg-[var(--error)]/10 disabled:opacity-50 flex items-center gap-1.5";

// ── Status Panel ─────────────────────────────────────────────────────────────

function StatusPanel({ repoPath, onRefresh }: { repoPath: string; onRefresh: () => void }) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opRunning, setOpRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [opResult, setOpResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    logger.git("Fetching repo status", { repoPath });
    try {
      const res = await fetch(`/api/git/status?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.error) { logger.error("git", "Status fetch error", data.error); setError(data.error); }
      else { logger.git("Status fetched", data); setStatus(data); }
    } catch (e: any) { logger.error("git", "Status fetch exception", e.message); setError(e.message); }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight; }, [progress]);

  const runStreamOp = async (op: "push" | "pull" | "fetch") => {
    setOpRunning(op);
    setProgress([]);
    setOpResult(null);
    await consumeSSE(
      `/api/git/${op}`,
      { repoPath },
      (line) => setProgress((p) => [...p, line]),
      () => { setOpResult({ type: "success", msg: `${op} completed successfully` }); setOpRunning(null); fetchStatus(); onRefresh(); },
      (msg) => { setOpResult({ type: "error", msg }); setOpRunning(null); },
    );
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading status...</div>;
  if (error) return <ErrorMsg msg={error} />;
  if (!status) return null;

  return (
    <div className="space-y-4">
      {/* Branch + clean/dirty */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-medium">
          <GitBranch size={12} /> {status.branch}
        </div>
        <span className={`text-xs font-medium ${status.isClean ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
          {status.isClean ? "Clean" : "Uncommitted changes"}
        </span>
        <button onClick={fetchStatus} className="ml-auto p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]" title="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Ahead/behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="flex gap-3 text-xs">
          {status.ahead > 0 && <span className="flex items-center gap-1 text-[var(--success)]"><ArrowUp size={12} /> {status.ahead} ahead</span>}
          {status.behind > 0 && <span className="flex items-center gap-1 text-[var(--warning)]"><ArrowDown size={12} /> {status.behind} behind</span>}
        </div>
      )}

      {/* File counts */}
      {!status.isClean && (
        <div className="flex gap-4 text-xs text-[var(--text-muted)]">
          {status.staged > 0 && <span className="text-[var(--success)]">{status.staged} staged</span>}
          {status.modified > 0 && <span className="text-[var(--warning)]">{status.modified} modified</span>}
          {status.untracked > 0 && <span className="text-[var(--text-muted)]">{status.untracked} untracked</span>}
        </div>
      )}

      {/* Last commit */}
      {status.lastCommit && (
        <div className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] mb-1">Last commit</p>
          <p className="text-xs text-[var(--text-primary)] font-medium">{status.lastCommit.message}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            <span className="font-mono text-[var(--accent)]">{status.lastCommit.shortHash}</span>
            {" by "}{status.lastCommit.author} &middot; {status.lastCommit.date}
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2 pt-1">
        <button onClick={() => runStreamOp("pull")} disabled={!!opRunning} className={btnSecondary}>
          {opRunning === "pull" ? <Spinner /> : <Download size={13} />} Pull
        </button>
        <button onClick={() => runStreamOp("push")} disabled={!!opRunning} className={btnPrimary}>
          {opRunning === "push" ? <Spinner /> : <Upload size={13} />} Push
        </button>
        <button onClick={() => runStreamOp("fetch")} disabled={!!opRunning} className={btnSecondary}>
          {opRunning === "fetch" ? <Spinner /> : <RefreshCw size={13} />} Fetch
        </button>
      </div>

      {progress.length > 0 && <ProgressBox lines={progress} progressRef={progressRef} />}
      {opResult && (opResult.type === "success" ? <SuccessMsg msg={opResult.msg} /> : <ErrorMsg msg={opResult.msg} />)}
    </div>
  );
}

// ── Changes Panel ────────────────────────────────────────────────────────────

function ChangesPanel({ repoPath, onRefresh }: { repoPath: string; onRefresh: () => void }) {
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError("");
    logger.git("Fetching changes", { repoPath });
    try {
      const res = await fetch(`/api/git/diff?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.error) { logger.error("git", "Changes fetch error", data.error); setError(data.error); }
      else { logger.git("Changes fetched", { count: (data.changes || []).length }); setChanges(data.changes || []); }
    } catch (e: any) { logger.error("git", "Changes fetch exception", e.message); setError(e.message); }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { fetchChanges(); }, [fetchChanges]);

  const stagedFiles = changes.filter((c) => c.staged);
  const unstagedFiles = changes.filter((c) => !c.staged);

  const stageFiles = async (files: string[]) => {
    try {
      await fetch("/api/git/stage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, files }),
      });
      fetchChanges();
    } catch (e: any) { setError(e.message || "Failed to stage files"); }
  };

  const unstageFiles = async (files: string[]) => {
    try {
      await fetch("/api/git/unstage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, files }),
      });
      fetchChanges();
    } catch (e: any) { setError(e.message || "Failed to unstage files"); }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    setResult(null);
    logger.git("Committing", { repoPath, messageLen: commitMsg.length });
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, message: commitMsg }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: "Committed successfully" }); setCommitMsg(""); fetchChanges(); onRefresh(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setCommitting(false);
  };

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading changes...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-4">
      {changes.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Working tree is clean — nothing to commit.</p>
      ) : (
        <>
          {/* Unstaged */}
          {unstagedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">Unstaged Changes ({unstagedFiles.length})</p>
                <button onClick={() => stageFiles(unstagedFiles.map((f) => f.path))} className={btnSecondary}>
                  <Plus size={11} /> Stage All
                </button>
              </div>
              <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
                {unstagedFiles.map((f) => (
                  <div key={`u-${f.path}`} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]">
                    <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggleSelect(f.path)} className="accent-[var(--accent)]" />
                    <StatusBadge status={f.status} />
                    <span className="text-[var(--text-secondary)] truncate flex-1 font-mono text-[11px]">{f.path}</span>
                    <button onClick={() => stageFiles([f.path])} className="text-[var(--text-muted)] hover:text-[var(--accent)]" title="Stage"><Plus size={12} /></button>
                  </div>
                ))}
              </div>
              {selected.size > 0 && (
                <button onClick={() => { stageFiles(Array.from(selected).filter((p) => unstagedFiles.some((f) => f.path === p))); setSelected(new Set()); }} className={`${btnSecondary} mt-2`}>
                  Stage Selected ({Array.from(selected).filter((p) => unstagedFiles.some((f) => f.path === p)).length})
                </button>
              )}
            </div>
          )}

          {/* Staged */}
          {stagedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-[var(--success)]">Staged Changes ({stagedFiles.length})</p>
                <button onClick={() => unstageFiles(stagedFiles.map((f) => f.path))} className={btnSecondary}>
                  Unstage All
                </button>
              </div>
              <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
                {stagedFiles.map((f) => (
                  <div key={`s-${f.path}`} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]">
                    <Check size={12} className="text-[var(--success)]" />
                    <StatusBadge status={f.status} />
                    <span className="text-[var(--text-secondary)] truncate flex-1 font-mono text-[11px]">{f.path}</span>
                    <button onClick={() => unstageFiles([f.path])} className="text-[var(--text-muted)] hover:text-[var(--warning)]" title="Unstage"><ArrowDown size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commit form */}
          <div className="pt-2 border-t border-[var(--border)]">
            <textarea
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              rows={3}
              className="w-full px-3 py-2 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCommit(); }}
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-[var(--text-muted)]">{navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to commit</p>
              <button onClick={handleCommit} disabled={committing || !commitMsg.trim() || stagedFiles.length === 0} className={btnPrimary}>
                {committing ? <Spinner /> : <Check size={13} />} Commit ({stagedFiles.length})
              </button>
            </div>
          </div>

          {result && (result.type === "success" ? <SuccessMsg msg={result.msg} /> : <ErrorMsg msg={result.msg} />)}
        </>
      )}
      <button onClick={fetchChanges} className={`${btnSecondary} mt-1`}><RefreshCw size={12} /> Refresh</button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    M: "text-[var(--warning)]",
    A: "text-[var(--success)]",
    D: "text-[var(--error)]",
    R: "text-[var(--accent)]",
    "?": "text-[var(--text-muted)]",
    U: "text-[var(--error)]",
  };
  return <span className={`font-mono text-[10px] font-bold w-3 ${colors[status] || "text-[var(--text-muted)]"}`}>{status}</span>;
}

// ── Branches Panel ───────────────────────────────────────────────────────────

function BranchesPanel({ repoPath }: { repoPath: string }) {
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/git/branches?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setBranches(data.branches || []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  const checkout = async (name: string) => {
    setSwitching(name);
    setResult(null);
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, branch: name }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Switched to ${name}` }); fetchBranches(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setSwitching(null);
  };

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    setCreating(true);
    setResult(null);
    try {
      const res = await fetch("/api/git/create-branch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, name: newBranch.trim() }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Created branch ${newBranch.trim()}` }); setNewBranch(""); fetchBranches(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setCreating(false);
  };

  const deleteBranch = async (name: string) => {
    if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
    setResult(null);
    try {
      const res = await fetch("/api/git/delete-branch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, name }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Deleted ${name}` }); fetchBranches(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading branches...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-4">
      {/* Create branch */}
      <div className="flex gap-2">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createBranch(); }}
          placeholder="New branch name..."
          className="flex-1 px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
        />
        <button onClick={createBranch} disabled={creating || !newBranch.trim()} className={btnPrimary}>
          {creating ? <Spinner /> : <Plus size={13} />} Create
        </button>
      </div>

      {result && (result.type === "success" ? <SuccessMsg msg={result.msg} /> : <ErrorMsg msg={result.msg} />)}

      {/* Local branches */}
      <div>
        <p className="text-xs font-medium text-[var(--text-primary)] mb-2">Local ({localBranches.length})</p>
        <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
          {localBranches.map((b) => (
            <div key={b.name} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)]">
              {b.current && <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
              <span className={`flex-1 font-mono text-[11px] ${b.current ? "text-[var(--accent)] font-medium" : "text-[var(--text-secondary)]"}`}>{b.name}</span>
              {!b.current && (
                <>
                  <button onClick={() => checkout(b.name)} disabled={!!switching} className="text-[var(--text-muted)] hover:text-[var(--accent)]" title="Switch">
                    {switching === b.name ? <Spinner /> : <ChevronRight size={13} />}
                  </button>
                  <button onClick={() => deleteBranch(b.name)} className="text-[var(--text-muted)] hover:text-[var(--error)]" title="Delete">
                    <Trash2 size={12} />
                  </button>
                </>
              )}
              {b.current && <span className="text-[10px] text-[var(--accent)]">current</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Remote branches */}
      {remoteBranches.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--text-primary)] mb-2">Remote ({remoteBranches.length})</p>
          <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
            {remoteBranches.map((b) => (
              <div key={b.name} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)]">
                <Globe size={11} className="text-[var(--text-muted)]" />
                <span className="flex-1 font-mono text-[11px] text-[var(--text-muted)]">{b.name}</span>
                <button onClick={() => checkout(b.name.replace(/^[^/]+\//, ""))} disabled={!!switching} className="text-[var(--text-muted)] hover:text-[var(--accent)]" title="Checkout locally">
                  <Download size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Remotes Panel ────────────────────────────────────────────────────────────

function RemotesPanel({ repoPath }: { repoPath: string }) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchRemotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/git/remotes?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setRemotes(data.remotes || []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { fetchRemotes(); }, [fetchRemotes]);

  const addRemote = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    setResult(null);
    try {
      const res = await fetch("/api/git/remote-add", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, name: newName.trim(), url: newUrl.trim() }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Added remote "${newName.trim()}"` }); setNewName(""); setNewUrl(""); fetchRemotes(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setAdding(false);
  };

  const removeRemote = async (name: string) => {
    if (!confirm(`Remove remote "${name}"?`)) return;
    setResult(null);
    try {
      const res = await fetch("/api/git/remote-remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, name }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Removed "${name}"` }); fetchRemotes(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
  };

  const saveUrl = async (name: string) => {
    if (!editUrl.trim()) return;
    setResult(null);
    try {
      const res = await fetch("/api/git/remote-set-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, name, url: editUrl.trim() }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: `Updated URL for "${name}"` }); setEditingRemote(null); fetchRemotes(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading remotes...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-4">
      {/* Add remote */}
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (e.g. origin)" className="w-[120px] px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]" />
        <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="URL" className="flex-1 px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]" onKeyDown={(e) => { if (e.key === "Enter") addRemote(); }} />
        <button onClick={addRemote} disabled={adding || !newName.trim() || !newUrl.trim()} className={btnPrimary}>
          {adding ? <Spinner /> : <Plus size={13} />} Add
        </button>
      </div>

      {result && (result.type === "success" ? <SuccessMsg msg={result.msg} /> : <ErrorMsg msg={result.msg} />)}

      {remotes.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No remotes configured.</p>
      ) : (
        <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
          {remotes.map((r) => (
            <div key={r.name} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)]">{r.name}</span>
                <span className="flex-1" />
                <button onClick={() => { setEditingRemote(editingRemote === r.name ? null : r.name); setEditUrl(r.fetchUrl); }} className="text-[var(--text-muted)] hover:text-[var(--accent)]" title="Edit URL">
                  <Settings size={12} />
                </button>
                <button onClick={() => removeRemote(r.name)} className="text-[var(--text-muted)] hover:text-[var(--error)]" title="Remove">
                  <Trash2 size={12} />
                </button>
              </div>
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-1 truncate" title={r.fetchUrl}>{r.fetchUrl}</p>
              {editingRemote === r.name && (
                <div className="flex gap-2 mt-2">
                  <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" onKeyDown={(e) => { if (e.key === "Enter") saveUrl(r.name); }} />
                  <button onClick={() => saveUrl(r.name)} className={btnPrimary}>Save</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stash Panel ──────────────────────────────────────────────────────────────

function StashPanel({ repoPath }: { repoPath: string }) {
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stashMsg, setStashMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchStashes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/git/stash-list?path=${encodeURIComponent(repoPath)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setStashes(data.stashes || []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { fetchStashes(); }, [fetchStashes]);

  const stashSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/git/stash-save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, message: stashMsg || undefined }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: "Changes stashed" }); setStashMsg(""); fetchStashes(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setSaving(false);
  };

  const stashApply = async (index: number) => {
    setResult(null);
    try {
      const res = await fetch("/api/git/stash-apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, index }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else setResult({ type: "success", msg: `Applied stash@{${index}}` });
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
  };

  const stashDrop = async (index: number) => {
    if (!confirm(`Drop stash@{${index}}? This cannot be undone.`)) return;
    setResult(null);
    try {
      const res = await fetch("/api/git/stash-drop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, index }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: "Stash dropped" }); fetchStashes(); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading stashes...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-4">
      {/* Save stash */}
      <div className="flex gap-2">
        <input value={stashMsg} onChange={(e) => setStashMsg(e.target.value)} placeholder="Stash message (optional)..." className="flex-1 px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]" onKeyDown={(e) => { if (e.key === "Enter") stashSave(); }} />
        <button onClick={stashSave} disabled={saving} className={btnPrimary}>
          {saving ? <Spinner /> : <Archive size={13} />} Stash
        </button>
      </div>

      {result && (result.type === "success" ? <SuccessMsg msg={result.msg} /> : <ErrorMsg msg={result.msg} />)}

      {stashes.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No stashes saved.</p>
      ) : (
        <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)]">
          {stashes.map((s) => (
            <div key={s.index} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)]">
              <span className="font-mono text-[10px] text-[var(--accent)]">@{s.index}</span>
              <span className="flex-1 text-[var(--text-secondary)] truncate">{s.message}</span>
              <span className="text-[10px] text-[var(--text-muted)]">{s.date}</span>
              <button onClick={() => stashApply(s.index)} className="text-[var(--text-muted)] hover:text-[var(--success)]" title="Apply"><Download size={12} /></button>
              <button onClick={() => stashDrop(s.index)} className="text-[var(--text-muted)] hover:text-[var(--error)]" title="Drop"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Log Panel ────────────────────────────────────────────────────────────────

function LogPanel({ repoPath }: { repoPath: string }) {
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/log?path=${encodeURIComponent(repoPath)}`);
        const data = await res.json();
        if (data.error) setError(data.error);
        else setEntries(data.entries || []);
      } catch (e: any) { setError(e.message); }
      setLoading(false);
    })();
  }, [repoPath]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading log...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-0">
      {entries.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No commits found.</p>
      ) : (
        <div className="rounded border border-[var(--border)] divide-y divide-[var(--border)] max-h-[500px] overflow-y-auto">
          {entries.map((e) => (
            <div
              key={e.hash}
              className="px-3 py-2 hover:bg-[var(--bg-tertiary)] cursor-pointer"
              onClick={() => setExpandedHash(expandedHash === e.hash ? null : e.hash)}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-[var(--accent)] mt-0.5 flex-shrink-0">{e.shortHash}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--text-primary)] truncate">{e.message}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {e.author} &middot; {e.date}
                    {e.refs && <span className="ml-2 text-[var(--accent)]">({e.refs})</span>}
                  </p>
                </div>
                <button
                  onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(e.hash); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0 mt-0.5"
                  title="Copy full hash"
                >
                  <Copy size={11} />
                </button>
              </div>
              {expandedHash === e.hash && (
                <div className="mt-2 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)]">
                  <p className="text-[10px] font-mono text-[var(--text-muted)] break-all">{e.hash}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ repoPath }: { repoPath: string }) {
  const [config, setConfig] = useState<GitConfig>({ userName: "", userEmail: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/git/config?path=${encodeURIComponent(repoPath)}`);
        const data = await res.json();
        if (data.error) setError(data.error);
        else setConfig({ userName: data.userName || "", userEmail: data.userEmail || "" });
      } catch (e: any) { setError(e.message); }
      setLoading(false);
    })();
  }, [repoPath]);

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/git/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, userName: config.userName, userEmail: config.userEmail }),
      });
      const data = await res.json();
      if (data.error) setResult({ type: "error", msg: data.error });
      else { setResult({ type: "success", msg: "Settings saved" }); setDirty(false); }
    } catch (e: any) { setResult({ type: "error", msg: e.message }); }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Spinner /> Loading settings...</div>;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[var(--text-primary)] mb-3">Repository Git Config</p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-1">user.name</label>
            <input
              value={config.userName}
              onChange={(e) => { setConfig((c) => ({ ...c, userName: e.target.value })); setDirty(true); }}
              placeholder="Your Name"
              className="w-full px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-muted)] block mb-1">user.email</label>
            <input
              value={config.userEmail}
              onChange={(e) => { setConfig((c) => ({ ...c, userEmail: e.target.value })); setDirty(true); }}
              placeholder="you@example.com"
              className="w-full px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !dirty} className={btnPrimary}>
          {saving ? <Spinner /> : <Check size={13} />} Save Settings
        </button>
        {result && (result.type === "success" ? <SuccessMsg msg={result.msg} /> : <ErrorMsg msg={result.msg} />)}
      </div>

      <div className="pt-3 border-t border-[var(--border)]">
        <p className="text-[10px] text-[var(--text-muted)]">
          These settings are saved to the repository's local git config (.git/config) and override global settings for this repo only.
        </p>
      </div>
    </div>
  );
}
