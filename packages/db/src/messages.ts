/**
 * Conversation transcript and usage records.
 *
 * A transcript is stored exactly as the model saw it: full content blocks,
 * tool_use and tool_result included, one row per turn. The agent loop trims
 * what it *sends* to the model, never what it keeps — the audit trail stays
 * whole so a handoff summary and a support review can read the real history.
 *
 * Every function is tenant-scoped through `withTenant`, so a conversation id
 * from another business reads as "no rows", not as somebody else's chat.
 */

import { and, count, desc, eq } from "drizzle-orm";

import { generateCustomerRef } from "@webina/shared";

import { conversations, messages, usageEvents } from "./schema";
import { withTenant } from "./tenant";

export type MessageRole = "user" | "assistant";

export interface ConversationHandle {
  id: string;
  customerRef: string;
  status: string;
}

/**
 * Start a conversation. The handle returned is the one the widget keeps: a
 * `cref_…` string, scoped to this tenant, not the row id.
 */
export async function createConversation(
  businessId: string,
  input: { channel?: string; customerRef?: string } = {},
): Promise<ConversationHandle> {
  const customerRef = input.customerRef ?? generateCustomerRef();
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        businessId,
        channel: input.channel ?? "web",
        customerRef,
        status: "active",
      })
      .returning({
        id: conversations.id,
        customerRef: conversations.customerRef,
        status: conversations.status,
      });
    if (!row) throw new Error("conversation row was not created");
    return row;
  });
}

/**
 * Find a conversation by the handle the widget sent back. Tenant-scoped, so a
 * handle from another business reads as "no rows" and the caller starts a new
 * conversation rather than opening somebody else's.
 */
export async function findConversationByCustomerRef(
  businessId: string,
  customerRef: string,
): Promise<ConversationHandle | null> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select({
        id: conversations.id,
        customerRef: conversations.customerRef,
        status: conversations.status,
      })
      .from(conversations)
      .where(
        and(eq(conversations.businessId, businessId), eq(conversations.customerRef, customerRef)),
      )
      .orderBy(desc(conversations.startedAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface MessageRecord {
  id: string;
  role: MessageRole;
  content: unknown[];
  createdAt: Date;
}

/** Append one turn. Bumps the conversation's `last_message_at` in the same transaction. */
export async function appendMessage(
  businessId: string,
  conversationId: string,
  role: MessageRole,
  content: unknown[],
): Promise<string> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({ businessId, conversationId, role, content })
      .returning({ id: messages.id });
    if (!row) throw new Error("message row was not created");
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId)));
    return row.id;
  });
}

/**
 * The most recent `limit` turns, oldest first — the order the model expects.
 * Newest-first at the database, reversed here, so trimming drops the oldest
 * turns rather than the newest.
 */
export async function listMessages(
  businessId: string,
  conversationId: string,
  limit = 60,
): Promise<MessageRecord[]> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(eq(messages.businessId, businessId), eq(messages.conversationId, conversationId)),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit),
  );
  return rows
    .map((row) => ({
      id: row.id,
      role: row.role as MessageRole,
      content: row.content,
      createdAt: row.createdAt,
    }))
    .reverse();
}

/** How many times the assistant has spoken — the per-conversation call cap. */
export async function countAssistantMessages(
  businessId: string,
  conversationId: string,
): Promise<number> {
  const rows = await withTenant(businessId, async (tx) =>
    tx
      .select({ total: count() })
      .from(messages)
      .where(
        and(
          eq(messages.businessId, businessId),
          eq(messages.conversationId, conversationId),
          eq(messages.role, "assistant"),
        ),
      ),
  );
  return Number(rows[0]?.total ?? 0);
}

export interface UsageEventInput {
  type: "conversation" | "ai_call" | "sms" | "whatsapp";
  quantity?: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costEstimateCents?: number | null;
}

/** One row per billable thing. Cost estimation belongs to the billing milestone. */
export async function recordUsageEvent(
  businessId: string,
  input: UsageEventInput,
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    await tx.insert(usageEvents).values({
      businessId,
      type: input.type,
      quantity: input.quantity ?? 1,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      costEstimateCents: input.costEstimateCents ?? null,
    });
  });
}

/** Newest first, for the dashboard and the weekly summary later. */
export async function listUsageEvents(businessId: string, limit = 100) {
  return withTenant(businessId, async (tx) =>
    tx
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.businessId, businessId))
      .orderBy(desc(usageEvents.createdAt))
      .limit(limit),
  );
}
