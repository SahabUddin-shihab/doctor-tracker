/**
 * Timezone-aware calendar helpers. All "this month", day-range filters and
 * trend buckets go through these functions so the whole API applies one
 * consistent timezone rule (APP_TIMEZONE).
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset (local - UTC) in ms for the given instant. */
function offsetMs(instantMs: number, timeZone: string): number {
  const flooredMs = instantMs - (((instantMs % 1000) + 1000) % 1000);
  const p = localParts(new Date(flooredMs), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - flooredMs;
}

/** The UTC instant at which the given local wall-clock time occurs in `timeZone`. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let result = naive - offsetMs(naive, timeZone);
  const corrected = naive - offsetMs(result, timeZone);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

export function startOfZonedMonth(now: Date, timeZone: string, monthOffset = 0): Date {
  const { year, month } = localParts(now, timeZone);
  const index = year * 12 + (month - 1) + monthOffset;
  return zonedTimeToUtc(Math.floor(index / 12), (index % 12) + 1, 1, timeZone);
}

export function startOfZonedDay(now: Date, timeZone: string): Date {
  const { year, month, day } = localParts(now, timeZone);
  return zonedTimeToUtc(year, month, day, timeZone);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a query-string date boundary. Date-only values ("2026-11-05") are
 * interpreted in the app timezone: start-of-day for `from`, end-of-day for `to`.
 * Full ISO timestamps are used as-is. Returns null when the value is invalid.
 */
export function parseBoundary(value: string, edge: 'start' | 'end', timeZone: string): Date | null {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [year, month, day] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
      return null;
    }
    const start = zonedTimeToUtc(year, month, day, timeZone);
    if (edge === 'start') return start;
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const nextStart = zonedTimeToUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      timeZone,
    );
    return new Date(nextStart.getTime() - 1);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "YYYY-MM-DD" key of the local calendar date for an instant. */
export function localDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = localParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Pure calendar arithmetic on "YYYY-MM-DD" keys (no DST involvement). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function addMonthsToKey(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m - 1 + months, 1));
  return next.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing the calendar date key. */
export function mondayOfKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysToKey(key, -((weekday + 6) % 7));
}

export function firstOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}
