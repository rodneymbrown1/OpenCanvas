
import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  FilePlus,
  FolderPlus,
  Trash2,
  Eye,
  ExternalLink,
  ChevronsDownUp,
  FolderSearch,
  Link2,
  Database,
  Pencil,
  GitBranch,
  Settings,
} from "lucide-react";
import { useView } from "../lib/ViewContext";
import { logger } from "../lib/logger";
import { useToast } from "../lib/ToastContext";
import GitManagerModal from "./GitManagerModal";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  isSymlink?: boolean;
  children?: FileEntry[];
}

interface FileExplorerProps {
  onFilePreview: (path: string) => void;
  onFileEdit?: (path: string, isNew?: boolean) => void;
  rootDir?: string;
  dragMode?: "move" | "link";
  onLinkDrop?: (source: string, targetDir: string) => void;
  onOpenGlobalPicker?: (targetDir: string) => void;
  readOnly?: boolean;
  pollInterval?: number;
}

interface ContextMenu {
  x: number;
  y: number;
  entry: FileEntry;
}

interface CreatingState {
  dir: string;
  type: "file" | "folder";
}

/** Recursively read all files from a FileSystemDirectoryEntry */
function readEntryRecursive(entry: FileSystemEntry, basePath: string): Promise<{ file: File; relativePath: string }[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        resolve([{ file, relativePath: basePath + file.name }]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const allEntries: FileSystemEntry[] = [];
      const readBatch = () => {
        dirReader.readEntries((entries) => {
          if (entries.length === 0) {
            Promise.all(
              allEntries.map((child) =>
                readEntryRecursive(child, basePath + entry.name + "/")
              )
            ).then((results) => resolve(results.flat()));
          } else {
            allEntries.push(...entries);
            readBatch();
          }
        }, () => resolve([]));
      };
      readBatch();
    } else {
      resolve([]);
    }
  });
}

/** Build a flat list of visible paths from a tree + expanded set */
function flattenVisible(entries: FileEntry[], expandedPaths: Set<string>): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.path);
    if (entry.type === "directory" && expandedPaths.has(entry.path) && entry.children) {
      result.push(...flattenVisible(entry.children, expandedPaths));
    }
  }
  return result;
}

// Shared drag state across all FileExplorer instances
let dragSource: { path: string; mode: "move" | "link" } | null = null;

// ── Explorer Context ────────────────────────────────────────────────────────
// Shared state passed via context so nested FileTreeNode instances
// can read expanded state, creating state, etc. without prop drilling.

interface ExplorerContextType {
  expandedPaths: Set<string>;
  selectedPath: string | null;
  focusedPath: string | null;
  creatingIn: CreatingState | null;
  renamingPath: string | null;
  dragMode?: "move" | "link";
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onDoubleClick: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onInternalDrop: (source: string, targetDir: string) => void;
  onExternalDrop: (files: FileList, targetDir: string, dataTransfer?: DataTransfer) => void;
  onLinkDrop?: (source: string, targetDir: string) => void;
  onCreateSubmit: (name: string) => void;
  onCreateCancel: () => void;
  onRenameSubmit: (newName: string) => void;
  onRenameCancel: () => void;
}

const ExplorerContext = createContext<ExplorerContextType | null>(null);

function useExplorer() {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error("useExplorer must be used within ExplorerContext");
  return ctx;
}

// ── Inline Inputs ───────────────────────────────────────────────────────────

function InlineCreateInput({
  type,
  depth,
}: {
  type: "file" | "folder";
  depth: number;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const { onCreateSubmit, onCreateCancel } = useExplorer();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (name.trim()) {
          submittedRef.current = true;
          onCreateSubmit(name.trim());
        }
      }}
      className="flex items-center gap-1 px-2 py-0.5"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="w-3.5" />
      {type === "folder" ? (
        <Folder size={14} className="shrink-0 text-[var(--accent)]" />
      ) : (
        <File size={14} className="shrink-0 text-[var(--text-muted)]" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={type === "file" ? "filename.ts" : "folder-name"}
        className="flex-1 bg-[var(--bg-secondary)] border border-[var(--accent)] rounded px-1.5 py-0 text-xs focus:outline-none min-w-0"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCreateCancel();
        }}
        onBlur={() => {
          // Delay to let submit handler fire first
          setTimeout(() => {
            if (!submittedRef.current && !name.trim()) onCreateCancel();
          }, 0);
        }}
      />
    </form>
  );
}

