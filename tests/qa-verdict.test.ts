import { describe, expect, it } from "vitest";
import { classifyChangedPaths, classifyPath } from "../src/qa/verdict.js";

describe("classifyChangedPaths", () => {
  it("treats a lockfile as needing an install before the restart", () => {
    const result = classifyChangedPaths(["pnpm-lock.yaml", "apps/web/src/page.tsx"]);
    expect(result.verdict).toBe("install-and-restart");
    expect(result.headline).toMatch(/install dependencies/i);
    expect(result.reasons[0].paths).toContain("pnpm-lock.yaml");
  });

  it("classifies UI source as HMR-covered", () => {
    const result = classifyChangedPaths([
      "apps/dashboard/app/qa/page.tsx",
      "apps/dashboard/app/globals.css"
    ]);
    expect(result.verdict).toBe("hmr");
  });

  it("never claims a restart is unnecessary, only that HMR should cover it", () => {
    const result = classifyChangedPaths(["src/components/Card.tsx"]);
    expect(result.headline).toMatch(/should cover/i);
    expect(result.headline).not.toMatch(/no restart/i);
  });

  it("takes the strongest verdict when files disagree", () => {
    const result = classifyChangedPaths([
      "README.md",
      "src/components/Card.tsx",
      "apps/intake/wrangler.toml"
    ]);
    expect(result.verdict).toBe("restart");
  });

  it("ranks unknown above hmr so unmatched paths still offer a restart", () => {
    const result = classifyChangedPaths(["src/app/page.tsx", "Makefile.custom"]);
    expect(result.verdict).toBe("unknown");
    expect(result.headline).toMatch(/restart to be sure/i);
  });

  it("flags migrations separately from the verdict", () => {
    const result = classifyChangedPaths(["src/db/migrations/0007_add_reviews.sql"]);
    expect(result.verdict).toBe("restart");
    expect(result.migrationsChanged).toBe(true);
    expect(result.headline).toMatch(/migrations changed/i);
  });

  it("reads docs and tests as inert", () => {
    const result = classifyChangedPaths([
      "docs/service-contract.md",
      "tests/qa-refresh.test.ts",
      ".github/workflows/ci.yml"
    ]);
    expect(result.verdict).toBe("inert");
  });

  it("prefers the true reason for a test file over 'watched source'", () => {
    expect(classifyPath("src/qa/verdict.test.ts")?.id).toBe("inert");
  });

  it("names the monorepo apps a change touches", () => {
    const result = classifyChangedPaths([
      "apps/marketing/src/index.astro",
      "apps/intake/src/form.ts",
      "packages/design-system/tokens.css"
    ]);
    expect(result.apps).toEqual(["apps/intake", "apps/marketing", "packages/design-system"]);
  });

  it("reports an empty diff as nothing to do", () => {
    const result = classifyChangedPaths([]);
    expect(result.verdict).toBe("inert");
    expect(result.headline).toBe("No incoming changes.");
    expect(result.reasons).toEqual([]);
  });

  it("always carries the files that produced the verdict", () => {
    const result = classifyChangedPaths(["next.config.mjs"]);
    expect(result.reasons[0].paths).toEqual(["next.config.mjs"]);
  });
});

describe("classifyPath", () => {
  const cases: Array<[string, string]> = [
    ["package.json", "dependencies"],
    ["apps/web/package.json", "dependencies"],
    ["scripts/services.sh", "service-script"],
    [".env.local", "environment"],
    ["apps/worker/wrangler.toml", "environment"],
    ["next.config.ts", "build-config"],
    ["tsconfig.build.json", "build-config"],
    ["pnpm-workspace.yaml", "build-config"],
    ["src/middleware.ts", "boot-entry"],
    ["src/db/schema.ts", "schema"],
    ["drizzle/migrations/0001_init.sql", "schema"],
    ["docs/plans/whatever.md", "inert"],
    ["src/app/layout.tsx", "watched-source"],
    ["packages/ui/styles/button.scss", "watched-source"]
  ];

  for (const [filePath, expected] of cases) {
    it(`classifies ${filePath} as ${expected}`, () => {
      expect(classifyPath(filePath)?.id).toBe(expected);
    });
  }

  it("returns null for a path no rule recognises", () => {
    expect(classifyPath("Dockerfile.legacy")).toBeNull();
  });
});
