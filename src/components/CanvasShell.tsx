
import { useEffect, Suspense, lazy } from "react";
import { Sidebar } from "@/components/Sidebar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ToastContainer } from "@/components/ToastContainer";
import { useView } from "@/lib/ViewContext";
import { logger } from "@/lib/logger";
import { Loader2 } from "lucide-react";

import WorkspaceView from "@/views/WorkspaceView";
import JobsView from "@/views/JobsView";
import UsageView from "@/views/UsageView";
import PortsView from "@/views/PortsView";
import SettingsView from "@/views/SettingsView";
import DataView from "@/views/DataView";
import ProjectsView from "@/views/ProjectsView";

// Lazy-load heavy views — FullCalendar (~500KB) and xterm (~400KB) only load on demand
const CalendarView = lazy(() => import("@/views/CalendarView"));
const TerminalPanel = lazy(() => import("@/components/TerminalPanel").then(m => ({ default: m.TerminalPanel })));

function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
    </div>
  );
}

function ActiveView() {
  const { view } = useView();

  useEffect(() => {
    logger.page(`View loaded: ${view}`);
  }, [view]);

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
    case "calendar":
      return <CalendarView />;
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
        <UpdateBanner />
        <main className={`flex-1 overflow-auto ${isWorkspace ? "min-h-0" : ""}`}>
          <Suspense fallback={<ViewLoading />}>
            <ActiveView />
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <TerminalPanel />
        </Suspense>
      </div>
      <ToastContainer />
    </>
  );
}
