"use client";

import Link from "next/link";
import { Key, Bot, Plug, ChevronRight } from "lucide-react";

const SECTIONS = [
  {
    href: "/settings/agents",
    icon: Bot,
    label: "Coding Agents",
    desc: "Select and configure Claude, Codex, or Gemini",
  },
  {
    href: "/settings/api-keys",
    icon: Key,
    label: "API Keys",
    desc: "Manage API keys for agent providers",
  },
  {
    href: "/settings/mcp",
    icon: Plug,
    label: "MCP Servers",
    desc: "Connect to external services via Model Context Protocol",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <div className="space-y-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center gap-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-4 py-4 hover:border-[var(--accent)] transition-colors"
          >
            <s.icon size={20} className="text-[var(--accent)] shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-[var(--text-muted)]">{s.desc}</p>
            </div>
            <ChevronRight size={16} className="text-[var(--text-muted)]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
