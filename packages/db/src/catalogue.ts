/**
 * Catalogue and work: services, service area, availability, bookings, job
 * requests, handoffs.
 *
 * Everything here runs inside `withTenant`, so a query cannot see or touch
 * another business's rows even if a caller passes an id from somewhere else.
 * Ids that arrive from outside (the model, a widget) are therefore never
 * trusted: they are looked up *within* the tenant and a miss is a `not_found`,
 * which is exactly what a cross-tenant id must produce.
 *
 * Money is integer AUD cents everywhere. There is no tax column and no tax
 * calculation anywhere in this file.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  availabilityExceptionInput,
  availabilityRuleInput,
  serviceAreaInput,
  serviceInput,
  type AvailabilityExceptionInput,
  type AvailabilityRuleInput,
  type ServiceAreaInput,
  type ServiceInput,
} from "@webina/shared";

import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  businesses,
  conversations,
  handoffs,
  jobRequests,
  notifications,
  serviceAreas,
  services,
} from "./schema";
import { withTenant, type Tx } from "./tenant";

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** A row this tenant owns was not found — including another tenant's id. */
export class NotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

/** The slot is fully taken. Carries the times we could offer instead. */
export class SlotTakenError extends Error {
  constructor(readonly alternatives: { startIso: string; endIso: string }[] = []) {
    super("slot taken");
    this.name = "SlotTakenError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code === PG_UNIQUE_VIOLATION || err?.cause?.code === PG_UNIQUE_VIOLATION;
}

function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  if (!isUniqueViolation(error)) return false;
  const err = error as { constraint?: string; cause?: { constraint?: string } };
  const name = err.constraint ?? err.cause?.constraint ?? "";
  return name === constraint;
}

/** Drizzle's `execute` hands back the driver result; read rows through this. */
function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

export interface ServiceRecord {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  active: boolean;
  pricingType: string;
  priceCents: number | null;
  pricingConfig: Record<string, unknown>;
  durationMinutes: number | null;
  schedulingType: string;
  recurringOptions: unknown[];
  intakeFields: unknown[];
  sortOrder: number;
}

export async function createService(businessId: string, input: ServiceInput): Promise<ServiceRecord> {
  const parsed = serviceInput.parse(input);
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(services)
      .values({
        businessId,
        name: parsed.name,
        description: parsed.description ?? null,
        active: parsed.active,
        pricingType: parsed.pricingType,
        priceCents: parsed.priceCents ?? null,
        pricingConfig: parsed.pricingConfig,
        durationMinutes: parsed.durationMinutes ?? null,
        schedulingType: parsed.schedulingType,
        recurringOptions: parsed.recurringOptions,
        intakeFields: parsed.intakeFields,
        sortOrder: parsed.sortOrder,
      })
      .returning();
    if (!row) throw new Error("service row was not created");
    return row as ServiceRecord;
  });
}

export async function updateService(
  businessId: string,
  serviceId: string,
  input: ServiceInput,
): Promise<ServiceRecord> {
  const parsed = serviceInput.parse(input);
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .update(services)
      .set({
        name: parsed.name,
        description: parsed.description ?? null,
        active: parsed.active,
        pricingType: parsed.pricingType,
        priceCents: parsed.priceCents ?? null,
        pricingConfig: parsed.pricingConfig,
        durationMinutes: parsed.durationMinutes ?? null,
        schedulingType: parsed.schedulingType,
        recurringOptions: parsed.recurringOptions,
        intakeFields: parsed.intakeFields,
        sortOrder: parsed.sortOrder,
        updatedAt: new Date(),
      })
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
      .returning();
    if (!row) throw new NotFoundError("service");
    return row as ServiceRecord;
  });
}

export async function getService(businessId: string, serviceId: string): Promise<ServiceRecord> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId))),
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("service");
  return row as ServiceRecord;
}

