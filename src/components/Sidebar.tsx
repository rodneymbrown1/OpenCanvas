"use client";

import Image from "next/image";
import {
  FolderOpen,
  Activity,
  BarChart3,
  Settings,
  FileText,
  Wifi,
  Sun,
  Moon,
  Database,
  Layers,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { useView, type ViewId } from "@/lib/ViewContext";

const NAV_ITEMS: { id: ViewId; icon: typeof FolderOpen; label: string }[] = [
  { id: "workspace", icon: FolderOpen, label: "Workspace" },
  { id: "jobs", icon: Activity, label: "Jobs" },
  { id: "usage", icon: BarChart3, label: "Usage" },
  { id: "ports", icon: Wifi, label: "Ports" },
  { id: "data", icon: Database, label: "Data" },
  { id: "projects", icon: Layers, label: "Projects" },
  { id: "project", icon: FileText, label: "Config" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { view, setView } = useView();
  const [theme, toggleTheme] = useTheme();

  return (
    <aside className="w-14 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      <button
        onClick={() => setView("workspace")}
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
