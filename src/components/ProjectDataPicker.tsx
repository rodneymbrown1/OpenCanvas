
import { useState, useCallback, useEffect } from "react";
import { X, FolderGit2, ChevronDown } from "lucide-react";
import { FileExplorer } from "./FileExplorer";

interface ProjectEntry {
  name: string;
  path: string;
  exists: boolean;
}

interface ProjectDataPickerProps {
  currentProjectPath: string;
  onClose: () => void;
}

export function ProjectDataPicker({ currentProjectPath, onClose }: ProjectDataPickerProps) {
  const [pos, setPos] = useState({ x: 240, y: 120 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectEntry | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const others = (data.projects || []).filter(
          (p: ProjectEntry) => p.exists && p.path !== currentProjectPath
        );
        setProjects(others);
        if (others.length > 0) setSelectedProject(others[0]);
      })
      .catch(() => {});
  }, [currentProjectPath]);

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
      style={{ left: pos.x, top: pos.y, width: 340, height: 460 }}
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
            <FolderGit2 size={13} className="text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--text-secondary)]">Link Project Data</span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Project selector */}
        <div className="px-3 py-2 border-b border-[var(--border)] shrink-0 relative">
          {projects.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No other projects registered.</p>
          ) : (
            <button
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
              onClick={() => setDropdownOpen((v) => !v)}
            >
              <span className="truncate">{selectedProject?.name ?? "Select project…"}</span>
              <ChevronDown size={12} className="shrink-0 ml-1 text-[var(--text-muted)]" />
            </button>
          )}
          {dropdownOpen && projects.length > 0 && (
            <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.path}
                  className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                    p.path === selectedProject?.path
                      ? "text-[var(--accent)] bg-[var(--bg-tertiary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  }`}
                  onClick={() => {
                    setSelectedProject(p);
                    setDropdownOpen(false);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* File explorer scoped to selected project, in link mode */}
        <div className="flex-1 overflow-hidden">
          {selectedProject ? (
            <FileExplorer
              key={selectedProject.path}
              rootDir={selectedProject.path}
              dragMode="link"
              readOnly
              onFilePreview={() => {}}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-[var(--text-muted)]">Select a project above.</p>
            </div>
          )}
        </div>

        {/* Hint */}
        <div className="px-3 py-1.5 border-t border-[var(--border)] shrink-0">
          <p className="text-[10px] text-[var(--text-muted)] text-center">
            Drag files into your project to link them
          </p>
        </div>
      </div>
    </div>
  );
}
