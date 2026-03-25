import { SessionProvider } from "@/lib/SessionContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import { TerminalProvider } from "@/lib/TerminalContext";
import { ViewProvider } from "@/lib/ViewContext";
import { CalendarProvider } from "@/lib/CalendarContext";
import { JobsProvider } from "@/lib/JobsContext";
import { CanvasShell } from "@/components/CanvasShell";

export function App() {
  return (
    <SessionProvider>
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
  );
}
