/**
 * `GET|POST|OPTIONS /api/chat` — the widget's only endpoint.
 *
 * Deliberately a server route rather than a `createServerFn`: the body is read
 * raw with `request.text()`, the CORS headers are written by hand, and the same
 * handler must answer a browser on another origin, curl and the test suite.
 *
 *   GET  ?key=pk_live_…   -> the widget's colours, name and greeting
 *   POST ?key=pk_live_…   -> one message, one reply
 *
 * Everything is implemented in `~/server/chat`; the handlers below exist only
 * to hand it the Request.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const { handleChatHttp } = await import("~/server/chat");
        return handleChatHttp(request);
      },
      GET: async ({ request }) => {
        const { handleChatHttp } = await import("~/server/chat");
        return handleChatHttp(request);
      },
      POST: async ({ request }) => {
        const { handleChatHttp } = await import("~/server/chat");
        return handleChatHttp(request);
      },
    },
  },
});
