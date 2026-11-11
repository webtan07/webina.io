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
