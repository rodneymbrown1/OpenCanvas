
import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/SessionContext";
import { useView } from "@/lib/ViewContext";
import { useProject } from "@/lib/ProjectContext";
import {
  FolderOpen,
  Plus,
  Trash2,
  Clock,
  ExternalLink,
  HardDrive,
  RefreshCw,
  CheckCircle,
  FolderSearch,
  AlertTriangle,
  Wifi,
  WifiOff,
  Square,
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  Check,
  X,
  GripVertical,
  Kanban,
} from "lucide-react";
import { CalendarAccordion } from "@/components/CalendarAccordion";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectEntry {
  name: string;
  path: string;
  lastOpened?: string;
  description?: string;
  exists?: boolean;
}

interface ProjectGroup {
  id: string;
  name: string;
  color?: string;
  projectPaths: string[];
}

type KanbanStatus = "todo" | "in-progress" | "done";
interface KanbanItem { type: "project" | "group"; id: string; }
interface KanbanBoard {
  todo: KanbanItem[];
  "in-progress": KanbanItem[];
  done: KanbanItem[];
}

interface SharedFile { name: string; path: string; size: number; }

interface GlobalState {
  configured: boolean;
  home: string;
  sharedDataDir: string;
  projects: ProjectEntry[];
  sharedData: SharedFile[];
  groups: ProjectGroup[];
  kanban: KanbanBoard;
}

interface ProjectServiceStatus {
  running: boolean;
  port: number | null;
  services: Record<string, { name: string; state: string; type?: string; port?: number }>;
  hasRunConfig: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GROUP_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6b7280",
];

const KANBAN_COLUMNS: { key: KanbanStatus; label: string; dotClass: string; borderClass: string }[] = [
  { key: "todo",        label: "To Do",       dotClass: "bg-[var(--text-muted)]", borderClass: "border-[var(--border)]" },
  { key: "in-progress", label: "In Progress",  dotClass: "bg-blue-400",            borderClass: "border-blue-400/30"    },
  { key: "done",        label: "Done",         dotClass: "bg-green-400",           borderClass: "border-green-400/30"   },
];

// ── UI State Persistence ──────────────────────────────────────────────────────

interface PersistedUIState {
  calendarOpen?: boolean;
  kanbanOpen?: boolean;
  collapsedGroups?: string[];
}

function loadUIState(): PersistedUIState {
  try { return JSON.parse(localStorage.getItem("oc-projects-ui") || "{}"); }
  catch { return {}; }
}

