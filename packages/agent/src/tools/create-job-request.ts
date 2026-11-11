import { z } from "zod";

import { getServiceArea, insertJobRequestAtomic, queueOwnerNotification } from "@webina/db";
import { normaliseAuPhone } from "@webina/shared";

import { checkArea } from "../area";
import { loadService, zodIssues } from "./shared";
import { toolError, toolOk, type ToolSpec } from "./types";

const input = z.object({
  /** Optional: "something custom" has no catalogue entry. */
  serviceId: z.string().uuid("serviceId must be a uuid").nullable().optional(),
  customerName: z.string().trim().min(2, "I need the customer's name").max(80),
  customerPhone: z.string().trim().min(6, "I need a contact number").max(32),
  customerEmail: z.string().trim().email().max(160).optional(),
  address: z.string().trim().min(3, "I need the address for the job").max(300),
  preferredWindow: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  photos: z.array(z.string().trim().url().max(500)).max(10).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

/**
 * The path for work the owner must price or confirm: quote-only trades, day
 * windows, and "something custom". Nothing is promised here — the owner
 * replies.
 */
export const createJobRequestTool: ToolSpec = {
  name: "create_job_request",
  description:
    "Take a job request when the job needs the owner's price or confirmation (quote-only work, a day window, something custom). Tell the customer the owner will be in touch; do not promise a time.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "I need a few more details to pass this on", {
        issues: zodIssues(parsed.error),
      });
    }
    const input_ = parsed.data;

    const phone = normaliseAuPhone(input_.customerPhone);
    if (!phone) {
      return toolError("invalid_input", "I need an Australian phone number for the customer");
    }

    let serviceName = "Custom job";
    if (input_.serviceId) {
      const loaded = await loadService(ctx.businessId, input_.serviceId);
      if (!loaded.ok) return loaded.result;
      serviceName = loaded.service.name;
    }

    const area = await getServiceArea(ctx.businessId);
    const verdict = checkArea(area, { address: input_.address });
    if (!verdict.determined) {
      return toolError("invalid_input", verdict.reason);
    }
    if (!verdict.inArea) {
      return toolError("out_of_area", verdict.reason, { matched: verdict.matched });
    }

    const { request, replayed } = await insertJobRequestAtomic(ctx.businessId, {
      serviceId: input_.serviceId ?? null,
      customerName: input_.customerName,
      customerPhone: phone,
      customerEmail: input_.customerEmail ?? null,
      address: input_.address,
      requestedDateWindow: input_.preferredWindow ?? null,
      photos: input_.photos ?? [],
      intakeAnswers: input_.answers ?? {},
      conversationId: ctx.conversationId,
      idempotencyKey: input_.idempotencyKey,
    });

    if (!replayed) {
      await queueOwnerNotification(ctx.businessId, {
        kind: "job_request_created",
        dedupeKey: `job_request:${request.id}`,
        payload: {
          jobRequestId: request.id,
          serviceId: input_.serviceId ?? null,
          channel: ctx.channel,
        },
      });
    }

    return toolOk({
      jobRequestId: request.id,
      replayed,
      status: request.status,
      serviceName,
      preferredWindow: request.requestedDateWindow,
      summary: `Job request passed to the owner: ${serviceName}${
        request.requestedDateWindow ? `, prefers ${request.requestedDateWindow}` : ""
      }. The owner will be in touch to confirm the price and time.`,
    });
  },
};
