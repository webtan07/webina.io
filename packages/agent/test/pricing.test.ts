/**
 * Pricing: the model never does arithmetic, so this is where a price is
 * decided. All four pricing types, plus tiers and add-ons.
 */

import { describe, expect, it } from "vitest";

import { quoteService } from "../src/pricing";

const tiered = {
  pricingType: "tiered",
  priceCents: null,
  pricingConfig: {
    tierLabel: "Lawn size",
    tiers: [
      { key: "small", label: "Small (under 200 m²)", priceCents: 4_500 },
      { key: "medium", label: "Medium (200–500 m²)", priceCents: 6_500 },
      { key: "large", label: "Large (over 500 m²)", priceCents: 9_000 },
    ],
    extras: [{ key: "green_waste", label: "Green waste removal", priceCents: 1_500 }],
  },
};

describe("get_quote pricing", () => {
  it("prices a fixed service", () => {
    const out = quoteService({ pricingType: "fixed", priceCents: 12_000, pricingConfig: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quote.totalCents).toBe(12_000);
    expect(out.quote.from).toBe(false);
    expect(out.quote.lines).toEqual([{ label: "Service", priceCents: 12_000 }]);
  });

  it("prices a tiered service by tier key", () => {
    const out = quoteService(tiered, { options: { lawnSize: "medium" } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quote.totalCents).toBe(6_500);
    expect(out.quote.tierKey).toBe("medium");
    expect(out.quote.tierLabel).toBe("Medium (200–500 m²)");
  });

  it("prices a tiered service when the tier arrives as the label or as an answer", () => {
    const byLabel = quoteService(tiered, { options: { lawnSize: "Large (over 500 m²)" } });
    expect(byLabel.ok && byLabel.quote.totalCents).toBe(9_000);

    const byAnswer = quoteService(tiered, { answers: { how_big: "small" } });
    expect(byAnswer.ok && byAnswer.quote.totalCents).toBe(4_500);
  });

  it("adds a chosen extra to the tier price", () => {
    const out = quoteService(tiered, { options: { lawnSize: "small", green_waste: true } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quote.totalCents).toBe(6_000);
    expect(out.quote.lines).toHaveLength(2);
  });

  it("ignores an extra the customer said no to", () => {
    const out = quoteService(tiered, { options: { lawnSize: "small", green_waste: "no" } });
    expect(out.ok && out.quote.totalCents).toBe(4_500);
  });

  it("asks which tier when none is given, and never guesses one", () => {
    const out = quoteService(tiered, { options: {} });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/which lawn size/i);
    expect(out.details?.choices).toHaveLength(3);
  });

  it("rejects a tier that does not exist rather than rounding to the nearest", () => {
    const out = quoteService(tiered, { options: { lawnSize: "enormous" } });
    expect(out.ok).toBe(false);
  });

  it("prices a 'from' service as a starting price", () => {
    const out = quoteService({ pricingType: "from", priceCents: 15_000, pricingConfig: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quote.totalCents).toBe(15_000);
    expect(out.quote.from).toBe(true);
  });

  it("returns 'the owner will quote' for a quote-only service, with no number", () => {
    const out = quoteService({ pricingType: "quote_only", priceCents: null, pricingConfig: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quote.totalCents).toBeNull();
    expect(out.quote.ownerWillQuote).toBe(true);
    expect(out.quote.lines).toEqual([]);
  });

  it("refuses to price a service with no configuration instead of returning zero", () => {
    const out = quoteService({ pricingType: "fixed", priceCents: null, pricingConfig: {} });
    expect(out.ok).toBe(false);
  });
});
