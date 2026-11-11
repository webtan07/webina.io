/**
 * Database client.
 *
 * One pool, created lazily from DATABASE_URL. The runtime connection must be
 * the least-privilege role (`webina_app`): no DDL, no table ownership, no
 * BYPASSRLS. If the configured role turns out to be able to bypass RLS the
 * process refuses to use it — a silent RLS bypass is the failure mode this
 * whole layer exists to prevent.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let verifiedPool: Pool | null = null;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function getPool(): Pool {
  if (pool === null) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Managed Postgres (Neon included) requires TLS.
      ssl: /sslmode=(require|verify-ca|verify-full)/.test(databaseUrl())
        ? { rejectUnauthorized: true }
        : undefined,
    });
  }
  return pool;
}

export function getDb(): Database {
  return drizzle(getPool(), { schema });
}

/** Throws unless the connected role is a plain, RLS-subject role. */
export async function assertLeastPrivilege(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    owns: number;
  }>(
    `SELECT current_user,
            r.rolsuper,
            r.rolbypassrls,
            (SELECT count(*)::int FROM pg_class c
              WHERE c.relkind = 'r' AND pg_catalog.pg_get_userbyid(c.relowner) = current_user) AS owns
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (!row) throw new Error("could not read the current database role");
  if (row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `refusing to run as "${row.current_user}": the role is a superuser or has BYPASSRLS, so Row Level Security would be silently ignored. Use the least-privilege role (webina_app).`,
    );
  }
  if (row.owns > 0) {
    throw new Error(
      `refusing to run as "${row.current_user}": the role owns tables, which bypasses Row Level Security. Use the least-privilege role (webina_app).`,
    );
  }
}

/** Runs the privilege check once per pool, not once per transaction. */
export async function ensureLeastPrivilege(target: Pool): Promise<void> {
  if (verifiedPool === target) return;
  const client = await target.connect();
  try {
    await assertLeastPrivilege(client);
    verifiedPool = target;
  } finally {
    client.release();
  }
}

/** Test-only: forget the cached check (a fresh database is created). */
export function resetPrivilegeCheckForTests(): void {
  verifiedPool = null;
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
    verifiedPool = null;
  }
}
