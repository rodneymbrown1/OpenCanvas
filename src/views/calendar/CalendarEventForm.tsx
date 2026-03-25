import { useState, useEffect } from "react";
import { X, Bot, User, Calendar } from "lucide-react";
import type { CalendarEvent } from "@/lib/CalendarContext";

interface CalendarEventFormProps {
  onSubmit: (event: Partial<CalendarEvent> & { title: string; startTime: string }) => void;
  onCancel: () => void;
  initialStart?: string;
  initialEnd?: string;
}

interface Project {
  name: string;
  path: string;
  exists: boolean;
}

const AGENTS = ["claude", "codex", "gemini"] as const;

function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarEventForm({ onSubmit, onCancel, initialStart, initialEnd }: CalendarEventFormProps) {
  const [isAgentEvent, setIsAgentEvent] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState(initialStart ? toLocalDatetimeValue(initialStart) : "");
  const [endTime, setEndTime] = useState(initialEnd ? toLocalDatetimeValue(initialEnd) : "");
  const [allDay, setAllDay] = useState(false);
  const [recurrence, setRecurrence] = useState("");

  // Regular event fields
  const [reminderMessage, setReminderMessage] = useState("");

  // Agent event fields
  const [agentChoice, setAgentChoice] = useState<string>("claude");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [projectScope, setProjectScope] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        if (data.projects) setProjects(data.projects.filter((p: Project) => p.exists));
      })
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startTime) return;

    const common = {
      title,
      startTime: new Date(startTime).toISOString(),
      endTime: endTime ? new Date(endTime).toISOString() : undefined,
      allDay,
      recurrence: recurrence || undefined,
      source: { agent: "user" as const },
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
          <h3 className="font-semibold text-sm">New Event</h3>
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
            {/* Agent selector */}
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Agent</label>
              <div className="flex gap-1">
                {AGENTS.map((agent) => (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => setAgentChoice(agent)}
                    className={`flex-1 ${pillClass(agentChoice === agent)}`}
                  >
                    {agent}
                  </button>
                ))}
              </div>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Start</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">End</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
            />
          </div>
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

        <button
          type="submit"
          className="w-full py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          {isAgentEvent ? "Schedule Agent Task" : "Create Event"}
        </button>
      </form>
    </div>
  );
}
