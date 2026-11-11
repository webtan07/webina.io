/**
 * Fixtures for the tool tests.
 *
 * Every tenant is real: created through the same path a sign-up uses, in the
 * throwaway test database, behind the same RLS-subject role.
 */

import {
  createBusiness,
  createService,
  getDb,
  replaceAvailabilityRules,
  setAvailabilityException,
  setPlanKey,
  setServiceArea,
  user,
  withTenant,
} from "@webina/db";
import { conversations } from "@webina/db/schema";
import type {
  AvailabilityExceptionInput,
  AvailabilityRuleInput,
  ServiceAreaInput,
  ServiceInput,
} from "@webina/shared";

import { addDays, localDateOf, weekdayOf } from "../src/time";

export interface FixtureTenant {
  businessId: string;
  userId: string;
  siteKey: string;
}

export async function makeTenant(name: string): Promise<FixtureTenant> {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const userId = crypto.randomUUID();
  await getDb().insert(user).values({ id: userId, name, email, emailVerified: true });

  const created = await createBusiness(
    {
      name,
      timezone: "Australia/Adelaide",
      tradeTemplate: "generic",
      ownerNotifyEmail: email,
      assistantName: "Webina",
    },
    { userId, environment: "test" },
  );
  return { businessId: created.businessId, userId, siteKey: created.siteKey };
}

export async function addService(
  businessId: string,
  input: Partial<ServiceInput> & { name: string },
) {
  return createService(businessId, {
    pricingType: "fixed",
    priceCents: 9_000,
    durationMinutes: 60,
    schedulingType: "time_slot",
    ...input,
  });
}

export async function addArea(businessId: string, input: ServiceAreaInput) {
  return setServiceArea(businessId, input);
}

export async function addRules(businessId: string, rules: AvailabilityRuleInput[]) {
  return replaceAvailabilityRules(businessId, rules);
}

export async function addException(businessId: string, input: AvailabilityExceptionInput) {
  return setAvailabilityException(businessId, input);
}

export async function setPlan(businessId: string, planKey: "answer" | "front_desk") {
  await setPlanKey(businessId, planKey);
}

export async function addConversation(businessId: string): Promise<string> {
  const id = crypto.randomUUID();
  await withTenant(businessId, async (tx) => {
    await tx.insert(conversations).values({
      id,
      businessId,
      channel: "web",
      customerRef: `ref-${id.slice(0, 8)}`,
      status: "active",
    });
  });
  return id;
}

/** A date at least `weeksAhead` weeks out that falls on `weekday` (0 = Sunday). */
export function futureDate(weekday: number, weeksAhead = 3): string {
  const today = localDateOf(new Date(), "Australia/Adelaide");
  let date = addDays(today, 1);
  while (weekdayOf(date) !== weekday) date = addDays(date, 1);
  return addDays(date, 7 * (weeksAhead - 1));
}
