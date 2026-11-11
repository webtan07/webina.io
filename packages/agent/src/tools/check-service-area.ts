import { z } from "zod";

import { getServiceArea } from "@webina/db";

import { checkArea } from "../area";
import { toolError, toolOk, type ToolSpec } from "./types";
import { zodIssues } from "./shared";

const input = z
  .object({
    address: z.string().trim().max(300).optional(),
    suburb: z.string().trim().max(80).optional(),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "an Australian postcode is four digits")
      .optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.address || value.suburb || value.postcode) ||
      (value.lat !== undefined && value.lng !== undefined),
    { message: "give me the customer's suburb, postcode or address" },
  );

/**
 * "Do you come to me?" — answered from the tenant's own area configuration,
 * and answered honestly: an unrecognisable address asks for a suburb rather
 * than guessing.
 */
export const checkServiceAreaTool: ToolSpec = {
  name: "check_service_area",
  description:
    "Check whether the business services the customer's location. Call this before offering a time. If it asks for a suburb or postcode, ask the customer for one.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "I need the customer's suburb or postcode", {
        issues: zodIssues(parsed.error),
      });
    }

    const area = await getServiceArea(ctx.businessId);
    const verdict = checkArea(area, parsed.data);

    if (!verdict.determined) {
      return toolError("invalid_input", verdict.reason);
    }
    if (!verdict.inArea) {
      return toolError("out_of_area", verdict.reason, { matched: verdict.matched });
    }
    return toolOk({
      inArea: true,
      matched: verdict.matched,
      areaType: area.type,
      message: verdict.reason,
    });
  },
};
