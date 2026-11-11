/**
 * Webina database schema (Drizzle, Postgres).
 *
 * Rules that hold everywhere in this file:
 *  - every tenant-owned table carries `business_id` (uuid, not null, FK);
 *  - every timestamp is `timestamptz`;
 *  - every money column is an integer number of cents, and the only currency
 *    is AUD. There is no GST column, no tax rate, no tax config — Web Digital
 *    Assistants is a sole trader below the A$100,000 turnover threshold.
 *
 * Row Level Security lives in migrations/0001_rls.sql. The runtime role
 * (webina_app) is subject to it; the migrator role owns the tables.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

/* ------------------------------------------------------------------ *
 * Tenancy and access
 * ------------------------------------------------------------------ */

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    tradeTemplate: text("trade_template").notNull().default("generic"),
    timezone: text("timezone").notNull().default("Australia/Adelaide"),
    ownerNotifyEmail: text("owner_notify_email").notNull(),
    ownerNotifyPhone: text("owner_notify_phone"),
    assistantName: text("assistant_name").notNull().default("Webina"),
    greeting: text("greeting"),
    tone: text("tone").notNull().default("friendly and brief"),
    businessRules: text("business_rules"),
    brandColor: text("brand_color"),
    logoUrl: text("logo_url"),
    showPoweredBy: boolean("show_powered_by").notNull().default(true),
    status: text("status").notNull().default("trial"),
    botEnabled: boolean("bot_enabled").notNull().default(true),
    currency: text("currency").notNull().default("AUD"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("businesses_slug_key").on(t.slug)],
);

/** Better Auth identity tables. Identity is global; tenancy is `memberships`. */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("user_email_key").on(t.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("session_token_key").on(t.token), index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Better Auth twoFactor plugin. 2FA is available and off by default. */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(false),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("two_factor_user_id_idx").on(t.userId)],
);

/** Who may act on a tenant. A user can belong to more than one business. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_business_key").on(t.userId, t.businessId),
    index("memberships_business_id_idx").on(t.businessId),
  ],
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    label: text("label"),
    siteKey: text("site_key").notNull(),
    allowedOrigins: text("allowed_origins").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sites_site_key_key").on(t.siteKey),
    index("sites_business_id_idx").on(t.businessId),
  ],
);

/* ------------------------------------------------------------------ *
 * Catalogue and rules
 * ------------------------------------------------------------------ */

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    pricingType: text("pricing_type").notNull().default("fixed"),
    priceCents: integer("price_cents"),
    /** One zod-validated union keyed by pricing_type. */
    pricingConfig: jsonb("pricing_config").$type<Record<string, unknown>>().notNull().default({}),
    durationMinutes: integer("duration_minutes"),
    schedulingType: text("scheduling_type").notNull().default("time_slot"),
    recurringOptions: jsonb("recurring_options").$type<unknown[]>().notNull().default([]),
    intakeFields: jsonb("intake_fields").$type<unknown[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("services_business_id_idx").on(t.businessId)],
);

export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("none"),
    values: jsonb("values").$type<string[]>().notNull().default([]),
    centerLat: numeric("center_lat", { precision: 9, scale: 6 }),
    centerLng: numeric("center_lng", { precision: 9, scale: 6 }),
    radiusKm: integer("radius_km"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("service_areas_business_id_key").on(t.businessId)],
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** 0 = Sunday … 6 = Saturday, in the business's own timezone. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(60),
    capacity: integer("capacity").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("availability_rules_business_weekday_idx").on(t.businessId, t.weekday)],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    closed: boolean("closed").notNull().default(true),
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("availability_exceptions_business_date_key").on(t.businessId, t.date)],
);

/* ------------------------------------------------------------------ *
 * Work created by the assistant
 * ------------------------------------------------------------------ */

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull().default("confirmed"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    address: text("address"),
    notes: text("notes"),
    intakeAnswers: jsonb("intake_answers").$type<Record<string, unknown>>().notNull().default({}),
    priceCentsSnapshot: integer("price_cents_snapshot"),
    currency: text("currency").notNull().default("AUD"),
    source: text("source").notNull().default("dashboard"),
    conversationId: uuid("conversation_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bookings_business_idempotency_key").on(t.businessId, t.idempotencyKey),
    // One confirmed booking per business per slot start. Cancelling frees it.
    uniqueIndex("bookings_business_start_confirmed_key")
      .on(t.businessId, t.startAt)
      .where(sql`status = 'confirmed'`),
    index("bookings_business_start_idx").on(t.businessId, t.startAt),
    index("bookings_business_status_idx").on(t.businessId, t.status),
  ],
);

export const jobRequests = pgTable(
  "job_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    address: text("address"),
    requestedDateWindow: text("requested_date_window"),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("new"),
    ownerPriceCents: integer("owner_price_cents"),
    currency: text("currency").notNull().default("AUD"),
    intakeAnswers: jsonb("intake_answers").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source").notNull().default("dashboard"),
    conversationId: uuid("conversation_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("job_requests_business_idempotency_key").on(t.businessId, t.idempotencyKey),
    index("job_requests_business_status_idx").on(t.businessId, t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("web"),
    /** Opaque. Never a phone number or email address. */
    customerRef: text("customer_ref").notNull(),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("conversations_business_created_idx").on(t.businessId, t.startedAt),
    index("conversations_business_status_idx").on(t.businessId, t.status),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** Full content blocks (tool_use / tool_result included). */
    content: jsonb("content").$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_business_created_idx").on(t.businessId, t.createdAt),
    index("messages_conversation_id_idx").on(t.conversationId),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    summary: text("summary").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("handoffs_business_status_idx").on(t.businessId, t.resolved)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    quantity: integer("quantity").notNull().default(1),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costEstimateCents: integer("cost_estimate_cents"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_business_created_idx").on(t.businessId, t.createdAt)],
);

/* ------------------------------------------------------------------ *
 * Billing, admin, outbound work
 * ------------------------------------------------------------------ */

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    planKey: text("plan_key").notNull().default("answer"),
    status: text("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "date" }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
    addons: jsonb("addons").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_business_id_key").on(t.businessId),
    uniqueIndex("subscriptions_stripe_subscription_id_key").on(t.stripeSubscriptionId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null only for platform-level events; tenant events always carry it. */
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    /** Never PII. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_business_created_idx").on(t.businessId, t.createdAt)],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    channel: text("channel").notNull(),
    type: text("type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("consents_business_phone_idx").on(t.businessId, t.phone)],
);

export const optOuts = pgTable(
  "opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    channel: text("channel").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("opt_outs_business_phone_channel_key").on(t.businessId, t.phone, t.channel)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Makes "notify once" true instead of hopeful. */
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notifications_business_dedupe_key").on(t.businessId, t.dedupeKey)],
);

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sendAfter: timestamp("send_after", { withTimezone: true, mode: "date" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("scheduled_messages_due_idx").on(t.status, t.sendAfter)],
);
