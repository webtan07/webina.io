/**
 * The seven tools, from the model's side: what it may call, what comes back,
 * and what is refused.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { listJobRequests, withTenant, handoffs } from "@webina/db";

import { runTool, toolsForPlan, TOOLS } from "../src/tools";
import { zonedToUtc } from "../src/time";
import {
  addArea,
  addConversation,
  addException,
  addRules,
  addService,
  futureDate,
  makeTenant,
  setPlan,
  type FixtureTenant,
} from "./fixtures";

const TZ = "Australia/Adelaide";
const TUESDAY = 2;

let tenant: FixtureTenant;
let lawnServiceId: string;
let customServiceId: string;

function ctx(conversationId: string | null = null) {
  return { businessId: tenant.businessId, conversationId, channel: "web" as const };
}

beforeEach(async () => {
  tenant = await makeTenant("Tools Test Co");
  await setPlan(tenant.businessId, "front_desk");
  await addArea(tenant.businessId, { type: "postcode_list", values: ["5067", "5068"] });
  await addRules(tenant.businessId, [
    { weekday: TUESDAY, startTime: "09:00", endTime: "12:00", slotMinutes: 60, capacity: 1 },
  ]);

  const lawn = await addService(tenant.businessId, {
    name: "Lawn mow",
    pricingType: "tiered",
    priceCents: null,
    durationMinutes: 60,
    pricingConfig: {
      tierLabel: "Lawn size",
      tiers: [
        { key: "small", label: "Small", priceCents: 4_500 },
        { key: "large", label: "Large", priceCents: 9_000 },
      ],
      extras: [{ key: "green_waste", label: "Green waste", priceCents: 1_500 }],
    },
    intakeFields: [
      { key: "lawn_size", question: "How big is the lawn?", type: "select", required: true, options: ["Small", "Large"] },
    ],
  });
  lawnServiceId = lawn.id;

  const custom = await addService(tenant.businessId, {
    name: "Gift wrapping",
    pricingType: "quote_only",
    priceCents: null,
    durationMinutes: null,
    schedulingType: "day_window",
  });
  customServiceId = custom.id;
});

describe("plan gating", () => {
  it("offers Answer five tools and Front Desk all seven", () => {
    const answer = toolsForPlan("answer").map((tool) => tool.name);
    const frontDesk = toolsForPlan("front_desk").map((tool) => tool.name);
    expect(answer).toEqual([
      "list_services",
      "get_quote",
      "check_service_area",
      "create_job_request",
      "handoff_to_owner",
    ]);
    expect(frontDesk).toHaveLength(7);
    expect(frontDesk).toContain("create_booking");
    expect(Object.keys(TOOLS)).toHaveLength(7);
  });

  it("refuses a booking tool the plan does not include, even when called by name", async () => {
    await setPlan(tenant.businessId, "answer");
    const result = await runTool("check_availability", { serviceId: lawnServiceId, date: futureDate(TUESDAY) }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/does not include check_availability/);
  });
});

describe("list_services", () => {
  it("lists active services with prices and intake questions", async () => {
    const result = await runTool("list_services", {}, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { count: number; services: { name: string; tiers: unknown[]; intakeQuestions: unknown[] }[] };
    expect(data.count).toBe(2);
    const lawn = data.services.find((service) => service.name === "Lawn mow");
    expect(lawn?.tiers).toHaveLength(2);
    expect(lawn?.intakeQuestions).toHaveLength(1);
  });

  it("does not list another business's services", async () => {
    const other = await makeTenant("Someone Else Pty");
    await addService(other.businessId, { name: "Their service" });
    const result = await runTool("list_services", {}, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = (result.data as { services: { name: string }[] }).services.map((s) => s.name);
    expect(names).not.toContain("Their service");
  });
});

describe("get_quote", () => {
  it("prices a tier and an add-on from the configuration", async () => {
    const result = await runTool(
      "get_quote",
      { serviceId: lawnServiceId, options: { lawnSize: "large", green_waste: true } },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { totalCents: number; priceLabel: string; summary: string };
    expect(data.totalCents).toBe(10_500);
    expect(data.priceLabel).toBe("$105");
    expect(data.summary).toContain("$105");
  });

  it("asks for the size rather than guessing a price", async () => {
    const result = await runTool("get_quote", { serviceId: lawnServiceId }, ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_input");
    expect(result.details?.choices).toHaveLength(2);
  });

  it("says the owner will quote for a quote-only service", async () => {
    const result = await runTool("get_quote", { serviceId: customServiceId }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { totalCents: number | null; ownerWillQuote: boolean };
    expect(data.totalCents).toBeNull();
    expect(data.ownerWillQuote).toBe(true);
  });

  it("refuses another business's service id", async () => {
    const other = await makeTenant("Other Quote Co");
    const theirs = await addService(other.businessId, { name: "Theirs", priceCents: 1_000 });
    const result = await runTool("get_quote", { serviceId: theirs.id }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("rejects a serviceId that is not a uuid", async () => {
    const result = await runTool("get_quote", { serviceId: "lawn" }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });
});

describe("check_service_area", () => {
  it("matches a postcode inside the area", async () => {
    const result = await runTool("check_service_area", { address: "12 Smith St, Norwood SA 5067" }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { inArea: boolean }).inArea).toBe(true);
  });

  it("refuses an address outside the area", async () => {
    const result = await runTool("check_service_area", { address: "1 Jetty Rd, Glenelg SA 5045" }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("out_of_area");
  });

  it("asks for a suburb instead of guessing", async () => {
    const result = await runTool("check_service_area", { address: "the corner shop" }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });
});

describe("check_availability", () => {
  it("returns real open times for an open day", async () => {
    const date = futureDate(TUESDAY);
    const result = await runTool("check_availability", { serviceId: lawnServiceId, date }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { slots: { startIso: string }[]; openCount: number };
    expect(data.slots).toHaveLength(3);
    expect(data.slots[0]?.startIso).toBe(zonedToUtc(date, "09:00", TZ)?.toISOString());
  });

  it("does not offer a time that is already booked", async () => {
    const date = futureDate(TUESDAY);
    await runTool(
      "create_booking",
      {
        serviceId: lawnServiceId,
        startIso: zonedToUtc(date, "09:00", TZ)?.toISOString(),
        customerName: "Sam Lee",
        customerPhone: "0400 111 222",
        address: "8 The Parade, Norwood SA 5067",
        answers: { lawnSize: "small" },
        idempotencyKey: "availability-001",
      },
      ctx(),
    );
    const result = await runTool("check_availability", { serviceId: lawnServiceId, date }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { slots: { startIso: string }[] };
    expect(data.slots).toHaveLength(2);
    expect(data.slots.map((slot) => slot.startIso)).not.toContain(
      zonedToUtc(date, "09:00", TZ)?.toISOString(),
    );
  });

  it("reports a closed day as closed, with a reason", async () => {
    const date = futureDate(TUESDAY, 4);
    await addException(tenant.businessId, { date, closed: true, reason: "public holiday" });
    const result = await runTool("check_availability", { serviceId: lawnServiceId, date }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { closed: boolean; closedReason: string; slots: unknown[] };
    expect(data.closed).toBe(true);
    expect(data.closedReason).toBe("public holiday");
    expect(data.slots).toEqual([]);
  });

  it("honours custom hours on an exception day", async () => {
    const date = futureDate(TUESDAY, 5);
    await addException(tenant.businessId, {
      date,
      closed: false,
      startTime: "13:00",
      endTime: "15:00",
    });
    const result = await runTool("check_availability", { serviceId: lawnServiceId, date }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { slots: { startIso: string }[] };
    expect(data.slots).toHaveLength(2);
    expect(data.slots[0]?.startIso).toBe(zonedToUtc(date, "13:00", TZ)?.toISOString());
  });

  it("offers day windows for a day-window service", async () => {
    const date = futureDate(TUESDAY, 6);
    const result = await runTool("check_availability", { serviceId: customServiceId, date }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { schedulingType: string; windows: unknown[]; slots: unknown[] };
    expect(data.schedulingType).toBe("day_window");
    expect(data.slots).toEqual([]);
    expect(data.windows).toHaveLength(1);
  });

  it("refuses a date in the past and a date beyond the horizon", async () => {
    const past = await runTool("check_availability", { serviceId: lawnServiceId, date: "2020-03-03" }, ctx());
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error).toBe("invalid_input");

    const far = await runTool(
      "check_availability",
      { serviceId: lawnServiceId, date: futureDate(TUESDAY, 20) },
      ctx(),
    );
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.message).toMatch(/60 days/);
  });
});

describe("create_job_request", () => {
  it("takes a job request for quote-only work and tells the owner", async () => {
    const result = await runTool(
      "create_job_request",
      {
        serviceId: customServiceId,
        customerName: "Priya Nair",
        customerPhone: "0411 222 333",
        address: "5 Edward St, Norwood SA 5067",
        preferredWindow: "Saturday morning",
        idempotencyKey: "job-request-0001",
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { status: string; summary: string };
    expect(data.status).toBe("new");
    expect(data.summary).toContain("owner");
    expect(await listJobRequests(tenant.businessId)).toHaveLength(1);
  });

  it("returns the same request for a repeated key", async () => {
    const input = {
      customerName: "Priya Nair",
      customerPhone: "0411 222 333",
      address: "5 Edward St, Norwood SA 5067",
      idempotencyKey: "job-request-0002",
    };
    const first = await runTool("create_job_request", input, ctx());
    const second = await runTool("create_job_request", input, ctx());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect((second.data as { replayed: boolean }).replayed).toBe(true);
    expect((first.data as { jobRequestId: string }).jobRequestId).toBe(
      (second.data as { jobRequestId: string }).jobRequestId,
    );
    expect(await listJobRequests(tenant.businessId)).toHaveLength(1);
  });

  it("refuses an out-of-area address", async () => {
    const result = await runTool(
      "create_job_request",
      {
        customerName: "Priya Nair",
        customerPhone: "0411 222 333",
        address: "1 Jetty Rd, Glenelg SA 5045",
        idempotencyKey: "job-request-0003",
      },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("out_of_area");
  });
});

describe("handoff_to_owner", () => {
  it("hands the conversation over once and notifies the owner once", async () => {
    const conversationId = await addConversation(tenant.businessId);
    const first = await runTool(
      "handoff_to_owner",
      { reason: "asks for a person", summary: "Customer wants to speak to the owner about a custom job." },
      ctx(conversationId),
    );
    const second = await runTool(
      "handoff_to_owner",
      { reason: "asks for a person", summary: "Customer wants to speak to the owner about a custom job." },
      ctx(conversationId),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect((second.data as { alreadyHandedOff: boolean }).alreadyHandedOff).toBe(true);

    const rows = await withTenant(tenant.businessId, (tx) => tx.select().from(handoffs));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("asks for a person");
  });

  it("refuses to hand over a conversation that does not exist", async () => {
    const result = await runTool(
      "handoff_to_owner",
      { reason: "upset", summary: "Customer is upset about a no-show." },
      ctx(crypto.randomUUID()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });
});

describe("runTool", () => {
  it("reports an unknown tool instead of throwing", async () => {
    const result = await runTool("delete_everything", {}, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });

  it("never throws when a tool is given nonsense", async () => {
    const result = await runTool("create_booking", { serviceId: 42 }, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });
});
