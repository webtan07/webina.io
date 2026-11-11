/**
 * Vitest for the tools.
 *
 * The database is the same throwaway test database packages/db and apps/web
 * build — created, migrated and granted by packages/db/test/global-setup.ts —
 * so a tool test exercises the real RLS-subject role, not a privileged
 * shortcut.
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
