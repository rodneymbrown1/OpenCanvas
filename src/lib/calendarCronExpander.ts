/**
 * Expand a cron expression into occurrence timestamps within a date range.
 * Uses a simple forward-iteration approach without additional dependencies.
 */

interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;

      if (range !== "*") {
        const dashMatch = range.match(/^(\d+)-(\d+)$/);
        if (dashMatch) {
          start = parseInt(dashMatch[1], 10);
          end = parseInt(dashMatch[2], 10);
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    const num = parseInt(part, 10);
    if (!isNaN(num)) values.add(num);
  }

  return Array.from(values).sort((a, b) => a - b);
}

function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

function matchesCron(date: Date, fields: CronFields): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  return (
    fields.minutes.includes(minute) &&
    fields.hours.includes(hour) &&
    fields.daysOfMonth.includes(dayOfMonth) &&
    fields.months.includes(month) &&
    fields.daysOfWeek.includes(dayOfWeek)
  );
}

/**
 * Expand a cron expression into occurrences within [from, to].
 * Returns ISO timestamp strings. Caps at maxOccurrences to prevent runaway.
 */
export function expandCron(
  cronExpression: string,
  from: string,
  to: string,
  maxOccurrences = 100
): string[] {
  const fields = parseCron(cronExpression);
  if (!fields) return [];

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const occurrences: string[] = [];

  // Start at the beginning of the "from" minute
  const cursor = new Date(fromDate);
  cursor.setSeconds(0, 0);

  while (cursor <= toDate && occurrences.length < maxOccurrences) {
    if (matchesCron(cursor, fields)) {
      occurrences.push(cursor.toISOString());
    }
    // Advance by 1 minute
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return occurrences;
}
