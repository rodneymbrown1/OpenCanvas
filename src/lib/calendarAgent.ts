/**
 * Calendar Agent — intent detection and routing for calendar operations.
 *
 * When an agent in any project mentions scheduling/calendar intent,
 * this module parses the intent and creates calendar events.
 */

import { addEvent, type CalendarEvent, type AgentType, type EventTarget } from "./calendarConfig";

// ── Intent Detection ─────────────────────────────────────────────────────────

const CALENDAR_INTENT_PATTERNS = [
  /(?:add|put|create|schedule|set)\s+(?:an?\s+)?(?:event|reminder|task|item)\s+(?:on|to|for|in)\s+(?:the\s+)?calendar/i,
  /remind\s+me\s+(?:to|about|that)/i,
  /schedule\s+(?:a\s+)?(?:meeting|call|session|review|deployment|test|check)/i,
  /(?:add|put)\s+(?:this|that|it)\s+(?:on|to)\s+(?:my|the)\s+calendar/i,
  /set\s+(?:a\s+)?reminder\s+(?:for|to|about)/i,
  /(?:at|by|before|on)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,
  /(?:tomorrow|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s+(?:at|by)/i,
];

export function detectCalendarIntent(text: string): boolean {
  return CALENDAR_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Intent Parsing ───────────────────────────────────────────────────────────

export interface CalendarIntent {
  title: string;
  description?: string;
  startTime?: string;
  target: EventTarget;
  actionType?: "prompt" | "command" | "reminder";
  actionPayload?: string;
  projectPath?: string;
}

/**
 * Parse a natural language calendar intent into structured data.
 * This is a basic parser — for complex intents, the calendar agent session
 * should be used for full reasoning.
 */
export function parseCalendarIntent(
  text: string,
  sourceAgent: AgentType,
  sourceProject?: string
): CalendarIntent {
  // Extract a reasonable title (first sentence or first 80 chars)
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  const title = firstSentence.length > 80
    ? firstSentence.slice(0, 77) + "..."
    : firstSentence;

  // Determine target based on keywords
  let target: EventTarget = "user";
  if (/(?:agent|claude|codex|gemini)\s+(?:should|will|needs?\s+to)/i.test(text)) {
    target = "agent";
  } else if (/(?:we|both|you and I)\s+(?:should|need)/i.test(text)) {
    target = "both";
  }

  // Determine action type
  let actionType: "prompt" | "command" | "reminder" = "reminder";
  if (/(?:run|execute|deploy|test|build)\s/i.test(text)) {
    actionType = target === "agent" ? "prompt" : "command";
  }

  return {
    title,
    description: text.length > 80 ? text : undefined,
    target,
    actionType,
    actionPayload: text,
    projectPath: sourceProject,
  };
}

// ── Route to Calendar ────────────────────────────────────────────────────────

/**
 * Create a calendar event from detected intent.
 * For events without a clear time, defaults to 1 hour from now.
 */
export function routeToCalendar(
  intentText: string,
  sourceAgent: AgentType,
  sourceProject?: string,
  sourceSessionId?: string
): CalendarEvent {
  const intent = parseCalendarIntent(intentText, sourceAgent, sourceProject);

  // Default to 1 hour from now if no time detected
  const startTime = intent.startTime || new Date(Date.now() + 3600_000).toISOString();

  return addEvent({
    title: intent.title,
    description: intent.description,
    startTime,
    source: {
      agent: sourceAgent,
      projectPath: sourceProject,
      sessionId: sourceSessionId,
    },
    target: intent.target,
    action: intent.actionPayload
      ? {
          type: intent.actionType || "reminder",
          payload: intent.actionPayload,
          projectPath: intent.projectPath,
          agent: sourceAgent,
        }
      : undefined,
  });
}