export async function listServices(
  businessId: string,
  options: { activeOnly?: boolean } = {},
): Promise<ServiceRecord[]> {
  const activeOnly = options.activeOnly ?? true;
  const rows = await withTenant(businessId, async (tx) => {
    const base = tx.select().from(services);
    const filtered = activeOnly
      ? base.where(and(eq(services.businessId, businessId), eq(services.active, true)))
      : base.where(eq(services.businessId, businessId));
    return filtered.orderBy(asc(services.sortOrder), asc(services.name));
  });
  return rows as ServiceRecord[];
}

/* ------------------------------------------------------------------ *
 * Service area
 * ------------------------------------------------------------------ */

export interface ServiceAreaRecord {
  type: string;
  values: string[];
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}

export async function setServiceArea(
  businessId: string,
  input: ServiceAreaInput,
): Promise<ServiceAreaRecord> {
  const parsed = serviceAreaInput.parse(input);
  const values = {
    type: parsed.type,
    values: parsed.values,
    centerLat: parsed.centerLat == null ? null : String(parsed.centerLat),
    centerLng: parsed.centerLng == null ? null : String(parsed.centerLng),
    radiusKm: parsed.radiusKm ?? null,
  };
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(serviceAreas)
      .values({ businessId, ...values })
      .onConflictDoUpdate({ target: serviceAreas.businessId, set: { ...values, updatedAt: new Date() } })
      .returning();
    if (!row) throw new Error("service area was not saved");
    return {
      type: row.type,
      values: row.values,
      centerLat: row.centerLat == null ? null : Number(row.centerLat),
      centerLng: row.centerLng == null ? null : Number(row.centerLng),
      radiusKm: row.radiusKm,
    };
  });
}

/** No area configured means "everywhere" — the honest default for a new tenant. */
export async function getServiceArea(businessId: string): Promise<ServiceAreaRecord> {
  const rows = await withTenant(businessId, async (tx) =>
    tx.select().from(serviceAreas).where(eq(serviceAreas.businessId, businessId)),
  );
  const row = rows[0];
  if (!row) {
    return { type: "none", values: [], centerLat: null, centerLng: null, radiusKm: null };
  }
  return {
    type: row.type,
    values: row.values,
    centerLat: row.centerLat == null ? null : Number(row.centerLat),
    centerLng: row.centerLng == null ? null : Number(row.centerLng),
    radiusKm: row.radiusKm,
  };
}

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

export interface AvailabilityRuleRecord {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacity: number;
}

export interface AvailabilityExceptionRecord {
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

/** Replaces the whole weekly pattern — the dashboard edits it as one grid. */
export async function replaceAvailabilityRules(
  businessId: string,
  input: AvailabilityRuleInput[],
): Promise<AvailabilityRuleRecord[]> {
  const parsed = input.map((rule) => availabilityRuleInput.parse(rule));
  return withTenant(businessId, async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.businessId, businessId));
    if (parsed.length === 0) return [];
    const rows = await tx
      .insert(availabilityRules)
      .values(
        parsed.map((rule) => ({
          businessId,
          weekday: rule.weekday,
          startTime: `${rule.startTime}:00`,
          endTime: `${rule.endTime}:00`,
          slotMinutes: rule.slotMinutes,
          capacity: rule.capacity,
        })),
      )
      .returning();
    return rows.map(toRuleRecord).sort(byWeekdayThenStart);
  });
}

function toRuleRecord(row: typeof availabilityRules.$inferSelect): AvailabilityRuleRecord {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    slotMinutes: row.slotMinutes,
    capacity: row.capacity,
  };
}

function byWeekdayThenStart(a: AvailabilityRuleRecord, b: AvailabilityRuleRecord): number {
  return a.weekday - b.weekday || a.startTime.localeCompare(b.startTime);
}

export async function listAvailabilityRules(
  businessId: string,
  weekday?: number,
): Promise<AvailabilityRuleRecord[]> {
  const rows = await withTenant(businessId, async (tx) => {
    const base = tx.select().from(availabilityRules);
    const filtered =
      weekday === undefined
        ? base.where(eq(availabilityRules.businessId, businessId))
        : base.where(
            and(
              eq(availabilityRules.businessId, businessId),
              eq(availabilityRules.weekday, weekday),
            ),
          );
    return filtered.orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime));
  });
  return rows.map(toRuleRecord);
}

