/**
 * Deterministic pricing.
 *
 * The model never does arithmetic on money. It names a service and, when the
 * service has tiers or extras, the options the customer chose; this module
 * turns that into a price from the stored configuration and nothing else. If
 * the configuration cannot produce a price, the answer is "ask the owner",
 * never a guess.
 */

import type { PricingConfig } from "@webina/shared";

export interface PriceableService {
  pricingType: string;
  priceCents: number | null;
  pricingConfig: Record<string, unknown>;
}

export interface QuoteLine {
  label: string;
  priceCents: number;
}

export interface Quote {
  pricingType: string;
  /** Null for a quote-only service: the owner prices it. */
  totalCents: number | null;
  /** True when the figure is a starting price, not a fixed one. */
  from: boolean;
  ownerWillQuote: boolean;
  tierKey: string | null;
  tierLabel: string | null;
  lines: QuoteLine[];
}

export type QuoteOutcome =
  | { ok: true; quote: Quote }
  | { ok: false; message: string; details?: Record<string, unknown> };

type OptionMap = Record<string, unknown>;

function asConfig(raw: Record<string, unknown>): PricingConfig {
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  const extras = Array.isArray(raw.extras) ? raw.extras : [];
  return {
    tierLabel: typeof raw.tierLabel === "string" ? raw.tierLabel : undefined,
    tiers: tiers as PricingConfig["tiers"],
    extras: extras as PricingConfig["extras"],
  };
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Every value the caller supplied, so a tier can be found under any key. */
function suppliedValues(...maps: OptionMap[]): string[] {
  const out: string[] = [];
  for (const map of maps) {
    for (const value of Object.values(map)) {
      if (typeof value === "string") out.push(value);
      else if (typeof value === "number") out.push(String(value));
    }
  }
  return out;
}

/** A keyed option counts as chosen when it is truthy and not "no"/"none". */
function isChosen(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = normalise(value);
    return v !== "" && v !== "no" && v !== "false" && v !== "none" && v !== "0";
  }
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function includesExtra(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => normalise(String(item)) === normalise(key));
  return typeof value === "string" && normalise(value) === normalise(key);
}

/**
 * Price a service for the options given.
 *
 * `options` is the model's reading of what the customer asked for (a tier
 * key or label, extras). `answers` is the intake answers; a tier can arrive
 * through either, because a lawn size is often an intake question.
 */
export function quoteService(
  service: PriceableService,
  input: { options?: OptionMap; answers?: OptionMap } = {},
): QuoteOutcome {
  const config = asConfig(service.pricingConfig);
  const options = input.options ?? {};
  const answers = input.answers ?? {};
  const values = suppliedValues(options, answers);

  if (service.pricingType === "quote_only") {
    return {
      ok: true,
      quote: {
        pricingType: "quote_only",
        totalCents: null,
        from: false,
        ownerWillQuote: true,
        tierKey: null,
        tierLabel: null,
        lines: [],
      },
    };
  }

  let baseCents: number | null = null;
  let tierKey: string | null = null;
  let tierLabel: string | null = null;

  if (service.pricingType === "tiered") {
    if (config.tiers.length === 0) {
      return { ok: false, message: "this service has no prices configured yet" };
    }
    const tier = config.tiers.find(
      (candidate) =>
        values.some((value) => normalise(value) === normalise(candidate.key)) ||
        values.some((value) => normalise(value) === normalise(candidate.label)),
    );
    if (!tier) {
      return {
        ok: false,
        message: `ask the customer which ${config.tierLabel ?? "option"} they need: ${config.tiers
          .map((t) => t.label)
          .join(", ")}`,
        details: {
          needOption: config.tierLabel ?? "option",
          choices: config.tiers.map((t) => ({ key: t.key, label: t.label, priceCents: t.priceCents })),
        },
      };
    }
    baseCents = tier.priceCents;
    tierKey = tier.key;
    tierLabel = tier.label;
  } else if (service.pricingType === "fixed" || service.pricingType === "from") {
    if (service.priceCents == null) {
      return { ok: false, message: "this service has no price configured yet" };
    }
    baseCents = service.priceCents;
  } else {
    return { ok: false, message: `unsupported pricing type: ${service.pricingType}` };
  }

  const lines: QuoteLine[] = [
    { label: tierLabel ?? "Service", priceCents: baseCents },
  ];
  let total = baseCents;

  for (const extra of config.extras) {
    const chosen =
      (extra.key in options && isChosen(options[extra.key])) ||
      (extra.label in options && isChosen(options[extra.label])) ||
      includesExtra(options.extras, extra.key) ||
      includesExtra(options.addons, extra.key);
    if (chosen) {
      lines.push({ label: extra.label, priceCents: extra.priceCents });
      total += extra.priceCents;
    }
  }

  return {
    ok: true,
    quote: {
      pricingType: service.pricingType,
      totalCents: total,
      from: service.pricingType === "from",
      ownerWillQuote: false,
      tierKey,
      tierLabel,
      lines,
    },
  };
}
