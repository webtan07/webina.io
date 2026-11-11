/**
 * Everything the loop needs from storage, as one interface.
 *
 * The loop itself never imports the database: it reads a tenant, appends
 * turns, reads the transcript back, counts turns and notifies the owner. That
 * keeps the loop's mechanics testable with an in-memory store, and keeps the
 * one place that touches Postgres auditable — every call there is tenant-scoped
 * through `withTenant`.
 */

import {
  appendMessage,
  countAssistantMessages,
  getBusinessProfile,
  getConversation,
  getServiceArea,
  listAvailabilityRules,
  listMessages,
  listServices,
  queueOwnerNotification,
  recordUsageEvent,
  setConversationStatus,
  type AvailabilityRuleRecord,
  type BusinessProfile,
  type ServiceAreaRecord,
  type ServiceRecord,
} from "@webina/db";
import type { PlanKey } from "@webina/shared";

import { planForBusiness, toolsForPlan } from "./tools";
import type { ContentBlock, ModelMessage, ModelToolDef } from "./model";

export type ConversationStatus = "active" | "handed_off" | "closed";
export type Channel = "web" | "sms" | "whatsapp";

export interface TenantContext {
  profile: BusinessProfile;
  services: ServiceRecord[];
  area: ServiceAreaRecord | null;
  rules: AvailabilityRuleRecord[];
  plan: PlanKey;
  /** The tools this tenant's plan allows — nothing else is offered. */
  tools: ModelToolDef[];
}

export interface OwnerNotification {
  kind: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
}

export interface AgentStore {
  loadTenant(businessId: string): Promise<TenantContext>;
  getConversationStatus(businessId: string, conversationId: string): Promise<ConversationStatus>;
  appendMessage(
    businessId: string,
    conversationId: string,
    role: "user" | "assistant",
    content: ContentBlock[],
  ): Promise<void>;
  /** Newest `limit` turns, oldest first. */
  listMessages(businessId: string, conversationId: string, limit: number): Promise<ModelMessage[]>;
  countAssistantMessages(businessId: string, conversationId: string): Promise<number>;
  setConversationStatus(
    businessId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<void>;
  notifyOwner(businessId: string, notification: OwnerNotification): Promise<void>;
  recordUsage(
    businessId: string,
    usage: { tokensIn: number; tokensOut: number },
  ): Promise<void>;
}

/** The production store: Postgres, behind RLS, one tenant at a time. */
export const dbAgentStore: AgentStore = {
  async loadTenant(businessId) {
    const [profile, services, area, rules, plan] = await Promise.all([
      getBusinessProfile(businessId),
      listServices(businessId, { activeOnly: true }),
      getServiceArea(businessId),
      listAvailabilityRules(businessId),
      planForBusiness(businessId),
    ]);
    return { profile, services, area, rules, plan, tools: toolsForPlan(plan) };
  },

  async getConversationStatus(businessId, conversationId) {
    const conversation = await getConversation(businessId, conversationId);
    const status = conversation.status;
    return status === "handed_off" || status === "closed" ? status : "active";
  },

  async appendMessage(businessId, conversationId, role, content) {
    await appendMessage(businessId, conversationId, role, content);
  },

  async listMessages(businessId, conversationId, limit) {
    const rows = await listMessages(businessId, conversationId, limit);
    return rows.map((row) => ({
      role: row.role,
      content: row.content as ContentBlock[],
    }));
  },

  async countAssistantMessages(businessId, conversationId) {
    return countAssistantMessages(businessId, conversationId);
  },

  async setConversationStatus(businessId, conversationId, status) {
    await setConversationStatus(businessId, conversationId, status);
  },

  async notifyOwner(businessId, notification) {
    await queueOwnerNotification(businessId, notification);
  },

  async recordUsage(businessId, usage) {
    await recordUsageEvent(businessId, {
      type: "ai_call",
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
    });
  },
};