function saveUIState(patch: Partial<PersistedUIState>): void {
  const current = loadUIState();
  localStorage.setItem("oc-projects-ui", JSON.stringify({ ...current, ...patch }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const revealInFinder = (path: string) =>
  fetch("/api/files/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });

// ── Setup Screen ──────────────────────────────────────────────────────────────

function SetupScreen({ onSetup }: { onSetup: (home?: string) => void }) {
  const [customPath, setCustomPath] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md w-full space-y-6 p-6">
        <div className="text-center space-y-2">
          <HardDrive size={32} className="mx-auto text-[var(--accent)]" />
          <h1 className="text-xl font-bold">Set Up Open Canvas</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Create a home directory where Open Canvas stores your projects,
            shared data, and global settings.
          </p>
        </div>
        <div className="space-y-3">
          <button onClick={() => { setUseCustom(false); onSetup(); }}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${!useCustom ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}>
            <p className="text-sm font-medium">Default Location</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">~/.open-canvas/</p>
          </button>
          <button onClick={() => setUseCustom(true)}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${useCustom ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}>
            <p className="text-sm font-medium">Custom Location</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Choose where to store Open Canvas data</p>
          </button>
          {useCustom && (
            <div className="flex gap-2">
              <input type="text" value={customPath} onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/path/to/open-canvas-home"
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none" />
              <button onClick={() => onSetup(customPath || undefined)} disabled={!customPath}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50">
                Set Up
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)] text-center">
          This creates: global.yaml, shared-data/, and a project registry.
        </p>
      </div>
    </div>
  );
}

// ── Kanban Status Button ──────────────────────────────────────────────────────
// Small button used on project cards and group headers to assign kanban status.

interface KanbanStatusButtonProps {
  currentStatus: KanbanStatus | null;
  onSetStatus: (status: KanbanStatus | null) => void;
}

function KanbanStatusButton({ currentStatus, onSetStatus }: KanbanStatusButtonProps) {
  const [open, setOpen] = useState(false);
  const current = KANBAN_COLUMNS.find((c) => c.key === currentStatus) ?? null;

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        title={current ? `Board: ${current.label}` : "Add to board"}
      >
        {current
          ? <span className={`w-2 h-2 rounded-full ${current.dotClass}`} />
          : <Kanban size={12} />}
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-30 w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg py-1"
          onMouseLeave={() => setOpen(false)}
        >
          <p className="px-3 py-1 text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wide">Board status</p>
          {KANBAN_COLUMNS.map((col) => (
            <button key={col.key}
              onClick={() => { onSetStatus(col.key); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${col.dotClass}`} />
              {col.label}
              {currentStatus === col.key && <Check size={10} className="ml-auto text-[var(--accent)]" />}
            </button>
          ))}
          {currentStatus && (
            <>
              <div className="border-t border-[var(--border)] my-1" />
              <button
                onClick={() => { onSetStatus(null); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <X size={10} /> Remove from board
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────
// Renders a single card on the kanban board (project or group type).

interface KanbanCardProps {
  item: KanbanItem;
  projects: ProjectEntry[];
  groups: ProjectGroup[];
  isDragging: boolean;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function KanbanCard({ item, projects, groups, isDragging, onRemove, onDragStart, onDragEnd }: KanbanCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (item.type === "project") {
    const project = projects.find((p) => p.path === item.id);
    if (!project) {
      // Stale reference — show a placeholder so it can be removed
      return (
        <div className="p-2.5 rounded-lg border border-dashed border-[var(--border)] flex items-center gap-2">
          <AlertTriangle size={12} className="text-[var(--error)] shrink-0" />
          <span className="text-xs text-[var(--text-muted)] flex-1 truncate">Missing project</span>
          <button onClick={onRemove} className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-red-400">
            <X size={10} />
          </button>
        </div>
      );
    }
    return (
      <div
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
        className={`p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] cursor-grab active:cursor-grabbing select-none transition-all ${isDragging ? "opacity-40 scale-95" : "hover:border-[var(--text-muted)]"}`}
      >
        <div className="flex items-start gap-1.5">
          <GripVertical size={11} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{project.name}</p>
            <p className="text-[10px] font-mono text-[var(--text-muted)] truncate">
              {project.path.split("/").slice(-2).join("/")}
            </p>
            {project.exists === false && (
              <span className="text-[10px] text-[var(--error)] flex items-center gap-0.5 mt-0.5">
                <AlertTriangle size={9} /> missing
              </span>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 shrink-0 mt-0.5">
            <X size={10} />
          </button>
        </div>
      </div>
    );
  }

  if (item.type === "group") {
    const group = groups.find((g) => g.id === item.id);
    if (!group) {
      return (
        <div className="p-2.5 rounded-lg border border-dashed border-[var(--border)] flex items-center gap-2">
          <AlertTriangle size={12} className="text-[var(--error)] shrink-0" />
          <span className="text-xs text-[var(--text-muted)] flex-1 truncate">Missing group</span>
          <button onClick={onRemove} className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-red-400">
            <X size={10} />
          </button>
        </div>
      );
    }
    const memberProjects = projects.filter((p) => group.projectPaths.includes(p.path));
    return (
      <div
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
        className={`rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] cursor-grab active:cursor-grabbing select-none transition-all ${isDragging ? "opacity-40 scale-95" : "hover:border-[var(--text-muted)]"}`}
      >
        <div className="flex items-center gap-1.5 p-2.5">
          <GripVertical size={11} className="text-[var(--text-muted)] shrink-0" />
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color || "#6366f1" }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{group.name}</p>
            <p className="text-[10px] text-[var(--text-muted)]">
              {memberProjects.length} project{memberProjects.length !== 1 ? "s" : ""}
            </p>
          </div>
          {memberProjects.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 shrink-0">
            <X size={10} />
          </button>
        </div>
        {expanded && memberProjects.length > 0 && (
          <div className="px-3 pb-2.5 pt-0 border-t border-[var(--border)] ml-5">
            <div className="mt-1.5 pl-2 border-l border-[var(--border)] space-y-1">
              {memberProjects.map((p) => (
                <p key={p.path} className="text-[10px] text-[var(--text-muted)] truncate">{p.name}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Kanban Board Section ──────────────────────────────────────────────────────
// Accordion with 3 columns. DnD is scoped entirely within this component.

interface KanbanBoardSectionProps {
  board: KanbanBoard;
  projects: ProjectEntry[];
  groups: ProjectGroup[];
  isOpen: boolean;
  onToggle: () => void;
  onSetStatus: (item: KanbanItem, status: KanbanStatus | null) => void;
}

function KanbanBoardSection({ board, projects, groups, isOpen, onToggle, onSetStatus }: KanbanBoardSectionProps) {
  // Internal drag state (only for within-board DnD)
  const [dragging, setDragging] = useState<{ item: KanbanItem; fromStatus: KanbanStatus } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);

  const totalItems = board.todo.length + board["in-progress"].length + board.done.length;

  const handleDrop = (e: React.DragEvent, toStatus: KanbanStatus) => {
    e.preventDefault();
    if (dragging) {
      // Internal kanban card move between columns
      if (dragging.fromStatus !== toStatus) {
        onSetStatus(dragging.item, toStatus);
      }
    } else {
      // External drop from the project list — project path is in text/plain
      const projectPath = e.dataTransfer.getData("text/plain");
      if (projectPath) {
        onSetStatus({ type: "project", id: projectPath }, toStatus);
      }
    }
    setDragging(null);
    setDragOverCol(null);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        {isOpen
          ? <ChevronDown size={14} className="text-[var(--text-muted)]" />
          : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
        <Kanban size={15} className="text-[var(--accent)]" />
        <span className="text-sm font-medium">Board</span>
        {totalItems > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] font-medium">
            {totalItems}
          </span>
        )}
        {/* Column summary when collapsed */}
        {!isOpen && (
          <div className="flex items-center gap-3 ml-2">
            {KANBAN_COLUMNS.map((col) =>
              board[col.key].length > 0 ? (
                <span key={col.key} className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <span className={`w-1.5 h-1.5 rounded-full ${col.dotClass}`} />
                  {board[col.key].length}
                </span>
              ) : null
            )}
            {totalItems === 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">empty — add projects or groups</span>
            )}
          </div>
        )}
      </button>

      {/* Board columns */}
      {isOpen && (
        <div className="border-t border-[var(--border)] p-3">
          <div className="grid grid-cols-3 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const items = board[col.key];
              const isOver = dragOverCol === col.key;

              return (
                <div
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => handleDrop(e, col.key)}
                  className={`flex flex-col gap-2 min-h-28 p-2 rounded-lg border-2 transition-all ${
                    isOver
                      ? "border-[var(--accent)] bg-[var(--accent)]/5"
                      : `border-dashed ${col.borderClass}`
                  }`}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-1.5 pb-1 border-b border-[var(--border)]">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${col.dotClass}`} />
                    <span className="text-xs font-medium flex-1">{col.label}</span>
                    {items.length > 0 && (
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">{items.length}</span>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex flex-col gap-1.5 flex-1">
                    {items.map((item) => (
                      <KanbanCard
                        key={`${item.type}:${item.id}`}
                        item={item}
                        projects={projects}
                        groups={groups}
                        isDragging={dragging?.item.type === item.type && dragging?.item.id === item.id}
                        onRemove={() => onSetStatus(item, null)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDragging({ item, fromStatus: col.key });
                        }}
                        onDragEnd={() => { setDragging(null); setDragOverCol(null); }}
                      />
                    ))}
                  </div>

                  {/* Empty drop hint */}
                  {items.length === 0 && !isOver && (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
                        Drag cards here
                        <br />
                        or use the{" "}
                        <Kanban size={9} className="inline" />{" "}
                        button on a project
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: ProjectEntry;
  isCurrent: boolean;
  serverStatus: ProjectServiceStatus;
  currentProjectState: { appPort: number | null; services: Record<string, { name: string; state: string; port?: number }>; runConfigExists: boolean };
  isStopping: boolean;
  isDragging: boolean;
  groups: ProjectGroup[];
  kanbanStatus: KanbanStatus | null;
  onOpen: () => void;
  onOpenInNewTab: () => void;
  onReveal: () => void;
  onRemove: () => void;
  onStop: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  onSetKanbanStatus: (status: KanbanStatus | null) => void;
}

function ProjectCard({
  project, isCurrent, serverStatus, currentProjectState, isStopping, isDragging,
  groups, kanbanStatus, onOpen, onOpenInNewTab, onReveal, onRemove, onStop,
  onDragStart, onDragEnd, onMoveToGroup, onSetKanbanStatus,
}: ProjectCardProps) {
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  const status = isCurrent
    ? { running: !!currentProjectState.appPort, port: currentProjectState.appPort, services: currentProjectState.services, hasRunConfig: currentProjectState.runConfigExists }
    : serverStatus;

  const serviceEntries = Object.values(status.services || {});
  const hasServices = serviceEntries.length > 0;
  const runningCount = serviceEntries.filter((s) => s.state === "running").length;
  const currentGroup = groups.find((g) => g.projectPaths.includes(project.path));

  return (
    <div
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      className={`p-4 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none ${isDragging ? "opacity-40 scale-95" : ""} ${isCurrent ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] hover:border-[var(--text-muted)]"}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <GripVertical size={12} className="text-[var(--text-muted)] shrink-0" />
            <h3 className="text-sm font-medium truncate">{project.name}</h3>
            {isCurrent && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--accent)]">
                <CheckCircle size={10} /> active
              </span>
            )}
            {project.exists === false && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--error)]">
                <AlertTriangle size={10} /> missing
              </span>
            )}
            {/* Kanban status badge */}
            {kanbanStatus && (
              <span className={`flex items-center gap-1 text-[10px] ${kanbanStatus === "done" ? "text-green-400" : kanbanStatus === "in-progress" ? "text-blue-400" : "text-[var(--text-muted)]"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${KANBAN_COLUMNS.find(c => c.key === kanbanStatus)?.dotClass}`} />
                {KANBAN_COLUMNS.find(c => c.key === kanbanStatus)?.label}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-muted)] font-mono truncate mt-0.5 ml-4">{project.path}</p>

          <div className="flex items-center gap-3 mt-1 ml-4">
            {project.lastOpened && (
              <p className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <Clock size={9} />
                {new Date(project.lastOpened).toLocaleDateString()}
              </p>
            )}
            {/* Server status */}
            {hasServices && runningCount > 0 ? (
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                    <Wifi size={10} /> {runningCount}/{serviceEntries.length} services
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); onStop(); }} disabled={isStopping}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] border border-[var(--border)] transition-colors disabled:opacity-50">
                    <Square size={8} /> {isStopping ? "Stopping..." : "Stop"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {serviceEntries.map((svc) => (
                    <span key={svc.name} className="flex items-center gap-1 text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${svc.state === "running" ? "bg-green-400" : svc.state === "starting" ? "bg-yellow-400" : "bg-[var(--text-muted)]"}`} />
                      <span className="font-mono text-[var(--text-muted)]">{svc.name}</span>
                      {svc.port && <span className="font-mono text-[var(--text-muted)]">:{svc.port}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ) : hasServices ? (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <WifiOff size={10} /> {serviceEntries.length} service{serviceEntries.length !== 1 ? "s" : ""} configured
              </span>
            ) : status.running && status.port ? (
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                  <Wifi size={10} /> :{status.port}
                </span>
                <button onClick={(e) => { e.stopPropagation(); onStop(); }} disabled={isStopping}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--error)] border border-[var(--border)] transition-colors disabled:opacity-50">
                  <Square size={8} /> {isStopping ? "Stopping..." : "Stop"}
                </button>
              </div>
            ) : status.running ? (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <Wifi size={10} /> starting...
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <WifiOff size={10} /> no server
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-2 shrink-0">
          {!isCurrent ? (
            <>
              <button onClick={onOpen} disabled={project.exists === false}
                className="px-2.5 py-1 rounded text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Open
              </button>
              <button onClick={onOpenInNewTab} disabled={project.exists === false}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                title="Open in new tab">
                <ExternalLink size={12} />
              </button>
            </>
          ) : (
            <button onClick={onOpenInNewTab}
              className="px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] border border-[var(--border)] transition-colors">
              new tab
            </button>
          )}
          <button onClick={onReveal}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            title="Reveal in Finder">
            <FolderSearch size={12} />
          </button>
          {/* Kanban status */}
          <KanbanStatusButton currentStatus={kanbanStatus} onSetStatus={onSetKanbanStatus} />
          {/* Group assignment */}
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowGroupMenu((v) => !v); }}
              className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
              title="Move to group">
              <Layers size={12} />
            </button>
            {showGroupMenu && (
              <div className="absolute right-0 top-7 z-20 min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg py-1"
                onMouseLeave={() => setShowGroupMenu(false)}>
                <p className="px-3 py-1 text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wide">Move to group</p>
                {groups.map((g) => (
                  <button key={g.id}
                    onClick={() => { onMoveToGroup(g.id); setShowGroupMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] transition-colors">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color || "#6366f1" }} />
                    <span className="truncate">{g.name}</span>
                    {currentGroup?.id === g.id && <Check size={10} className="ml-auto text-[var(--accent)]" />}
                  </button>
                ))}
                {currentGroup && (
                  <>
                    <div className="border-t border-[var(--border)] my-1" />
                    <button onClick={() => { onMoveToGroup(null); setShowGroupMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors">
                      <X size={10} /> Remove from group
                    </button>
                  </>
                )}
                {groups.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No groups yet</p>}
              </div>
            )}
          </div>
          <button onClick={onRemove}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 transition-colors"
            title="Remove from list">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Group Section ─────────────────────────────────────────────────────────────

interface GroupSectionProps {
  group: ProjectGroup;
  projects: ProjectEntry[];
  isCollapsed: boolean;
  isDragOver: boolean;
  kanbanStatus: KanbanStatus | null;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onSetKanbanStatus: (status: KanbanStatus | null) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  renderCard: (project: ProjectEntry) => React.ReactNode;
}

function GroupSection({
  group, projects, isCollapsed, isDragOver, kanbanStatus,
  onToggleCollapse, onDelete, onRename, onRecolor, onSetKanbanStatus,
  onDragOver, onDragLeave, onDrop, renderCard,
}: GroupSectionProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={`rounded-xl border transition-all ${isDragOver ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-sm" : "border-[var(--border)]"}`}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onToggleCollapse} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Color dot — click to recolor */}
        <div className="relative shrink-0">
          <button onClick={() => setShowColorPicker((v) => !v)}
            className="w-3 h-3 rounded-full ring-1 ring-white/20 hover:ring-white/40 transition-all"
            style={{ backgroundColor: group.color || "#6366f1" }} title="Change color" />
          {showColorPicker && (
            <div className="absolute left-0 top-5 z-20 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg"
              onMouseLeave={() => setShowColorPicker(false)}>
              <div className="grid grid-cols-5 gap-1">
                {GROUP_COLORS.map((c) => (
                  <button key={c} onClick={() => { onRecolor(c); setShowColorPicker(false); }}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${group.color === c ? "ring-2 ring-white/50" : ""}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Name */}
        {editing ? (
          <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditName(group.name); setEditing(false); } }}
            className="flex-1 text-sm font-medium bg-transparent border-b border-[var(--accent)] outline-none min-w-0" />
        ) : (
          <span className="flex-1 text-sm font-medium truncate cursor-pointer" onDoubleClick={() => { setEditName(group.name); setEditing(true); }} title="Double-click to rename">
            {group.name}
          </span>
        )}

        {/* Kanban status indicator */}
        {kanbanStatus && (
          <span className={`text-[10px] ${kanbanStatus === "done" ? "text-green-400" : kanbanStatus === "in-progress" ? "text-blue-400" : "text-[var(--text-muted)]"}`}>
            {KANBAN_COLUMNS.find(c => c.key === kanbanStatus)?.label}
          </span>
        )}

        <span className="text-[10px] text-[var(--text-muted)] shrink-0">
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </span>

        <button onClick={() => { setEditName(group.name); setEditing(true); }}
          className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
          title="Rename group">
          <Pencil size={10} />
        </button>

        {/* Kanban button for the whole group */}
        <KanbanStatusButton currentStatus={kanbanStatus} onSetStatus={onSetKanbanStatus} />

        <button onClick={onDelete}
          className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-400 transition-colors shrink-0"
          title="Delete group">
          <Trash2 size={11} />
        </button>
      </div>

      {/* Projects in group */}
      {!isCollapsed && (
        <div className="px-3 pb-3">
          {projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projects.map((p) => renderCard(p))}
            </div>
          ) : (
            <div className={`flex items-center justify-center py-5 rounded-lg border-2 border-dashed transition-colors ${isDragOver ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
              <p className="text-xs">Drag projects here</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function ProjectsView() {
  const { session, setWorkDir } = useSession();
  const { setView } = useView();
  const { state: projectState, stopApp } = useProject();
  const [state, setState] = useState<GlobalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [serverStatus, setServerStatus] = useState<Record<string, ProjectServiceStatus>>({});
  const [stoppingPaths, setStoppingPaths] = useState<Set<string>>(new Set());

  // Group UI state
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);

  // Drag-and-drop (group assignment) state
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // ── Persisted UI state ──────────────────────────────────────────────────────
  const [calendarOpen, setCalendarOpen] = useState<boolean>(() => loadUIState().calendarOpen ?? false);
  const [kanbanOpen, setKanbanOpen] = useState<boolean>(() => loadUIState().kanbanOpen ?? true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(loadUIState().collapsedGroups ?? []));

  const handleCalendarToggle = (open: boolean) => {
    setCalendarOpen(open);
    saveUIState({ calendarOpen: open });
  };

  const handleKanbanToggle = () => {
    const next = !kanbanOpen;
    setKanbanOpen(next);
    saveUIState({ kanbanOpen: next });
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      saveUIState({ collapsedGroups: Array.from(next) });
      return next;
    });
  };

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setState(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  // Poll server status for all registered projects
  useEffect(() => {
    if (!state?.projects.length) return;

    async function pollServerStatus() {
      const statuses: Record<string, ProjectServiceStatus> = {};
      await Promise.all(state!.projects.map(async (project) => {
        try {
          const svcRes = await fetch(`/api/services?cwd=${encodeURIComponent(project.path)}`);
          if (svcRes.ok) {
            const svcData = await svcRes.json();
            const services = svcData.services || {};
            const runningServices = Object.values(services).filter((s: unknown) => (s as { state: string }).state === "running");
            const primaryPort = (Object.values(services).find(
              (s: unknown) => (s as { state: string; port?: number }).state === "running" && (s as { port?: number }).port
            ) as { port?: number } | undefined)?.port || null;
            statuses[project.path] = { running: runningServices.length > 0, port: primaryPort, services, hasRunConfig: !!svcData.hasRunConfig };
            return;
          }
        } catch {}
        try {
          const res = await fetch(`/api/stack?cwd=${encodeURIComponent(project.path)}`);
          if (res.ok) {
            const data = await res.json();
            statuses[project.path] = { running: !!data.running, port: data.session?.detectedPort || null, services: {}, hasRunConfig: false };
          } else {
            statuses[project.path] = { running: false, port: null, services: {}, hasRunConfig: false };
          }
        } catch {
          statuses[project.path] = { running: false, port: null, services: {}, hasRunConfig: false };
        }
      }));
      setServerStatus(statuses);
    }

    pollServerStatus();
    const interval = setInterval(pollServerStatus, 5000);
    return () => clearInterval(interval);
  }, [state?.projects]);

  // ── Project handlers ────────────────────────────────────────────────────────

  const handleStopServer = async (projectPath: string) => {
    setStoppingPaths((prev) => new Set(prev).add(projectPath));
    try { await fetch("/api/services?action=stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: projectPath }) }); } catch {}
    try { await fetch("/api/stack?action=stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: projectPath }) }); } catch {}
    setStoppingPaths((prev) => { const next = new Set(prev); next.delete(projectPath); return next; });
    setServerStatus((prev) => ({ ...prev, [projectPath]: { running: false, port: null, services: {}, hasRunConfig: prev[projectPath]?.hasRunConfig ?? false } }));
  };

  const handleSetup = async (customHome?: string) => {
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup", customHome }) });
    fetchState();
  };

  const handleCreate = async (name: string) => {
    setCreateError(""); setCreating(true);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name }) });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || "Failed to create project"); return; }
      setShowCreate(false); setNewName(""); fetchState();
    } finally { setCreating(false); }
  };

  const handleRegister = async (projectPath: string, name?: string) => {
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", path: projectPath, name }) });
    fetchState();
  };

  const handleRemove = async (projectPath: string) => {
    const name = projectPath.split("/").pop() || projectPath;
    if (!confirm(`Remove project "${name}" from the registry? (Files on disk will not be deleted.)`)) return;
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", path: projectPath }) });
    fetchState();
  };

  const handleOpen = (project: ProjectEntry) => {
    // Navigate synchronously first — URL and React state are the source of truth.
    // Server calls fire-and-forget so async awaits never race against the workDir
    // update (previously the two awaits before setWorkDir caused wrong-project bugs).
    setWorkDir(project.path);
    setView("workspace");

    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", path: project.path, name: project.name }) }).catch(() => {});
    fetch("/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: { root: project.path } }) }).catch(() => {});
  };

  const handleOpenInNewTab = (project: ProjectEntry) => {
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", path: project.path, name: project.name }) }).catch(() => {});
    // Use root path — the app is always served from /. SessionContext reads ?project= on load.
    window.open(`/?project=${encodeURIComponent(project.path)}`, "_blank");
  };

  // ── Group handlers ──────────────────────────────────────────────────────────

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-group", name: newGroupName.trim(), color: newGroupColor }) });
    setShowNewGroup(false); setNewGroupName(""); setNewGroupColor(GROUP_COLORS[0]);
    fetchState();
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group? Projects will be ungrouped but not removed.")) return;
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-group", groupId }) });
    fetchState();
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-group", groupId, name }) });
    fetchState();
  };

  const handleRecolorGroup = async (groupId: string, color: string) => {
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-group", groupId, color }) });
    fetchState();
  };

  const handleMoveToGroup = async (projectPath: string, groupId: string | null) => {
    if (groupId) {
      await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add-to-group", groupId, projectPath }) });
    } else {
      const currentGroup = state?.groups.find((g) => g.projectPaths.includes(projectPath));
      if (currentGroup) {
        await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove-from-group", groupId: currentGroup.id, projectPath }) });
      }
    }
    fetchState();
  };

  // ── Kanban handlers ─────────────────────────────────────────────────────────

  const handleKanbanSetStatus = async (item: KanbanItem, status: KanbanStatus | null) => {
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "kanban-set", type: item.type, id: item.id, status }) });
    fetchState();
  };

  const getKanbanStatus = (item: KanbanItem): KanbanStatus | null => {
    const board = state?.kanban;
    if (!board) return null;
    for (const col of ["todo", "in-progress", "done"] as KanbanStatus[]) {
      if (board[col].some((i) => i.type === item.type && i.id === item.id)) return col;
    }
    return null;
  };

  // ── Group drag-and-drop handlers ────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, projectPath: string) => {
    setDraggedPath(projectPath);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectPath);
  };

  const handleDragEnd = () => { setDraggedPath(null); setDragOverTarget(null); };

  const handleGroupDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverTarget(groupId);
  };

  const handleUngroupedDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverTarget("ungrouped");
  };

  const handleGroupDrop = async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    const path = e.dataTransfer.getData("text/plain") || draggedPath;
    if (path) await handleMoveToGroup(path, groupId);
    setDraggedPath(null); setDragOverTarget(null);
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const groups = state?.groups ?? [];
  const kanban = state?.kanban ?? { todo: [], "in-progress": [], done: [] };
  const allGroupedPaths = new Set(groups.flatMap((g) => g.projectPaths));
  const ungroupedProjects = (state?.projects ?? []).filter((p) => !allGroupedPaths.has(p.path));
  const isCurrentProject = (p: ProjectEntry) => p.path === session.workDir;

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderProjectCard = (project: ProjectEntry) => (
    <ProjectCard
      key={project.path}
      project={project}
      isCurrent={isCurrentProject(project)}
      serverStatus={serverStatus[project.path] ?? { running: false, port: null, services: {}, hasRunConfig: false }}
      currentProjectState={{ appPort: projectState.appPort, services: projectState.services, runConfigExists: projectState.runConfigExists }}
      isStopping={stoppingPaths.has(project.path)}
      isDragging={draggedPath === project.path}
      groups={groups}
      kanbanStatus={getKanbanStatus({ type: "project", id: project.path })}
      onOpen={() => handleOpen(project)}
      onOpenInNewTab={() => handleOpenInNewTab(project)}
      onReveal={() => revealInFinder(project.path)}
      onRemove={() => handleRemove(project.path)}
      onStop={() => { if (isCurrentProject(project)) stopApp(); else handleStopServer(project.path); }}
      onDragStart={(e) => handleDragStart(e, project.path)}
      onDragEnd={handleDragEnd}
      onMoveToGroup={(groupId) => handleMoveToGroup(project.path, groupId)}
      onSetKanbanStatus={(status) => handleKanbanSetStatus({ type: "project", id: project.path }, status)}
    />
  );

  // ── Early returns ───────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full text-[var(--text-muted)]">Loading...</div>;
  }

  if (!state?.configured) {
    return <SetupScreen onSetup={handleSetup} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Project Manager</h1>
          <span className="text-xs text-[var(--text-muted)]">
            {state.projects.length} project{state.projects.length !== 1 ? "s" : ""}
            {groups.length > 0 && ` · ${groups.length} group${groups.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowNewGroup(!showNewGroup); setNewGroupName(""); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border)] transition-colors"
          >
            <Layers size={12} /> New Group
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateError(""); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus size={12} /> New Project
          </button>
          <button onClick={fetchState}
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Create project form */}
        {showCreate && (
          <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
            <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) handleCreate(newName.trim()); }} className="flex gap-2">
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Project name" autoFocus
                className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-xs focus:border-[var(--accent)] focus:outline-none" />
              <button type="submit" disabled={!newName.trim() || creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs disabled:opacity-50">
                {creating && <Loader2 size={11} className="animate-spin" />}
                {creating ? "Creating..." : "Create"}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setNewName(""); setCreateError(""); }}
                className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                Cancel
              </button>
            </form>
            {createError && <p className="text-[11px] text-[var(--error)] px-1">{createError}</p>}
            {state?.home && (
              <p className="text-[10px] text-[var(--text-muted)] px-1">
                Creates in: {state.home}/projects/{newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "..."}
              </p>
            )}
          </div>
        )}

        {/* Create group form */}
        {showNewGroup && (
          <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
            <p className="text-xs font-medium text-[var(--text-secondary)]">New Group</p>
            <div className="flex items-center gap-2">
              <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) handleCreateGroup(); if (e.key === "Escape") { setShowNewGroup(false); setNewGroupName(""); } }}
                placeholder="Group name (e.g. Clients, Schoolwork)" autoFocus
                className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-xs focus:border-[var(--accent)] focus:outline-none" />
              <button onClick={handleCreateGroup} disabled={!newGroupName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs disabled:opacity-50">
                Create
              </button>
              <button onClick={() => { setShowNewGroup(false); setNewGroupName(""); }}
                className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] text-[var(--text-muted)]">Color:</span>
              <div className="flex gap-1.5">
                {GROUP_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewGroupColor(c)}
                    className={`w-4 h-4 rounded-full transition-transform hover:scale-110 ${newGroupColor === c ? "ring-2 ring-white/60 scale-110" : ""}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Auto-register current workspace if not in list */}
        {session.workDir && !state.projects.find((p) => p.path === session.workDir) && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
            <div className="flex items-center gap-2 text-xs">
              <FolderOpen size={14} className="text-[var(--accent)]" />
              <span>Current workspace not registered:</span>
              <span className="font-mono text-[var(--text-muted)]">{session.workDir}</span>
            </div>
            <button onClick={() => handleRegister(session.workDir)}
              className="px-2.5 py-1 rounded text-xs bg-[var(--accent)] text-white">
              Register
            </button>
          </div>
        )}

        {/* Global info */}
        <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-[var(--accent)]" />
              <span className="text-xs font-medium">Open Canvas Home</span>
            </div>
            <div className="flex items-center gap-2">
              {state.sharedData.length > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {state.sharedData.length} shared file{state.sharedData.length !== 1 ? "s" : ""}
                </span>
              )}
              <button onClick={() => revealInFinder(state.home)}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                title="Reveal in Finder">
                <FolderSearch size={12} />
              </button>
            </div>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1 ml-5">{state.home}</p>
        </div>

        {/* Calendar accordion — persisted state */}
        <CalendarAccordion defaultOpen={calendarOpen} onToggle={handleCalendarToggle} />

        {/* Kanban board accordion — persisted state */}
        <KanbanBoardSection
          board={kanban}
          projects={state.projects}
          groups={groups}
          isOpen={kanbanOpen}
          onToggle={handleKanbanToggle}
          onSetStatus={handleKanbanSetStatus}
        />

        {/* ── Groups + Projects ─────────────────────────────────────────────── */}
        {state.projects.length === 0 ? (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <FolderOpen size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No projects registered</p>
            <p className="text-xs mt-1">Add a project or open a folder to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Group sections */}
            {groups.map((group) => {
              const groupProjects = state.projects.filter((p) => group.projectPaths.includes(p.path));
              return (
                <GroupSection
                  key={group.id}
                  group={group}
                  projects={groupProjects}
                  isCollapsed={collapsedGroups.has(group.id)}
                  isDragOver={dragOverTarget === group.id}
                  kanbanStatus={getKanbanStatus({ type: "group", id: group.id })}
                  onToggleCollapse={() => toggleGroupCollapse(group.id)}
                  onDelete={() => handleDeleteGroup(group.id)}
                  onRename={(name) => handleRenameGroup(group.id, name)}
                  onRecolor={(color) => handleRecolorGroup(group.id, color)}
                  onSetKanbanStatus={(status) => handleKanbanSetStatus({ type: "group", id: group.id }, status)}
                  onDragOver={(e) => handleGroupDragOver(e, group.id)}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleGroupDrop(e, group.id)}
                  renderCard={renderProjectCard}
                />
              );
            })}

            {/* Ungrouped projects */}
            {(ungroupedProjects.length > 0 || groups.length === 0) && (
              <div
                onDragOver={handleUngroupedDragOver}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleGroupDrop(e, null)}
                className={`transition-all rounded-xl ${dragOverTarget === "ungrouped" && draggedPath ? "ring-2 ring-[var(--accent)]/40 bg-[var(--accent)]/3 p-2" : ""}`}
              >
                {groups.length > 0 && ungroupedProjects.length > 0 && (
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-xs text-[var(--text-muted)] font-medium">Ungrouped</span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {ungroupedProjects.length} project{ungroupedProjects.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {groups.length > 0 && ungroupedProjects.length === 0 ? (
                  <div className={`flex items-center justify-center py-4 rounded-xl border-2 border-dashed transition-colors ${dragOverTarget === "ungrouped" ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                    <p className="text-xs">Drop here to ungroup</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ungroupedProjects.map((project) => renderProjectCard(project))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
