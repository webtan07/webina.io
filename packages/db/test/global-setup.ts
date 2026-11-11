/**
 * Creates the throwaway test database once per `vitest run`:
 *   roles -> database -> migrations (as migrator) -> least-privilege grants.
 *
 * Deliberately the same path production uses, so the tests exercise the real
 * role separation rather than a privileged shortcut.
 */

import path from "node:path";

import { Client } from "pg";

import { migrate, runSqlFile, SQL_DIR } from "../src/migrate";
import {
  ADMIN_TEST_URL,
  APP_PASSWORD,
  APP_ROLE,
  MIGRATOR_PASSWORD,
  MIGRATOR_ROLE,
  MIGRATOR_TEST_URL,
  TEST_DB_NAME,
} from "./db-urls";

async function setPassword(admin: Client, role: string, password: string): Promise<void> {
  const { rows } = await admin.query<{ stmt: string }>(
    "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS stmt",
    [role, password],
  );
  const stmt = rows[0]?.stmt;
  if (stmt) await admin.query(stmt);
}

export default async function setup(): Promise<void> {
  await runSqlFile({ connectionString: ADMIN_TEST_URL, filePath: path.join(SQL_DIR, "roles.sql") });

  const admin = new Client({ connectionString: ADMIN_TEST_URL });
  await admin.connect();
  try {
    await setPassword(admin, APP_ROLE, APP_PASSWORD);
    await setPassword(admin, MIGRATOR_ROLE, MIGRATOR_PASSWORD);
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME} OWNER ${MIGRATOR_ROLE}`);
  } finally {
    await admin.end();
  }

  const applied = await migrate({ connectionString: MIGRATOR_TEST_URL });
  if (applied.length === 0) throw new Error("no migrations were applied");

  await runSqlFile({ connectionString: MIGRATOR_TEST_URL, filePath: path.join(SQL_DIR, "grants.sql") });
}
