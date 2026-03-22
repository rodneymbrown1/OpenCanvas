import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { SessionProvider } from "@/lib/SessionContext";

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
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
