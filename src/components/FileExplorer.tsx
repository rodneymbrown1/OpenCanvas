"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Eye,
  ExternalLink,
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
  onContextMenu,
}: {
  entry: FileEntry;
  depth: number;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = entry.type === "directory";

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
          if (isDir) setExpanded(!expanded);
        }}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)]"
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
              onContextMenu={onContextMenu}
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
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

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

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          EXPLORER
        </span>
        <button
          onClick={fetchTree}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {root && (
        <div className="px-3 py-1 text-[10px] text-[var(--text-muted)] truncate border-b border-[var(--border)]">
          {root}
        </div>
      )}
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
              onContextMenu={handleContextMenu}
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
          <button
            onClick={() => {
              // Copy path to clipboard
              navigator.clipboard.writeText(contextMenu.entry.path);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ExternalLink size={13} />
            Copy Path
          </button>
        </div>
      )}
    </div>
  );
}