export async function setAvailabilityException(
  businessId: string,
  input: AvailabilityExceptionInput,
): Promise<AvailabilityExceptionRecord> {
  const parsed = availabilityExceptionInput.parse(input);
  return withTenant(businessId, async (tx) => {
    const values = {
      date: parsed.date,
      closed: parsed.closed,
      startTime: parsed.closed ? null : `${parsed.startTime}:00`,
      endTime: parsed.closed ? null : `${parsed.endTime}:00`,
      reason: parsed.reason ?? null,
    };
    const [row] = await tx
      .insert(availabilityExceptions)
      .values({ businessId, ...values })
      .onConflictDoUpdate({
        target: [availabilityExceptions.businessId, availabilityExceptions.date],
        set: values,
      })
      .returning();
    if (!row) throw new Error("availability exception was not saved");
    return {
      date: row.date,
      closed: row.closed,
      startTime: row.startTime?.slice(0, 5) ?? null,
      endTime: row.endTime?.slice(0, 5) ?? null,
      reason: row.reason,
    };
  });
}

export async function listAvailabilityExceptions(
  businessId: string,
  from: string,
  to: string,
): Promise<AvailabilityExceptionRecord[]> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.businessId, businessId),
          gte(availabilityExceptions.date, from),
          lte(availabilityExceptions.date, to),
        ),
      )
      .orderBy(asc(availabilityExceptions.date)),
  );
  return rows.map((row) => ({
    date: row.date,
    closed: row.closed,
    startTime: row.startTime?.slice(0, 5) ?? null,
    endTime: row.endTime?.slice(0, 5) ?? null,
    reason: row.reason,
  }));
}

export interface BusyBooking {
  startAt: Date;
  endAt: Date;
}

/** Confirmed work overlapping [from, to) — never exposes who it belongs to. */
export async function listBusyTimes(
  businessId: string,
  from: Date,
  to: Date,
): Promise<BusyBooking[]> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select({ startAt: bookings.startAt, endAt: bookings.endAt })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.status, "confirmed"),
          lte(bookings.startAt, to),
          gte(bookings.endAt, from),
        ),
      ),
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------ */

export interface BookingRecord {
  id: string;
  businessId: string;
  serviceId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  priceCentsSnapshot: number | null;
  source: string;
  idempotencyKey: string | null;
}

export interface InsertBookingInput {
  serviceId: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address?: string | null;
  notes?: string | null;
  intakeAnswers?: Record<string, unknown>;
  priceCentsSnapshot: number | null;
  conversationId?: string | null;
  idempotencyKey: string;
  /** From the availability rule that produced this slot. */
  capacity: number;
}

export type InsertBookingResult =
  | { ok: true; booking: BookingRecord; replayed: boolean }
  | { ok: false; reason: "slot_taken" };

/**
 * The only way a booking is created.
 *
 * One transaction: take a per-slot advisory lock, honour an idempotency key,
 * count the confirmed bookings that overlap, refuse beyond capacity, then
 * insert. Two callers racing for the last place serialise on the lock, so
 * exactly one wins and the other is told the slot is taken — the unique index
 * on (business_id, start_at, slot_seq) is the second line of defence.
 */
