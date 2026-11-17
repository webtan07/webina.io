/**
 * The chat wire format, shared by the endpoint and the widget.
 *
 * One request carries one customer message; one response carries one reply and
 * the handle the widget replays next time. The handle is a `cref_…` string and
 * never a database id, a phone number or an email address — the widget keeps it
 * in session storage, so it must not identify anybody on its own.
 */

import { z } from "zod";

/** Longer than this and it is not a chat message; it is a paste. */
export const CHAT_MAX_MESSAGE_CHARS = 2_000;
/** The widget sends one message at a time and stops retrying after this. */
export const CHAT_MAX_REQUESTS_PER_MINUTE = 20;

export const customerRefSchema = z
  .string()
  .trim()
  .regex(/^cref_[a-z2-9]{24}$/, "unknown conversation handle");

export const chatMessageInput = z.object({
  message: z
    .string()
    .trim()
    .min(1, "message is empty")
    .max(CHAT_MAX_MESSAGE_CHARS, "message is too long"),
  /** Returned by the previous reply; omitted on the first message. */
  customerRef: customerRefSchema.optional(),
  /** The page the widget is on, for the transcript. Never required. */
  pageUrl: z.string().trim().max(500).optional(),
});
export type ChatMessageInput = z.infer<typeof chatMessageInput>;

export type ChatRunStatus = "replied" | "handed_off" | "fallback" | "disabled" | "capped";

export type ChatErrorCode =
  | "invalid_request"
  | "unknown_site_key"
  | "site_inactive"
  | "origin_not_allowed"
  | "rate_limited"
  | "server_error";

export interface ChatReplyBody {
  ok: true;
  /** Store this and send it back with the next message. */
  conversationRef: string;
  reply: string;
  status: ChatRunStatus;
}

export interface ChatErrorBody {
  ok: false;
  error: ChatErrorCode;
  /** Safe to show: never a stack trace, a provider message or a tenant id. */
  message: string;
  retryAfterSeconds?: number;
}

/** What the widget needs to draw itself before anybody has typed anything. */
export interface WidgetConfig {
  businessName: string;
  assistantName: string;
  brandColor: string;
  greeting: string;
  showPoweredBy: boolean;
  /** False when the owner has switched the assistant off. */
  enabled: boolean;
}

export interface WidgetConfigBody {
  ok: true;
  config: WidgetConfig;
}

/** The greeting a business gets before it writes its own. */
export function defaultGreeting(assistantName: string, businessName: string): string {
  return `Hi, I'm ${assistantName}, the assistant for ${businessName}. Ask me about services, prices or booking a time.`;
}
