import { z } from "zod";

import {
  NotFoundError,
  createHandoff,
  getConversation,
  queueOwnerNotification,
  setConversationStatus,
} from "@webina/db";

import { zodIssues } from "./shared";
import { toolError, toolOk, type ToolSpec } from "./types";

const input = z.object({
  reason: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(3, "the owner needs a summary").max(600),
});

/**
 * Hand the conversation to the human.
 *
 * The owner is told once per conversation, however many times the model calls
 * this: a duplicate handoff updates nothing and sends nothing twice. That is
 * the rate limit, expressed as a fact rather than a timer.
 */
export const handoffToOwnerTool: ToolSpec = {
  name: "handoff_to_owner",
  description:
    "Stop and hand the conversation to the business owner when the request is custom, the customer is upset or asks for a person, the answer is not in the configuration, or you are unsure. Include a clear summary.",
  inputSchema: z.toJSONSchema(input) as Record<string, unknown>,
  handler: async (raw, ctx) => {
    const parsed = input.safeParse(raw ?? {});
    if (!parsed.success) {
      return toolError("invalid_input", "I need a reason and a summary for the owner", {
        issues: zodIssues(parsed.error),
      });
    }

    if (!ctx.conversationId) {
      return toolError("tool_failed", "there is no conversation to hand over");
    }

    try {
      const conversation = await getConversation(ctx.businessId, ctx.conversationId);
      if (conversation.status === "handed_off") {
        return toolOk({
          handedOff: true,
          alreadyHandedOff: true,
          summary: parsed.data.summary,
          message: "The owner has already been told about this conversation.",
        });
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        return toolError("not_found", "I could not find this conversation");
      }
      throw error;
    }

    const handoff = await createHandoff(ctx.businessId, {
      conversationId: ctx.conversationId,
      reason: parsed.data.reason,
      summary: parsed.data.summary,
    });
    await setConversationStatus(ctx.businessId, ctx.conversationId, "handed_off");

    await queueOwnerNotification(ctx.businessId, {
      kind: "handoff",
      dedupeKey: `handoff:${ctx.conversationId}`,
      payload: { handoffId: handoff.id, reason: parsed.data.reason, channel: ctx.channel },
    });

    return toolOk({
      handoffId: handoff.id,
      handedOff: true,
      alreadyHandedOff: false,
      reason: handoff.reason,
      summary: handoff.summary,
      message: "The owner has been told and will reply soon.",
    });
  },
};