function InlineRenameInput({
  initialName,
  depth,
  isDir,
  entry,
}: {
  initialName: string;
  depth: number;
  isDir: boolean;
  entry: FileEntry;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const { onRenameSubmit, onRenameCancel } = useExplorer();

  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current && !isDir) {
      const dotIndex = initialName.lastIndexOf(".");
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    } else {
      inputRef.current?.select();
    }
  }, [initialName, isDir]);

  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  const getFileColor = () => {
    if (["ts", "tsx"].includes(ext)) return "text-blue-400";
    if (["js", "jsx", "mjs"].includes(ext)) return "text-yellow-400";
    if (["md", "mdx"].includes(ext)) return "text-gray-400";
    if (["json", "yaml", "yml"].includes(ext)) return "text-green-400";
    if (["css", "scss"].includes(ext)) return "text-pink-400";
    if (["py"].includes(ext)) return "text-emerald-400";
    return "text-[var(--text-muted)]";
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        submittedRef.current = true;
        if (name.trim() && name.trim() !== initialName) onRenameSubmit(name.trim());
        else onRenameCancel();
      }}
      className="w-full flex items-center gap-1 px-2 py-0.5"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {isDir ? (
        <>
          <ChevronRight size={14} className="shrink-0" />
          <Folder size={14} className="shrink-0 text-[var(--accent)]" />
        </>
      ) : (
        <>
          <span className="w-3.5" />
          <File size={14} className={`shrink-0 ${getFileColor()}`} />
        </>
      )}
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 bg-[var(--bg-secondary)] border border-[var(--accent)] rounded px-1.5 py-0 text-xs focus:outline-none min-w-0"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onRenameCancel();
        }}
        onBlur={() => {
          setTimeout(() => {
            if (submittedRef.current) return;
            if (name.trim() && name.trim() !== initialName) onRenameSubmit(name.trim());
            else onRenameCancel();
          }, 0);
        }}
      />
      {entry.isSymlink && (
        <span title="Linked from global data"><Link2 size={9} className="text-[var(--accent)] shrink-0 ml-0.5" /></span>
      )}
    </form>
  );
}

// ── Tree Node ───────────────────────────────────────────────────────────────

function FileTreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const {
    expandedPaths, selectedPath, focusedPath, creatingIn, renamingPath, dragMode,
    onToggleExpand, onSelect, onDoubleClick, onContextMenu,
    onInternalDrop, onExternalDrop, onLinkDrop,
    onCreateSubmit, onCreateCancel,
  } = useExplorer();

  const [dropTarget, setDropTarget] = useState(false);

  const isDir = entry.type === "directory";
  const isSelected = entry.path === selectedPath;
  const isFocused = entry.path === focusedPath;
  const expanded = isDir && expandedPaths.has(entry.path);
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  const isBeingRenamed = renamingPath === entry.path;

  const getFileColor = () => {
    if (["ts", "tsx"].includes(ext)) return "text-blue-400";
    if (["js", "jsx", "mjs"].includes(ext)) return "text-yellow-400";
    if (["md", "mdx"].includes(ext)) return "text-gray-400";
    if (["json", "yaml", "yml"].includes(ext)) return "text-green-400";
    if (["css", "scss"].includes(ext)) return "text-pink-400";
    if (["py"].includes(ext)) return "text-emerald-400";
    return "text-[var(--text-muted)]";
  };

  const handleDragStart = (e: React.DragEvent) => {
    dragSource = { path: entry.path, mode: dragMode || "move" };
    e.dataTransfer.effectAllowed = dragMode === "link" ? "link" : "move";
    e.dataTransfer.setData("text/plain", entry.path);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDir) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragSource
      ? (dragSource.mode === "link" ? "link" : "move")
      : "copy";
    setDropTarget(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(false);
    if (!isDir) return;
    if (e.dataTransfer.files.length > 0 && !dragSource) {
      onExternalDrop(e.dataTransfer.files, entry.path, e.dataTransfer);
    } else if (dragSource && dragSource.path !== entry.path) {
      if (dragSource.mode === "link" && onLinkDrop) {
        onLinkDrop(dragSource.path, entry.path);
      } else {
        onInternalDrop(dragSource.path, entry.path);
      }
      dragSource = null;
    }
  };

  const renderChildren = () => {
    if (!isDir || !expanded || !entry.children) return null;
    const isCreatingHere = creatingIn && creatingIn.dir === entry.path;
    const children = entry.children;

    if (!isCreatingHere) {
      if (children.length === 0) {
        return (
          <div
            className="text-[10px] text-[var(--text-muted)] italic"
            style={{ paddingLeft: `${(depth + 1) * 12 + 26}px` }}
          >
            (empty)
          </div>
        );
      }
      return children.map((child) => (
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
      ));
    }

    // Insert the create input at the correct sorted position
    const isFolder = creatingIn.type === "folder";
    const result: React.ReactNode[] = [];
    let inserted = false;

    for (const child of children) {
      const childIsDir = child.type === "directory";
      if (!inserted) {
        if (isFolder && !childIsDir) {
          // Insert new folder input before first file
          result.push(
            <InlineCreateInput key="__creating__" type="folder" depth={depth + 1} />
          );
          inserted = true;
        } else if (!isFolder && !childIsDir) {
          // Insert new file input at start of files section
          result.push(
            <InlineCreateInput key="__creating__" type="file" depth={depth + 1} />
          );
          inserted = true;
        }
      }
      result.push(
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
      );
    }

    if (!inserted) {
      result.push(
        <InlineCreateInput key="__creating__" type={creatingIn.type} depth={depth + 1} />
      );
    }

    return result;
  };

  if (isBeingRenamed) {
    return (
      <div>
        <InlineRenameInput initialName={entry.name} depth={depth} isDir={isDir} entry={entry} />
        {renderChildren()}
      </div>
    );
  }

  return (
    <div>
      <button
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropTarget(false)}
        onDrop={handleDrop}
        onDragEnd={() => { dragSource = null; }}
        onClick={() => { onSelect(entry.path); if (isDir) onToggleExpand(entry.path); }}
        onDoubleClick={() => onDoubleClick(entry.path)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className={`w-full flex items-center gap-1 px-2 py-0.5 text-xs transition-colors ${
          dropTarget
            ? "bg-[var(--accent)]/10 ring-1 ring-[var(--accent)] ring-inset"
            : isSelected
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        } ${isFocused && !isSelected ? "outline outline-1 outline-[var(--accent)] -outline-offset-1" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        data-path={entry.path}
      >
        {isDir ? (
          <>
            {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            {expanded ? <FolderOpen size={14} className="shrink-0 text-[var(--accent)]" /> : <Folder size={14} className="shrink-0 text-[var(--accent)]" />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={14} className={`shrink-0 ${getFileColor()}`} />
          </>
        )}
        <span className="truncate">{entry.name}</span>
        {entry.isSymlink && (
          <span title="Linked from global data"><Link2 size={9} className="text-[var(--accent)] shrink-0 ml-0.5" /></span>
        )}
      </button>
      {renderChildren()}
    </div>
  );
}

// ── Main FileExplorer ───────────────────────────────────────────────────────

export function FileExplorer({ onFilePreview, onFileEdit, rootDir, dragMode, onLinkDrop, onOpenGlobalPicker, readOnly, pollInterval }: FileExplorerProps) {
  const { setView } = useView();
  const { toast } = useToast();
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [creatingIn, setCreatingIn] = useState<CreatingState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState(false);
  const [gitCloneTarget, setGitCloneTarget] = useState<string | null>(null);
  const [gitCloneUrl, setGitCloneUrl] = useState("");
  const [gitCloning, setGitCloning] = useState(false);
  const [gitCloneError, setGitCloneError] = useState("");
  const [gitCloneProgress, setGitCloneProgress] = useState<string[]>([]);
  const [gitCloneAuthHint, setGitCloneAuthHint] = useState(false);
  const gitCloneProgressRef = useRef<HTMLDivElement>(null);
  const [gitManagerPath, setGitManagerPath] = useState<string | null>(null);
  const gitRepoCacheRef = useRef<Map<string, boolean>>(new Map());

  // Persistent expanded state — survives tree refreshes
  const expandedPathsRef = useRef<Set<string>>(new Set());
  const [expandedVersion, setExpandedVersion] = useState(0);
  const treeRef = useRef<FileEntry[]>([]);
  const lastTreeJsonRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const toggleExpand = useCallback((path: string) => {
    if (expandedPathsRef.current.has(path)) {
      expandedPathsRef.current.delete(path);
    } else {
      expandedPathsRef.current.add(path);
    }
    setExpandedVersion((v) => v + 1);
  }, []);

  const collapseAll = useCallback(() => {
    expandedPathsRef.current.clear();
    setExpandedVersion((v) => v + 1);
  }, []);

  const fetchTree = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const url = rootDir ? `/api/files?dir=${encodeURIComponent(rootDir)}` : "/api/files";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const newJson = JSON.stringify(data.tree);
        if (silent && newJson === lastTreeJsonRef.current) return;
        lastTreeJsonRef.current = newJson;
        treeRef.current = data.tree;
        setTree(data.tree);
        setRoot(data.root);
        if (!initializedRef.current && data.tree.length > 0) {
          for (const entry of data.tree) {
            if (entry.type === "directory") {
              expandedPathsRef.current.add(entry.path);
            }
          }
          setExpandedVersion((v) => v + 1);
          initializedRef.current = true;
        }
      }
    } catch {}
    if (!silent) setLoading(false);
  }, [rootDir]);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  // Polling for auto-refresh
  useEffect(() => {
    if (!pollInterval || pollInterval <= 0) return;
    const interval = setInterval(() => fetchTree(true), pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, fetchTree]);

  useEffect(() => { const h = () => setContextMenu(null); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, []);

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
    // Async-detect git repo for directories
    if (entry.type === "directory" && !gitRepoCacheRef.current.has(entry.path)) {
      logger.git("Detecting git repo", { path: entry.path });
      fetch(`/api/git/detect?path=${encodeURIComponent(entry.path)}`)
        .then((r) => r.json())
        .then((d) => { logger.git("Git detect result", { path: entry.path, isRepo: d.isRepo }); gitRepoCacheRef.current.set(entry.path, !!d.isRepo); setContextMenu((prev) => prev ? { ...prev } : null); })
        .catch((e) => { logger.error("git", "Git detect failed", e); });
    }
  };

  const getCreateDir = (): string => {
    if (!selectedPath) return root;
    const entry = findEntry(tree, selectedPath);
    if (entry?.type === "directory") return selectedPath;
    const parts = selectedPath.split("/"); parts.pop(); return parts.join("/");
  };

  const startCreating = (type: "file" | "folder") => {
    const dir = getCreateDir();
    setCreatingIn({ dir, type });
    if (dir !== root) {
      expandedPathsRef.current.add(dir);
      setExpandedVersion((v) => v + 1);
    }
  };

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!creatingIn) return;
    const newPath = `${creatingIn.dir}/${name}`;
    const isFile = creatingIn.type === "file";
    try {
      await fetch("/api/files/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: newPath,
          type: isFile ? "file" : "directory",
        }),
      });
    } catch {
      toast(`Failed to create ${isFile ? "file" : "folder"}`, { type: "error" });
    }
    setCreatingIn(null);
    fetchTree();
    // Open edit modal for newly created files
    if (isFile && onFileEdit) {
      onFileEdit(newPath, true);
    }
  }, [creatingIn, fetchTree, onFileEdit, toast]);

  const handleCreateCancel = useCallback(() => {
    setCreatingIn(null);
  }, []);

  const handleRenameSubmit = useCallback(async (newName: string) => {
    if (!renamingPath) return;
    const parentDir = renamingPath.split("/").slice(0, -1).join("/");
    const newPath = `${parentDir}/${newName}`;
    try {
      await fetch("/api/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: renamingPath, destination: newPath }),
      });
    } catch {
      toast("Failed to rename", { type: "error" });
    }
    setRenamingPath(null);
    fetchTree();
  }, [renamingPath, fetchTree, toast]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);

  }, []);

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete "${path.split("/").pop()}"?`)) return;
    await fetch("/api/files/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    if (selectedPath === path) setSelectedPath(null);
    fetchTree();
  };

  const handleGitClone = async () => {
    if (!gitCloneTarget || !gitCloneUrl.trim()) return;
    setGitCloning(true);
    setGitCloneError("");
    setGitCloneProgress([]);
    setGitCloneAuthHint(false);
    try {
      const resp = await fetch("/api/files/git-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gitCloneUrl.trim(), targetDir: gitCloneTarget }),
      });

      // If response is not SSE (e.g. 400 validation error), handle as JSON
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await resp.json();
        if (!resp.ok) {
          setGitCloneError(data.error || "Clone failed");
        }
        setGitCloning(false);
        return;
      }

      // Read SSE stream
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let cloneSucceeded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine.slice(6));
            if (evt.type === "progress") {
              setGitCloneProgress((prev) => {
                // Replace last line if it's a progress update (contains %)
                const line = typeof evt.data === "string" ? evt.data : String(evt.data);
                if (line.includes("%") && prev.length > 0 && prev[prev.length - 1].includes("%")) {
                  return [...prev.slice(0, -1), line];
                }
                return [...prev, line];
              });
              // Auto-scroll progress
              setTimeout(() => gitCloneProgressRef.current?.scrollTo({ top: gitCloneProgressRef.current.scrollHeight }), 0);
            } else if (evt.type === "done") {
              cloneSucceeded = true;
              setGitCloneProgress((prev) => [...prev, "Clone complete!"]);
            } else if (evt.type === "error") {
              const errData = evt.data;
              if (typeof errData === "object" && errData.authRequired) {
                setGitCloneAuthHint(true);
                setGitCloneError(errData.message || "Clone failed — authentication may be required");
              } else {
                setGitCloneError(typeof errData === "string" ? errData : errData?.message || "Clone failed");
              }
            }
          } catch {}
        }
      }

      if (cloneSucceeded) {
        expandedPathsRef.current.add(gitCloneTarget);
        setExpandedVersion((v) => v + 1);
        fetchTree();
        // Brief delay so user can see "Clone complete!" before closing
        await new Promise((r) => setTimeout(r, 1000));
        setGitCloneTarget(null);
        setGitCloneUrl("");
        setGitCloneProgress([]);
      }
    } catch (err) {
      setGitCloneError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setGitCloning(false);
    }
  };

  const handleInternalDrop = useCallback(async (source: string, targetDir: string) => {
    try {
      await fetch("/api/files/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, destination: targetDir }) });
    } catch {
      toast("Failed to move file", { type: "error" });
    }
    fetchTree();
  }, [fetchTree, toast]);

  const handleLinkDropInternal = useCallback(async (source: string, targetDir: string) => {
    try {
      await fetch("/api/files/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, targetDir }) });
    } catch {
      toast("Failed to link file", { type: "error" });
    }
    fetchTree();
  }, [fetchTree, toast]);

  const handleExternalDrop = useCallback(async (files: FileList, targetDir: string, dataTransfer?: DataTransfer) => {
    const formData = new FormData();
    formData.append("targetDir", targetDir);

    let usedEntries = false;
    if (dataTransfer?.items) {
      const entryPromises: Promise<{ file: File; relativePath: string }[]>[] = [];
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const entry = dataTransfer.items[i].webkitGetAsEntry?.();
        if (entry) {
          entryPromises.push(readEntryRecursive(entry, ""));
        }
      }
      if (entryPromises.length > 0) {
        const results = (await Promise.all(entryPromises)).flat();
        if (results.length > 0) {
          usedEntries = true;
          for (const { file, relativePath } of results) {
            formData.append("files", file);
            formData.append("relativePaths", relativePath);
          }
        }
      }
    }

    if (!usedEntries) {
      for (const file of Array.from(files)) {
        formData.append("files", file);
        formData.append("relativePaths", file.name);
      }
    }

    try {
      await fetch("/api/files/upload", { method: "POST", body: formData });
    } catch {
      toast("Failed to upload file", { type: "error" });
    }
    fetchTree();
  }, [fetchTree, toast]);

  const effectiveLinkDrop = onLinkDrop || handleLinkDropInternal;

  const handleDoubleClick = useCallback((path: string) => {
    const entry = findEntry(treeRef.current, path);
    if (entry?.type === "file") {
      onFilePreview(path);
    }
  }, [onFilePreview]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't intercept keys when inline create/rename inputs are active
    if (creatingIn || renamingPath) return;

    const visiblePaths = flattenVisible(treeRef.current, expandedPathsRef.current);
    if (visiblePaths.length === 0) return;

    const currentPath = focusedPath || selectedPath;
    const currentIndex = currentPath ? visiblePaths.indexOf(currentPath) : -1;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, visiblePaths.length - 1);
        setFocusedPath(visiblePaths[next]);
        const el = containerRef.current?.querySelector(`[data-path="${CSS.escape(visiblePaths[next])}"]`);
        el?.scrollIntoView({ block: "nearest" });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        setFocusedPath(visiblePaths[prev]);
        const el = containerRef.current?.querySelector(`[data-path="${CSS.escape(visiblePaths[prev])}"]`);
        el?.scrollIntoView({ block: "nearest" });
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (currentPath) {
          const entry = findEntry(treeRef.current, currentPath);
          if (entry?.type === "directory" && !expandedPathsRef.current.has(currentPath)) {
            expandedPathsRef.current.add(currentPath);
            setExpandedVersion((v) => v + 1);
          }
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (currentPath) {
          const entry = findEntry(treeRef.current, currentPath);
          if (entry?.type === "directory" && expandedPathsRef.current.has(currentPath)) {
            expandedPathsRef.current.delete(currentPath);
            setExpandedVersion((v) => v + 1);
          } else {
            const parentPath = currentPath.split("/").slice(0, -1).join("/");
            if (parentPath && visiblePaths.includes(parentPath)) {
              setFocusedPath(parentPath);
            }
          }
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        const targetPath = focusedPath || selectedPath;
        if (targetPath) {
          setSelectedPath(targetPath);
          const entry = findEntry(treeRef.current, targetPath);
          if (entry?.type === "file") {
            onFilePreview(targetPath);
          } else if (entry?.type === "directory") {
            toggleExpand(targetPath);
          }
        }
        break;
      }
      case "F2": {
        e.preventDefault();
        const targetPath = focusedPath || selectedPath;
        if (targetPath && !readOnly) {
          const entry = findEntry(treeRef.current, targetPath);
          if (entry) {
            setRenamingPath(entry.path);
          }
        }
        break;
      }
      case "Delete":
      case "Backspace": {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          const targetPath = focusedPath || selectedPath;
          if (targetPath && !readOnly) {
            handleDelete(targetPath);
          }
        }
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPath, selectedPath, readOnly, onFilePreview, toggleExpand, creatingIn, renamingPath]);

  // Context value — memoize to avoid unnecessary re-renders
  const explorerContextValue: ExplorerContextType = {
    expandedPaths: expandedPathsRef.current,
    selectedPath,
    focusedPath,
    creatingIn,
    renamingPath,
    dragMode,
    onToggleExpand: toggleExpand,
    onSelect: setSelectedPath,
    onDoubleClick: handleDoubleClick,
    onContextMenu: handleContextMenu,
    onInternalDrop: handleInternalDrop,
    onExternalDrop: handleExternalDrop,
    onLinkDrop: effectiveLinkDrop,
    onCreateSubmit: handleCreateSubmit,
    onCreateCancel: handleCreateCancel,
    onRenameSubmit: handleRenameSubmit,
    onRenameCancel: handleRenameCancel,
  };

  // Render the inline create input at root level if creating in root
  const renderRootCreate = () => {
    if (!creatingIn || creatingIn.dir !== root) return null;
    const isFolder = creatingIn.type === "folder";
    const result: React.ReactNode[] = [];
    let inserted = false;

    for (const entry of tree) {
      if (!inserted) {
        if (isFolder && entry.type !== "directory") {
          result.push(<InlineCreateInput key="__creating__" type="folder" depth={0} />);
          inserted = true;
        } else if (!isFolder && entry.type !== "directory") {
          result.push(<InlineCreateInput key="__creating__" type="file" depth={0} />);
          inserted = true;
        }
      }
      result.push(<FileTreeNode key={entry.path} entry={entry} depth={0} />);
    }

    if (!inserted) {
      result.push(<InlineCreateInput key="__creating__" type={creatingIn.type} depth={0} />);
    }

    return result;
  };

  // Force re-render when expandedVersion changes (expandedPaths ref updated)
  void expandedVersion;

  return (
    <ExplorerContext.Provider value={explorerContextValue}>
      <div
        className="flex flex-col h-full relative"
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ outline: "none" }}
      >
        {/* Header toolbar */}
        {!readOnly && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-xs font-medium text-[var(--text-secondary)]">EXPLORER</span>
            <div className="flex items-center gap-1">
              <button onClick={() => startCreating("file")} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="New File"><FilePlus size={13} /></button>
              <button onClick={() => startCreating("folder")} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="New Folder"><FolderPlus size={13} /></button>
              {selectedPath && <button onClick={() => handleDelete(selectedPath)} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-tertiary)]" title="Delete"><Trash2 size={13} /></button>}
              <button onClick={collapseAll} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="Collapse All"><ChevronsDownUp size={13} /></button>
              <button onClick={() => fetchTree()} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="Refresh"><RefreshCw size={13} /></button>
            </div>
          </div>
        )}

        {readOnly && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-xs font-medium text-[var(--text-secondary)]">EXPLORER</span>
            <div className="flex items-center gap-1">
              <button onClick={collapseAll} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="Collapse All"><ChevronsDownUp size={13} /></button>
              <button onClick={() => fetchTree()} className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" title="Refresh"><RefreshCw size={13} /></button>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className={`flex-1 overflow-auto py-1 transition-colors ${rootDrop ? "bg-[var(--accent)]/5" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setRootDrop(true); }}
          onDragLeave={() => setRootDrop(false)}
          onDrop={(e) => {
            e.preventDefault(); setRootDrop(false);
            if (e.dataTransfer.files.length > 0 && root && !dragSource) {
              handleExternalDrop(e.dataTransfer.files, root, e.dataTransfer);
            } else if (dragSource && root) {
              if (dragSource.mode === "link") {
                effectiveLinkDrop(dragSource.path, root);
              } else {
                handleInternalDrop(dragSource.path, root);
              }
              dragSource = null;
            }
          }}
        >
          {loading ? (
            <div className="text-xs text-[var(--text-muted)] px-3 py-2">Loading...</div>
          ) : tree.length === 0 && !creatingIn ? (
            <div className="text-xs text-[var(--text-muted)] px-3 py-8 text-center">
              {readOnly ? "No files yet." : "Drop files here to add them."}
            </div>
          ) : creatingIn && creatingIn.dir === root ? (
            renderRootCreate()
          ) : (
            tree.map((entry) => (
              <FileTreeNode key={entry.path} entry={entry} depth={0} />
            ))
          )}
        </div>

        {contextMenu && (
          <div className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.entry.type === "file" && (
              <>
                <button onClick={() => { onFilePreview(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><Eye size={13} /> View File</button>
                {!readOnly && onFileEdit && (
                  <button onClick={() => { onFileEdit(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><Pencil size={13} /> Edit File</button>
                )}
                <button onClick={() => { const url = new URL(window.location.href); url.pathname = "/workspace"; url.searchParams.set("file", contextMenu.entry.path); window.open(url.toString(), "_blank"); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><ExternalLink size={13} /> Open in New Tab</button>
              </>
            )}
            {contextMenu.entry.type === "directory" && !readOnly && (
              <>
                <button onClick={() => { setSelectedPath(contextMenu.entry.path); setCreatingIn({ dir: contextMenu.entry.path, type: "file" }); expandedPathsRef.current.add(contextMenu.entry.path); setExpandedVersion((v) => v + 1); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><FilePlus size={13} /> New File Here</button>
                <button onClick={() => { setSelectedPath(contextMenu.entry.path); setCreatingIn({ dir: contextMenu.entry.path, type: "folder" }); expandedPathsRef.current.add(contextMenu.entry.path); setExpandedVersion((v) => v + 1); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><FolderPlus size={13} /> New Folder Here</button>
                <button onClick={() => { setGitCloneTarget(contextMenu.entry.path); setGitCloneUrl(""); setGitCloneError(""); setGitCloneProgress([]); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><GitBranch size={13} /> Git Clone</button>
                {gitRepoCacheRef.current.get(contextMenu.entry.path) && (
                  <>
                    <div className="border-t border-[var(--border)] my-1" />
                    <button onClick={() => { setGitManagerPath(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"><Settings size={13} /> Manage Git Repo</button>
                  </>
                )}
              </>
            )}
            {!readOnly && (
              <button onClick={() => { setRenamingPath(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><Pencil size={13} /> Rename</button>
            )}
            {contextMenu.entry.type === "directory" && onOpenGlobalPicker && !readOnly && (
              <button onClick={() => { onOpenGlobalPicker(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"><Database size={13} /> Link Global Data</button>
            )}
            <button onClick={() => { navigator.clipboard.writeText(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><ExternalLink size={13} /> Copy Path</button>
            <button onClick={() => { fetch("/api/files/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: contextMenu.entry.path }) }); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><FolderSearch size={13} /> Reveal in Finder</button>
            {!readOnly && (
              <>
                <div className="border-t border-[var(--border)] my-1" />
                <button onClick={() => { handleDelete(contextMenu.entry.path); setContextMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--error)] hover:bg-[var(--bg-tertiary)]"><Trash2 size={13} /> Delete</button>
              </>
            )}
          </div>
        )}

        {gitCloneTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!gitCloning) { setGitCloneTarget(null); setGitCloneUrl(""); setGitCloneError(""); setGitCloneProgress([]); } }}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl p-4 w-[440px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={16} className="text-[var(--accent)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">Git Clone</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Clone into: <span className="text-[var(--text-secondary)]">{gitCloneTarget.split("/").pop()}/</span>
              </p>
              <input
                autoFocus
                type="text"
                placeholder="https://github.com/user/repo.git"
                value={gitCloneUrl}
                onChange={(e) => { setGitCloneUrl(e.target.value); setGitCloneError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && gitCloneUrl.trim() && !gitCloning) handleGitClone(); if (e.key === "Escape" && !gitCloning) { setGitCloneTarget(null); setGitCloneUrl(""); setGitCloneError(""); setGitCloneProgress([]); } }}
                disabled={gitCloning}
                className="w-full px-3 py-2 text-xs rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
              {gitCloneProgress.length > 0 && (
                <div
                  ref={gitCloneProgressRef}
                  className="mt-2 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] max-h-[150px] overflow-y-auto"
                >
                  {gitCloneProgress.map((line, i) => (
                    <p key={i} className="text-[10px] font-mono text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap break-all">{line}</p>
                  ))}
                </div>
              )}
              {gitCloneError && (
                <div className="mt-2">
                  <p className="text-xs text-[var(--error)]">{gitCloneError}</p>
                  {gitCloneAuthHint && (
                    <button
                      onClick={() => { setGitCloneTarget(null); setGitCloneUrl(""); setGitCloneError(""); setGitCloneProgress([]); setGitCloneAuthHint(false); window.location.hash = "connections"; setView("settings"); }}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90"
                    >
                      <Settings size={12} />
                      Authenticate GitHub in Settings
                    </button>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => { setGitCloneTarget(null); setGitCloneUrl(""); setGitCloneError(""); setGitCloneProgress([]); }}
                  disabled={gitCloning}
                  className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={handleGitClone}
                  disabled={gitCloning || !gitCloneUrl.trim()}
                  className="px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                >{gitCloning ? "Cloning..." : "Clone"}</button>
              </div>
            </div>
          </div>
        )}

        {gitManagerPath && (
          <GitManagerModal
            repoPath={gitManagerPath}
            onClose={() => setGitManagerPath(null)}
            onRefresh={() => fetchTree()}
          />
        )}
      </div>
    </ExplorerContext.Provider>
  );
}

function findEntry(entries: FileEntry[], path: string): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.children) { const found = findEntry(entry.children, path); if (found) return found; }
  }
  return null;
}
