/**
 * Migration runner: applies every .sql file in migrations/ in filename order,
 * once, each inside its own transaction, recorded in `webina_migrations`.
 *
 * Run with the MIGRATOR connection string (`pnpm db:migrate`), never with the
 * runtime role: the runtime role has no DDL and no ownership.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(HERE, "..");
export const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "migrations");
export const SQL_DIR = path.join(PACKAGE_ROOT, "sql");

export interface RunSqlOptions {
  connectionString: string;
  filePath: string;
}

/** Apply one SQL file as-is (multi-statement). */
export async function runSqlFile({ connectionString, filePath }: RunSqlOptions): Promise<void> {
  const sql = await readFile(filePath, "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export interface MigrateOptions {
  connectionString: string;
  migrationsDir?: string;
  log?: (message: string) => void;
}

export async function migrate(options: MigrateOptions): Promise<string[]> {
  const dir = options.migrationsDir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => undefined);
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS webina_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string }>("SELECT name FROM webina_migrations");
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO webina_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}
