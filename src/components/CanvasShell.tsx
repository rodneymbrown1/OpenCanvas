"use client";

import { Sidebar } from "@/components/Sidebar";
import { TerminalPanel } from "@/components/TerminalPanel";
import { useView } from "@/lib/ViewContext";
import dynamic from "next/dynamic";

// Lazy-load views to keep initial bundle small
const WorkspaceView = dynamic(() => import("@/views/WorkspaceView"), { ssr: false });
const JobsView = dynamic(() => import("@/views/JobsView"), { ssr: false });
const UsageView = dynamic(() => import("@/views/UsageView"), { ssr: false });
const PortsView = dynamic(() => import("@/views/PortsView"), { ssr: false });
const SettingsView = dynamic(() => import("@/views/SettingsView"), { ssr: false });
const DataView = dynamic(() => import("@/views/DataView"), { ssr: false });
const ProjectsView = dynamic(() => import("@/views/ProjectsView"), { ssr: false });

function ActiveView() {
  const { view } = useView();

  switch (view) {
    case "workspace":
      return <WorkspaceView />;
    case "jobs":
      return <JobsView />;
    case "usage":
      return <UsageView />;
    case "ports":
      return <PortsView />;
    case "project":
    case "settings":
      return <SettingsView />;
    case "data":
      return <DataView />;
    case "appify":
      return (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
          App Builder — coming soon
        </div>
      );
    case "projects":
      return <ProjectsView />;
    default:
      return <WorkspaceView />;
  }
}

export function CanvasShell() {
  const { view } = useView();
  const isWorkspace = view === "workspace";

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className={`flex-1 overflow-auto ${isWorkspace ? "min-h-0" : ""}`}>
          <ActiveView />
        </main>
        <TerminalPanel />
      </div>
    </>
  );
}
