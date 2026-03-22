"use client";

import { useProject } from "@/lib/ProjectContext";
import { Loader2, CheckCircle, FileText, Upload, FolderOpen, Globe } from "lucide-react";

export function ProjectStatusBar() {
  const { state, refreshAppPreview } = useProject();
  const { pipelinePhase, appStatus, appPort } = state;

  // Determine what to show
  let icon: React.ReactNode = null;
  let label = "";
  let color = "var(--text-muted)";
  let bgColor = "transparent";
  let visible = false;

  if (pipelinePhase === "uploading") {
    icon = <Upload size={13} className="animate-pulse" />;
    label = "Uploading documents...";
    color = "var(--accent)";
    bgColor = "var(--bg-tertiary)";
    visible = true;
  } else if (pipelinePhase === "formatting") {
    icon = <FileText size={13} className="animate-pulse" />;
    label = "Formatting to markdown...";
    color = "var(--accent)";
    bgColor = "var(--bg-tertiary)";
    visible = true;
  } else if (pipelinePhase === "organizing") {
    icon = <FolderOpen size={13} className="animate-pulse" />;
    label = "Organizing project data...";
    color = "var(--accent)";
    bgColor = "var(--bg-tertiary)";
    visible = true;
  } else if (appStatus === "building" || appStatus === "initializing") {
    icon = <Loader2 size={13} className="animate-spin" />;
    label = appStatus === "initializing" ? "Initializing app..." : "Building app...";
    color = "#f59e0b";
    bgColor = "rgba(245, 158, 11, 0.08)";
    visible = true;
  } else if (appStatus === "running" && appPort) {
    icon = <Globe size={13} />;
    label = `App running on :${appPort}`;
    color = "#22c55e";
    bgColor = "rgba(34, 197, 94, 0.08)";
    visible = true;
  } else if (appStatus === "error") {
    icon = <CheckCircle size={13} />;
    label = "App stopped";
    color = "var(--error)";
    bgColor = "rgba(239, 68, 68, 0.08)";
    visible = true;
  }

  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 border-b border-[var(--border)] text-xs transition-all duration-300 shrink-0"
      style={{ backgroundColor: bgColor, color }}
    >
      {icon}
      <span>{label}</span>
      {appStatus === "running" && appPort && (
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refreshAppPreview}
            className="opacity-60 hover:opacity-100 transition-opacity text-xs"
          >
            refresh
          </button>
          <a
            href={`http://localhost:${appPort}`}
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-60 hover:opacity-100 transition-opacity text-xs"
          >
            open ↗
          </a>
        </div>
      )}
    </div>
  );
}
