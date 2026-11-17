/**
 * The public chat endpoint.
 *
 * This is the one route in the product that anybody can call, so it does the
 * same three things in the same order every time:
 *
 *   1. **Identify the tenant** from the site key, and prove the request came
 *      from an origin that tenant registered. The key is public — it is in the
 *      embed snippet — so the origin check, not the key, is the boundary.
 *   2. **Meter the caller** before anything expensive happens: a per-caller,
 *      per-site window, counted in Redis when it is configured and in process
 *      memory when it is not.
 *   3. **Run the agent loop**, which persists the customer's message and the
 *      reply itself, and hands the conversation to the owner when it should.
 *
 * The request body is read as raw text (`request.text()`) rather than being
 * deserialised by the framework: this is a public JSON endpoint called by a
 * script on someone else's page, and it must behave identically for a browser,
 * for curl and for the test suite. Errors are always JSON with a code the
 * widget can act on, and never carry a stack trace, a provider message or an
 * internal id.
 */

import {
  DEFAULT_BRAND_COLOR,
  chatMessageInput,
  defaultGreeting,
  safeBrandColor,
  type ChatErrorBody,
  type ChatErrorCode,
  type ChatReplyBody,
  type WidgetConfig,
  type WidgetConfigBody,
} from "@webina/shared";
import {
  SiteRequestRejected,
  createConversation,
  findConversationByCustomerRef,
  getWidgetBranding,
  resolveSiteForRequest,
} from "@webina/db";
import { resolveModelClient, runAgent, type ModelClient } from "@webina/agent";

import { callerKey, getRateLimiter, rateLimitConfig, type RateLimiter } from "./rate-limit";

/** Bodies bigger than this are not chat messages. */
const MAX_BODY_BYTES = 20_000;

export interface ChatModel {
  client: ModelClient;
  model: string;
  offline: boolean;
}

export interface ChatDeps {
  env?: NodeJS.ProcessEnv;
  /** Defaults to `resolveModelClient(env)` — the real client, or the offline one. */
  model?: ChatModel;
  limiter?: RateLimiter;
  now?: () => number;
}

interface ChatLogger {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
}

const consoleLogger: ChatLogger = {
  info(event) {
    console.log(JSON.stringify({ level: "info", component: "chat", ...event }));
  },
  error(event) {
    console.error(JSON.stringify({ level: "error", component: "chat", ...event }));
  },
};

const CORS_METHODS = "GET,POST,OPTIONS";
const CORS_HEADERS = "content-type,x-webina-site-key";
/** Preflight answers are cached by the browser for this long. */
const CORS_MAX_AGE = "600";

function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    // Always vary, even when the origin is refused: a cached "yes" for one
    // origin must never be replayed for another.
    vary: "Origin",
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
    "access-control-max-age": CORS_MAX_AGE,
  };
  if (allowed && origin !== null) headers["access-control-allow-origin"] = origin;
  return headers;
}

