/**
 * The dashboard's own reads and writes.
 *
 * Everything here runs inside `withTenant`, so it inherits the same two-layer
 * protection as the rest of the catalogue: the membership check decides who
 * may ask, and Row Level Security means a query that forgot a `WHERE` still
 * cannot return another business's rows.
 *
 * Two rules that are easy to get wrong and are enforced here:
 *  - a transcript summarises the model's tool calls but never re-sends the raw
 *    content blocks to the browser;
 *  - "install checked" and "test chat sent" are written to `audit_log`, not
 *    invented in the page, so the wizard's progress survives a refresh.
 */

import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  auditLog,
  availabilityRules,
  bookings,
  businesses,
  conversations,
  handoffs,
  jobRequests,
  messages,
  serviceAreas,
  services,
  sites,
} from "./schema";
import { withTenant } from "./tenant";
import type { MessageRecord } from "./messages";

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

/** Drizzle's `execute` hands back the driver result; read rows through this. */
function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export class DashboardError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "slot_taken",
    message: string,
  ) {
    super(message);
    this.name = "DashboardError";
  }
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

export interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  startedAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  openHandoff: boolean;
}

export async function listConversationSummaries(
  businessId: string,
  filters: { channel?: string; status?: string; limit?: number } = {},
): Promise<ConversationSummary[]> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(businessId, async (tx) => {
    const where = [eq(conversations.businessId, businessId)];
    if (filters.channel) where.push(eq(conversations.channel, filters.channel));
    if (filters.status) where.push(eq(conversations.status, filters.status));

    const rows = await tx
      .select({
        id: conversations.id,
        channel: conversations.channel,
        status: conversations.status,
        startedAt: conversations.startedAt,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(and(...where))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit);

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const counts = await tx
      .select({ conversationId: messages.conversationId, total: count() })
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .groupBy(messages.conversationId);

    const openHandoffRows = await tx
      .select({ conversationId: handoffs.conversationId })
      .from(handoffs)
      .where(and(inArray(handoffs.conversationId, ids), eq(handoffs.resolved, false)));

    const countBy = new Map(counts.map((row) => [row.conversationId, Number(row.total)]));
    const handoffSet = new Set(openHandoffRows.map((row) => row.conversationId));

    return rows.map((row) => ({
      ...row,
      messageCount: countBy.get(row.id) ?? 0,
      openHandoff: handoffSet.has(row.id),
    }));
  });
}

export interface TranscriptTurn {
  id: string;
  role: string;
  /** Customer text or the assistant's own words. */
  text: string;
  /** The tools this turn called, summarised — never the raw blocks. */
  tools: { name: string; summary: string }[];
  at: Date;
}

