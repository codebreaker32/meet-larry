import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Server-only modules are imported directly in unit tests.
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Component tests (*.test.tsx) opt into jsdom with a `// @vitest-environment jsdom` comment.
    // Playwright specs in e2e/ run with `npm run test:e2e`, not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "node",
  },
});
