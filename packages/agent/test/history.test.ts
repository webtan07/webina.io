import { describe, expect, it } from "vitest";

import { hasNoOrphanToolResults, isPlainUserText, trimHistory } from "../src/history";
import type { ContentBlock, ModelMessage } from "../src/model";

const user = (text: string): ModelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

const assistant = (text: string): ModelMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

const toolCall = (id: string): ModelMessage => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name: "list_services", input: {} }],
});

const toolResults = (ids: string[]): ModelMessage => ({
  role: "user",
  content: ids.map(
    (id): ContentBlock => ({ type: "tool_result", tool_use_id: id, content: '{"ok":true}' }),
  ),
});

/** One complete exchange: question, tool call, tool result, answer. */
function exchange(n: number): ModelMessage[] {
  return [
    user(`question ${n}`),
    toolCall(`tu_${n}`),
    toolResults([`tu_${n}`]),
    assistant(`answer ${n}`),
  ];
}

describe("isPlainUserText", () => {
  it("accepts a user turn of text only", () => {
    expect(isPlainUserText(user("hello"))).toBe(true);
  });

  it("rejects an assistant turn, an empty turn and a tool result", () => {
    expect(isPlainUserText(assistant("hi"))).toBe(false);
    expect(isPlainUserText({ role: "user", content: [] })).toBe(false);
    expect(isPlainUserText(toolResults(["tu_1"]))).toBe(false);
  });
});

describe("trimHistory", () => {
  it("keeps everything when the transcript is short enough", () => {
    const messages = exchange(1);
    expect(trimHistory(messages, 30)).toEqual(messages);
  });

  it("returns nothing when the limit is zero", () => {
    expect(trimHistory(exchange(1), 0)).toEqual([]);
  });

  it("drops a cut that would start mid-exchange", () => {
    // The last three messages are tool_call, tool_result, answer — no plain
    // user text to start from, so nothing survives rather than something invalid.
    expect(trimHistory(exchange(1), 3)).toEqual([]);
  });

  it("starts at the newest complete exchange", () => {
    const trimmed = trimHistory([...exchange(1), ...exchange(2)], 6);
    expect(trimmed[0]).toEqual(user("question 2"));
    expect(trimmed).toHaveLength(4);
  });

  it("never leaves a tool_result without its tool_use, at any limit", () => {
    const messages = [...exchange(1), ...exchange(2), ...exchange(3)];
    for (let limit = 0; limit <= messages.length; limit += 1) {
      const trimmed = trimHistory(messages, limit);
      expect(hasNoOrphanToolResults(trimmed)).toBe(true);
      if (trimmed.length > 0) expect(isPlainUserText(trimmed[0] as ModelMessage)).toBe(true);
    }
  });

  it("keeps the newest turns, not the oldest", () => {
    const trimmed = trimHistory([...exchange(1), ...exchange(2), ...exchange(3)], 8);
    expect(trimmed.map((message) => JSON.stringify(message.content))).not.toContain(
      JSON.stringify(user("question 1").content),
    );
    expect(trimmed.at(-1)).toEqual(exchange(3).at(-1));
  });
});

describe("hasNoOrphanToolResults", () => {
  it("accepts a matched pair", () => {
    expect(hasNoOrphanToolResults([user("hi"), toolCall("tu_1"), toolResults(["tu_1"])])).toBe(
      true,
    );
  });

  it("rejects a result whose call was trimmed away", () => {
    expect(hasNoOrphanToolResults([toolResults(["tu_1"])])).toBe(false);
  });

  it("rejects a second result for the same call", () => {
    expect(
      hasNoOrphanToolResults([toolCall("tu_1"), toolResults(["tu_1"]), toolResults(["tu_1"])]),
    ).toBe(false);
  });
});
