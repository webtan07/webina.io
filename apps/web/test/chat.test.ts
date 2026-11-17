/**
 * The public chat endpoint, end to end against Postgres.
 *
 * The site key is public, so these tests are mostly about the checks that make
 * it useless on its own: an origin that is not registered gets nothing, an
 * unknown key gets nothing, and a caller who will not stop gets a 429 before a
 * single token is spent. The happy path runs the real agent loop with the
 * offline model (no key needed) and then reads the transcript back out of the
 * database to prove the messages were persisted, not just returned.
 */

import { afterAll, describe, expect, it } from "vitest";

import { OfflineModelClient } from "@webina/agent";
import {
  closePool,
  findConversationByCustomerRef,
  listMessages,
  setAllowedOrigins,
} from "@webina/db";
import { createTestTenant } from "../../../packages/db/test/helpers";
import { handleChatHttp } from "../src/server/chat";
import { MemoryRateLimiter } from "../src/server/rate-limit";

const ORIGIN = "https://brightmowers.example";
const API = "https://app.webina.test";
const MODEL = { client: new OfflineModelClient("A standard mow is $80."), model: "offline", offline: true };

afterAll(async () => {
  await closePool();
});

async function tenantWithOrigin(name: string, origins: string[] = [ORIGIN]) {
  const tenant = await createTestTenant(name, { environment: "test" });
  const { listSites } = await import("@webina/db");
  const sites = await listSites(tenant.businessId);
  const site = sites[0];
  if (!site) throw new Error("tenant has no site");
  await setAllowedOrigins(tenant.businessId, site.id, origins);
  return { ...tenant, siteId: site.id };
}