function summariseInput(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>).slice(0, 3);
  return entries
    .map(([key, value]) => {
      const text =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : Array.isArray(value)
            ? `${value.length} item(s)`
            : "…";
      return `${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    })
    .join(" · ");
}

/** Turns stored content blocks into something a person can read. */
export function summariseTranscript(records: MessageRecord[]): TranscriptTurn[] {
  return records.map((record) => {
    const texts: string[] = [];
    const tools: { name: string; summary: string }[] = [];
    for (const block of record.content) {
      if (block === null || typeof block !== "object") continue;
      const typed = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text);
      if (typed.type === "tool_use" && typeof typed.name === "string") {
        tools.push({ name: typed.name, summary: summariseInput(typed.input) });
      }
    }
    return {
      id: record.id,
      role: record.role,
      text: texts.join("\n").trim(),
      tools,
      at: record.createdAt,
    };
  });
}

export interface ConversationDetail {
  conversation: {
    id: string;
    channel: string;
    status: string;
    startedAt: Date;
    lastMessageAt: Date;
  };
  turns: TranscriptTurn[];
  handoffs: { id: string; reason: string; summary: string; resolved: boolean; createdAt: Date }[];
}

export async function getConversationDetail(
  businessId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({
        id: conversations.id,
        channel: conversations.channel,
        status: conversations.status,
        startedAt: conversations.startedAt,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId)),
      );
    const conversation = rows[0];
    if (!conversation) throw new DashboardError("not_found", "conversation not found");

    // Read in the same transaction: a nested withTenant would take a second
    // connection out of a five-connection pool for no benefit.
    const messageRows = await tx
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(eq(messages.businessId, businessId), eq(messages.conversationId, conversationId)),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(200);

    const records: MessageRecord[] = messageRows.map((row) => ({
      id: row.id,
      role: row.role as MessageRecord["role"],
      content: row.content,
      createdAt: row.createdAt,
    }));

    const handoffRows = await tx
      .select({
        id: handoffs.id,
        reason: handoffs.reason,
        summary: handoffs.summary,
        resolved: handoffs.resolved,
        createdAt: handoffs.createdAt,
      })
      .from(handoffs)
      .where(eq(handoffs.conversationId, conversationId))
      .orderBy(desc(handoffs.createdAt));

    return { conversation, turns: summariseTranscript(records), handoffs: handoffRows };
  });
}

/** "Take over" and "hand back to the bot" are the same write, different status. */
export async function setConversationStatusForDashboard(
  businessId: string,
  conversationId: string,
  status: "active" | "handed_off" | "closed",
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(conversations)
      .set({ status })
      .where(and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId)))
      .returning({ id: conversations.id });
    if (updated.length === 0) throw new DashboardError("not_found", "conversation not found");
  });
}

/* ------------------------------------------------------------------ *
 * Handoffs
 * ------------------------------------------------------------------ */

export interface HandoffListItem {
  id: string;
  conversationId: string;
  reason: string;
  summary: string;
  resolved: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
  conversationStatus: string;
}

export async function listHandoffInbox(
  businessId: string,
  options: { includeResolved?: boolean } = {},
): Promise<HandoffListItem[]> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({
        id: handoffs.id,
        conversationId: handoffs.conversationId,
        reason: handoffs.reason,
        summary: handoffs.summary,
        resolved: handoffs.resolved,
        createdAt: handoffs.createdAt,
        resolvedAt: handoffs.resolvedAt,
        conversationStatus: conversations.status,
      })
      .from(handoffs)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, handoffs.conversationId),
          eq(conversations.businessId, handoffs.businessId),
        ),
      )
      .where(
        options.includeResolved
          ? eq(handoffs.businessId, businessId)
          : and(eq(handoffs.businessId, businessId), eq(handoffs.resolved, false)),
      )
      .orderBy(asc(handoffs.resolved), desc(handoffs.createdAt))
      .limit(100);
    return rows;
  });
}

export async function resolveHandoff(businessId: string, handoffId: string): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(handoffs)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(and(eq(handoffs.id, handoffId), eq(handoffs.businessId, businessId)))
      .returning({ id: handoffs.id });
    if (updated.length === 0) throw new DashboardError("not_found", "handoff not found");
  });
}

/* ------------------------------------------------------------------ *
 * Bookings and job requests
 * ------------------------------------------------------------------ */

export interface BookingRow {
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string | null;
  notes: string | null;
  priceCentsSnapshot: number | null;
  source: string;
  conversationId: string | null;
}

const bookingColumns = {
  id: bookings.id,
  serviceId: bookings.serviceId,
  serviceName: services.name,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  status: bookings.status,
  customerName: bookings.customerName,
  customerPhone: bookings.customerPhone,
  customerEmail: bookings.customerEmail,
  address: bookings.address,
  notes: bookings.notes,
  priceCentsSnapshot: bookings.priceCentsSnapshot,
  source: bookings.source,
  conversationId: bookings.conversationId,
};

export async function listBookingsForDashboard(
  businessId: string,
  options: { from?: Date; to?: Date; limit?: number } = {},
): Promise<BookingRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return withTenant(businessId, async (tx) => {
    const where = [eq(bookings.businessId, businessId)];
    if (options.from) where.push(gte(bookings.startAt, options.from));
    if (options.to) where.push(lte(bookings.startAt, options.to));
    const rows = await tx
      .select(bookingColumns)
      .from(bookings)
      .leftJoin(services, eq(services.id, bookings.serviceId))
      .where(and(...where))
      .orderBy(asc(bookings.startAt))
      .limit(limit);
    return rows;
  });
}

export async function updateBookingStatus(
  businessId: string,
  bookingId: string,
  status: "confirmed" | "completed" | "cancelled" | "no_show",
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(bookings)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
      .returning({ id: bookings.id });
    if (updated.length === 0) throw new DashboardError("not_found", "booking not found");
  });
}

export interface DashboardBookingInput {
  serviceId: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address?: string | null;
  notes?: string | null;
  priceCents?: number | null;
}

/**
 * A booking the owner types in themselves.
 *
 * Same slot arithmetic as the assistant's path — advisory lock, count the
 * confirmed work that overlaps, refuse beyond the slot's capacity — so the
 * dashboard and the widget can never double-book a chair between them.
 */
export async function createDashboardBooking(
  businessId: string,
  input: DashboardBookingInput,
): Promise<{ id: string }> {
  return withTenant(businessId, async (tx) => {
    const serviceRows = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.businessId, businessId)));
    if (serviceRows.length === 0) throw new DashboardError("not_found", "service not found");

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${businessId}|${input.startAt.toISOString()}`}, 0))`,
    );

    const ruleRows = await tx
      .select({ capacity: availabilityRules.capacity })
      .from(availabilityRules)
      .where(eq(availabilityRules.businessId, businessId));
    const capacity = Math.max(1, ...ruleRows.map((row) => row.capacity));

    const taken =
      rowsOf<{ n: number }>(
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM bookings
           WHERE business_id = ${businessId}
             AND status = 'confirmed'
             AND start_at < ${input.endAt}
             AND end_at > ${input.startAt}
        `),
      )[0]?.n ?? 0;
    if (taken >= capacity) {
      throw new DashboardError("slot_taken", "that time is already booked");
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
          priceCentsSnapshot: input.priceCents ?? null,
          currency: "AUD",
          source: "dashboard",
          slotSeq: taken,
        })
        .returning({ id: bookings.id });
      if (!row) throw new Error("booking row was not created");
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DashboardError("slot_taken", "that time is already booked");
      }
      throw error;
    }
  });
}

