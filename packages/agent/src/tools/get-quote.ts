import { z } from "zod";

import { formatAud } from "@webina/shared";

import { quoteService } from "../pricing";
import { loadService, zodIssues } from "./shared";
import { toolError, toolOk, type ToolSpec } from "./types";

const input = z.object({
  serviceId: z.string().uuid("serviceId must be a uuid"),
  /** What the customer chose, e.g. { lawnSize: "medium" } or { extras: ["wax"] }. */
  options: z.record(z.string(), z.unknown()).optional(),
  /** Intake answers, in case a tier was given as an answer. */
  answers: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The only place a price is calculated. `quote_only` comes back as "the owner
 * will quote", never as an invented number.
 */
export const getQuoteTool: ToolSpec = {
  name: "get_quote",
  description:
    "Get the exact price of one service, including any size tier or add-ons the customer chose. Quote the figure it returns; never estimate a price yourself.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "that request did not make sense", {
        issues: zodIssues(parsed.error),
      });
    }

    const loaded = await loadService(ctx.businessId, parsed.data.serviceId);
    if (!loaded.ok) return loaded.result;
    const service = loaded.service;

    const priced = quoteService(service, {
      options: parsed.data.options,
      answers: parsed.data.answers,
    });
    if (!priced.ok) {
      return toolError("invalid_input", priced.message, priced.details);
    }
    const quote = priced.quote;

    if (quote.ownerWillQuote) {
      return toolOk({
        serviceId: service.id,
        serviceName: service.name,
        pricingType: quote.pricingType,
        totalCents: null,
        priceLabel: null,
        fromPrice: false,
        ownerWillQuote: true,
        lines: [],
        summary: `${service.name}: the owner will quote after seeing the details.`,
      });
    }

    const total = quote.totalCents ?? 0;
    const label = formatAud(total);
    return toolOk({
      serviceId: service.id,
      serviceName: service.name,
      pricingType: quote.pricingType,
      totalCents: total,
      priceLabel: label,
      fromPrice: quote.from,
      ownerWillQuote: false,
      tierKey: quote.tierKey,
      tierLabel: quote.tierLabel,
      lines: quote.lines.map((line) => ({
        label: line.label,
        priceCents: line.priceCents,
        priceLabel: formatAud(line.priceCents),
      })),
      summary: quote.from ? `${service.name}: from ${label}` : `${service.name}: ${label}`,
    });
  },
};
