/**
 * Connection strings for the test database.
 *
 * TEST_ADMIN_DATABASE_URL must point at a superuser/owner role that can create
 * roles and databases (CI: the postgres service container; local: the machine's
 * own Postgres). Everything else is derived, so no env has to be passed between
 * the vitest main process and its workers.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/postgres";

export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? "webina_test";
export const APP_ROLE = "webina_app";
export const MIGRATOR_ROLE = "webina_migrator";
export const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? "webina_app_test";
export const MIGRATOR_PASSWORD = process.env.MIGRATOR_DB_PASSWORD ?? "webina_migrator_test";

function parse(url: string): URL {
  return new URL(url);
}

/** Same host/port as the admin URL, different database and role. */
export function roleUrl(role: string, password: string, database = TEST_DB_NAME): string {
  const url = parse(ADMIN_URL);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

export const ADMIN_TEST_URL = ADMIN_URL;
export const APP_TEST_URL = roleUrl(APP_ROLE, APP_PASSWORD);
export const MIGRATOR_TEST_URL = roleUrl(MIGRATOR_ROLE, MIGRATOR_PASSWORD);

/** The database the admin connection starts on (to CREATE/DROP the test db). */
export function adminMaintenanceUrl(): string {
  const url = parse(ADMIN_URL);
  return url.toString();
}
