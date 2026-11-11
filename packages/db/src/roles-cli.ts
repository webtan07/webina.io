#!/usr/bin/env tsx
/**
 * pnpm db:roles — create the two roles, then apply the least-privilege grants.
 *
 * Step 1 runs as the project owner (Neon: ADMIN_DATABASE_URL, the role that may
 * CREATE ROLE). Step 2 runs as the MIGRATOR, because only the owner of the
 * tables may grant or revoke on them. Run `pnpm db:migrate` in between (or
 * before: the grants file also sets default privileges for future tables).
 */

import path from "node:path";

import { Client } from "pg";

import { runSqlFile, SQL_DIR } from "./migrate";

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) {
  console.error("ADMIN_DATABASE_URL (project owner role) is required to create roles");
  process.exit(1);
}

await runSqlFile({ connectionString: adminUrl, filePath: path.join(SQL_DIR, "roles.sql") });
console.log("roles: webina_app, webina_migrator (NOBYPASSRLS)");

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
try {
  for (const [role, env] of [
    ["webina_app", "APP_DB_PASSWORD"],
    ["webina_migrator", "MIGRATOR_DB_PASSWORD"],
  ] as const) {
    const password = process.env[env];
    if (!password) continue;
    const { rows } = await admin.query<{ stmt: string }>(
      "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS stmt",
      [role, password],
    );
    const stmt = rows[0]?.stmt;
    if (stmt) await admin.query(stmt);
    console.log(`password set for ${role}`);
  }
} finally {
  await admin.end();
}

const migratorUrl = process.env.MIGRATE_DATABASE_URL;
if (!migratorUrl) {
  console.log("MIGRATE_DATABASE_URL not set — skipping grants (run again after migrating)");
  process.exit(0);
}

await runSqlFile({ connectionString: migratorUrl, filePath: path.join(SQL_DIR, "grants.sql") });
console.log("grants applied to webina_app");
