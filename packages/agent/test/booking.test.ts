/**
 * Bookings: the parts that are easy to get wrong.
 *
 * The race, the retry, and the id from another business. All three run against
 * real Postgres, as the least-privilege role, through the real tool.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { listBookings, notifications, withTenant } from "@webina/db";

import { runTool } from "../src/tools";
import { zonedToUtc } from "../src/time";
import {
  addArea,
  addRules,
  addService,
  futureDate,
  makeTenant,
  setPlan,
  type FixtureTenant,
} from "./fixtures";

const TZ = "Australia/Adelaide";
const MONDAY = 1;

let tenant: FixtureTenant;
let serviceId: string;

function ctxFor(businessId: string, conversationId: string | null = null) {
  return { businessId, conversationId, channel: "web" as const };
}

function at(date: string, time: string): string {
  const instant = zonedToUtc(date, time, TZ);
  if (!instant) throw new Error(`${date} ${time} does not exist in ${TZ}`);
  return instant.toISOString();
}

async function bookingInput(date: string, time: string, key: string, address = "12 Smith St, Norwood SA 5067") {
  return {
    serviceId,
    startIso: at(date, time),
    customerName: "Alex Taylor",
    customerPhone: "0412 345 678",
    address,
    idempotencyKey: key,
  };
}

beforeEach(async () => {
  tenant = await makeTenant("Race Test Co");
  await setPlan(tenant.businessId, "front_desk");
  const service = await addService(tenant.businessId, {
    name: "Standard clean",
    pricingType: "fixed",
    priceCents: 9_000,
    durationMinutes: 60,
  });
  serviceId = service.id;
  await addArea(tenant.businessId, { type: "suburb_list", values: ["Norwood", "Kent Town"] });
  await addRules(tenant.businessId, [
    { weekday: MONDAY, startTime: "09:00", endTime: "17:00", slotMinutes: 60, capacity: 1 },
  ]);
});

describe("create_booking", () => {
  it("books an open slot, snapshots the price and tells the owner once", async () => {
    const date = futureDate(MONDAY);
    const result = await runTool(
      "create_booking",
      await bookingInput(date, "10:00", "book-once-0001"),
      ctxFor(tenant.businessId),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { bookingId: string; priceCents: number; summary: string };
    expect(data.priceCents).toBe(9_000);
    expect(data.summary).toContain("Standard clean");

    const rows = await listBookings(tenant.businessId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.priceCentsSnapshot).toBe(9_000);
    expect(rows[0]?.source).toBe("ai_assistant");
    expect(rows[0]?.customerPhone).toBe("+61412345678");

    const queued = await withTenant(tenant.businessId, async (tx) =>
      tx.select({ kind: notifications.kind }).from(notifications),
    );
    expect(queued.map((row) => row.kind)).toEqual(["booking_created"]);
  });

  it("lets exactly one of two simultaneous bookings win the last slot", async () => {
    const date = futureDate(MONDAY);
    const [first, second] = await Promise.all([
      runTool("create_booking", await bookingInput(date, "11:00", "race-aaa-0001"), ctxFor(tenant.businessId)),
      runTool("create_booking", await bookingInput(date, "11:00", "race-bbb-0001"), ctxFor(tenant.businessId)),
    ]);

    const winners = [first, second].filter((result) => result.ok);
    const losers = [first, second].filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    expect(loser && !loser.ok ? loser.error : null).toBe("slot_taken");
    if (loser && !loser.ok) {
      expect(loser.details?.alternatives).toBeInstanceOf(Array);
    }

    const rows = await listBookings(tenant.businessId);
    expect(rows).toHaveLength(1);
  });

  it("returns the same booking for a repeated idempotency key, not a second one", async () => {
    const date = futureDate(MONDAY);
    const input = await bookingInput(date, "12:00", "retry-same-key-01");

    const first = await runTool("create_booking", input, ctxFor(tenant.businessId));
    const second = await runTool("create_booking", input, ctxFor(tenant.businessId));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const a = first.data as { bookingId: string; replayed: boolean };
    const b = second.data as { bookingId: string; replayed: boolean };
    expect(b.bookingId).toBe(a.bookingId);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(await listBookings(tenant.businessId)).toHaveLength(1);
  });

  it("survives two simultaneous retries of the same key", async () => {
    const date = futureDate(MONDAY);
    const input = await bookingInput(date, "13:00", "retry-parallel-01");
    const results = await Promise.all([
      runTool("create_booking", input, ctxFor(tenant.businessId)),
      runTool("create_booking", input, ctxFor(tenant.businessId)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await listBookings(tenant.businessId)).toHaveLength(1);
  });

  it("takes two bookings for the same time when the slot has capacity for two", async () => {
    await addRules(tenant.businessId, [
      { weekday: MONDAY, startTime: "09:00", endTime: "17:00", slotMinutes: 60, capacity: 2 },
    ]);
    const date = futureDate(MONDAY);
    const results = await Promise.all([
      runTool("create_booking", await bookingInput(date, "14:00", "cap-two-aaa-1"), ctxFor(tenant.businessId)),
      runTool("create_booking", await bookingInput(date, "14:00", "cap-two-bbb-1"), ctxFor(tenant.businessId)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await listBookings(tenant.businessId)).toHaveLength(2);
  });

  it("refuses a service id belonging to another business", async () => {
    const other = await makeTenant("Other Business Ltd");
    const otherService = await addService(other.businessId, { name: "Their service", priceCents: 5_000 });
    await setPlan(other.businessId, "front_desk");

    const date = futureDate(MONDAY);
    const input = await bookingInput(date, "10:00", "cross-tenant-001");
    const result = await runTool(
      "create_booking",
      { ...input, serviceId: otherService.id },
      ctxFor(tenant.businessId),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
    expect(await listBookings(tenant.businessId)).toHaveLength(0);
    expect(await listBookings(other.businessId)).toHaveLength(0);
  });

  it("refuses an address outside the service area", async () => {
    const date = futureDate(MONDAY);
    const result = await runTool(
      "create_booking",
      await bookingInput(date, "10:00", "outside-area-01", "1 Jetty Rd, Glenelg SA 5045"),
      ctxFor(tenant.businessId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("out_of_area");
  });

  it("refuses a time in the past and a time past the booking horizon", async () => {
    const past = await runTool(
      "create_booking",
      await bookingInput("2020-01-06", "10:00", "past-booking-01"),
      ctxFor(tenant.businessId),
    );
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error).toBe("invalid_input");

    const far = await runTool(
      "create_booking",
      await bookingInput(futureDate(MONDAY, 12), "10:00", "far-booking-001"),
      ctxFor(tenant.businessId),
    );
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.error).toBe("invalid_input");
  });

  it("refuses a time that is not on the slot grid", async () => {
    const date = futureDate(MONDAY);
    const result = await runTool(
      "create_booking",
      await bookingInput(date, "10:37", "off-grid-00001"),
      ctxFor(tenant.businessId),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("slot_unavailable");
  });

  it("rejects a malformed phone number instead of inventing one", async () => {
    const date = futureDate(MONDAY);
    const input = await bookingInput(date, "10:00", "bad-phone-0001");
    const result = await runTool(
      "create_booking",
      { ...input, customerPhone: "call me" },
      ctxFor(tenant.businessId),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });

  it("is not available on the Answer plan", async () => {
    await setPlan(tenant.businessId, "answer");
    const date = futureDate(MONDAY);
    const result = await runTool(
      "create_booking",
      await bookingInput(date, "10:00", "answer-plan-001"),
      ctxFor(tenant.businessId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");
    expect(result.message).toMatch(/does not include create_booking/);
    expect(await listBookings(tenant.businessId)).toHaveLength(0);
  });
});