export interface JobRequestRow {
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  status: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string | null;
  requestedDateWindow: string | null;
  photos: string[];
  ownerPriceCents: number | null;
  intakeAnswers: Record<string, unknown>;
  source: string;
  conversationId: string | null;
  createdAt: Date;
}

export async function listJobRequestsForDashboard(
  businessId: string,
  options: { status?: string; limit?: number } = {},
): Promise<JobRequestRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return withTenant(businessId, async (tx) => {
    const where = [eq(jobRequests.businessId, businessId)];
    if (options.status) where.push(eq(jobRequests.status, options.status));
    const rows = await tx
      .select({
        id: jobRequests.id,
        serviceId: jobRequests.serviceId,
        serviceName: services.name,
        status: jobRequests.status,
        customerName: jobRequests.customerName,
        customerPhone: jobRequests.customerPhone,
        customerEmail: jobRequests.customerEmail,
        address: jobRequests.address,
        requestedDateWindow: jobRequests.requestedDateWindow,
        photos: jobRequests.photos,
        ownerPriceCents: jobRequests.ownerPriceCents,
        intakeAnswers: jobRequests.intakeAnswers,
        source: jobRequests.source,
        conversationId: jobRequests.conversationId,
        createdAt: jobRequests.createdAt,
      })
      .from(jobRequests)
      .leftJoin(services, eq(services.id, jobRequests.serviceId))
      .where(and(...where))
      .orderBy(desc(jobRequests.createdAt))
      .limit(limit);
    return rows;
  });
}

export type JobRequestStatus = "new" | "quoted" | "accepted" | "declined" | "done";

export async function updateJobRequest(
  businessId: string,
  requestId: string,
  input: { status?: JobRequestStatus; ownerPriceCents?: number | null },
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(jobRequests)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ownerPriceCents === undefined ? {} : { ownerPriceCents: input.ownerPriceCents }),
        updatedAt: new Date(),
      })
      .where(and(eq(jobRequests.id, requestId), eq(jobRequests.businessId, businessId)))
      .returning({ id: jobRequests.id });
    if (updated.length === 0) throw new DashboardError("not_found", "job request not found");
  });
}

/* ------------------------------------------------------------------ *
 * Services (the dashboard edits one at a time)
 * ------------------------------------------------------------------ */

export async function setServiceActive(
  businessId: string,
  serviceId: string,
  active: boolean,
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(services)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
      .returning({ id: services.id });
    if (updated.length === 0) throw new DashboardError("not_found", "service not found");
  });
}

