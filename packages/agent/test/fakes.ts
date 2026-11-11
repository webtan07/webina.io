/**
 * Test doubles for the agent loop.
 *
 * The model is a script: each step is either a response or an error to throw,
 * and every request is recorded so a test can assert on what the loop sent
 * (history trimming, tool pairing) as well as what it returned.
 *
 * The store is in memory. It is deliberately *not* the database: these tests
 * are about loop mechanics, and they must run without a key and without a
 * connection.
 */

import type {
  AgentStore,
  ConversationStatus,
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolDef,
  OwnerNotification,
  TenantContext,
} from "../src";
import type { ContentBlock } from "../src/model";

export type ScriptStep = ModelResponse | Error | ((request: ModelRequest) => ModelResponse);

export interface ScriptedModel extends ModelClient {
  requests: ModelRequest[];
}

export function scriptedModel(...steps: ScriptStep[]): ScriptedModel {
  const requests: ModelRequest[] = [];
  let index = 0;
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const step = steps[index];
      index += 1;
      if (step === undefined) {
        throw new Error("the model was called more times than the script allows");
      }
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(request) : step;
    },
  };
}

export function textResponse(
  text: string,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): ModelResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens: usage.inputTokens ?? 100, outputTokens: usage.outputTokens ?? 20 },
  };
}

export function toolUseResponse(
  calls: { id: string; name: string; input?: unknown }[],
  options: { text?: string; usage?: { inputTokens?: number; outputTokens?: number } } = {},
): ModelResponse {
  const content: ContentBlock[] = [];
  if (options.text) content.push({ type: "text", text: options.text });
  for (const call of calls) {
    content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
  }
  return {
    content,
    stopReason: "tool_use",
    usage: {
      inputTokens: options.usage?.inputTokens ?? 100,
      outputTokens: options.usage?.outputTokens ?? 20,
    },
  };
}

export const TOOL_DEFS: ModelToolDef[] = [
  { name: "list_services", description: "list", input_schema: { type: "object" } },
  { name: "get_quote", description: "quote", input_schema: { type: "object" } },
  { name: "check_service_area", description: "area", input_schema: { type: "object" } },
  { name: "check_availability", description: "slots", input_schema: { type: "object" } },
  { name: "create_booking", description: "book", input_schema: { type: "object" } },
  { name: "create_job_request", description: "request", input_schema: { type: "object" } },
  { name: "handoff_to_owner", description: "handoff", input_schema: { type: "object" } },
];

export function defaultTenant(overrides: Partial<TenantContext> = {}): TenantContext {
  const profile = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Adelaide Car Care",
    timezone: "Australia/Adelaide",
    assistantName: "Webina",
    greeting: null,
    tone: "friendly and brief",
    businessRules: "We do not work on Sundays.",
    tradeTemplate: "car_service",
    status: "active",
    botEnabled: true,
    ownerNotifyEmail: "owner@example.test",
    currency: "AUD",
  };
  const base: TenantContext = {
    profile,
    services: [],
    area: {
      type: "suburb_list",
      values: ["Norwood", "Kent Town"],
      centerLat: null,
      centerLng: null,
      radiusKm: null,
    },
    rules: [],
    plan: "front_desk",
    tools: TOOL_DEFS,
  };
  return { ...base, ...overrides, profile: { ...base.profile, ...(overrides.profile ?? {}) } };
}

export interface MemoryStore extends AgentStore {
  transcript: { role: "user" | "assistant"; content: ContentBlock[] }[];
  status: ConversationStatus;
  notifications: OwnerNotification[];
  usage: { tokensIn: number; tokensOut: number }[];
  tenant: TenantContext;
}

export function memoryStore(
  options: {
    tenant?: Partial<TenantContext>;
    status?: ConversationStatus;
    transcript?: ModelMessage[];
    assistantTurns?: number;
  } = {},
): MemoryStore {
  const store: MemoryStore = {
    transcript: [...(options.transcript ?? [])],
    status: options.status ?? "active",
    notifications: [],
    usage: [],
    tenant: defaultTenant(options.tenant),
    async loadTenant() {
      return store.tenant;
    },
    async getConversationStatus() {
      return store.status;
    },
    async appendMessage(_businessId, _conversationId, role, content) {
      store.transcript.push({ role, content: [...content] });
    },
    async listMessages(_businessId, _conversationId, limit) {
      return store.transcript.slice(Math.max(0, store.transcript.length - limit));
    },
    async countAssistantMessages() {
      if (options.assistantTurns !== undefined) return options.assistantTurns;
      return store.transcript.filter((message) => message.role === "assistant").length;
    },
    async setConversationStatus(_businessId, _conversationId, status) {
      store.status = status;
    },
    async notifyOwner(_businessId, notification) {
      store.notifications.push(notification);
    },
    async recordUsage(_businessId, usage) {
      store.usage.push(usage);
    },
  };
  return store;
}
