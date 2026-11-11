/**
 * Plan configuration — the single file the owner can change.
 *
 * Prices are AUD, stored as integer cents. Web Digital Assistants is a sole
 * trader below the A$100,000 turnover threshold, so there is NO GST anywhere:
 * no tax line, no tax rate, no "plus GST". If a third-party setting forces a
 * tax field, leave it empty.
 *
 * Plan limits are enforced on the server; the model never decides them.
 */

export const PLAN_KEYS = ["answer", "front_desk"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const CURRENCY = "AUD" as const;

/** Tools the model may call. Gating is server-side; this is the allow-list. */
export const TOOL_NAMES = [
  "list_services",
  "get_quote",
  "check_service_area",
  "check_availability",
  "create_booking",
  "create_job_request",
  "handoff_to_owner",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type PlanFeature =
  | "web_chat"
  | "job_requests"
  | "bookings"
  | "sms"
  | "whatsapp"
  | "reminders"
  | "review_requests"
  | "weekly_summary";

export interface Plan {
  key: PlanKey;
  name: string;
  priceCents: number;
  currency: typeof CURRENCY;
  interval: "month";
  /** Included inbound conversations per calendar month. */
  conversationsPerMonth: number;
  tools: readonly ToolName[];
  features: readonly PlanFeature[];
}

export const PLANS: Record<PlanKey, Plan> = {
  answer: {
    key: "answer",
    name: "Webina Answer",
    priceCents: 9_900,
    currency: CURRENCY,
    interval: "month",
    conversationsPerMonth: 300,
    tools: ["list_services", "get_quote", "check_service_area", "create_job_request", "handoff_to_owner"],
    features: ["web_chat", "job_requests"],
  },
  front_desk: {
    key: "front_desk",
    name: "Webina Front Desk",
    priceCents: 19_900,
    currency: CURRENCY,
    interval: "month",
    conversationsPerMonth: 1_000,
    tools: [
      "list_services",
      "get_quote",
      "check_service_area",
      "check_availability",
      "create_booking",
      "create_job_request",
      "handoff_to_owner",
    ],
    features: [
      "web_chat",
      "job_requests",
      "bookings",
      "sms",
      "whatsapp",
      "reminders",
      "review_requests",
      "weekly_summary",
    ],
  },
};

/** One-time setup, waived for the first 10 founding customers (owner-enforced). */
export const SETUP_FEE_CENTS = 29_700;

/** Overage: a pack of 500 extra conversations for A$29. */
export const EXTRA_CONVERSATION_PACK = {
  conversations: 500,
  priceCents: 2_900,
  currency: CURRENCY,
} as const;

/** What happens at the limit: stop politely, tell the customer, notify the owner. */
export const LIMIT_BEHAVIOUR = "stop_politely" as const;

export function planFor(key: PlanKey): Plan {
  return PLANS[key];
}

export function planAllowsTool(key: PlanKey, tool: ToolName): boolean {
  return PLANS[key].tools.includes(tool);
}

export function planHasFeature(key: PlanKey, feature: PlanFeature): boolean {
  return PLANS[key].features.includes(feature);
}

export function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
