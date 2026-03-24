"use client";

import { Sidebar } from "@/components/Sidebar";
import { TerminalPanel } from "@/components/TerminalPanel";
import { usePathname } from "next/navigation";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWorkspace = pathname === "/workspace";

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Page content — takes remaining space above the terminal */}
        <main className={`flex-1 overflow-auto ${isWorkspace ? "min-h-0" : ""}`}>
          {children}
        </main>
        {/* Terminal — always mounted, only visible on /workspace */}
        <TerminalPanel />
      </div>
    </>
  );
}
