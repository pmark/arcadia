import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/notes-to-self.md is a bounded cache: capped in size, and each entry is
// validated against the repository so a stale answer fails here instead of
// misleading the next agent.
const root = path.resolve(__dirname, "..");
const doc = readFileSync(path.join(root, "docs/notes-to-self.md"), "utf8");
const entries = doc.split(/^---$/m)[1]?.split(/^## /m).slice(1) ?? [];

describe("docs/notes-to-self.md", () => {
  it("stays within its 25-entry capacity", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(25);
  });

  it("gives every entry a keys: line", () => {
    for (const entry of entries) {
      expect(entry, entry.split("\n")[0]).toMatch(/^keys: \S/m);
    }
  });

  it("references only repository paths that still exist", () => {
    // Any backticked token shaped like a repo-relative path (contains a slash, or
    // is a root-level Markdown file). Absolute, home, flag, and placeholder
    // tokens (`<…>`, `…`) are not repository paths and are skipped.
    const paths = [...doc.matchAll(/`([^`\s]+)`/g)]
      .map((match) => match[1])
      .filter((token) => /^[\w.[\]-]+(?:\/[\w.[\]-]+)+\/?$|^[\w-]+\.md$/.test(token))
      .filter((token) => !/^[~/-]/.test(token));
    expect(paths.length).toBeGreaterThan(0);
    for (const reference of paths) {
      expect(existsSync(path.join(root, reference)), reference).toBe(true);
    }
  });
});
