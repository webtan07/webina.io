import { z } from "zod";

import { findBookingByIdempotencyKey, getServiceArea, insertBookingAtomic, queueOwnerNotification } from "@webina/db";
import { BOOKING_HORIZON_DAYS, formatAud, normaliseAuPhone } from "@webina/shared";

import { checkArea } from "../area";
import { planDay, validateSlot } from "../availability";
import { quoteService } from "../pricing";
import { dateLabel, localDateOf, timeLabel } from "../time";
import { loadBusiness, loadDay, loadService, localDayOf, zodIssues } from "./shared";
import { toolError, toolOk, type ToolSpec } from "./types";

const input = z.object({
  serviceId: z.string().uuid("serviceId must be a uuid"),
  /** ISO 8601 with an offset, e.g. 2026-10-06T09:00:00+10:30. */
  startIso: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "startIso must be an ISO timestamp"),
  customerName: z.string().trim().min(2, "I need the customer's name").max(80),
  customerPhone: z.string().trim().min(6, "I need a contact number").max(32),
  customerEmail: z.string().trim().email().max(160).optional(),
  address: z.string().trim().min(3, "I need the address for the job").max(300),
  notes: z.string().trim().max(1000).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  /** Repeats of the same attempt must return the same booking, not a second one. */
  idempotencyKey: z.string().trim().min(8).max(128),
});

/** The next few open times, so a refused slot can be answered usefully. */
async function alternatives(
  businessId: string,
  timezone: string,
  date: string,
  service: { schedulingType: string; durationMinutes: number | null },
  skipIso: string,
): Promise<{ startIso: string; endIso: string; label: string }[]> {
  const day = await loadDay(businessId, timezone, date);
  const plan = planDay({
    date,
    timezone,
    schedulingType: service.schedulingType,
    durationMinutes: service.durationMinutes,
    rules: day.rules,
    exception: day.exception,
    busy: day.busy,
    now: new Date(),
    limit: 5,
  });
  return plan.slots.filter((slot) => slot.startIso !== skipIso).slice(0, 3);
}

/** The reply the model reads back to the customer, for a new or replayed booking. */
function confirmation(
  business: { timezone: string },
  service: { id: string; name: string },
  booking: {
    id: string;
    status: string;
    startAt: Date;
    endAt: Date;
  },
  priceCents: number | null,
  replayed: boolean,
) {
  const when = `${dateLabel(booking.startAt, business.timezone)} at ${timeLabel(booking.startAt, business.timezone)}`;
  const priceText = priceCents == null ? "the owner will confirm the price" : formatAud(priceCents);
  return {
    bookingId: booking.id,
    replayed,
    status: booking.status,
    serviceId: service.id,
    serviceName: service.name,
    startIso: booking.startAt.toISOString(),
    endIso: booking.endAt.toISOString(),
    date: localDateOf(booking.startAt, business.timezone),
    timezone: business.timezone,
    priceCents,
    priceLabel: priceCents == null ? null : formatAud(priceCents),
    summary: `Booked: ${service.name}, ${when} (${business.timezone}), ${priceText}.`,
  };
}

/**
 * Create a confirmed booking.
 *
 * Everything is re-checked here — the area, the time, the price — because the
 * model's proposal is not evidence. The insert itself is one transaction that
 * takes a per-slot lock, so two customers racing for the last place produce
 * exactly one booking and one honest "that time has just gone".
 */
