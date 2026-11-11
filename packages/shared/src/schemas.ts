import { z } from "zod";

import { normalizeOriginList } from "./origin";

export const uuidSchema = z.string().uuid("must be a uuid");

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, { message: "unknown IANA timezone" });

export const TRADE_TEMPLATES = [
  "generic",
  "car_service",
  "lawn_mowing",
  "barber",
  "gift_wrapping",
  "cleaner",
  "detailer",
] as const;
export type TradeTemplate = (typeof TRADE_TEMPLATES)[number];

export const createBusinessInput = z.object({
  name: z.string().trim().min(2, "business name is too short").max(80),
  timezone: timeZoneSchema.default("Australia/Adelaide"),
  tradeTemplate: z.enum(TRADE_TEMPLATES).default("generic"),
  ownerNotifyEmail: z.string().trim().toLowerCase().email(),
  ownerNotifyPhone: z.string().trim().max(32).optional(),
  assistantName: z.string().trim().min(1).max(40).default("Webina"),
});
export type CreateBusinessInput = z.input<typeof createBusinessInput>;

export const siteInput = z.object({
  label: z.string().trim().max(60).optional(),
  allowedOrigins: z.array(z.string().trim().max(255)).max(20).default([]),
});
export type SiteInput = z.input<typeof siteInput>;

export const allowedOriginsInput = z.object({
  siteId: uuidSchema,
  allowedOrigins: z.array(z.string().trim().max(255)).max(20),
});

export const allowedOriginsSchema = z
  .array(z.string().trim().max(255))
  .max(20)
  .transform((list) => normalizeOriginList(list));

export const membershipRoleSchema = z.enum(["owner", "staff"]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/* ------------------------------------------------------------------ *
 * Catalogue: services, pricing, areas, availability
 * ------------------------------------------------------------------ */

/** Money is always an integer number of AUD cents. Never a float. */
export const centsSchema = z
  .number()
  .int("money must be whole cents")
  .min(0)
  .max(10_000_000, "that price is out of range");

export const PRICING_TYPES = ["fixed", "tiered", "from", "quote_only"] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

export const SCHEDULING_TYPES = ["time_slot", "day_window", "owner_confirms"] as const;
export type SchedulingType = (typeof SCHEDULING_TYPES)[number];

export const INTAKE_FIELD_TYPES = ["text", "number", "select", "boolean"] as const;

export const intakeFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "use snake_case keys"),
  question: z.string().trim().min(1).max(200),
  type: z.enum(INTAKE_FIELD_TYPES).default("text"),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type IntakeField = z.infer<typeof intakeFieldSchema>;

/** A selectable priced option: a lawn-size tier, a wax add-on, and so on. */
export const priceOptionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "use lowercase keys"),
  label: z.string().trim().min(1).max(80),
  priceCents: centsSchema,
});
export type PriceOption = z.infer<typeof priceOptionSchema>;

/**
 * The non-price part of a service's pricing configuration. Which parts are
 * required depends on `pricing_type` — enforced by `serviceInput` below, so a
 * tiered service can never be saved without tiers.
 */
export const pricingConfigSchema = z.object({
  /** What the tier list is called in customer-facing copy, e.g. "Lawn size". */
  tierLabel: z.string().trim().min(1).max(40).optional(),
  tiers: z.array(priceOptionSchema).max(20).default([]),
  extras: z.array(priceOptionSchema).max(20).default([]),
});
export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export const serviceInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    active: z.boolean().default(true),
    pricingType: z.enum(PRICING_TYPES),
    priceCents: centsSchema.nullable().optional(),
    pricingConfig: pricingConfigSchema.default({ tiers: [], extras: [] }),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    schedulingType: z.enum(SCHEDULING_TYPES).default("time_slot"),
    recurringOptions: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    intakeFields: z.array(intakeFieldSchema).max(15).default([]),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  .superRefine((value, ctx) => {
    const needsPrice = value.pricingType === "fixed" || value.pricingType === "from";
    if (needsPrice && (value.priceCents === null || value.priceCents === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["priceCents"],
        message: `a ${value.pricingType} price is required`,
      });
    }
    if (value.pricingType === "tiered" && value.pricingConfig.tiers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["pricingConfig", "tiers"],
        message: "a tiered service needs at least one tier",
      });
    }
    if (value.pricingType === "quote_only" && value.priceCents != null) {
      ctx.addIssue({
        code: "custom",
        path: ["priceCents"],
        message: "a quote-only service must not carry a price",
      });
    }
    const seen = new Set<string>();
    for (const tier of [...value.pricingConfig.tiers, ...value.pricingConfig.extras]) {
      if (seen.has(tier.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["pricingConfig"],
          message: `duplicate option key: ${tier.key}`,
        });
      }
      seen.add(tier.key);
    }
  });
export type ServiceInput = z.input<typeof serviceInput>;

export const SERVICE_AREA_TYPES = ["suburb_list", "postcode_list", "radius", "none"] as const;
export type ServiceAreaType = (typeof SERVICE_AREA_TYPES)[number];

export const serviceAreaInput = z
  .object({
    type: z.enum(SERVICE_AREA_TYPES),
    values: z.array(z.string().trim().min(1).max(40)).max(500).default([]),
    centerLat: z.number().min(-90).max(90).nullable().optional(),
    centerLng: z.number().min(-180).max(180).nullable().optional(),
    radiusKm: z.number().int().min(1).max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const listed = value.type === "suburb_list" || value.type === "postcode_list";
    if (listed && value.values.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["values"],
        message: `a ${value.type} area needs at least one value`,
      });
    }
    if (value.type === "radius") {
      if (value.centerLat == null || value.centerLng == null || value.radiusKm == null) {
        ctx.addIssue({
          code: "custom",
          path: ["centerLat"],
          message: "a radius area needs a centre and a radius",
        });
      }
    }
    if (value.type === "postcode_list") {
      const bad = value.values.filter((v) => !/^\d{4}$/.test(v));
      if (bad.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["values"],
          message: `not Australian postcodes: ${bad.join(", ")}`,
        });
      }
    }
  });
export type ServiceAreaInput = z.input<typeof serviceAreaInput>;

/** `HH:MM` 24-hour wall clock, in the business's own timezone. */
export const wallClockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM");

export const availabilityRuleInput = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: wallClockSchema,
    endTime: wallClockSchema,
    slotMinutes: z.number().int().min(5).max(240).default(60),
    capacity: z.number().int().min(1).max(20).default(1),
  })
  .refine((value) => value.endTime > value.startTime, {
    message: "end time must be after start time",
    path: ["endTime"],
  });
export type AvailabilityRuleInput = z.input<typeof availabilityRuleInput>;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "not a real date");

export const availabilityExceptionInput = z
  .object({
    date: isoDateSchema,
    closed: z.boolean().default(true),
    startTime: wallClockSchema.nullable().optional(),
    endTime: wallClockSchema.nullable().optional(),
    reason: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.closed) {
      if (!value.startTime || !value.endTime) {
        ctx.addIssue({
          code: "custom",
          path: ["startTime"],
          message: "custom hours need a start and an end",
        });
      } else if (value.endTime <= value.startTime) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "end time must be after start time",
        });
      }
    }
  });
export type AvailabilityExceptionInput = z.input<typeof availabilityExceptionInput>;

/** How far ahead the assistant may look for, or book, a time. */
export const BOOKING_HORIZON_DAYS = 60;
/** Never hand the model more than this many times at once. */
export const MAX_SLOTS_RETURNED = 10;
