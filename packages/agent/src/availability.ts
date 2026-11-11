/**
 * Open times.
 *
 * Slots are generated in the business's wall clock (so "9:00 am" means 9:00 am
 * on the day the clocks change) and returned as instants. Nothing here reveals
 * who else is booked: a slot is either open or not.
 */

import { MAX_SLOTS_RETURNED } from "@webina/shared";

import {
  addDays,
  dateLabel,
  daysBetween,
  localDateOf,
  minutesOfDay,
  timeFromMinutes,
  timeLabel,
  weekdayOf,
  zonedToUtc,
} from "./time";

export interface RuleLike {
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacity: number;
}

export interface ExceptionLike {
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export interface BusyLike {
  startAt: Date;
  endAt: Date;
}

export interface Slot {
  startIso: string;
  endIso: string;
  label: string;
}

export interface Window {
  startIso: string;
  endIso: string;
  label: string;
}

export interface DayPlan {
  /** `YYYY-MM-DD` in the business timezone. */
  date: string;
  timezone: string;
  /** `time_slot` | `day_window` | `owner_confirms`. */
  schedulingType: string;
  closed: boolean;
  closedReason: string | null;
  slots: Slot[];
  windows: Window[];
  /** Total open times found before the reply was trimmed to MAX_SLOTS. */
  openCount: number;
}

interface Block {
  startTime: string;
  endTime: string;
  stepMinutes: number;
  capacity: number;
}

function blocksFor(
  date: string,
  rules: RuleLike[],
  exception: ExceptionLike | null,
  durationMinutes: number | null,
): { blocks: Block[]; closed: boolean; closedReason: string | null } {
  if (exception) {
    if (exception.closed) {
      return {
        blocks: [],
        closed: true,
        closedReason: exception.reason ?? "closed that day",
      };
    }
    if (exception.startTime && exception.endTime) {
      return {
        blocks: [
          {
            startTime: exception.startTime,
            endTime: exception.endTime,
            stepMinutes: durationMinutes ?? 60,
            capacity: 1,
          },
        ],
        closed: false,
        closedReason: null,
      };
    }
  }

  const weekday = weekdayOf(date);
  const dayRules = rules.filter((rule) => rule.weekday === weekday);
  if (dayRules.length === 0) {
    return { blocks: [], closed: true, closedReason: "no opening hours that day" };
  }
  return {
    blocks: dayRules.map((rule) => ({
      startTime: rule.startTime,
      endTime: rule.endTime,
      stepMinutes: rule.slotMinutes,
      capacity: rule.capacity,
    })),
    closed: false,
    closedReason: null,
  };
}

/**
 * Build one day's open times.
 *
 * `now` is injected so a test can sit on either side of a changeover.
 */
export function planDay(options: {
  date: string;
  timezone: string;
  schedulingType: string;
  durationMinutes: number | null;
  rules: RuleLike[];
  exception: ExceptionLike | null;
  busy: BusyLike[];
  now: Date;
  limit?: number;
}): DayPlan {
  const limit = options.limit ?? MAX_SLOTS_RETURNED;
  const duration = options.durationMinutes ?? 60;
  const { blocks, closed, closedReason } = blocksFor(
    options.date,
    options.rules,
    options.exception,
    options.durationMinutes,
  );

  const plan: DayPlan = {
    date: options.date,
    timezone: options.timezone,
    schedulingType: options.schedulingType,
    closed,
    closedReason,
    slots: [],
    windows: [],
    openCount: 0,
  };
  if (blocks.length === 0) return plan;

  const busy = options.busy;
  const seen = new Set<string>();
  const found: Slot[] = [];

  for (const block of blocks) {
    const windowStart = zonedToUtc(options.date, block.startTime, options.timezone);
    const windowEnd = zonedToUtc(options.date, block.endTime, options.timezone);
    if (!windowStart || !windowEnd || windowEnd <= windowStart) continue;

    if (options.schedulingType === "day_window") {
      const key = windowStart.toISOString();
      if (!seen.has(key)) {
        seen.add(key);
        plan.windows.push({
          startIso: key,
          endIso: windowEnd.toISOString(),
          label: `${timeLabel(windowStart, options.timezone)} – ${timeLabel(windowEnd, options.timezone)}`,
        });
      }
      continue;
    }

    // Walk the wall clock, not the timeline: on a changeover day the number of
    // real minutes in a block is not the number of wall minutes.
    const first = minutesOfDay(block.startTime);
    const last = minutesOfDay(block.endTime);
    for (let minute = first; minute < last; minute += block.stepMinutes) {
      const start = zonedToUtc(options.date, timeFromMinutes(minute), options.timezone);
      // A wall time that does not exist (the skipped hour) yields null.
      if (!start) continue;
      const end = new Date(start.getTime() + duration * 60_000);
      if (end > windowEnd) break;
      if (start.getTime() <= options.now.getTime()) continue;

      const overlapping = busy.filter(
        (booking) => booking.startAt < end && booking.endAt > start,
      ).length;
      if (overlapping >= Math.max(1, block.capacity)) continue;

      const key = start.toISOString();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        startIso: key,
        endIso: end.toISOString(),
        label: `${dateLabel(start, options.timezone)}, ${timeLabel(start, options.timezone)}`,
      });
    }
  }

  found.sort((a, b) => a.startIso.localeCompare(b.startIso));
  plan.openCount = found.length;
  plan.slots = found.slice(0, limit);
  return plan;
}

