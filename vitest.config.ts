import path from "node:path";
import { defineConfig } from "vitest/config";

const sourceRoot = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  // The dashboard tsconfig keeps JSX for Next to compile; component render
  // tests (renderToStaticMarkup) need it compiled with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
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
    // The CLI-response and discord suites spawn `mise exec`/`tsx`
    // subprocesses that routinely exceed 30s under file parallelism on a busy
    // host (#452), so a slow machine reported itself as a broken change. A
    // timeout is a hang detector, not a performance assertion: 120s is
    // adequate headroom (a full run passed at that value) and a real hang
    // still fails. The hook timeout matches for the same reason (#514: a cold
    // `tsc` build in a `beforeAll` exceeds the 10s default).
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      // Codex observation falls back to the developer's real ~/.codex, so any
      // test that reaches profile selection read, attached and queried the
      // SQLite databases the Codex app was concurrently writing. That made
      // tests/launch-preview.test.ts fail intermittently with "unable to open
      // database file" on a machine that runs Codex, and never in CI, which
      // has no ~/.codex at all. Pointing every test run at a directory that
      // does not exist makes local goals deterministically empty and keeps the
      // suite independent of whatever the developer's own tools are doing.
      ARCADIA_CODEX_HOME: path.join(import.meta.dirname, "tests", ".no-codex-home"),
      // An agent may run the suite from a shell with the inline-workspace mode
      // on (src/workspace/resolve.ts). Fixtures resolve temporary defaults on
      // purpose, so the suite starts with the mode off; tests of the mode
      // turn it on themselves.
      ARCADIA_REQUIRE_INLINE_WORKSPACE: ""
    },
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
