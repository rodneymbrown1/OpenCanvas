import { Sidebar } from "@/components/Sidebar";
import { TerminalPanel } from "@/components/TerminalPanel";
import { useView } from "@/lib/ViewContext";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { view } = useView();
  const isWorkspace = view === "workspace";

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className={`flex-1 overflow-auto ${isWorkspace ? "min-h-0" : ""}`}>
          {children}
        </main>
        <TerminalPanel />
      </div>
    </>
  );
}