function post(body: unknown, options: { key: string; origin?: string | null; ip?: string }): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.ip) headers["x-forwarded-for"] = options.ip;
  return new Request(`${API}/api/chat?key=${encodeURIComponent(options.key)}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(key: string, origin: string | null = ORIGIN): Request {
  return new Request(`${API}/api/chat?key=${encodeURIComponent(key)}`, {
    method: "GET",
    headers: origin === null ? {} : { origin },
  });
}

describe("who may talk to the assistant", () => {
  it("refuses a request whose Origin is not registered for that site key", async () => {
    const tenant = await tenantWithOrigin("Origin Mowers");

    const response = await handleChatHttp(
      post({ message: "How much for a mow?" }, { key: tenant.siteKey, origin: "https://not-their-site.example" }),
      { model: MODEL },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "origin_not_allowed",
    });
    // No allow-origin header, so a browser cannot even read the refusal.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("refuses a request with no Origin at all — curl is not a browser", async () => {
    const tenant = await tenantWithOrigin("No Origin Mowers");
    const response = await handleChatHttp(post({ message: "hello" }, { key: tenant.siteKey, origin: null }), {
      model: MODEL,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "origin_not_allowed" });
  });

  it("refuses an unknown site key", async () => {
    const response = await handleChatHttp(
      post({ message: "hello" }, { key: "pk_test_zzzzzzzzzzzzzzzzzzzz" }),
      { model: MODEL },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "unknown_site_key" });
  });

  it("refuses a request with no site key", async () => {
    const response = await handleChatHttp(
      new Request(`${API}/api/chat`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
      { model: MODEL },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "unknown_site_key" });
  });

  it("answers the preflight only for an origin it would accept", async () => {
    const tenant = await tenantWithOrigin("Preflight Mowers");

    const allowed = await handleChatHttp(
      new Request(`${API}/api/chat?key=${tenant.siteKey}`, {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "access-control-request-method": "POST" },
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(allowed.headers.get("access-control-allow-methods")).toContain("POST");

    const refused = await handleChatHttp(
      new Request(`${API}/api/chat?key=${tenant.siteKey}`, {
        method: "OPTIONS",
        headers: { origin: "https://elsewhere.example", "access-control-request-method": "POST" },
      }),
    );
    expect(refused.status).toBe(204);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("metering", () => {
  it("stops a caller who will not stop, with a Retry-After", async () => {
    const tenant = await tenantWithOrigin("Busy Mowers");
    const limiter = new MemoryRateLimiter(() => 1_000);
    const deps = {
      model: MODEL,
      limiter,
      env: { CHAT_RATE_LIMIT: "2", CHAT_RATE_WINDOW_SECONDS: "60" } as NodeJS.ProcessEnv,
    };

    const first = await handleChatHttp(
      post({ message: "one" }, { key: tenant.siteKey, ip: "203.0.113.9" }),
      deps,
    );
    const second = await handleChatHttp(
      post({ message: "two" }, { key: tenant.siteKey, ip: "203.0.113.9" }),
      deps,
    );
    const third = await handleChatHttp(
      post({ message: "three" }, { key: tenant.siteKey, ip: "203.0.113.9" }),
      deps,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    await expect(third.json()).resolves.toMatchObject({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: 60,
    });

    // A different visitor to the same site is unaffected.
    const other = await handleChatHttp(
      post({ message: "hello" }, { key: tenant.siteKey, ip: "198.51.100.4" }),
      deps,
    );
    expect(other.status).toBe(200);
  });
});

describe("a real conversation", () => {
  it("answers through the loop and keeps the transcript", async () => {
    const tenant = await tenantWithOrigin("Transcript Mowers");

    const response = await handleChatHttp(
      post({ message: "How much for a standard mow?" }, { key: tenant.siteKey }),
      { model: MODEL },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const body = (await response.json()) as { conversationRef: string; reply: string; status: string };
    expect(body.reply).toBe("A standard mow is $80.");
    expect(body.status).toBe("replied");
    expect(body.conversationRef).toMatch(/^cref_[a-z2-9]{24}$/);

    const conversation = await findConversationByCustomerRef(tenant.businessId, body.conversationRef);
    expect(conversation).not.toBeNull();
    const messages = await listMessages(tenant.businessId, conversation!.id, 10);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");

    // The next message continues that conversation rather than starting one.
    const second = await handleChatHttp(
      post({ message: "Can I book Thursday?", customerRef: body.conversationRef }, { key: tenant.siteKey }),
      { model: MODEL },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { conversationRef: string };
    expect(secondBody.conversationRef).toBe(body.conversationRef);
    expect(await listMessages(tenant.businessId, conversation!.id, 10)).toHaveLength(4);
  });

  it("will not reopen another business's conversation from a leaked handle", async () => {
    const alpha = await tenantWithOrigin("Alpha Mowers");
    const bravo = await tenantWithOrigin("Bravo Mowers");

    const first = await handleChatHttp(
      post({ message: "Hi from Alpha" }, { key: alpha.siteKey }),
      { model: MODEL },
    );
    const alphaRef = ((await first.json()) as { conversationRef: string }).conversationRef;

    const borrowed = await handleChatHttp(
      post({ message: "Hi from Bravo", customerRef: alphaRef }, { key: bravo.siteKey }),
      { model: MODEL },
    );
    expect(borrowed.status).toBe(200);
    const borrowedRef = ((await borrowed.json()) as { conversationRef: string }).conversationRef;
    expect(borrowedRef).not.toBe(alphaRef);
    expect(await findConversationByCustomerRef(bravo.businessId, alphaRef)).toBeNull();
  });

  it("rejects a body that is not a message, and one that is not JSON", async () => {
    const tenant = await tenantWithOrigin("Validate Mowers");

    const empty = await handleChatHttp(post({ message: "   " }, { key: tenant.siteKey }), { model: MODEL });
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({ error: "invalid_request" });

    const notJson = await handleChatHttp(post("this is not json", { key: tenant.siteKey }), {
      model: MODEL,
    });
    expect(notJson.status).toBe(400);
  });
});

describe("the widget's config", () => {
  it("returns the tenant's name, colours and greeting — and nothing else", async () => {
    const tenant = await tenantWithOrigin("Config Mowers");

    const response = await handleChatHttp(get(tenant.siteKey));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      config: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.config.businessName).toBe("Config Mowers");
    expect(body.config.assistantName).toBe("Webina");
    expect(body.config.brandColor).toBe("#0f7b8a");
    expect(String(body.config.greeting)).toContain("Config Mowers");
    // Nothing that identifies the owner, the tenant or the database.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(tenant.businessId);
    expect(serialised).not.toContain(tenant.ownerNotifyEmail);
  });

  it("refuses the config for an unregistered origin too", async () => {
    const tenant = await tenantWithOrigin("Config Guard Mowers");
    const response = await handleChatHttp(get(tenant.siteKey, "https://elsewhere.example"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "origin_not_allowed" });
  });
});