export const createBookingTool: ToolSpec = {
  name: "create_booking",
  description:
    "Confirm a booking at a time check_availability returned. Repeat the details back and get the customer's explicit yes before calling this. Pass the same idempotencyKey if you retry.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "I need a few more details before I can book that", {
        issues: zodIssues(parsed.error),
      });
    }
    const input_ = parsed.data;

    const business = await loadBusiness(ctx.businessId);
    const loaded = await loadService(ctx.businessId, input_.serviceId);
    if (!loaded.ok) return loaded.result;
    const service = loaded.service;

    if (service.schedulingType !== "time_slot") {
      return toolError(
        "invalid_input",
        "this service is not booked at an exact time — take a job request instead",
      );
    }

    const phone = normaliseAuPhone(input_.customerPhone);
    if (!phone) {
      return toolError("invalid_input", "I need an Australian phone number for the customer");
    }

    // A retry is answered from the booking it already made, before any of the
    // re-validation below: by then the slot may well be full of that very
    // booking, and "that time has gone" would be a lie.
    const existing = await findBookingByIdempotencyKey(ctx.businessId, input_.idempotencyKey);
    if (existing) {
      return toolOk(confirmation(business, service, existing, existing.priceCentsSnapshot, true));
    }

    const startAt = new Date(input_.startIso);
    if (Number.isNaN(startAt.getTime())) {
      return toolError("invalid_input", "I could not read that time");
    }
    const date = localDayOf(startAt, business.timezone);

    const area = await getServiceArea(ctx.businessId);
    const verdict = checkArea(area, { address: input_.address });
    if (!verdict.determined) {
      return toolError("invalid_input", verdict.reason);
    }
    if (!verdict.inArea) {
      return toolError("out_of_area", verdict.reason, { matched: verdict.matched });
    }

    const day = await loadDay(ctx.businessId, business.timezone, date);
    const slot = validateSlot({
      date,
      timezone: business.timezone,
      schedulingType: service.schedulingType,
      durationMinutes: service.durationMinutes,
      rules: day.rules,
      exception: day.exception,
      busy: day.busy,
      startAt,
      now: new Date(),
      horizonDays: BOOKING_HORIZON_DAYS,
    });
    if (!slot.ok) {
      // A parallel retry of the same attempt may have won the lock between the
      // check above and here: answer it with its own booking, not a refusal.
      const raced = await findBookingByIdempotencyKey(ctx.businessId, input_.idempotencyKey);
      if (raced) {
        return toolOk(confirmation(business, service, raced, raced.priceCentsSnapshot, true));
      }
      const offered =
        slot.code === "slot_taken"
          ? await alternatives(ctx.businessId, business.timezone, date, service, startAt.toISOString())
          : [];
      return toolError(slot.code, slot.message, offered.length > 0 ? { alternatives: offered } : {});
    }

    const priced = quoteService(service, { answers: input_.answers });
    if (!priced.ok) {
      return toolError("invalid_input", priced.message, priced.details);
    }
    const priceCents = priced.quote.ownerWillQuote ? null : priced.quote.totalCents;

    const inserted = await insertBookingAtomic(ctx.businessId, {
      serviceId: service.id,
      startAt,
      endAt: slot.endAt,
      customerName: input_.customerName,
      customerPhone: phone,
      customerEmail: input_.customerEmail ?? null,
      address: input_.address,
      notes: input_.notes ?? null,
      intakeAnswers: input_.answers ?? {},
      priceCentsSnapshot: priceCents,
      conversationId: ctx.conversationId,
      idempotencyKey: input_.idempotencyKey,
      capacity: slot.capacity,
    });

    if (!inserted.ok) {
      const offered = await alternatives(
        ctx.businessId,
        business.timezone,
        date,
        service,
        startAt.toISOString(),
      );
      return toolError("slot_taken", "that time has just been taken", { alternatives: offered });
    }

    const booking = inserted.booking;
    if (!inserted.replayed) {
      await queueOwnerNotification(ctx.businessId, {
        kind: "booking_created",
        dedupeKey: `booking:${booking.id}`,
        payload: {
          bookingId: booking.id,
          serviceId: service.id,
          startIso: booking.startAt.toISOString(),
          channel: ctx.channel,
        },
      });
    }

    return toolOk(confirmation(business, service, booking, priceCents, inserted.replayed));
  },
};
