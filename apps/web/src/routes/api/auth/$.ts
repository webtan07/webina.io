import { createFileRoute } from "@tanstack/react-router";

/**
 * Better Auth's HTTP surface: sign-up, sign-in, sign-out, session, magic link,
 * 2FA. Every path under /api/auth/* lands here and is handed to Better Auth
 * unchanged, including the Set-Cookie headers it writes.
 *
 * The auth instance is imported inside the handlers so Better Auth, drizzle and
 * pg stay out of the browser bundle.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import("~/lib/auth");
        return getAuth().handler(request);
      },
      POST: async ({ request }) => {
        const { getAuth } = await import("~/lib/auth");
        return getAuth().handler(request);
      },
    },
  },
});
