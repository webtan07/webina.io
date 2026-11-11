/**
 * The one way into tenant data.
 *
 * Every tenant-scoped query runs inside `withTenant(businessId, fn)`, which
 * opens a transaction, sets `app.business_id` for that transaction only
 * (`set_config(..., true)`), and hands back a Drizzle handle. Postgres RLS then
 * refuses any row belonging to another business, so a forgotten WHERE clause
 * leaks nothing.
 *
 * `businessId` must come from a trusted source: the authenticated session's
 * membership, or a site key resolved on the server. It never comes from the
 * model, from a request body, or from a query string.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";

import { ensureLeastPrivilege, getPool, type Database } from "./client";
import * as schema from "./schema";

export type Tx = Database;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantScope {
  businessId: string;
  /** The signed-in user, when there is one. Used by the memberships policy. */
  userId?: string | null;
}

export function assertBusinessId(businessId: string): string {
  if (typeof businessId !== "string" || !UUID_RE.test(businessId)) {
    throw new TypeError(`invalid business id: ${String(businessId)}`);
  }
  return businessId;
}

async function inTransaction<T>(
  client: PoolClient,
  settings: { businessId?: string; userId?: string | null },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    if (settings.businessId !== undefined) {
      await client.query("SELECT set_config('app.business_id', $1, true)", [settings.businessId]);
    }
    if (settings.userId != null && settings.userId !== "") {
      await client.query("SELECT set_config('app.user_id', $1, true)", [settings.userId]);
    }
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Run `fn` with tenant A's rows visible and nobody else's. */
export async function withTenant<T>(
  scope: TenantScope | string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const businessId = assertBusinessId(typeof scope === "string" ? scope : scope.businessId);
  const userId = typeof scope === "string" ? null : (scope.userId ?? null);
  const client = await getPool().connect();
  try {
    await ensureLeastPrivilege(getPool());
    return await inTransaction(client, { businessId, userId }, fn);
  } finally {
    client.release();
  }
}

/**
 * Run `fn` with no tenant set — used only to list a user's own memberships
 * before a tenant is chosen. Tenant tables return nothing here, by policy.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (typeof userId !== "string" || userId === "") {
    throw new TypeError("invalid user id");
  }
  const client = await getPool().connect();
  try {
    await ensureLeastPrivilege(getPool());
    return await inTransaction(client, { userId }, fn);
  } finally {
    client.release();
  }
}

/**
 * Raw read used only by the site-key door (a SECURITY DEFINER function that
 * returns one site's business id and origins). No tenant context exists yet,
 * and nothing else is readable this way.
 */
export async function resolveSiteKey(
  siteKey: string,
): Promise<{ businessId: string; allowedOrigins: string[]; isActive: boolean } | null> {
  if (typeof siteKey !== "string" || siteKey.trim() === "") return null;
  const client = await getPool().connect();
  try {
    await ensureLeastPrivilege(getPool());
    const { rows } = await client.query<{
      business_id: string;
      allowed_origins: string[];
      is_active: boolean;
    }>("SELECT * FROM webina_resolve_site_key($1)", [siteKey]);
    const row = rows[0];
    if (!row) return null;
    return {
      businessId: row.business_id,
      allowedOrigins: row.allowed_origins ?? [],
      isActive: row.is_active,
    };
  } finally {
    client.release();
  }
}
