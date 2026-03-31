import { SessionProvider, useSession } from "@/lib/SessionContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import { TerminalProvider } from "@/lib/TerminalContext";
import { ViewProvider } from "@/lib/ViewContext";
import { CalendarProvider } from "@/lib/CalendarContext";
import { JobsProvider } from "@/lib/JobsContext";
import { ToastProvider } from "@/lib/ToastContext";
import { CanvasShell } from "@/components/CanvasShell";
import { useEffect } from "react";

function TitleUpdater() {
  const { session } = useSession();
  useEffect(() => {
    const name = session.workDir ? session.workDir.split("/").pop() : "";
    document.title = name ? `${name} — Open Canvas` : "Open Canvas";
  }, [session.workDir]);
  return null;
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <TitleUpdater />
        <ProjectProvider>
          <TerminalProvider>
            <ViewProvider>
              <CalendarProvider>
                <JobsProvider>
                  <CanvasShell />
                </JobsProvider>
              </CalendarProvider>
            </ViewProvider>
          </TerminalProvider>
        </ProjectProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