export async function insertBookingAtomic(
  businessId: string,
  input: InsertBookingInput,
): Promise<InsertBookingResult> {
  return withTenant(businessId, async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${businessId}|${input.startAt.toISOString()}`}, 0))`,
    );

    if (input.idempotencyKey) {
      const existing = await findBookingByKey(tx, businessId, input.idempotencyKey);
      if (existing) return { ok: true, booking: existing, replayed: true };
    }

    const taken = rowsOf<{ n: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS n FROM bookings
         WHERE business_id = ${businessId}
           AND status = 'confirmed'
           AND start_at < ${input.endAt}
           AND end_at > ${input.startAt}
      `),
    )[0]?.n;
    if ((taken ?? 0) >= Math.max(1, input.capacity)) {
      return { ok: false, reason: "slot_taken" };
    }

    try {
      const [row] = await tx
        .insert(bookings)
        .values({
          businessId,
          serviceId: input.serviceId,
          startAt: input.startAt,
          endAt: input.endAt,
          status: "confirmed",
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          intakeAnswers: input.intakeAnswers ?? {},
          priceCentsSnapshot: input.priceCentsSnapshot,
          currency: "AUD",
          source: "ai_assistant",
          conversationId: input.conversationId ?? null,
          idempotencyKey: input.idempotencyKey,
          slotSeq: taken ?? 0,
        })
        .returning();
      if (!row) throw new Error("booking row was not created");
      return { ok: true, booking: row as BookingRecord, replayed: false };
    } catch (error) {
      if (isUniqueViolationOn(error, "bookings_business_idempotency_key")) {
        const existing = await findBookingByKey(tx, businessId, input.idempotencyKey);
        if (existing) return { ok: true, booking: existing, replayed: true };
      }
      if (isUniqueViolation(error)) return { ok: false, reason: "slot_taken" };
      throw error;
    }
  });
}

async function findBookingByKey(
  tx: Tx,
  businessId: string,
  idempotencyKey: string,
): Promise<BookingRecord | null> {
  const rows = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.businessId, businessId), eq(bookings.idempotencyKey, idempotencyKey)));
  return (rows[0] as BookingRecord | undefined) ?? null;
}

export async function findBookingByIdempotencyKey(
  businessId: string,
  idempotencyKey: string,
): Promise<BookingRecord | null> {
  return withTenant(businessId, (tx) => findBookingByKey(tx, businessId, idempotencyKey));
}

export async function listBookings(businessId: string, limit = 50): Promise<BookingRecord[]> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(bookings)
      .where(eq(bookings.businessId, businessId))
      .orderBy(desc(bookings.startAt))
      .limit(limit),
  );
  return rows as BookingRecord[];
}

/* ------------------------------------------------------------------ *
 * Job requests
 * ------------------------------------------------------------------ */

export interface JobRequestRecord {
  id: string;
  businessId: string;
  serviceId: string | null;
  status: string;
  customerName: string;
  customerPhone: string;
  requestedDateWindow: string | null;
}

export interface InsertJobRequestInput {
  serviceId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address?: string | null;
  requestedDateWindow?: string | null;
  photos?: string[];
  intakeAnswers?: Record<string, unknown>;
  conversationId?: string | null;
  idempotencyKey: string;
}

export async function insertJobRequestAtomic(
  businessId: string,
  input: InsertJobRequestInput,
): Promise<{ request: JobRequestRecord; replayed: boolean }> {
  return withTenant(businessId, async (tx) => {
    const existingRows = await tx
      .select()
      .from(jobRequests)
      .where(
        and(eq(jobRequests.businessId, businessId), eq(jobRequests.idempotencyKey, input.idempotencyKey)),
      );
    const existing = existingRows[0];
    if (existing) return { request: existing as JobRequestRecord, replayed: true };

    try {
      const [row] = await tx
        .insert(jobRequests)
        .values({
          businessId,
          serviceId: input.serviceId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          address: input.address ?? null,
          requestedDateWindow: input.requestedDateWindow ?? null,
          photos: input.photos ?? [],
          intakeAnswers: input.intakeAnswers ?? {},
          status: "new",
          currency: "AUD",
          source: "ai_assistant",
          conversationId: input.conversationId ?? null,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!row) throw new Error("job request row was not created");
      return { request: row as JobRequestRecord, replayed: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await tx
          .select()
          .from(jobRequests)
          .where(
            and(
              eq(jobRequests.businessId, businessId),
              eq(jobRequests.idempotencyKey, input.idempotencyKey),
            ),
          );
        const row = again[0];
        if (row) return { request: row as JobRequestRecord, replayed: true };
      }
      throw error;
    }
  });
}

export async function listJobRequests(businessId: string, limit = 50): Promise<JobRequestRecord[]> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(jobRequests)
      .where(eq(jobRequests.businessId, businessId))
      .orderBy(desc(jobRequests.createdAt))
      .limit(limit),
  );
  return rows as JobRequestRecord[];
}

/* ------------------------------------------------------------------ *
 * Conversations and handoffs
 * ------------------------------------------------------------------ */

export interface ConversationRecord {
  id: string;
  businessId: string;
  channel: string;
  status: string;
}

export async function getConversation(
  businessId: string,
  conversationId: string,
): Promise<ConversationRecord> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId))),
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("conversation");
  return row as ConversationRecord;
}

export async function setConversationStatus(
  businessId: string,
  conversationId: string,
  status: "active" | "handed_off" | "closed",
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(conversations)
      .set({ status })
      .where(and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId)));
  });
}

export interface HandoffRecord {
  id: string;
  reason: string;
  summary: string;
}

export async function createHandoff(
  businessId: string,
  input: { conversationId: string; reason: string; summary: string },
): Promise<HandoffRecord> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(handoffs)
      .values({
        businessId,
        conversationId: input.conversationId,
        reason: input.reason,
        summary: input.summary,
      })
      .returning({ id: handoffs.id, reason: handoffs.reason, summary: handoffs.summary });
    if (!row) throw new Error("handoff row was not created");
    return row;
  });
}

/* ------------------------------------------------------------------ *
 * Owner notifications
 * ------------------------------------------------------------------ */

/**
 * Queues one owner notification. `dedupeKey` makes "notify once" true instead
 * of hopeful: a duplicate key is silently ignored and reported as `false`.
 * Delivery (email) belongs to a later milestone; the row is the record.
 */
export async function queueOwnerNotification(
  businessId: string,
  input: { kind: string; dedupeKey: string; payload?: Record<string, unknown> },
): Promise<boolean> {
  return withTenant(businessId, async (tx) => {
    const inserted = await tx
      .insert(notifications)
      .values({
        businessId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        payload: input.payload ?? {},
      })
      .onConflictDoNothing({ target: [notifications.businessId, notifications.dedupeKey] })
      .returning({ id: notifications.id });
    return inserted.length > 0;
  });
}

/** The tenant's own settings, as the assistant needs them. */
export interface BusinessProfile {
  id: string;
  name: string;
  timezone: string;
  assistantName: string;
  status: string;
  botEnabled: boolean;
  ownerNotifyEmail: string;
  currency: string;
}

export async function getBusinessProfile(businessId: string): Promise<BusinessProfile> {
  const rows = await withTenant(businessId, async (tx) =>
    tx.select().from(businesses).where(eq(businesses.id, businessId)),
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("business");
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    assistantName: row.assistantName,
    status: row.status,
    botEnabled: row.botEnabled,
    ownerNotifyEmail: row.ownerNotifyEmail,
    currency: row.currency,
  };
}

/** Which plan a tenant is on. Missing subscription = the entry plan. */
export async function getPlanKey(businessId: string): Promise<string> {
  const rows = await withTenant(businessId, async (tx) =>
    tx.execute(sql`SELECT plan_key FROM subscriptions WHERE business_id = ${businessId} LIMIT 1`),
  );
  return rowsOf<{ plan_key: string }>(rows)[0]?.plan_key ?? "answer";
}

/** Test/dashboard helper: set the plan a tenant is on. */
export async function setPlanKey(businessId: string, planKey: string): Promise<void> {
  await withTenant(businessId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO subscriptions (business_id, plan_key, status)
      VALUES (${businessId}, ${planKey}, 'trialing')
      ON CONFLICT (business_id) DO UPDATE SET plan_key = ${planKey}, updated_at = now()
    `);
  });
}

/** Used by the dashboard later: mark a booking cancelled, freeing the slot. */
export async function cancelBooking(businessId: string, bookingId: string): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(bookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
      .returning({ id: bookings.id });
    if (updated.length === 0) throw new NotFoundError("booking");
  });
}

/** Kept for the isolation tests: services visible to this tenant only. */
export async function servicesOwnedBy(businessId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await withTenant(businessId, async (tx) =>
    tx.select({ id: services.id }).from(services).where(inArray(services.id, ids)),
  );
  return rows.map((row) => row.id);
}
