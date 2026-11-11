/**
 * Wall-clock maths in a business's own timezone.
 *
 * Slots are described in the owner's world ("Tuesday 9:00 am") but stored as
 * instants, and Australia/Adelaide shifts by an hour twice a year. Everything
 * here converts between the two without assuming a fixed offset, and refuses
 * to invent a wall time that does not exist (the hour skipped on the spring
 * changeover) rather than silently booking an hour out.
 *
 * No date library: `Intl` is the authority on timezone rules, and the offsets
 * are derived from it.
 */

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The local wall clock of an instant, in `timeZone`. */
export function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Minutes east of UTC at this instant (Adelaide: 570, or 630 in daylight time). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const w = wallClockOf(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/** `YYYY-MM-DD` of an instant, in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  const w = wallClockOf(instant, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function parseIsoDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function addDays(date: string, days: number): string {
  const parts = parseIsoDate(date);
  if (!parts) throw new TypeError(`not a date: ${date}`);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) throw new TypeError("not a date");
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday for a calendar date. */
export function weekdayOf(date: string): number {
  const parts = parseIsoDate(date);
  if (!parts) throw new TypeError(`not a date: ${date}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/**
 * `YYYY-MM-DD` + `HH:MM` in `timeZone` -> instant.
 *
 * Returns `null` when that wall time does not exist (the hour skipped by a
 * spring changeover). An ambiguous time (the hour repeated when daylight time
 * ends) resolves to the later occurrence, which is the one a customer means
 * when they say "2:30".
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const parts = parseIsoDate(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!parts || !clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;

  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0);
  // Two passes settle the offset either side of a changeover.
  let candidate = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  candidate = naive - offsetMinutes(new Date(candidate), timeZone) * 60_000;

  const wall = wallClockOf(new Date(candidate), timeZone);
  if (wall.year !== parts.year || wall.month !== parts.month || wall.day !== parts.day) return null;
  if (wall.hour !== hour || wall.minute !== minute) return null;
  return new Date(candidate);
}

/** `9:00 am` — the label a customer reads. */
export function timeLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/** `Tuesday 6 October` — for confirmations. */
export function dateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

/** Minutes from midnight for `HH:MM`. */
export function minutesOfDay(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new TypeError(`not a time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timeFromMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
