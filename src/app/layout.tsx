import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/SessionContext";
import { ProjectProvider } from "@/lib/ProjectContext";
import { ViewProvider } from "@/lib/ViewContext";
import { CanvasShell } from "@/components/CanvasShell";

export const metadata: Metadata = {
  title: "Open Canvas",
  description: "Browser-based IDE for terminal coding agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className="flex h-screen overflow-hidden">
        <SessionProvider>
          <ProjectProvider>
            <ViewProvider>
              <CanvasShell />
              {children}
            </ViewProvider>
          </ProjectProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