/* ------------------------------------------------------------------ *
 * Settings and the install check
 * ------------------------------------------------------------------ */

export interface BusinessSettings {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  tradeTemplate: string;
  assistantName: string;
  greeting: string | null;
  tone: string;
  businessRules: string | null;
  brandColor: string | null;
  showPoweredBy: boolean;
  botEnabled: boolean;
  ownerNotifyEmail: string;
  ownerNotifyPhone: string | null;
  sites: { id: string; label: string | null; siteKey: string; allowedOrigins: string[]; isActive: boolean }[];
}

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(businesses).where(eq(businesses.id, businessId));
    const business = rows[0];
    if (!business) throw new DashboardError("not_found", "business not found");

    const siteRows = await tx
      .select({
        id: sites.id,
        label: sites.label,
        siteKey: sites.siteKey,
        allowedOrigins: sites.allowedOrigins,
        isActive: sites.isActive,
      })
      .from(sites)
      .where(eq(sites.businessId, businessId))
      .orderBy(asc(sites.createdAt));

    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      status: business.status,
      timezone: business.timezone,
      tradeTemplate: business.tradeTemplate,
      assistantName: business.assistantName,
      greeting: business.greeting,
      tone: business.tone,
      businessRules: business.businessRules,
      brandColor: business.brandColor,
      showPoweredBy: business.showPoweredBy,
      botEnabled: business.botEnabled,
      ownerNotifyEmail: business.ownerNotifyEmail,
      ownerNotifyPhone: business.ownerNotifyPhone,
      sites: siteRows,
    };
  });
}

export interface BusinessSettingsPatch {
  name?: string;
  assistantName?: string;
  greeting?: string | null;
  tone?: string;
  businessRules?: string | null;
  brandColor?: string | null;
  showPoweredBy?: boolean;
  botEnabled?: boolean;
  ownerNotifyEmail?: string;
  ownerNotifyPhone?: string | null;
  timezone?: string;
  status?: string;
}

export async function updateBusinessSettings(
  businessId: string,
  patch: BusinessSettingsPatch,
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const updated = await tx
      .update(businesses)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(businesses.id, businessId))
      .returning({ id: businesses.id });
    if (updated.length === 0) throw new DashboardError("not_found", "business not found");
  });
}

/** Which page the "Check installation" test last found the snippet on. */
export interface InstallCheckRecord {
  found: boolean;
  url: string;
  at: Date;
}

export async function recordInstallCheck(
  businessId: string,
  actor: string,
  record: InstallCheckRecord,
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    await tx.insert(auditLog).values({
      businessId,
      actor,
      action: "install_checked",
      metadata: { found: record.found, url: record.url, at: record.at.toISOString() },
    });
  });
}

export async function latestInstallCheck(businessId: string): Promise<InstallCheckRecord | null> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ metadata: auditLog.metadata, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, "install_checked")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const metadata = row.metadata as { found?: boolean; url?: string };
    return {
      found: metadata.found === true,
      url: typeof metadata.url === "string" ? metadata.url : "",
      at: row.createdAt,
    };
  });
}

export async function recordAudit(
  businessId: string,
  actor: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    await tx.insert(auditLog).values({ businessId, actor, action, metadata });
  });
}

export async function hasAuditAction(businessId: string, action: string): Promise<boolean> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, action)))
      .limit(1);
    return rows.length > 0;
  });
}

/* ------------------------------------------------------------------ *
 * Overview numbers and onboarding progress
 * ------------------------------------------------------------------ */

export interface DashboardSummary {
  conversations7d: number;
  openHandoffs: number;
  newRequests: number;
  upcomingBookings: number;
  activeServices: number;
}

export async function dashboardSummary(businessId: string): Promise<DashboardSummary> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return withTenant(businessId, async (tx) => {
    const conversationRows = await tx
      .select({ total: count() })
      .from(conversations)
      .where(
        and(eq(conversations.businessId, businessId), gte(conversations.startedAt, sevenDaysAgo)),
      );
    const handoffRows = await tx
      .select({ total: count() })
      .from(handoffs)
      .where(and(eq(handoffs.businessId, businessId), eq(handoffs.resolved, false)));
    const requestRows = await tx
      .select({ total: count() })
      .from(jobRequests)
      .where(and(eq(jobRequests.businessId, businessId), eq(jobRequests.status, "new")));
    const bookingRows = await tx
      .select({ total: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.status, "confirmed"),
          gte(bookings.startAt, new Date()),
        ),
      );
    const serviceRows = await tx
      .select({ total: count() })
      .from(services)
      .where(and(eq(services.businessId, businessId), eq(services.active, true)));

    return {
      conversations7d: Number(conversationRows[0]?.total ?? 0),
      openHandoffs: Number(handoffRows[0]?.total ?? 0),
      newRequests: Number(requestRows[0]?.total ?? 0),
      upcomingBookings: Number(bookingRows[0]?.total ?? 0),
      activeServices: Number(serviceRows[0]?.total ?? 0),
    };
  });
}

