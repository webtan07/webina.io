/**
 * The model seam.
 *
 * Everything the agent loop needs from a language model is this one interface:
 * give it a system prompt, a trimmed transcript and the tool definitions, get
 * back content blocks. Tests drive the loop with a scripted fake, and the real
 * client is a thin, validated wrapper over the Anthropic Messages API — so no
 * loop mechanic depends on the network, and no test depends on a key.
 *
 * Request and response shapes follow the documented Messages API (tool use):
 * `POST /v1/messages` with `x-api-key` and `anthropic-version`, `tools[]` of
 * `{name, description, input_schema}`, and a response of `content` blocks
 * (`text`, `tool_use`) plus `stop_reason` and `usage`.
 */

import { z } from "zod";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ModelMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ModelToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  /** Stable prefix first, volatile date last — see `buildSystemPrompt`. */
  system: string;
  messages: ModelMessage[];
  tools: ModelToolDef[];
  maxTokens: number;
  model: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: string | null;
  usage: ModelUsage;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** Any failure from the model, in a shape the loop can retry and log safely. */
export class ModelRequestFailed extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ModelRequestFailed";
  }
}

/* ------------------------------------------------------------------ *
 * Block helpers — used by the loop and by tests
 * ------------------------------------------------------------------ */

export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === "tool_result";
}

/** All the visible text of one assistant turn, joined. */
export function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/* ------------------------------------------------------------------ *
 * The real client
 * ------------------------------------------------------------------ */

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_MS = 30_000;

const responseSchema = z.object({
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("tool_use"),
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
      }),
    ]),
  ),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export interface AnthropicClientOptions {
  /** Defaults to `process.env.ANTHROPIC_API_KEY`, read when a request is made. */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class AnthropicModelClient implements ModelClient {
  constructor(private readonly options: AnthropicClientOptions = {}) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ModelRequestFailed("ANTHROPIC_API_KEY is not set", null);
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `${this.options.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          tools: request.tools,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout, DNS, refused connection: worth one retry, never worth showing
      // the customer.
      throw new ModelRequestFailed(
        error instanceof Error ? error.message : "model request failed",
        null,
      );
    }

    if (!response.ok) {
      // The body can carry a helpful validation message; it never contains
      // customer text we would be logging here, only our own request shape.
      const detail = await response.text().catch(() => "");
      throw new ModelRequestFailed(
        `model returned ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ModelRequestFailed("model returned a body that is not JSON", response.status);
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ModelRequestFailed(
        `model returned an unexpected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        response.status,
      );
    }

    return {
      content: parsed.data.content as ContentBlock[],
      stopReason: parsed.data.stop_reason ?? null,
      usage: {
        inputTokens: parsed.data.usage?.input_tokens ?? 0,
        outputTokens: parsed.data.usage?.output_tokens ?? 0,
      },
    };
  }
}
