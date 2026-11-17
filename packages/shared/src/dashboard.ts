/**
 * Input contracts for the dashboard's server functions.
 *
 * Every one of these is validated on the server before anything is read or
 * written: the browser is a stranger as far as the database is concerned, and
 * a `businessId` in a form body proves nothing on its own — membership is
 * checked separately, and RLS after that.
 */

import { z } from "zod";

import {
  availabilityExceptionInput,
  availabilityRuleInput,
  centsSchema,
  isoDateSchema,
  serviceAreaInput,
  serviceInput,
  TRADE_TEMPLATES,
  uuidSchema,
  wallClockSchema,
} from "./schemas";

export const JOB_REQUEST_STATUSES = ["new", "quoted", "accepted", "declined", "done"] as const;
export type JobRequestStatus = (typeof JOB_REQUEST_STATUSES)[number];

export const BOOKING_STATUSES = ["confirmed", "completed", "cancelled", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CONVERSATION_STATUSES = ["active", "handed_off", "closed"] as const;
export const CHANNELS = ["web", "sms", "whatsapp"] as const;

const business = z.object({ businessId: uuidSchema });

export const templateApplyInput = business.extend({
  trade: z.enum(TRADE_TEMPLATES),
  replace: z.boolean().default(false),
});

export const serviceSaveInput = business.extend({
  serviceId: uuidSchema.nullable().optional(),
  service: serviceInput,
});

export const serviceActiveInput = business.extend({
  serviceId: uuidSchema,
  active: z.boolean(),
});

export const areaSaveInput = business.extend({ area: serviceAreaInput });

export const hoursSaveInput = business.extend({
  rules: z.array(availabilityRuleInput).max(28),
});

export const exceptionSaveInput = business.extend({
  exception: availabilityExceptionInput,
});

export const conversationListInput = business.extend({
  channel: z.enum(CHANNELS).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
});

export const conversationInput = business.extend({ conversationId: uuidSchema });

export const conversationStatusInput = conversationInput.extend({
  status: z.enum(CONVERSATION_STATUSES),
});

export const bookingStatusInput = business.extend({
  bookingId: uuidSchema,
  status: z.enum(BOOKING_STATUSES),
});

export const bookingCreateInput = business.extend({
  serviceId: uuidSchema,
  date: isoDateSchema,
  startTime: wallClockSchema,
  durationMinutes: z.number().int().min(5).max(600).default(60),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(6).max(32),
  customerEmail: z.string().trim().email().max(200).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  priceCents: centsSchema.nullable().optional(),
});

export const requestUpdateInput = business.extend({
  requestId: uuidSchema,
  status: z.enum(JOB_REQUEST_STATUSES).optional(),
  ownerPriceCents: centsSchema.nullable().optional(),
});

export const handoffResolveInput = business.extend({ handoffId: uuidSchema });

export const settingsSaveInput = business.extend({
  name: z.string().trim().min(2).max(80).optional(),
  assistantName: z.string().trim().min(1).max(40).optional(),
  greeting: z.string().trim().max(300).nullable().optional(),
  tone: z.string().trim().max(200).optional(),
  businessRules: z.string().trim().max(4000).nullable().optional(),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "use a colour like #0f7b8a")
    .nullable()
    .optional(),
  showPoweredBy: z.boolean().optional(),
  botEnabled: z.boolean().optional(),
  ownerNotifyEmail: z.string().trim().toLowerCase().email().optional(),
  ownerNotifyPhone: z.string().trim().max(32).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const originsSaveInput = business.extend({
  siteId: uuidSchema,
  allowedOrigins: z.array(z.string().trim().max(255)).max(20),
});

export const installCheckInput = business.extend({ siteId: uuidSchema });

export const testChatInput = business.extend({
  message: z.string().trim().min(1, "type a message").max(1_000),
  conversationId: uuidSchema.nullable().optional(),
});

export type DashboardInput<T extends z.ZodTypeAny> = z.input<T>;
