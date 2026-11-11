import { describe, expect, it } from "vitest";

import {
  FALLBACK_REPLY,
  HANDOFF_REPLY,
  LIMIT_REPLY,
  DISABLED_REPLY,
  runAgent,
  type RunAgentInput,
} from "../src/loop";
import { hasNoOrphanToolResults, isPlainUserText } from "../src/history";
import type { ModelMessage } from "../src/model";
import type { ToolResult } from "../src/tools";
import {
  defaultTenant,
  memoryStore,
  scriptedModel,
  textResponse,
  toolUseResponse,
} from "./fakes";

const input: RunAgentInput = {
  businessId: "11111111-1111-1111-1111-111111111111",
  conversationId: "22222222-2222-2222-2222-222222222222",
  channel: "web",
  userText: "How much to mow my lawn?",
};

/** A config that never touches the environment. */
const config = { model: "test-model", maxSteps: 3, retryBackoffMs: 0 } as const;

const okTool = async (): Promise<ToolResult> => ({
  ok: true,
  data: { services: [{ name: "Lawn mow", priceLabel: "A$90" }] },
});

function toolResultIds(messages: ModelMessage[]): string[] {
  return messages.flatMap((message) =>
    message.content.flatMap((block) => (block.type === "tool_result" ? [block.tool_use_id] : [])),
  );
}

describe("runAgent — plain replies", () => {
  it("returns the model's text and stores both turns", async () => {
    const store = memoryStore();
    const model = scriptedModel(textResponse("A standard mow is A$90."));

    const result = await runAgent(input, { model, store, config });

    expect(result.status).toBe("replied");
    expect(result.reply).toBe("A standard mow is A$90.");
    expect(result.steps).toBe(1);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: input.userText }],
    });
    expect(model.requests[0]?.tools).toHaveLength(defaultTenant().tools.length);
    expect(store.transcript).toHaveLength(2);
    expect(store.transcript[0]?.role).toBe("user");
    expect(store.transcript[1]?.role).toBe("assistant");
    expect(store.usage).toEqual([{ tokensIn: 100, tokensOut: 20 }]);
  });

  it("sends the tenant's own prompt and caps the output", async () => {
    const store = memoryStore({ tenant: { profile: { ...defaultTenant().profile, tone: "dry and short" } } });
    const model = scriptedModel(textResponse("Yes."));

    await runAgent(input, { model, store, config: { ...config, maxTokens: 256 } });

    const request = model.requests[0];
    expect(request?.system).toContain("dry and short");
    expect(request?.system).toContain("Adelaide Car Care");
    expect(request?.maxTokens).toBe(256);
    expect(request?.model).toBe("test-model");
  });
});

describe("runAgent — tool use", () => {
  it("executes a tool and answers it with a matching tool_result", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "list_services" }]),
      textResponse("A standard mow is A$90."),
    );
    const executed: string[] = [];

    const result = await runAgent(input, {
      model,
      store,
      config,
      executeTool: async (name) => {
        executed.push(name);
        return okTool();
      },
    });

    expect(executed).toEqual(["list_services"]);
    expect(result.status).toBe("replied");
    expect(result.toolsCalled).toEqual([{ name: "list_services", ok: true, error: null }]);
    expect(model.requests).toHaveLength(2);
    expect(toolResultIds(model.requests[1]?.messages ?? [])).toEqual(["tu_1"]);
    expect(store.transcript.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(hasNoOrphanToolResults(model.requests[1]?.messages ?? [])).toBe(true);
  });

  it("answers every tool_use when the model asks for several at once", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([
        { id: "tu_a", name: "check_service_area", input: { suburb: "Norwood" } },
        { id: "tu_b", name: "get_quote", input: { serviceId: "svc" } },
      ]),
      textResponse("We cover Norwood — A$90."),
    );

    await runAgent(input, { model, store, config, executeTool: okTool });

    const toolResults = (model.requests[1]?.messages ?? []).flatMap((message) =>
      message.content.filter((block) => block.type === "tool_result"),
    );
    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((block) => (block.type === "tool_result" ? block.tool_use_id : ""))).toEqual([
      "tu_a",
      "tu_b",
    ]);
    // Both results travel in ONE user turn, which is what the API expects.
    expect((model.requests[1]?.messages ?? []).at(-1)?.role).toBe("user");
  });

  it("passes a tool error back to the model and keeps going", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "check_service_area" }]),
      textResponse("Sorry, we don't cover that area."),
    );

    const result = await runAgent(input, {
      model,
      store,
      config,
      executeTool: async () => ({
        ok: false,
        error: "out_of_area",
        message: "we do not service that suburb",
      }),
    });

    expect(result.status).toBe("replied");
    expect(result.toolsCalled[0]).toEqual({
      name: "check_service_area",
      ok: false,
      error: "out_of_area",
    });
    const block = (model.requests[1]?.messages ?? []).at(-1)?.content[0];
    expect(block).toMatchObject({ type: "tool_result", tool_use_id: "tu_1", is_error: true });
  });

  it("answers a tool_use for a tool it cannot run", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_x", name: "delete_everything" }]),
      textResponse("I can't do that, but I can help with a mow."),
    );

    const result = await runAgent(input, {
      model,
      store,
      config,
      executeTool: async () => ({
        ok: false,
        error: "invalid_input",
        message: "there is no tool called that",
      }),
    });

    expect(result.toolsCalled[0]?.error).toBe("invalid_input");
    expect(result.status).toBe("replied");
    expect(toolResultIds(model.requests[1]?.messages ?? [])).toEqual(["tu_x"]);
  });

  it("survives a tool handler that throws, and still answers the tool_use", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "create_booking" }]),
      textResponse("Let me get the team to help with that."),
    );

    const result = await runAgent(input, {
      model,
      store,
      config,
      executeTool: async () => {
        throw new Error("database is on fire");
      },
    });

    expect(result.toolsCalled[0]).toEqual({
      name: "create_booking",
      ok: false,
      error: "tool_failed",
    });
    expect(result.status).toBe("replied");
    expect(result.reply).toBe("Let me get the team to help with that.");
  });

  it("truncates oversized tool output before it reaches the model", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "list_services" }]),
      textResponse("Done."),
    );

    await runAgent(input, {
      model,
      store,
      config: { ...config, maxToolOutputChars: 200 },
      executeTool: async () => ({ ok: true, data: { blob: "x".repeat(5_000) } }),
    });

    const block = (model.requests[1]?.messages ?? []).at(-1)?.content[0];
    const content = block?.type === "tool_result" ? block.content : "";
    expect(content.length).toBeLessThanOrEqual(220);
    expect(content.endsWith("…[truncated]")).toBe(true);
  });
});

