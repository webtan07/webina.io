/**
 * The tool contract.
 *
 * Every tool has the same signature and the same result shape, so the agent
 * loop can execute a `tool_use` block without knowing which tool it was. A
 * handler never throws: whatever goes wrong comes back as `{ ok: false }` with
 * one of the fixed codes, because a thrown error would reach the model as a
 * stack trace and reach the customer as an apology.
 *
 * `businessId` and `conversationId` come only from `ctx`. No tool accepts a
 * business id in its input, so a model that has been talked into "pretending
 * to be another business" has nothing to put in that field.
 */

import type { ToolName } from "@webina/shared";

export const TOOL_ERROR_CODES = [
  "invalid_input",
  "not_found",
  "out_of_area",
  "slot_taken",
  "slot_unavailable",
  "rate_limited",
  "tool_failed",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolErrorCode; message: string; details?: Record<string, unknown> };

export interface ToolContext {
  /** Trusted: resolved from the site key or session, never from the model. */
  businessId: string;
  conversationId: string | null;
  channel: "web" | "sms" | "whatsapp";
}

export type ToolHandler = (rawInput: unknown, ctx: ToolContext) => Promise<ToolResult>;

export function toolOk<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function toolError(
  error: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolResult<never> {
  return details === undefined
    ? { ok: false, error, message }
    : { ok: false, error, message, details };
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema for the model's `tools` array. */
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}
