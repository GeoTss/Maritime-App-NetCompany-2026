import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      "scripts/**/*.test.ts",
      ".claude/hooks/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    passWithNoTests: true,
    testTimeout: 20_000,
  },
});
