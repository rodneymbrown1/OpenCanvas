import { useState, useEffect } from "react";
import { X, Bot, User, Calendar } from "lucide-react";
import type { CalendarEvent } from "@/lib/CalendarContext";

interface CalendarEventFormProps {
  onSubmit: (event: Partial<CalendarEvent> & { title: string; startTime: string }) => void;
  onCancel: () => void;
  initialStart?: string;
  initialEnd?: string;
  editEvent?: CalendarEvent;
}

interface Project {
  name: string;
  path: string;
  exists: boolean;
}

interface AgentInfo {
  id: string;
  label: string;
  installed: boolean;
}

const FALLBACK_AGENTS: AgentInfo[] = [
  { id: "claude", label: "Claude Code", installed: true },
  { id: "codex", label: "Codex", installed: false },
  { id: "gemini", label: "Gemini", installed: false },
];

function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarEventForm({ onSubmit, onCancel, initialStart, initialEnd, editEvent }: CalendarEventFormProps) {
  const isEdit = !!editEvent;
  const [isAgentEvent, setIsAgentEvent] = useState(editEvent?.target === "agent" || editEvent?.target === "both" || false);
  const [title, setTitle] = useState(editEvent?.title || "");
  const [description, setDescription] = useState(editEvent?.description || "");
  const [startTime, setStartTime] = useState(
    editEvent?.startTime ? toLocalDatetimeValue(editEvent.startTime) : initialStart ? toLocalDatetimeValue(initialStart) : ""
  );
  const [endTime, setEndTime] = useState(
    editEvent?.endTime ? toLocalDatetimeValue(editEvent.endTime) : initialEnd ? toLocalDatetimeValue(initialEnd) : ""
  );
  const [allDay, setAllDay] = useState(editEvent?.allDay || false);
  const [recurrence, setRecurrence] = useState(editEvent?.recurrence || "");

  // Regular event fields
  const [reminderMessage, setReminderMessage] = useState(
    editEvent?.action?.type === "reminder" ? editEvent.action.payload : ""
  );

  // Agent event fields
  const [agentChoice, setAgentChoice] = useState<string>(editEvent?.action?.agent || "claude");
  const [agentPrompt, setAgentPrompt] = useState(editEvent?.action?.type === "prompt" ? editEvent.action.payload : "");
  const [projectScope, setProjectScope] = useState(editEvent?.action?.projectPath || "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS);

  // Google Calendar sync
  const [syncToGoogle, setSyncToGoogle] = useState(!!editEvent?.googleCalendarId);
  const [mcpAvailable, setMcpAvailable] = useState(false);

  useEffect(() => {
    // Fetch installed agents, projects, and MCP status in parallel
    Promise.all([
      fetch("/api/agents").then((r) => r.json()).catch(() => null),
      fetch("/api/projects").then((r) => r.json()).catch(() => null),
      fetch("/api/calendar/mcp-status").then((r) => r.json()).catch(() => null),
    ]).then(([agentData, projectData, mcpData]) => {
      if (agentData?.agents) {
        setAgents(agentData.agents);
        // Default to first installed agent
        const firstInstalled = agentData.agents.find((a: AgentInfo) => a.installed);
        if (firstInstalled) setAgentChoice(firstInstalled.id);
      }
      if (projectData?.projects) {
        setProjects(projectData.projects.filter((p: Project) => p.exists));
      }
      if (mcpData?.available) {
        setMcpAvailable(true);
      }
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startTime) return;

    const common = {
      title,
      startTime: new Date(startTime).toISOString(),
      endTime: !isAgentEvent && endTime ? new Date(endTime).toISOString() : undefined,
      allDay,
      recurrence: recurrence || undefined,
      source: { agent: "user" as const },
      syncToGoogle: syncToGoogle && mcpAvailable ? true : undefined,
    };

    if (isAgentEvent) {
      onSubmit({
        ...common,
        description: agentPrompt || undefined,
        target: "agent",
        action: {
          type: "prompt",
          payload: agentPrompt || title,
          agent: agentChoice,
          projectPath: projectScope || undefined,
        },
      });
    } else {
      onSubmit({
        ...common,
        description: description || undefined,
        target: "user",
        action: reminderMessage
          ? { type: "reminder", payload: reminderMessage }
          : undefined,
      });
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";

  const pillClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
      active
        ? "bg-[var(--accent)] text-white"
        : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 space-y-3 w-[440px] max-h-[80vh] overflow-auto shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{isEdit ? "Edit Event" : "New Event"}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Event type toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)]">
          <button
            type="button"
            onClick={() => setIsAgentEvent(false)}
            className={`flex-1 flex items-center justify-center gap-1.5 ${pillClass(!isAgentEvent)}`}
          >
            <Calendar size={12} />
            Regular Event
          </button>
          <button
            type="button"
            onClick={() => setIsAgentEvent(true)}
            className={`flex-1 flex items-center justify-center gap-1.5 ${pillClass(isAgentEvent)}`}
          >
            <Bot size={12} />
            Agent Task
          </button>
        </div>

        <input
          type="text"
          placeholder={isAgentEvent ? "Task name" : "Event title"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          required
          autoFocus
        />

        {/* Agent-specific fields */}
        {isAgentEvent && (
          <>
            {/* Agent selector — only installed agents are selectable */}
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Agent</label>
              <div className="flex gap-1">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => agent.installed && setAgentChoice(agent.id)}
                    disabled={!agent.installed}
                    title={agent.installed ? agent.label : `${agent.label} is not installed`}
                    className={`flex-1 ${pillClass(agentChoice === agent.id)} ${
                      !agent.installed ? "opacity-30 cursor-not-allowed line-through" : ""
                    }`}
                  >
                    {agent.id}
                  </button>
                ))}
              </div>
              {!agents.some((a) => a.installed) && (
                <p className="text-[10px] text-red-400 mt-1">No agents installed. Install claude, codex, or gemini CLI first.</p>
              )}
            </div>

            {/* Agent prompt */}
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">Prompt</label>
              <textarea
                placeholder="What should the agent do? e.g. 'Find interesting people to reach out to for the Activate program'"
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                rows={4}
                className={`${inputClass} resize-none border-l-2 border-l-[var(--accent)]`}
              />
            </div>

            {/* Project scope */}
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">Project Scope</label>
              <select
                value={projectScope}
                onChange={(e) => setProjectScope(e.target.value)}
                className={inputClass}
              >
                <option value="">Auto-detect (recommended)</option>
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Regular event description */}
        {!isAgentEvent && (
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        )}

        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="rounded"
            />
            All day
          </label>
        </div>

        <div className={`grid ${isAgentEvent ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              {isAgentEvent ? "Run at" : "Start"}
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          {!isAgentEvent && (
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">End</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">
            Recurrence (cron expression, optional)
          </label>
          <input
            type="text"
            placeholder="e.g. 0 9 * * 1-5 (weekdays at 9am)"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Regular event reminder */}
        {!isAgentEvent && (
          <input
            type="text"
            placeholder="Reminder message (optional)"
            value={reminderMessage}
            onChange={(e) => setReminderMessage(e.target.value)}
            className={inputClass}
          />
        )}

        {/* Google Calendar sync toggle */}
        <label
          className={`flex items-center gap-2 text-xs py-2 ${
            mcpAvailable
              ? "text-[var(--text-secondary)] cursor-pointer"
              : "text-[var(--text-muted)] opacity-50 cursor-not-allowed"
          }`}
          title={mcpAvailable ? undefined : "Google Calendar MCP not available. Ensure Claude Code CLI has access."}
        >
          <input
            type="checkbox"
            checked={syncToGoogle}
            onChange={(e) => setSyncToGoogle(e.target.checked)}
            disabled={!mcpAvailable}
            className="rounded border-[var(--border)] accent-[var(--accent)]"
          />
          {editEvent?.googleCalendarId ? "Synced with Google Calendar" : "Add to Google Calendar"}
        </label>

        <button
          type="submit"
          className="w-full py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          {isEdit ? "Save Changes" : isAgentEvent ? "Schedule Agent Task" : "Create Event"}
        </button>
      </form>
    </div>
  );
}