describe("runAgent — handoff", () => {
  it("hands over, replies once, and does not ask the model again", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([
        { id: "tu_h", name: "handoff_to_owner", input: { reason: "upset", summary: "Customer wants a refund" } },
      ]),
    );

    const result = await runAgent(input, {
      model,
      store,
      config,
      executeTool: async () => ({ ok: true, data: { handedOff: true } }),
    });

    expect(result.status).toBe("handed_off");
    expect(result.reply).toBe(HANDOFF_REPLY);
    expect(model.requests).toHaveLength(1);
    expect(store.status).toBe("handed_off");
    expect(store.transcript.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: HANDOFF_REPLY }],
    });
    expect(hasNoOrphanToolResults(store.transcript)).toBe(true);
  });

  it("does not call the model at all on a handed-off conversation", async () => {
    const store = memoryStore({ status: "handed_off" });
    const model = scriptedModel();

    const result = await runAgent(input, { model, store, config });

    expect(model.requests).toHaveLength(0);
    expect(result.status).toBe("handed_off");
    expect(result.reply).toBe(HANDOFF_REPLY);
    expect(store.transcript).toEqual([
      { role: "user", content: [{ type: "text", text: input.userText }] },
    ]);
    expect(store.notifications.map((notification) => notification.kind)).toEqual([
      "message_after_handoff",
    ]);
  });
});

describe("runAgent — failures", () => {
  it("retries once, then succeeds", async () => {
    const store = memoryStore();
    const model = scriptedModel(new Error("upstream 529"), textResponse("All good."));

    const result = await runAgent(input, { model, store, config });

    expect(model.requests).toHaveLength(2);
    expect(result.status).toBe("replied");
    expect(result.reply).toBe("All good.");
  });

  it("falls back safely when the model fails twice", async () => {
    const store = memoryStore();
    const model = scriptedModel(new Error("upstream 529"), new Error("upstream 529"));

    const result = await runAgent(input, { model, store, config });

    expect(model.requests).toHaveLength(2);
    expect(result.status).toBe("fallback");
    expect(result.reply).toBe(FALLBACK_REPLY);
    expect(result.reply).not.toContain("529");
    expect(store.notifications.map((notification) => notification.kind)).toEqual(["agent_failed"]);
  });

  it("falls back when AGENT_MODEL is missing, without calling the model", async () => {
    const store = memoryStore();
    const model = scriptedModel();

    const result = await runAgent(input, { model, store, config: { model: "" } });

    expect(model.requests).toHaveLength(0);
    expect(result.status).toBe("fallback");
    expect(store.notifications.map((notification) => notification.kind)).toEqual([
      "agent_misconfigured",
    ]);
  });

  it("falls back on a model turn with no content", async () => {
    const store = memoryStore();
    const model = scriptedModel({ content: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 0 } });

    const result = await runAgent(input, { model, store, config });

    expect(result.status).toBe("fallback");
    expect(result.reply).toBe(FALLBACK_REPLY);
  });
});

