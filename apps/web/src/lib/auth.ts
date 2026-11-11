/**
 * Better Auth — the identity layer.
 *
 * Owner decision (webina-ai/DECISIONS-v1.md): Better Auth, email + password
 * with a magic link available, TOTP 2FA available but off by default.
 *
 * Identity is global and lives in Better Auth's own tables (`user`, `session`,
 * `account`, `verification`, `two_factor`), which carry no RLS because a
 * session has to be read before any tenant is known. Tenancy is `memberships`,
 * and everything else is reachable only through withTenant(). See
 * packages/db/migrations/0001_rls.sql.
 *
 * The instance is built lazily: importing this module must not need
 * DATABASE_URL, so the build and a cold start stay independent of the database.
 */

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { magicLink, twoFactor } from "better-auth/plugins";

import { getDb } from "@webina/db";
import * as schema from "@webina/db/schema";

import { sendEmail } from "./email";

type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | null = null;

function baseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3100";
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.trim() === "") {
    throw new Error("BETTER_AUTH_SECRET is not set — sign-in cannot be trusted without it");
  }
  return value;
}

function buildAuth() {
  const trustedOrigins = [baseUrl()];
  if (process.env.APP_BASE_URL && !trustedOrigins.includes(process.env.APP_BASE_URL)) {
    trustedOrigins.push(process.env.APP_BASE_URL);
  }

  return betterAuth({
    appName: "Webina",
    baseURL: baseUrl(),
    basePath: "/api/auth",
    secret: secret(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      usePlural: false,
    }),
    emailAndPassword: {
      enabled: true,
      // Ten characters, not eight: these are business owners' working accounts.
      minPasswordLength: 10,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      // Available now; delivery needs EMAIL_SERVER_URL (Milestone 6).
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({
            to: email,
            subject: "Your Webina sign-in link",
            text: `Sign in to Webina: ${url}\n\nThe link expires in 10 minutes. If you did not ask for it, ignore this email.`,
          });
        },
      }),
      // Available but off by default — a new account has no second factor.
      twoFactor({ issuer: "Webina" }),
    ],
    trustedOrigins,
  });
}

export function getAuth(): Auth {
  if (cached !== null) return cached;
  cached = buildAuth();
  return cached;
}

/** Test-only: drop the cached instance so a new database is picked up. */
export function resetAuthForTests(): void {
  cached = null;
}
