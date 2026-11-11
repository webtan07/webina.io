/**
 * The agent loop.
 *
 * One customer message in, one reply out, with the model allowed to call tools
 * in between. The rules this file enforces, in order of importance:
 *
 * - **Every `tool_use` gets a `tool_result`**, in the same turn, matched by id.
 *   The model cannot leave a tool call unanswered, and neither can we.
 * - **A handoff ends the model's involvement.** Once the handoff tool has
 *   succeeded the conversation is the owner's; the customer gets a fixed reply
 *   and no further model call happens in that run or in later runs.
 * - **Failure is boring.** One retry, then a fixed fallback reply and an owner
 *   notification. The customer never sees an error, a stack trace or a raw
 *   provider message.
 * - **Caps are real.** Steps, tokens per run, calls per conversation, output
 *   size and the two kill switches are checked here, not asked of the model.
 */

import {
  AgentConfigError,
  resolveAgentConfig,
  type AgentConfig,
} from "./config";
import { hasNoOrphanToolResults, trimHistory } from "./history";
import {
  ModelRequestFailed,
  isToolUseBlock,
  textOf,
  type ContentBlock,
  type ModelClient,
  type ModelMessage,
  type ModelUsage,
  type ToolResultBlock,
} from "./model";
import { buildSystemPrompt } from "./prompt";
import { dbAgentStore, type AgentStore, type Channel } from "./store";
import { runTool, type ToolResult } from "./tools";

/** Shown when something went wrong. Deliberately says nothing about what. */
export const FALLBACK_REPLY =
  "Sorry, I'm having trouble with that right now. I've let the team know and they'll get back to you shortly.";

/** Shown once a conversation has been handed over. */
export const HANDOFF_REPLY =
  "Thanks — I've passed this to the team, and they'll get back to you shortly.";

/** Shown when the assistant is switched off for this tenant or globally. */
export const DISABLED_REPLY =
  "Thanks for your message. Our assistant is offline at the moment, so the team will reply as soon as they can.";

/** Shown when a cap is reached mid-conversation. */
export const LIMIT_REPLY =
  "Thanks for your patience. I've passed this to the team and someone will get back to you shortly.";

export interface RunAgentInput {
  businessId: string;
  conversationId: string;
  channel: Channel;
  userText: string;
}

export type RunStatus = "replied" | "handed_off" | "fallback" | "disabled" | "capped";

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  error: string | null;
}

export interface RunAgentResult {
  reply: string;
  status: RunStatus;
  toolsCalled: ToolCallRecord[];
  usage: ModelUsage;
  steps: number;
  durationMs: number;
}

export interface AgentLogger {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
}

export interface AgentDeps {
  model: ModelClient;
  store?: AgentStore;
  /** Injected by tests; production runs the real handlers. */
  executeTool?: (name: string, input: unknown, ctx: ToolContextLike) => Promise<ToolResult>;
  config?: Partial<AgentConfig>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  logger?: AgentLogger;
}

interface ToolContextLike {
  businessId: string;
  conversationId: string;
  channel: Channel;
}

const silentLogger: AgentLogger = { info: () => undefined, error: () => undefined };

/**
 * Structured, PII-free logging: ids, counts, tool names and timings only. Never
 * the customer's words, an address or a phone number.
 */
