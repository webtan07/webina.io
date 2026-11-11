import { z } from "zod";

import { listServices } from "@webina/db";
import { formatAud } from "@webina/shared";

import { toolError, toolOk, type ToolSpec } from "./types";
import { zodIssues } from "./shared";

const input = z.object({});

/**
 * Everything the assistant is allowed to say about the catalogue. Prices are
 * formatted here, in code, so the model is reading a number rather than
 * producing one.
 */
export const listServicesTool: ToolSpec = {
  name: "list_services",
  description:
    "List the services this business offers, with their prices, durations, booking type and the questions the customer must answer. Call this before quoting anything.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "that request did not make sense", {
        issues: zodIssues(parsed.error),
      });
    }

    const services = await listServices(ctx.businessId, { activeOnly: true });
    return toolOk({
      count: services.length,
      services: services.map((service) => {
        const config = service.pricingConfig as {
          tierLabel?: string;
          tiers?: { key: string; label: string; priceCents: number }[];
          extras?: { key: string; label: string; priceCents: number }[];
        };
        return {
          id: service.id,
          name: service.name,
          description: service.description,
          pricingType: service.pricingType,
          priceCents: service.priceCents,
          priceLabel: service.priceCents == null ? null : formatAud(service.priceCents),
          fromPrice: service.pricingType === "from",
          tierLabel: config.tierLabel ?? null,
          tiers: (config.tiers ?? []).map((tier) => ({
            key: tier.key,
            label: tier.label,
            priceCents: tier.priceCents,
            priceLabel: formatAud(tier.priceCents),
          })),
          extras: (config.extras ?? []).map((extra) => ({
            key: extra.key,
            label: extra.label,
            priceCents: extra.priceCents,
            priceLabel: formatAud(extra.priceCents),
          })),
          durationMinutes: service.durationMinutes,
          schedulingType: service.schedulingType,
          bookableOnline: service.schedulingType === "time_slot",
          intakeQuestions: (service.intakeFields as { key: string; question: string; type: string; required: boolean; options: string[] }[]).map(
            (field) => ({
              key: field.key,
              question: field.question,
              type: field.type,
              required: field.required,
              options: field.options,
            }),
          ),
        };
      }),
    });
  },
};