describe("runAgent — caps and kill switches", () => {
  it("stops at MAX_STEPS, hands over and tells the customer something safe", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "list_services" }]),
      toolUseResponse([{ id: "tu_2", name: "list_services" }]),
      toolUseResponse([{ id: "tu_3", name: "list_services" }]),
    );

    const result = await runAgent(input, { model, store, config, executeTool: okTool });

    expect(model.requests).toHaveLength(3);
    expect(result.status).toBe("capped");
    expect(result.reply).toBe(LIMIT_REPLY);
    expect(store.status).toBe("handed_off");
    expect(store.notifications.map((notification) => notification.kind)).toEqual([
      "agent_step_cap",
    ]);
    // Every tool call the model made was answered, even on the last step.
    expect(toolResultIds(store.transcript)).toEqual(["tu_1", "tu_2", "tu_3"]);
    expect(hasNoOrphanToolResults(store.transcript)).toBe(true);
  });

  it("stops when a run spends more tokens than allowed", async () => {
    const store = memoryStore();
    const model = scriptedModel(
      toolUseResponse([{ id: "tu_1", name: "list_services" }], {
        usage: { inputTokens: 30_000, outputTokens: 20_000 },
      }),
    );

    const result = await runAgent(input, {
      model,
      store,
      config: { ...config, maxTokensPerRun: 40_000 },
      executeTool: okTool,
    });

    expect(result.status).toBe("capped");
    expect(result.reply).toBe(LIMIT_REPLY);
    expect(store.status).toBe("handed_off");
    expect(store.notifications.map((notification) => notification.kind)).toEqual(["token_cap"]);
  });

  it("stops before the model when the conversation has used its calls", async () => {
    const store = memoryStore({ assistantTurns: 12 });
    const model = scriptedModel();

    const result = await runAgent(input, {
      model,
      store,
      config: { ...config, maxCallsPerConversation: 12 },
    });

    expect(model.requests).toHaveLength(0);
    expect(result.status).toBe("capped");
    expect(store.status).toBe("handed_off");
    expect(store.notifications.map((notification) => notification.kind)).toEqual([
      "conversation_limit",
    ]);
  });

  it("obeys the global kill switch", async () => {
    const store = memoryStore();
    const model = scriptedModel();

    const result = await runAgent(input, { model, store, config: { ...config, enabled: false } });

    expect(model.requests).toHaveLength(0);
    expect(result.status).toBe("disabled");
    expect(result.reply).toBe(DISABLED_REPLY);
    expect(store.transcript[0]?.role).toBe("user");
    expect(store.notifications.map((notification) => notification.kind)).toEqual([
      "agent_disabled",
    ]);
  });

  it("obeys the per-tenant pause", async () => {
    const store = memoryStore({
      tenant: { profile: { ...defaultTenant().profile, botEnabled: false } },
    });
    const model = scriptedModel();

    const result = await runAgent(input, { model, store, config });

    expect(model.requests).toHaveLength(0);
    expect(result.status).toBe("disabled");
    expect(store.notifications.map((notification) => notification.kind)).toEqual(["bot_disabled"]);
  });
});

describe("runAgent — history", () => {
  it("sends a trimmed transcript that starts at a user message and keeps tool pairs", async () => {
    const transcript: ModelMessage[] = [];
    for (let index = 0; index < 6; index += 1) {
      transcript.push(
        { role: "user", content: [{ type: "text", text: `question ${index}` }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: `tu_${index}`, name: "list_services", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `tu_${index}`, content: "{}" }],
        },
        { role: "assistant", content: [{ type: "text", text: `answer ${index}` }] },
      );
    }
    // The per-conversation call cap has its own test; pin it out of the way so
    // this test is only about what the transcript looks like on the wire.
    const store = memoryStore({ transcript, assistantTurns: 0 });
    const model = scriptedModel(textResponse("Here you go."));

    const result = await runAgent(input, {
      model,
      store,
      config: { ...config, historyLimit: 6 },
    });

    const sent = model.requests.at(-1)?.messages ?? [];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(12);
    expect(isPlainUserText(sent[0] as ModelMessage)).toBe(true);
    expect(hasNoOrphanToolResults(sent)).toBe(true);
    // The message just received is always the last one sent.
    expect(sent.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: input.userText }] });
    expect(result.status).toBe("replied");
  });

  it("repairs a stored transcript that would orphan a tool_result", async () => {
    const store = memoryStore({
      transcript: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_gone", content: "{}" }] },
        { role: "assistant", content: [{ type: "text", text: "orphaned" }] },
      ],
    });
    const model = scriptedModel(textResponse("Still here."));

    const result = await runAgent(input, { model, store, config });

    const sent = model.requests[0]?.messages ?? [];
    expect(hasNoOrphanToolResults(sent)).toBe(true);
    expect(result.status).toBe("replied");
  });
});
