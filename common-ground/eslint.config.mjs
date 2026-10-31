import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Production builds run with NEXT_DIST_DIR=.next-build on this machine.
    ".next-build/**",
    // Other local build outputs and perf scratch files.
    ".next-*/**",
    ".perf/**",
  ]),
]);

export default eslintConfig;
