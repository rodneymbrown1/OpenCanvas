"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  Activity,
  BarChart3,
  Settings,
  FileText,
  Wifi,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";

const NAV_ITEMS = [
  { href: "/workspace", icon: FolderOpen, label: "Workspace" },
  { href: "/jobs", icon: Activity, label: "Jobs" },
  { href: "/usage", icon: BarChart3, label: "Usage" },
  { href: "/ports", icon: Wifi, label: "Ports" },
  { href: "/project", icon: FileText, label: "Project" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [theme, toggleTheme] = useTheme();

  return (
    <aside className="w-14 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      <Link
        href="/workspace"
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-4 hover:opacity-80 transition-opacity"
        title="Open Canvas"
      >
        <Image
          src="/open_canvas_logo.png"
          alt="Open Canvas"
          width={32}
          height={32}
          className="rounded"
        />
      </Link>
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isActive
                ? "bg-[var(--bg-tertiary)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <item.icon size={20} />
          </Link>
        );
      })}

      {/* Spacer to push theme toggle to bottom */}
      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </aside>
  );
}
