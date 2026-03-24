"use client";

import { X, Plus, Terminal } from "lucide-react";
import { useTerminals } from "@/lib/TerminalContext";
import type { TerminalTab } from "@/lib/types/terminal";

function statusColor(status: TerminalTab["status"]): string {
  switch (status) {
    case "connected":
      return "bg-[var(--success)]";
    case "connecting":
      return "bg-yellow-400";
    case "exited":
      return "bg-[var(--error)]";
    default:
      return "bg-[var(--text-muted)]";
  }
}

interface TerminalTabBarProps {
  onAddClicked?: () => void;
}

export function TerminalTabBar({ onAddClicked }: TerminalTabBarProps) {
  const { state, removeTab, setActiveTab } = useTerminals();
  const { tabs, activeTabId } = state;

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    removeTab(tabId);
  };

  return (
    <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border)] overflow-x-auto">
      {/* Tabs */}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-[var(--border)] shrink-0 transition-colors ${
            tab.id === activeTabId
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)] border-b-2 border-b-[var(--accent)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(tab.status)}`} />
          <Terminal size={11} className="shrink-0 opacity-60" />
          <span className="truncate max-w-[100px]">{tab.label}</span>
          <span
            onClick={(e) => handleCloseTab(e, tab.id)}
            className="ml-1 opacity-0 group-hover:opacity-100 hover:text-[var(--error)] transition-opacity shrink-0"
          >
            <X size={12} />
          </span>
        </button>
      ))}

      {/* Add tab button — opens connect modal */}
      <button
        onClick={onAddClicked}
        className="flex items-center justify-center w-7 h-7 shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title="New terminal"
      >
        <Plus size={14} />
      </button>

      {/* Label when no tabs */}
      {tabs.length === 0 && (
        <span className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
          TERMINAL
        </span>
      )}
    </div>
  );
}
