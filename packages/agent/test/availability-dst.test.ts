/**
 * Daylight saving.
 *
 * Australia/Adelaide skips an hour on the first Sunday in October and repeats
 * one on the first Sunday in April. A booking made across either boundary must
 * land on the wall-clock time the customer was told, and the skipped hour must
 * never be offered.
 */

import { describe, expect, it } from "vitest";

import { planDay, validateSlot } from "../src/availability";
import { localDateOf, offsetMinutes, timeLabel, zonedToUtc } from "../src/time";

const TZ = "Australia/Adelaide";
const SPRING_FORWARD = "2027-10-03"; // 02:00 -> 03:00
const FALL_BACK = "2027-04-04"; // 03:00 -> 02:00
const SPRING_NOW = new Date("2027-09-01T00:00:00Z");
const AUTUMN_NOW = new Date("2027-01-15T00:00:00Z");

const sundayRule = {
  weekday: 0,
  startTime: "01:00",
  endTime: "04:00",
  slotMinutes: 60,
  capacity: 1,
};

describe("timezone arithmetic", () => {
  it("uses +09:30 in winter and +10:30 in summer", () => {
    expect(offsetMinutes(new Date("2027-07-01T00:00:00Z"), TZ)).toBe(570);
    expect(offsetMinutes(new Date("2027-12-01T00:00:00Z"), TZ)).toBe(630);
  });

  it("refuses a wall time that does not exist on the spring changeover", () => {
    expect(zonedToUtc(SPRING_FORWARD, "02:30", TZ)).toBeNull();
  });

  it("resolves the repeated hour on the autumn changeover to one real instant", () => {
    const instant = zonedToUtc(FALL_BACK, "02:30", TZ);
    expect(instant).not.toBeNull();
    expect(instant?.toISOString()).toBe("2027-04-03T17:00:00.000Z");
    expect(timeLabel(instant as Date, TZ)).toBe("2:30 am");
  });
});

describe("open times across a changeover", () => {
  it("skips the hour that does not exist and keeps every slot a real instant", () => {
    const plan = planDay({
      date: SPRING_FORWARD,
      timezone: TZ,
      schedulingType: "time_slot",
      durationMinutes: 60,
      rules: [sundayRule],
      exception: null,
      busy: [],
      now: SPRING_NOW,
    });

    // 01:00 and 03:00 exist; 02:00 was skipped by the clocks.
    expect(plan.slots.map((slot) => slot.startIso)).toEqual([
      "2027-10-02T15:30:00.000Z",
      "2027-10-02T16:30:00.000Z",
    ]);
    // Two wall-clock hours apart, one real hour apart.
    const [first, second] = plan.slots;
    const gap = new Date(second!.startIso).getTime() - new Date(first!.startIso).getTime();
    expect(gap).toBe(60 * 60_000);
    expect(first!.label).toContain("1:00 am");
    expect(second!.label).toContain("3:00 am");
  });

  it("never offers the repeated hour twice on the autumn changeover", () => {
    const plan = planDay({
      date: FALL_BACK,
      timezone: TZ,
      schedulingType: "time_slot",
      durationMinutes: 60,
      rules: [sundayRule],
      exception: null,
      busy: [],
      now: AUTUMN_NOW,
    });

    const starts = plan.slots.map((slot) => slot.startIso);
    expect(starts).toEqual(["2027-04-03T14:30:00.000Z", "2027-04-03T16:30:00.000Z", "2027-04-03T17:30:00.000Z"]);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort()).toEqual(starts);
  });

  it("accepts a slot on the far side of the spring changeover and stores the right instant", () => {
    const startAt = zonedToUtc(SPRING_FORWARD, "03:00", TZ) as Date;
    const verdict = validateSlot({
      date: SPRING_FORWARD,
      timezone: TZ,
      schedulingType: "time_slot",
      durationMinutes: 60,
      rules: [sundayRule],
      exception: null,
      busy: [],
      startAt,
      now: SPRING_NOW,
      horizonDays: 60,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.endAt.toISOString()).toBe("2027-10-02T17:30:00.000Z");
    expect(localDateOf(verdict.endAt, TZ)).toBe(SPRING_FORWARD);
  });

  it("rejects a proposed 02:30 on the changeover day", () => {
    const verdict = validateSlot({
      date: SPRING_FORWARD,
      timezone: TZ,
      schedulingType: "time_slot",
      durationMinutes: 60,
      rules: [sundayRule],
      exception: null,
      busy: [],
      // 02:30 local does not exist; this is the instant a naive UTC reading gives.
      startAt: new Date("2027-10-02T02:30:00Z"),
      now: SPRING_NOW,
      horizonDays: 60,
    });
    expect(verdict.ok).toBe(false);
  });
});