const consoleLogger: AgentLogger = {
  info(event) {
    console.log(JSON.stringify({ level: "info", component: "agent", ...event }));
  },
  error(event) {
    console.error(JSON.stringify({ level: "error", component: "agent", ...event }));
  },
};

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One retry with backoff, then let the caller fall back. */
async function completeWithRetry(
  model: ModelClient,
  request: Parameters<ModelClient["complete"]>[0],
  config: AgentConfig,
  sleep: (ms: number) => Promise<void>,
) {
  try {
    return await model.complete(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "model call failed";
    if (config.retryBackoffMs > 0) await sleep(config.retryBackoffMs);
    try {
      return await model.complete(request);
    } catch (second) {
      const detail = second instanceof Error ? second.message : reason;
      throw new ModelRequestFailed(detail, second instanceof ModelRequestFailed ? second.status : null);
    }
  }
}

/** Tool output is data for the model, and it is capped so one big result cannot fill the window. */
function toToolResultBlock(
  toolUseId: string,
  result: ToolResult,
  maxChars: number,
): ToolResultBlock {
  let body: string;
  try {
    body = JSON.stringify(result);
  } catch {
    body = JSON.stringify({ ok: false, error: "tool_failed", message: "unreadable result" });
  }
  const content =
    body.length > maxChars ? `${body.slice(0, maxChars)}…[truncated]` : body;
  return { type: "tool_result", tool_use_id: toolUseId, content, is_error: !result.ok };
}

function userTextBlocks(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

/**
 * Run one customer message through the assistant.
 *
 * Never throws: a failure at any point becomes a fallback reply plus an owner
 * notification, because the widget needs an answer it can show.
 */
export async function runAgent(input: RunAgentInput, deps: AgentDeps): Promise<RunAgentResult> {
  const startedAt = Date.now();
  const store = deps.store ?? dbAgentStore;
  const logger = deps.logger ?? (deps.store ? silentLogger : consoleLogger);
  const sleep = deps.sleep ?? sleepFor;
  const now = deps.now ?? (() => new Date());
  const toolsCalled: ToolCallRecord[] = [];
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  let steps = 0;

  const finish = (reply: string, status: RunStatus): RunAgentResult => {
    const result: RunAgentResult = {
      reply,
      status,
      toolsCalled,
      usage,
      steps,
      durationMs: Date.now() - startedAt,
    };
    logger.info({
      event: "agent_run",
      businessId: input.businessId,
      conversationId: input.conversationId,
      channel: input.channel,
      status,
      steps,
      tools: toolsCalled.map((call) => `${call.name}:${call.ok ? "ok" : call.error ?? "error"}`),
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      durationMs: result.durationMs,
    });
    return result;
  };

  /** Store the customer's message, tell the owner, and reply safely. */
  const stopWithoutModel = async (
    status: RunStatus,
    reply: string,
    kind: string,
  ): Promise<RunAgentResult> => {
    try {
      await store.appendMessage(
        input.businessId,
        input.conversationId,
        "user",
        userTextBlocks(input.userText),
      );
      await store.notifyOwner(input.businessId, {
        kind,
        dedupeKey: `${kind}:${input.conversationId}`,
        payload: { conversationId: input.conversationId, channel: input.channel },
      });
    } catch (error) {
      logger.error({
        event: "agent_store_failed",
        businessId: input.businessId,
        conversationId: input.conversationId,
        detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    }
    return finish(reply, status);
  };

  /** Best effort: a failed notification must never turn a fallback into a crash. */
  const notifyFallback = async (kind: string): Promise<void> => {
    try {
      await store.notifyOwner(input.businessId, {
        kind,
        dedupeKey: `${kind}:${input.conversationId}`,
        payload: { conversationId: input.conversationId, channel: input.channel },
      });
    } catch {
      // Ignored on purpose — see above.
    }
  };

  /** Give the conversation to the owner, and tell them why. */
  const handOver = async (kind: string): Promise<void> => {
    try {
      await store.setConversationStatus(input.businessId, input.conversationId, "handed_off");
    } catch {
      // The notification below is what the owner actually sees.
    }
    await notifyFallback(kind);
  };

  let config: AgentConfig;
  try {
    config = resolveAgentConfig(deps.config);
  } catch (error) {
    logger.error({
      event: "agent_config_invalid",
      businessId: input.businessId,
      detail: error instanceof AgentConfigError ? error.message : "invalid config",
    });
    return stopWithoutModel("fallback", FALLBACK_REPLY, "agent_misconfigured");
  }

  // Global kill switch: no model call at all, for any tenant.
  if (!config.enabled) {
    return stopWithoutModel("disabled", DISABLED_REPLY, "agent_disabled");
  }

  let tenant;
  try {
    tenant = await store.loadTenant(input.businessId);
  } catch (error) {
    logger.error({
      event: "agent_tenant_load_failed",
      businessId: input.businessId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return stopWithoutModel("fallback", FALLBACK_REPLY, "agent_failed");
  }

  // Per-tenant kill switch.
  if (!tenant.profile.botEnabled) {
    return stopWithoutModel("disabled", DISABLED_REPLY, "bot_disabled");
  }

  // The conversation may already belong to the owner. Then the model is not
  // consulted at all: store the message and let the owner read it.
  let conversationStatus;
  try {
    conversationStatus = await store.getConversationStatus(
      input.businessId,
      input.conversationId,
    );
  } catch (error) {
    logger.error({
      event: "agent_conversation_load_failed",
      businessId: input.businessId,
      conversationId: input.conversationId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return stopWithoutModel("fallback", FALLBACK_REPLY, "agent_failed");
  }

  if (conversationStatus === "handed_off") {
    return stopWithoutModel("handed_off", HANDOFF_REPLY, "message_after_handoff");
  }

  try {
    await store.appendMessage(
      input.businessId,
      input.conversationId,
      "user",
      userTextBlocks(input.userText),
    );
  } catch (error) {
    logger.error({
      event: "agent_store_failed",
      businessId: input.businessId,
      conversationId: input.conversationId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    await notifyFallback("agent_failed");
    return finish(FALLBACK_REPLY, "fallback");
  }

  // Per-conversation call cap, checked before we spend anything.
  let assistantTurns: number;
  try {
    assistantTurns = await store.countAssistantMessages(input.businessId, input.conversationId);
  } catch {
    assistantTurns = 0;
  }
  if (assistantTurns >= config.maxCallsPerConversation) {
    await handOver("conversation_limit");
    return finish(LIMIT_REPLY, "capped");
  }

  let system: ReturnType<typeof buildSystemPrompt>;
  try {
    system = buildSystemPrompt({
      tenant: {
        businessName: tenant.profile.name,
        assistantName: tenant.profile.assistantName,
        trade: tenant.profile.tradeTemplate,
        tone: tenant.profile.tone,
        timezone: tenant.profile.timezone,
        businessRules: tenant.profile.businessRules,
      },
      catalogue: { services: tenant.services, area: tenant.area, rules: tenant.rules },
      now: now(),
    });
  } catch (error) {
    logger.error({
      event: "agent_prompt_failed",
      businessId: input.businessId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    await notifyFallback("agent_failed");
    return finish(FALLBACK_REPLY, "fallback");
  }

  const toolCtx: ToolContextLike = {
    businessId: input.businessId,
    conversationId: input.conversationId,
    channel: input.channel,
  };
  const executeTool = deps.executeTool ?? ((name, raw, ctx) => runTool(name, raw, ctx));

  let history: ModelMessage[];
  try {
    history = trimHistory(
      await store.listMessages(input.businessId, input.conversationId, config.historyLimit * 2),
      config.historyLimit,
    );
  } catch (error) {
    logger.error({
      event: "agent_history_load_failed",
      businessId: input.businessId,
      conversationId: input.conversationId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return finish(FALLBACK_REPLY, "fallback");
  }

  // A stored transcript that does not satisfy the API's pairing rules would be
  // rejected whole. Trim again rather than send it.
  if (!hasNoOrphanToolResults(history)) {
    history = trimHistory(history, Math.max(0, history.length - 1));
  }

  for (let step = 1; step <= config.maxSteps; step += 1) {
    steps = step;

    let response;
    try {
      response = await completeWithRetry(
        deps.model,
        {
          system: system.text,
          messages: history,
          tools: tenant.tools,
          maxTokens: config.maxTokens,
          model: config.model,
        },
        config,
        sleep,
      );
    } catch (error) {
      logger.error({
        event: "agent_model_failed",
        businessId: input.businessId,
        conversationId: input.conversationId,
        step,
        status: error instanceof ModelRequestFailed ? error.status : null,
      });
      await notifyFallback("agent_failed");
      return finish(FALLBACK_REPLY, "fallback");
    }

    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    try {
      await store.recordUsage(input.businessId, {
        tokensIn: response.usage.inputTokens,
        tokensOut: response.usage.outputTokens,
      });
    } catch {
      // Usage accounting is not worth failing a customer's message over.
    }

    if (response.content.length === 0) {
      // A model turn with neither text nor a tool call is a dead end.
      await notifyFallback("agent_empty_reply");
      return finish(FALLBACK_REPLY, "fallback");
    }

    const content = response.content;
    try {
      await store.appendMessage(
        input.businessId,
        input.conversationId,
        "assistant",
        response.content,
      );
    } catch {
      // Continue: the customer still gets an answer.
    }
    history = [...history, { role: "assistant", content }];

    if (usage.inputTokens + usage.outputTokens > config.maxTokensPerRun) {
      logger.error({
        event: "agent_token_cap",
        businessId: input.businessId,
        conversationId: input.conversationId,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
      });
      await handOver("token_cap");
      return finish(LIMIT_REPLY, "capped");
    }

    const toolUses = content.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      const text = textOf(content);
      if (text === "") {
        // A model turn with neither text nor a tool call is a dead end.
        await notifyFallback("agent_empty_reply");
        return finish(FALLBACK_REPLY, "fallback");
      }
      return finish(text, "replied");
    }

    // Every tool_use is executed and answered — in order, one result each.
    const results: ToolResultBlock[] = [];
    let handedOff = false;
    for (const toolUse of toolUses) {
      let result: ToolResult;
      try {
        result = await executeTool(toolUse.name, toolUse.input, toolCtx);
      } catch (error) {
        // A handler that throws is still a tool_use that must be answered.
        logger.error({
          event: "agent_tool_threw",
          businessId: input.businessId,
          conversationId: input.conversationId,
          tool: toolUse.name,
          detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        });
        result = {
          ok: false,
          error: "tool_failed",
          message: "I could not complete that just now",
        };
      }
      toolsCalled.push({
        name: toolUse.name,
        ok: result.ok,
        error: result.ok ? null : result.error,
      });
      if (toolUse.name === "handoff_to_owner" && result.ok) handedOff = true;
      results.push(toToolResultBlock(toolUse.id, result, config.maxToolOutputChars));
    }

    try {
      await store.appendMessage(input.businessId, input.conversationId, "user", results);
    } catch {
      // The transcript is best effort from here; the reply is not.
    }
    history = [...history, { role: "user", content: results }];

    if (handedOff) {
      // The owner owns the conversation now. Say so once, deterministically,
      // rather than asking the model for a goodbye.
      try {
        await store.setConversationStatus(input.businessId, input.conversationId, "handed_off");
      } catch {
        // The tool handler already did this in production; best effort here.
      }
      const reply: ContentBlock[] = [{ type: "text", text: HANDOFF_REPLY }];
      try {
        await store.appendMessage(input.businessId, input.conversationId, "assistant", reply);
      } catch {
        // Best effort.
      }
      return finish(HANDOFF_REPLY, "handed_off");
    }
  }

  // The model kept calling tools without ever answering. Stop it and hand over.
  logger.error({
    event: "agent_step_cap",
    businessId: input.businessId,
    conversationId: input.conversationId,
    steps,
  });
  await handOver("agent_step_cap");
  return finish(LIMIT_REPLY, "capped");
}
