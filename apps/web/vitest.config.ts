/**
 * Vitest for the web app.
 *
 * The integration tests drive the real Better Auth handler against real
 * Postgres, as the least-privilege runtime role — the same database the
 * isolation tests in packages/db build. The database is created, migrated and
 * granted by packages/db/test/global-setup.ts, so both suites share one
 * definition of "the test database".
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    setupFiles: ["../../packages/db/test/setup.ts"],
    include: ["test/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
