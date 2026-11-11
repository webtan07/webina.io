import { z } from "zod";

import { BOOKING_HORIZON_DAYS, isoDateSchema } from "@webina/shared";

import { checkBookableDate, planDay } from "../availability";
import { loadBusiness, loadDay, loadService, zodIssues } from "./shared";
import { toolError, toolOk, type ToolSpec } from "./types";

const input = z.object({
  serviceId: z.string().uuid("serviceId must be a uuid"),
  /** `YYYY-MM-DD`, read in the business's timezone. */
  date: isoDateSchema,
});

/**
 * Real open times for one day, in the business's timezone. Never says who
 * holds the other slots — only which ones are free.
 */
export const checkAvailabilityTool: ToolSpec = {
  name: "check_availability",
  description:
    "List the open times for one service on one date (YYYY-MM-DD). Only offer times this returns. If it returns none, offer another day.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "I could not read that date", {
        issues: zodIssues(parsed.error),
      });
    }

    const business = await loadBusiness(ctx.businessId);
    const loaded = await loadService(ctx.businessId, parsed.data.serviceId);
    if (!loaded.ok) return loaded.result;
    const service = loaded.service;

    const now = new Date();
    const dateCheck = checkBookableDate({
      date: parsed.data.date,
      timezone: business.timezone,
      now,
      horizonDays: BOOKING_HORIZON_DAYS,
    });
    if (!dateCheck.ok) {
      return toolError("invalid_input", dateCheck.message);
    }

    if (service.schedulingType === "owner_confirms") {
      return toolOk({
        date: parsed.data.date,
        timezone: business.timezone,
        schedulingType: service.schedulingType,
        closed: false,
        closedReason: null,
        slots: [],
        windows: [],
        openCount: 0,
        message:
          "The owner confirms the time for this service — take a job request with the customer's preferred window instead of booking a slot.",
      });
    }

    const day = await loadDay(ctx.businessId, business.timezone, parsed.data.date);
    const plan = planDay({
      date: parsed.data.date,
      timezone: business.timezone,
      schedulingType: service.schedulingType,
      durationMinutes: service.durationMinutes,
      rules: day.rules,
      exception: day.exception,
      busy: day.busy,
      now,
    });

    const message = plan.closed
      ? `Closed on ${parsed.data.date}: ${plan.closedReason ?? "not open"}.`
      : plan.schedulingType === "day_window"
        ? plan.windows.length === 0
          ? "No windows left that day — offer another day."
          : "Ask the customer which window suits, then take a job request."
        : plan.slots.length === 0
          ? "No open times left that day — offer another day."
          : `${plan.slots.length} open time${plan.slots.length === 1 ? "" : "s"} on ${parsed.data.date}.`;

    return toolOk({
      date: parsed.data.date,
      timezone: business.timezone,
      schedulingType: plan.schedulingType,
      closed: plan.closed,
      closedReason: plan.closedReason,
      slots: plan.slots,
      windows: plan.windows,
      openCount: plan.openCount,
      message,
    });
  },
};
