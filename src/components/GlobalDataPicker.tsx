"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Database } from "lucide-react";
import { FileExplorer } from "./FileExplorer";

interface GlobalDataPickerProps {
  sharedDataDir: string;
  onClose: () => void;
}

export function GlobalDataPicker({ sharedDataDir, onClose }: GlobalDataPickerProps) {
  const [pos, setPos] = useState({ x: 200, y: 100 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      setPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    },
    [dragging, offset]
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className="fixed z-40"
      style={{ left: pos.x, top: pos.y, width: 320, height: 420 }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Draggable title bar */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] cursor-move select-none shrink-0"
          onMouseDown={(e) => {
            setDragging(true);
            setOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
          }}
        >
          <div className="flex items-center gap-2">
            <Database size={13} className="text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--text-secondary)]">Global Shared Data</span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* File explorer scoped to shared-data, in link mode */}
        <div className="flex-1 overflow-hidden">
          <FileExplorer
            rootDir={sharedDataDir}
            dragMode="link"
            readOnly
            onFilePreview={() => {}}
          />
        </div>

        {/* Hint */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] shrink-0">
          <p className="text-[10px] text-[var(--text-muted)] text-center">
            Drag items into your project to link them
          </p>
        </div>
      </div>
    </div>
  );
}
