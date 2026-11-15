import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "packages/*/src/**/*.test.ts",
            "apps/api/src/**/*.test.ts",
            "apps/worker/src/**/*.test.ts",
            "services/*/src/**/*.test.ts",
            "scripts/**/*.test.ts",
            ".claude/hooks/**/*.test.ts",
            "evals/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "e2e/**"],
        },
      },
      {
        extends: true,
        resolve: {
          alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
        },
        test: {
          name: "web",
          environment: "happy-dom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "e2e/**"],
        },
      },
    ],
  },
});