function jsonResponse(
  status: number,
  body: ChatReplyBody | WidgetConfigBody | ChatErrorBody | { ok: true },
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The widget polls nothing and the answer is per-conversation.
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const REJECTION_MESSAGES: Record<SiteRequestRejected["code"], string> = {
  unknown_site_key: "This chat is not configured for this site.",
  site_inactive: "This chat is not configured for this site.",
  origin_not_allowed: "This chat is not enabled for this website address.",
};

function rejectionResponse(
  code: ChatErrorCode,
  message: string,
  headers: Record<string, string>,
): Response {
  return jsonResponse(403, { ok: false, error: code, message }, headers);
}

/** The address the request came from, as the platform reports it. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

/** The site key, from the query string (CORS-friendly) or a header (curl, tests). */
export function siteKeyOf(request: Request): string | null {
  const fromQuery = new URL(request.url).searchParams.get("key")?.trim();
  if (fromQuery) return fromQuery;
  const fromHeader = request.headers.get("x-webina-site-key")?.trim();
  return fromHeader && fromHeader !== "" ? fromHeader : null;
}

/**
 * The single entry point for every method on the route. The route file is a
 * thin wrapper; everything testable lives here.
 */
export async function handleChatHttp(request: Request, deps: ChatDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const startedAt = Date.now();
  const origin = request.headers.get("origin");
  const siteKey = siteKeyOf(request);
  const method = request.method.toUpperCase();

  // Preflight: answer it, but only promise an origin we would actually accept.
  if (method === "OPTIONS") {
    let allowed = false;
    if (siteKey !== null) {
      try {
        await resolveSiteForRequest(siteKey, origin);
        allowed = true;
      } catch {
        allowed = false;
      }
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
  }

  if (method !== "GET" && method !== "POST") {
    return jsonResponse(
      405,
      { ok: false, error: "invalid_request", message: "Method not allowed." },
      { ...corsHeaders(origin, false), allow: "GET,POST,OPTIONS" },
    );
  }

  if (siteKey === null) {
    // No key, no tenant: nothing to look up and nothing to vary on.
    return rejectionResponse(
      "unknown_site_key",
      REJECTION_MESSAGES.unknown_site_key,
      corsHeaders(origin, false),
    );
  }

  let site: { businessId: string; siteId: string };
  try {
    site = await resolveSiteForRequest(siteKey, origin);
  } catch (error) {
    if (error instanceof SiteRequestRejected) {
      // An origin we refused gets no `access-control-allow-origin`, so the
      // browser cannot even read this body. curl still can, which is the point.
      return rejectionResponse(
        error.code,
        REJECTION_MESSAGES[error.code],
        corsHeaders(origin, false),
      );
    }
    consoleLogger.error({
      event: "chat_site_lookup_failed",
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return jsonResponse(
      503,
      { ok: false, error: "server_error", message: "Chat is unavailable right now." },
      corsHeaders(origin, false),
    );
  }

  const allowedCors = corsHeaders(origin, true);
  const limiter = deps.limiter ?? getRateLimiter(env);
  const limits = rateLimitConfig(env);

  let limited;
  try {
    limited = await limiter.hit(callerKey(site.siteId, clientIp(request)), limits);
  } catch {
    // A limiter that throws must not become an outage.
    limited = { allowed: true, limit: limits.limit, remaining: 0, retryAfterSeconds: 0 };
  }
  if (!limited.allowed) {
    return jsonResponse(
      429,
      {
        ok: false,
        error: "rate_limited",
        message: "Too many messages just now. Please wait a moment and try again.",
        retryAfterSeconds: limited.retryAfterSeconds,
      },
      {
        ...allowedCors,
        "retry-after": String(limited.retryAfterSeconds),
        "x-ratelimit-limit": String(limited.limit),
        "x-ratelimit-remaining": "0",
      },
    );
  }

  const rateHeaders = {
    "x-ratelimit-limit": String(limited.limit),
    "x-ratelimit-remaining": String(limited.remaining),
  };

  if (method === "GET") {
    return configResponse(site.businessId, { ...allowedCors, ...rateHeaders });
  }

  // ---- POST: one customer message in, one reply out ----------------------

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse(
      400,
      { ok: false, error: "invalid_request", message: "That message is too long." },
      { ...allowedCors, ...rateHeaders },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return jsonResponse(
      400,
      { ok: false, error: "invalid_request", message: "Send a JSON body." },
      { ...allowedCors, ...rateHeaders },
    );
  }

  const parsed = chatMessageInput.safeParse(parsedJson);
  if (!parsed.success) {
    return jsonResponse(
      400,
      {
        ok: false,
        error: "invalid_request",
        message: parsed.error.issues[0]?.message ?? "That message could not be read.",
      },
      { ...allowedCors, ...rateHeaders },
    );
  }

  const model = deps.model ?? resolveModelClient(env);
  if (model.offline) {
    consoleLogger.info({ event: "chat_model_offline", businessId: site.businessId });
  }

  // A handle from the previous reply reopens that conversation; anything else
  // (including another tenant's handle, which reads as "no rows") starts one.
  let conversation;
  try {
    conversation =
      parsed.data.customerRef !== undefined
        ? await findConversationByCustomerRef(site.businessId, parsed.data.customerRef)
        : null;
    conversation ??= await createConversation(site.businessId, { channel: "web" });
  } catch (error) {
    consoleLogger.error({
      event: "chat_conversation_failed",
      businessId: site.businessId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return jsonResponse(
      503,
      { ok: false, error: "server_error", message: "Chat is unavailable right now." },
      { ...allowedCors, ...rateHeaders },
    );
  }

  const result = await runAgent(
    {
      businessId: site.businessId,
      conversationId: conversation.id,
      channel: "web",
      userText: parsed.data.message,
    },
    { model: model.client, config: { model: model.model } },
  );

  consoleLogger.info({
    event: "chat_replied",
    businessId: site.businessId,
    siteId: site.siteId,
    status: result.status,
    steps: result.steps,
    tools: result.toolsCalled.length,
    tokensIn: result.usage.inputTokens,
    tokensOut: result.usage.outputTokens,
    durationMs: Date.now() - startedAt,
  });

  return jsonResponse(
    200,
    {
      ok: true,
      conversationRef: conversation.customerRef,
      reply: result.reply,
      status: result.status,
    },
    { ...allowedCors, ...rateHeaders },
  );
}

/** Branding for the widget: the tenant's colours and name, and nothing else. */
async function configResponse(
  businessId: string,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const branding = await getWidgetBranding(businessId);
    const config: WidgetConfig = {
      businessName: branding.businessName,
      assistantName: branding.assistantName,
      brandColor: safeBrandColor(branding.brandColor, DEFAULT_BRAND_COLOR),
      greeting:
        branding.greeting?.trim() || defaultGreeting(branding.assistantName, branding.businessName),
      showPoweredBy: branding.showPoweredBy,
      enabled: branding.botEnabled,
    };
    return jsonResponse(200, { ok: true, config }, headers);
  } catch (error) {
    consoleLogger.error({
      event: "chat_config_failed",
      businessId,
      detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return jsonResponse(
      503,
      { ok: false, error: "server_error", message: "Chat is unavailable right now." },
      headers,
    );
  }
}
