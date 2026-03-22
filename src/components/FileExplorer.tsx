"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileEntry[];
}

interface FileExplorerProps {
  onFilePreview: (path: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  entry: FileEntry;
}

function FileTreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
  collapseKey,
}: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  collapseKey: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  // Collapse when collapseKey changes
  useEffect(() => {
    if (collapseKey > 0) setExpanded(false);
  }, [collapseKey]);
  const isDir = entry.type === "directory";
  const isSelected = entry.path === selectedPath;

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
    <div>
      <button
        onClick={() => {
          onSelect(entry.path);
          if (isDir) setExpanded(!expanded);
        }}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className={`w-full flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
          isSelected
            ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)]"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDir ? (
          <>
            {expanded ? (
              <ChevronDown size={14} className="shrink-0" />
            ) : (
              <ChevronRight size={14} className="shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={14} className="shrink-0 text-[var(--accent)]" />
            ) : (
              <Folder size={14} className="shrink-0 text-[var(--accent)]" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={14} className={`shrink-0 ${getFileColor()}`} />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              collapseKey={collapseKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ onFilePreview }: FileExplorerProps) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [collapseKey, setCollapseKey] = useState(0);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files");
      if (res.ok) {
        const data = await res.json();
        setTree(data.tree);
        setRoot(data.root);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Close context menu on click anywhere
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  // Determine the parent directory for create operations
  const getCreateDir = (): string => {
    if (!selectedPath) return root;
    // Find if selectedPath is a directory in the tree
    const isDir = findEntry(tree, selectedPath)?.type === "directory";
    if (isDir) return selectedPath;
    // Otherwise use parent directory
    const parts = selectedPath.split("/");
    parts.pop();
    return parts.join("/");
  };

  const handleCreate = async () => {
    if (!newName.trim() || !creating) return;
    const parentDir = getCreateDir();
    const fullPath = `${parentDir}/${newName.trim()}`;
    await fetch("/api/files/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: fullPath,
        type: creating === "folder" ? "directory" : "file",
      }),
    });
    setCreating(null);
    setNewName("");
    fetchTree();
  };

  const handleDelete = async (path: string) => {
    const name = path.split("/").pop();
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await fetch("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (selectedPath === path) setSelectedPath(null);
    fetchTree();
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          EXPLORER
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setCreating("file");
              setNewName("");
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="New File"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => {
              setCreating("folder");
              setNewName("");
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="New Folder"
          >
            <FolderPlus size={13} />
          </button>
          {selectedPath && (
            <button
              onClick={() => handleDelete(selectedPath)}
              className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--bg-tertiary)] transition-colors"
              title="Delete Selected"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={() => setCollapseKey((k) => k + 1)}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Collapse All"
          >
            <ChevronsDownUp size={13} />
          </button>
          <button
            onClick={fetchTree}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Create input */}
      {creating && (
        <div className="px-2 py-1.5 border-b border-[var(--border)] bg-[var(--bg-primary)]">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] mb-1">
            {creating === "file" ? (
              <FilePlus size={11} />
            ) : (
              <FolderPlus size={11} />
            )}
            New {creating} in{" "}
            <span className="text-[var(--text-secondary)] truncate max-w-[120px]">
              {getCreateDir().split("/").pop()}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
            className="flex gap-1"
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={
                creating === "file" ? "filename.ts" : "folder-name"
              }
              className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-0.5 text-xs focus:outline-none focus:border-[var(--accent)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(null);
                  setNewName("");
                }
              }}
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="px-2 py-0.5 rounded bg-[var(--accent)] text-white text-xs disabled:opacity-40"
            >
              Create
            </button>
          </form>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-auto py-1">
        {loading ? (
          <div className="text-xs text-[var(--text-muted)] px-3 py-2">
            Loading...
          </div>
        ) : tree.length === 0 ? (
          <div className="text-xs text-[var(--text-muted)] px-3 py-2">
            No files found.
          </div>
        ) : (
          tree.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              onContextMenu={handleContextMenu}
              collapseKey={collapseKey}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.type === "file" && (
            <button
              onClick={() => {
                onFilePreview(contextMenu.entry.path);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Eye size={13} />
              View File
            </button>
          )}
          {contextMenu.entry.type === "directory" && (
            <>
              <button
                onClick={() => {
                  setSelectedPath(contextMenu.entry.path);
                  setCreating("file");
                  setNewName("");
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <FilePlus size={13} />
                New File Here
              </button>
              <button
                onClick={() => {
                  setSelectedPath(contextMenu.entry.path);
                  setCreating("folder");
                  setNewName("");
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <FolderPlus size={13} />
                New Folder Here
              </button>
            </>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.entry.path);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ExternalLink size={13} />
            Copy Path
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={() => {
              handleDelete(contextMenu.entry.path);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--error)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to find an entry in the tree by path
function findEntry(
  entries: FileEntry[],
  path: string
): FileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.children) {
      const found = findEntry(entry.children, path);
      if (found) return found;
    }
  }
  return null;
}
