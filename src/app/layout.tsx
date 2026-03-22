import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/SessionContext";
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
    <html lang="en" className="dark">
      <body className="flex h-screen overflow-hidden">
        <SessionProvider>
          <ViewProvider>
            <CanvasShell />
            {/* Hidden: Next.js still needs children rendered for API routes */}
            <div className="hidden">{children}</div>
          </ViewProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
