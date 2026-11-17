/**
 * Rate limiting for the public chat endpoint.
 *
 * The endpoint is the only unauthenticated thing in the product, so the cap is
 * per site key *and* per caller: one noisy visitor cannot spend a business's
 * model budget, and one business's traffic cannot slow another's.
 *
 * The store is a seam. Upstash Redis (REST) is used when its two environment
 * variables are set, because a serverless deployment has as many processes as
 * it has requests and an in-process counter would be a suggestion. Without
 * them — a dev box, CI, a single-container deploy — the same interface is
 * served from memory, which is exact for one process and honest about being
 * local. A Redis failure falls back to memory rather than letting every
 * request through unmetered.
 */

import { createHash } from "node:crypto";

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — the `Retry-After` value. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
}

/** Callers are identified by address; the address is hashed, never stored raw. */
export function callerKey(siteId: string, ip: string | null): string {
  const digest = createHash("sha256")
    .update(`${siteId}:${ip ?? "unknown"}`)
    .digest("hex")
    .slice(0, 24);
  return `webina:chat:${digest}`;
}

/**
 * Fixed-window counters in this process. Small, synchronous and dependency
 * free: good enough for a single container, and the floor under the Redis
 * implementation when it is unreachable.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, { count: number; resetAtMs: number }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 20_000,
  ) {}

  async hit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const nowMs = this.now();
    const windowMs = Math.max(1, options.windowSeconds) * 1_000;
    const existing = this.counters.get(key);
    const counter =
      existing === undefined || existing.resetAtMs <= nowMs
        ? { count: 0, resetAtMs: nowMs + windowMs }
        : existing;
    counter.count += 1;
    this.counters.set(key, counter);
    if (this.counters.size > this.maxKeys) this.prune(nowMs);
    const remaining = Math.max(0, options.limit - counter.count);
    return {
      allowed: counter.count <= options.limit,
      limit: options.limit,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAtMs - nowMs) / 1_000)),
    };
  }

  /** Drop expired windows so a busy day cannot grow the map without bound. */
  private prune(nowMs: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.resetAtMs <= nowMs) this.counters.delete(key);
    }
  }

  clear(): void {
    this.counters.clear();
  }
}

interface UpstashOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Used when Redis itself fails. */
  fallback: RateLimiter;
}

/**
 * Upstash Redis over its REST API: INCR the window's counter and set its TTL
 * in one round trip. No client library, no connection to keep alive.
 */
export class UpstashRateLimiter implements RateLimiter {
  constructor(private readonly options: UpstashOptions) {}

  async hit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const window = Math.max(1, options.windowSeconds);
    const bucket = `${key}:${Math.floor(Date.now() / (window * 1_000))}`;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `${this.options.url.replace(/\/+$/, "")}/pipeline`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify([
            ["INCR", bucket],
            ["EXPIRE", bucket, String(window), "NX"],
          ]),
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (!response.ok) throw new Error(`upstash returned ${response.status}`);
      const body = (await response.json()) as { result?: unknown }[];
      const count = Number((body[0]?.result as number | string | undefined) ?? 0);
      if (!Number.isFinite(count) || count <= 0) throw new Error("upstash returned no count");
      return {
        allowed: count <= options.limit,
        limit: options.limit,
        remaining: Math.max(0, options.limit - count),
        retryAfterSeconds: window,
      };
    } catch {
      // Redis down: keep serving, keep counting — in this process.
      return this.options.fallback.hit(key, options);
    }
  }
}

export interface RateLimitConfig extends RateLimitOptions {}

function intFromEnv(name: string, fallback: number, min: number, max: number, env: NodeJS.ProcessEnv) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/** `CHAT_RATE_LIMIT` per `CHAT_RATE_WINDOW_SECONDS`, per caller per site. */
export function rateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    limit: intFromEnv("CHAT_RATE_LIMIT", 20, 1, 1_000, env),
    windowSeconds: intFromEnv("CHAT_RATE_WINDOW_SECONDS", 60, 1, 3_600, env),
  };
}

const memory = new MemoryRateLimiter();

/**
 * One limiter per process, chosen from the environment. The memory limiter is
 * always the fallback, so this never returns null and never throws.
 */
export function getRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = (env.UPSTASH_REDIS_REST_URL ?? "").trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  if (url === "" || token === "") return memory;
  return new UpstashRateLimiter({ url, token, fallback: memory });
}

/** Tests only: forget every counter this process is holding. */
export function resetRateLimits(): void {
  memory.clear();
}
