
import { useEffect, Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TerminalPanel } from "@/components/TerminalPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ToastContainer } from "@/components/ToastContainer";
import { useView } from "@/lib/ViewContext";
import { logger } from "@/lib/logger";
import { Loader2 } from "lucide-react";

// Static imports — project is ~650K source, no benefit from code-splitting.
// Dynamic imports with ssr:false caused SSR bailout, white screens, and
// on-demand Turbopack compilation lag on every tab switch in dev mode.
import WorkspaceView from "@/views/WorkspaceView";
import JobsView from "@/views/JobsView";
import UsageView from "@/views/UsageView";
import PortsView from "@/views/PortsView";
import SettingsView from "@/views/SettingsView";
import DataView from "@/views/DataView";
import ProjectsView from "@/views/ProjectsView";
import CalendarView from "@/views/CalendarView";

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
        <TerminalPanel />
      </div>
      <ToastContainer />
    </>
  );
}
