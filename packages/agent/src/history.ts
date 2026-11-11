/**
 * History trimming.
 *
 * The transcript we store is complete; the transcript we *send* is capped. Two
 * things must stay true when the cap bites, or the model API rejects the whole
 * request and the customer gets an apology:
 *
 *   1. A `tool_result` never appears without the assistant `tool_use` it
 *      answers. The API treats an orphaned result as a malformed request.
 *   2. The transcript starts with a plain user text message, not with a tool
 *      result and not with an assistant turn.
 *
 * So trimming cuts from the front and keeps cutting until the first surviving
 * message is a user turn of plain text. Because a `tool_use` is always
 * immediately followed by its `tool_result`, anything dropped that way is
 * dropped as a pair.
 */

import { isToolResultBlock, type ModelMessage } from "./model";

/** A user turn with no tool_result blocks — the only valid place to start. */
export function isPlainUserText(message: ModelMessage): boolean {
  if (message.role !== "user") return false;
  if (message.content.length === 0) return false;
  return !message.content.some(isToolResultBlock);
}

/**
 * The last `limit` messages, adjusted so the result is a valid request body.
 * Returns an empty array when nothing usable survives — the caller then asks
 * the model with the system prompt alone, which is a normal first turn.
 */
export function trimHistory(messages: readonly ModelMessage[], limit: number): ModelMessage[] {
  if (limit <= 0) return [];
  const kept = messages.slice(Math.max(0, messages.length - limit));

  // The earliest start that satisfies both rules wins, so the model gets as
  // much of the recent conversation as the cap allows.
  for (let start = 0; start < kept.length; start += 1) {
    if (!isPlainUserText(kept[start] as ModelMessage)) continue;
    const candidate = kept.slice(start);
    if (hasNoOrphanToolResults(candidate)) return candidate;
  }
  return [];
}

/**
 * True when every `tool_result` in the transcript answers a `tool_use` that
 * appears before it and is not already answered. The loop uses this as a guard
 * on what it is about to send: a malformed body is rejected wholesale by the
 * API, and the customer would get a fallback instead of an answer.
 */
export function hasNoOrphanToolResults(messages: readonly ModelMessage[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use") {
        pending.add(block.id);
        continue;
      }
      if (block.type === "tool_result") {
        if (!pending.delete(block.tool_use_id)) return false;
      }
    }
  }
  return true;
}
