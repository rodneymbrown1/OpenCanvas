"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  Activity,
  BarChart3,
  Settings,
  FileText,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/workspace", icon: FolderOpen, label: "Workspace" },
  { href: "/jobs", icon: Activity, label: "Jobs" },
  { href: "/usage", icon: BarChart3, label: "Usage" },
  { href: "/project", icon: FileText, label: "Project" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-14 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      <Link
        href="/workspace"
        className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm mb-4"
        title="Open Canvas"
      >
        OC
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
    </aside>
  );
}
