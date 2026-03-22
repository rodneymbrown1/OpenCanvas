"use client";

import { useState } from "react";
import { X, FolderOpen, FolderPlus, Loader2 } from "lucide-react";

interface FolderPickerModalProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPickerModal({ onSelect, onClose }: FolderPickerModalProps) {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const browseFolder = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/folder-picker");
      const data = await res.json();
      if (data.path) {
        onSelect(data.path);
      } else if (data.cancelled) {
        // User cancelled, do nothing
      }
    } catch {
      setError("Failed to open folder picker");
    }
    setLoading(false);
  };

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/folder-picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (data.path) {
        onSelect(data.path);
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError("Failed to create workspace");
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-[420px] max-w-[90vw] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Select Workspace</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Browse existing folder */}
          <button
            onClick={browseFolder}
            disabled={loading}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-left"
          >
            {loading ? (
              <Loader2 size={20} className="text-[var(--accent)] animate-spin shrink-0" />
            ) : (
              <FolderOpen size={20} className="text-[var(--accent)] shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium">Open Existing Folder</p>
              <p className="text-[10px] text-[var(--text-muted)]">
                Browse your computer for a project folder
              </p>
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-[var(--border)]" />
            <span className="text-[10px] text-[var(--text-muted)]">or</span>
            <div className="flex-1 border-t border-[var(--border)]" />
          </div>

          {/* Create new workspace */}
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-left"
            >
              <FolderPlus size={20} className="text-[var(--accent)] shrink-0" />
              <div>
                <p className="text-sm font-medium">Create New Workspace</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Creates a folder in ~/OpenCanvas/
                </p>
              </div>
            </button>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-[var(--text-muted)]">
                Workspace Name
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createWorkspace();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="my-project"
                  className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || loading}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
              </form>
              <p className="text-[10px] text-[var(--text-muted)]">
                Will be created at ~/OpenCanvas/{newName || "..."}
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-[var(--error)]">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