export type DateRejection = { ok: false; message: string };

/** Is this a date the assistant may look at, and book on? */
export function checkBookableDate(options: {
  date: string;
  timezone: string;
  now: Date;
  horizonDays: number;
}): { ok: true; daysAhead: number } | DateRejection {
  const today = localDateOf(options.now, options.timezone);
  const daysAhead = daysBetween(today, options.date);
  if (Number.isNaN(daysAhead)) return { ok: false, message: "that is not a date I can read" };
  if (daysAhead < 0) return { ok: false, message: "that date is in the past" };
  if (daysAhead > options.horizonDays) {
    const last = addDays(today, options.horizonDays);
    return { ok: false, message: `I can only look ${options.horizonDays} days ahead (up to ${last})` };
  }
  return { ok: true, daysAhead };
}

export type SlotValidation =
  | { ok: true; capacity: number; endAt: Date }
  | {
      ok: false;
      /** Why the proposed time was refused, in the tool's own vocabulary. */
      code: "invalid_input" | "slot_taken" | "slot_unavailable";
      message: string;
    };

/**
 * Re-check, inside the booking itself, that a proposed start is a real open
 * slot: on the grid, inside opening hours (or that day's exception), long
 * enough for the service, in the future, within the horizon and not already
 * full. The model's word is not evidence.
 */
export function validateSlot(options: {
  date: string;
  timezone: string;
  schedulingType: string;
  durationMinutes: number | null;
  rules: RuleLike[];
  exception: ExceptionLike | null;
  busy: BusyLike[];
  startAt: Date;
  now: Date;
  horizonDays: number;
}): SlotValidation {
  const fail = (
    message: string,
    code: "invalid_input" | "slot_taken" | "slot_unavailable" = "slot_unavailable",
  ): SlotValidation => ({ ok: false, code, message });

  const dateCheck = checkBookableDate({
    date: options.date,
    timezone: options.timezone,
    now: options.now,
    horizonDays: options.horizonDays,
  });
  if (!dateCheck.ok) return fail(dateCheck.message, "invalid_input");

  if (options.schedulingType !== "time_slot") {
    return fail(
      "this service is not booked at an exact time — send a job request instead",
      "invalid_input",
    );
  }

  const duration = options.durationMinutes ?? 60;
  const { blocks } = blocksFor(options.date, options.rules, options.exception, options.durationMinutes);
  if (blocks.length === 0) return fail("we are closed that day");

  const end = new Date(options.startAt.getTime() + duration * 60_000);

  const wallStart = localDateOf(options.startAt, options.timezone);
  if (wallStart !== options.date) {
    return fail("that time falls on a different day in our timezone", "invalid_input");
  }

  const startMinutes = minutesOfDay(timeLabel24(options.startAt, options.timezone));

  for (const block of blocks) {
    const blockStart = minutesOfDay(block.startTime);
    const blockEnd = minutesOfDay(block.endTime);
    if (startMinutes < blockStart || startMinutes + duration > blockEnd) continue;
    if ((startMinutes - blockStart) % block.stepMinutes !== 0) continue;

    const windowEnd = zonedToUtc(options.date, block.endTime, options.timezone);
    if (!windowEnd || end > windowEnd) continue;

    const overlapping = options.busy.filter(
      (booking) => booking.startAt < end && booking.endAt > options.startAt,
    ).length;
    if (overlapping >= Math.max(1, block.capacity)) {
      return fail("that time has just been taken", "slot_taken");
    }
    return { ok: true, capacity: block.capacity, endAt: end };
  }

  return fail("that time is not one of our open times");
}

/** `HH:MM` of an instant in the business timezone. */
function timeLabel24(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return parts;
}
