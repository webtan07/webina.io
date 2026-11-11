/**
 * Shared plumbing for the tool handlers: one place where a domain error turns
 * into a `ToolResult`, so no handler ever throws at the model.
 */

import {
  NotFoundError,
  getBusinessProfile,
  getService,
  listAvailabilityExceptions,
  listAvailabilityRules,
  listBusyTimes,
  type AvailabilityExceptionRecord,
  type AvailabilityRuleRecord,
  type BusinessProfile,
  type ServiceRecord,
} from "@webina/db";
import { formatAud } from "@webina/shared";

import { addDays, localDateOf, zonedToUtc } from "../time";
import { toolError, type ToolResult } from "./types";

export async function loadBusiness(businessId: string): Promise<BusinessProfile> {
  return getBusinessProfile(businessId);
}

/** A service id that is not this tenant's is "not found", never "forbidden". */
export async function loadService(
  businessId: string,
  serviceId: string,
): Promise<{ ok: true; service: ServiceRecord } | { ok: false; result: ToolResult<never> }> {
  try {
    const service = await getService(businessId, serviceId);
    if (!service.active) {
      return {
        ok: false,
        result: toolError("not_found", "that service is not available at the moment"),
      };
    }
    return { ok: true, service };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, result: toolError("not_found", "I could not find that service") };
    }
    throw error;
  }
}

export interface DayContext {
  rules: AvailabilityRuleRecord[];
  exception: AvailabilityExceptionRecord | null;
  busy: { startAt: Date; endAt: Date }[];
}

/** Everything needed to answer "is this day open?" for one date. */
export async function loadDay(
  businessId: string,
  timezone: string,
  date: string,
): Promise<DayContext> {
  const next = addDays(date, 1);
  const dayStart = zonedToUtc(date, "00:00", timezone);
  const dayEnd = zonedToUtc(next, "00:00", timezone);
  const [rules, exceptions, busy] = await Promise.all([
    listAvailabilityRules(businessId),
    listAvailabilityExceptions(businessId, date, date),
    dayStart && dayEnd ? listBusyTimes(businessId, dayStart, dayEnd) : Promise.resolve([]),
  ]);
  return { rules, exception: exceptions[0] ?? null, busy };
}

export function audLabel(cents: number | null): string | null {
  return cents == null ? null : formatAud(cents);
}

/** Zod's complaints, in a shape the model can act on. */
export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(input)",
    problem: issue.message,
  }));
}

/** Where the customer's start time sits on the business's calendar. */
export function localDayOf(startAt: Date, timezone: string): string {
  return localDateOf(startAt, timezone);
}

export { toolError };
export type { ToolResult };
