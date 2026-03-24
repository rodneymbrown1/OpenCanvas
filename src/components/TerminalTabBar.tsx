"use client";

import { useState, useRef, useEffect } from "react";
import { X, Plus, Terminal } from "lucide-react";
import { useTerminals } from "@/lib/TerminalContext";
import type { AgentType, TerminalTab } from "@/lib/types/terminal";

const AGENT_OPTIONS: { id: AgentType; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "shell", label: "Shell" },
];

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
  onTabCreated?: (tabId: string, agent: AgentType) => void;
}

export function TerminalTabBar({ onTabCreated }: TerminalTabBarProps) {
  const { state, addTab, removeTab, setActiveTab } = useTerminals();
  const { tabs, activeTabId } = state;
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const handleAddTab = (agent: AgentType) => {
    const tabId = addTab(agent);
    setShowDropdown(false);
    onTabCreated?.(tabId, agent);
  };

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

      {/* Add tab button */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="New terminal"
        >
          <Plus size={14} />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[140px]">
            {AGENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleAddTab(opt.id)}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)] transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Label */}
      {tabs.length === 0 && (
        <span className="px-3 py-1.5 text-xs text-[var(--text-muted)]">
          TERMINAL
        </span>
      )}
    </div>
  );
}
