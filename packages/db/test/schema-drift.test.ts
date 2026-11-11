/**
 * The migration and the Drizzle schema must describe the same tables.
 * If they drift, every type in the app becomes a lie, so this fails loudly.
 */

import { getTableName, getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "../src/schema";
import { APP_TEST_URL } from "./db-urls";

const pool = new Pool({ connectionString: APP_TEST_URL, max: 1 });

afterAll(async () => {
  await pool.end();
});

const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[];

describe("schema matches the applied migration", () => {
  it("finds every schema table in the database", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const inDb = new Set(rows.map((r) => r.table_name));
    const missing = tables.map((t) => getTableName(t)).filter((name) => !inDb.has(name));
    expect(missing).toEqual([]);
  });

  it("has the same columns in every table", async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const dbColumns = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = dbColumns.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      dbColumns.set(row.table_name, set);
    }

    const problems: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      const declared = Object.values(getTableColumns(table)).map((c) => c.name);
      const actual = dbColumns.get(name);
      if (!actual) {
        problems.push(`${name}: missing from the database`);
        continue;
      }
      for (const column of declared) {
        if (!actual.has(column)) problems.push(`${name}.${column}: declared but not in the database`);
      }
      for (const column of actual) {
        if (!declared.includes(column)) problems.push(`${name}.${column}: in the database but not declared`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has row level security enabled on every tenant table", async () => {
    const tenantTables = [
      "businesses",
      "sites",
      "memberships",
      "services",
      "service_areas",
      "availability_rules",
      "availability_exceptions",
      "bookings",
      "job_requests",
      "conversations",
      "messages",
      "handoffs",
      "usage_events",
      "subscriptions",
      "audit_log",
      "consents",
      "opt_outs",
      "notifications",
      "scheduled_messages",
    ];
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1)",
      [tenantTables],
    );
    const off = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(off).toEqual([]);
    expect(rows).toHaveLength(tenantTables.length);
  });

  it("has no GST or tax column anywhere", async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND (column_name ILIKE '%gst%' OR column_name ILIKE '%tax%')`,
    );
    expect(rows).toEqual([]);
  });
});
