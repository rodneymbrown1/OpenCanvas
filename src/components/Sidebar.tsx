"use client";

import Image from "next/image";
import {
  FolderOpen,
  Bot,
  DollarSign,
  Settings,
  Wifi,
  Sun,
  Moon,
  Database,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { useView, type ViewId } from "@/lib/ViewContext";

const NAV_ITEMS: { id: ViewId; icon: typeof FolderOpen; label: string }[] = [
  { id: "workspace", icon: FolderOpen, label: "Workspace" },
  { id: "jobs", icon: Bot, label: "Jobs" },
  { id: "usage", icon: DollarSign, label: "Usage" },
  { id: "ports", icon: Wifi, label: "Ports" },
  { id: "data", icon: Database, label: "Data" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { view, setView } = useView();
  const [theme, toggleTheme] = useTheme();

  return (
    <aside className="w-14 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      {/* Logo → Project Manager */}
      <button
        onClick={() => setView("projects")}
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-4 transition-colors ${
          view === "projects"
            ? "bg-[var(--bg-tertiary)] ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-secondary)]"
            : "hover:bg-[var(--bg-tertiary)] hover:ring-1 hover:ring-[var(--border)]"
        }`}
        title="Project Manager"
      >
        <Image
          src="/open_square_canvas_logo.png"
          alt="Open Canvas"
          width={32}
          height={32}
          className="rounded"
          style={{ width: "auto", height: "auto" }}
        />
      </button>

      {NAV_ITEMS.map((item) => {
        const isActive = view === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={item.label}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isActive
                ? "bg-[var(--bg-tertiary)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <item.icon size={20} />
          </button>
        );
      })}

      <div className="flex-1" />

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
