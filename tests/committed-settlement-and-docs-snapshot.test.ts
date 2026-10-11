import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findCommittedSettlement } from "../src/ask/settlement.js";
import { discoverDocs, withDocsSnapshot } from "../src/docs/discover.js";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function repoWithDecision(bodyLine: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-committed-"));
  roots.push(repo);
  mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  writeFileSync(path.join(repo, "docs/decisions/0001-q.md"), [
    "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: q", "project: demo", "status: open", "question: Q?",
    "updated: 2026-09-01", "options:", "  - label: Go ahead", "    consequence: It proceeds.", "    recommended: true",
    "---", "", "# Decision", "", "## Rationale", "", "Revises the earlier draft, Agent Ask x.", "", bodyLine, ""
  ].join("\n"));
  return repo;
}

describe("findCommittedSettlement (Issue #1236)", () => {
  it.each([
    ["the writer's line", "Proposed by Agent Ask x.", "x", true],
    ["text after the period on the same line", "Proposed by Agent Ask x. The operator approved this Decision.", "x", true],
    ["a longer revision id", "Proposed by Agent Ask x-r3.", "x", false],
    ["a dotted revision id", "Proposed by Agent Ask x.2.", "x", false],
    ["a prose mention in the rationale only", "Proposed by Agent Ask y.", "x", false]
  ])("matches %s: %s", (_label, line, requestId, found) => {
    const repo = repoWithDecision(line);
    const docs = discoverDocs(repo).docs;
    expect(findCommittedSettlement(docs, "demo", requestId)).toBe(found ? "docs/decisions/0001-q.md" : null);
  });
});

describe("withDocsSnapshot", () => {
  it("walks each root once inside the pass, returns fresh arrays, and ends with the pass even when it throws", () => {
    const repo = repoWithDecision("Proposed by Agent Ask x.");
    const decision = path.join(repo, "docs/decisions/0001-q.md");
    withDocsSnapshot(() => {
      const first = discoverDocs(repo);
      first.docs.length = 0;
      rmSync(decision);
      // Same snapshot: the removed file is still seen, and the caller's truncation did not leak.
      expect(discoverDocs(repo).docs).toHaveLength(1);
      // Nested use shares the outer snapshot.
      expect(withDocsSnapshot(() => discoverDocs(repo).docs)).toHaveLength(1);
    });
    // Outside the pass the repository is walked again.
    expect(discoverDocs(repo).docs).toHaveLength(0);
    expect(() => withDocsSnapshot(() => { discoverDocs(repo); throw new Error("boom"); })).toThrow("boom");
    // The throwing pass cached an empty walk; it must not outlive the pass.
    repoWithDecision("");
    writeFileSync(decision, readFileSync(path.join(roots[roots.length - 1], "docs/decisions/0001-q.md")));
    expect(discoverDocs(repo).docs).toHaveLength(1);
  });
});
