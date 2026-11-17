/**
 * The widget's two calls: read the config, send a message.
 *
 * Both go to the same endpoint with the site key in the query string, because
 * a cross-origin request needs a URL the preflight can be answered for without
 * reading a body. `credentials: "omit"` on purpose: this page is not signed in
 * to anything of ours and the widget must never carry a cookie.
 */

import type { ChatErrorBody, ChatReplyBody, WidgetConfig, WidgetConfigBody } from "@webina/shared";

export interface ApiOptions {
  apiBase: string;
  siteKey: string;
  fetchImpl?: typeof fetch;
}

/** A failure with something the widget can say out loud. */
export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

export function chatEndpoint(apiBase: string, siteKey: string): string {
  const base = apiBase.trim().replace(/\/+$/, "");
  return `${base}/api/chat?key=${encodeURIComponent(siteKey)}`;
}

async function readError(response: Response): Promise<ChatApiError> {
  let code = "server_error";
  let message = "Something went wrong. Please try again.";
  try {
    const body = (await response.json()) as ChatErrorBody;
    if (body && body.ok === false) {
      code = body.error;
      if (typeof body.message === "string" && body.message !== "") message = body.message;
    }
  } catch {
    // A non-JSON error is still an error; the default message stands.
  }
  return new ChatApiError(response.status, code, message);
}

export async function loadWidgetConfig(options: ApiOptions): Promise<WidgetConfig> {
  const request = options.fetchImpl ?? fetch;
  const response = await request(chatEndpoint(options.apiBase, options.siteKey), {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as WidgetConfigBody;
  if (!body || body.ok !== true || !body.config) {
    throw new ChatApiError(response.status, "server_error", "Chat is unavailable right now.");
  }
  return body.config;
}

export interface SendOptions extends ApiOptions {
  message: string;
  customerRef?: string | null;
}

export async function sendChatMessage(options: SendOptions): Promise<ChatReplyBody> {
  const request = options.fetchImpl ?? fetch;
  const response = await request(chatEndpoint(options.apiBase, options.siteKey), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "omit",
    mode: "cors",
    body: JSON.stringify({
      message: options.message,
      ...(options.customerRef ? { customerRef: options.customerRef } : {}),
      ...(typeof location !== "undefined" && location.href ? { pageUrl: location.href } : {}),
    }),
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as ChatReplyBody;
  if (!body || body.ok !== true || typeof body.reply !== "string") {
    throw new ChatApiError(response.status, "server_error", "Chat is unavailable right now.");
  }
  return body;
}