export interface OnboardingProgress {
  tradeTemplate: string;
  status: string;
  botEnabled: boolean;
  serviceCount: number;
  areaType: string;
  ruleCount: number;
  ownerNotifyEmail: string;
  ownerNotifyPhone: string | null;
  siteKey: string | null;
  siteId: string | null;
  allowedOrigins: string[];
  installChecked: boolean;
  installFound: boolean;
  testChatSent: boolean;
  templateApplied: boolean;
  detailsSaved: boolean;
  planKey: string;
}

export async function onboardingProgress(businessId: string): Promise<OnboardingProgress> {
  // One transaction, one connection: the pool holds five, and the wizard asks
  // for this on every page load.
  return withTenant(businessId, async (tx) => {
    const businessRows = await tx.select().from(businesses).where(eq(businesses.id, businessId));
    const business = businessRows[0];
    if (!business) throw new DashboardError("not_found", "business not found");

    const siteRows = await tx
      .select({
        id: sites.id,
        siteKey: sites.siteKey,
        allowedOrigins: sites.allowedOrigins,
      })
      .from(sites)
      .where(eq(sites.businessId, businessId))
      .orderBy(asc(sites.createdAt))
      .limit(1);

    const serviceRows = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.businessId, businessId), eq(services.active, true)));

    const areaRows = await tx
      .select({ type: serviceAreas.type })
      .from(serviceAreas)
      .where(eq(serviceAreas.businessId, businessId));

    const ruleRows = await tx
      .select({ id: availabilityRules.id })
      .from(availabilityRules)
      .where(eq(availabilityRules.businessId, businessId));

    const auditRows = await tx
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.businessId, businessId),
          inArray(auditLog.action, [
            "install_checked",
            "test_chat_sent",
            "template_applied",
            "settings_saved",
          ]),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(50);

    const planRows = await tx.execute(
      sql`SELECT plan_key FROM subscriptions WHERE business_id = ${businessId} LIMIT 1`,
    );

    const installRow = auditRows.find((row) => row.action === "install_checked");
    const installFound = installRow
      ? (installRow.metadata as { found?: boolean }).found === true
      : false;
    const site = siteRows[0] ?? null;

    return {
      tradeTemplate: business.tradeTemplate,
      status: business.status,
      botEnabled: business.botEnabled,
      serviceCount: serviceRows.length,
      areaType: areaRows[0]?.type ?? "none",
      ruleCount: ruleRows.length,
      ownerNotifyEmail: business.ownerNotifyEmail,
      ownerNotifyPhone: business.ownerNotifyPhone,
      siteKey: site?.siteKey ?? null,
      siteId: site?.id ?? null,
      allowedOrigins: site?.allowedOrigins ?? [],
      installChecked: installRow !== undefined,
      installFound,
      testChatSent: auditRows.some((row) => row.action === "test_chat_sent"),
      templateApplied: auditRows.some((row) => row.action === "template_applied"),
      detailsSaved: auditRows.some((row) => row.action === "settings_saved"),
      planKey: rowsOf<{ plan_key: string }>(planRows)[0]?.plan_key ?? "answer",
    };
  });
}

/** Services and hours are what a tenant needs before it can answer anyone. */
export async function canGoLive(businessId: string): Promise<{ ok: boolean; missing: string[] }> {
  const progress = await onboardingProgress(businessId);
  const missing: string[] = [];
  if (progress.serviceCount === 0) missing.push("at least one active service");
  if (progress.ruleCount === 0) missing.push("opening hours");
  if (!progress.ownerNotifyEmail) missing.push("an email for job notifications");
  return { ok: missing.length === 0, missing };
}
