import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    include: ["test/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
