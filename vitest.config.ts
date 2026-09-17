import path from "node:path";
import { defineConfig } from "vitest/config";

const sourceRoot = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  resolve: {
    // `@pmark/arcadia`'s exports map points at `dist/`, which only exists
    // after `pnpm build`. Vitest resolving it there meant a bare `pnpm test`
    // in a fresh checkout failed the dashboard suites with "Cannot find
    // package '@pmark/arcadia/intelligence/client'" — a build-order artifact
    // that looks exactly like a real breakage and has cost more than one
    // agent session to re-diagnose. CI happens to build first, so it never
    // saw this. Pointing the subpaths at their TypeScript sources makes the
    // tests independent of build order; the exports map still governs what
    // the published package and the built dashboard consume.
    alias: {
      "@pmark/arcadia/intelligence/client": path.join(sourceRoot, "intelligence/client/index.ts"),
      "@pmark/arcadia/intelligence/contracts": path.join(sourceRoot, "intelligence/contracts.ts")
    }
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/tests/e2e/**",
      "**/.claude/worktrees/**",
      "**/.codex/worktrees/**"
    ]
  }
});
