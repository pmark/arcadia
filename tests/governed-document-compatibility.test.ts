import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch } from "../src/docs/dispatch.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repo(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-governed-docs-"));
  temporary.push(directory);
  return directory;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const PROJECT = `---
arcadia: v1
type: project
slug: demo
name: Demo
status: active
goal: Keep control documents dispatchable.
active_plan: active-plan
updated: 2026-08-14
---
`;

const ACTIVE_PLAN = `---
arcadia: v1
type: plan
slug: active-plan
project: demo
status: active
token_impact: small
token_budget: Tests stay deterministic; one implementation pass is bounded.
current_action: record-verdict
updated: 2026-08-14
actions:
  - id: operator-step
    title: Operator-owned work
    status: open
    responsibility: operator
  - id: record-verdict
    title: Record the verdict
    status: open
    responsibility: codex
    clarification: clarified
    next_action: Write the evidence-backed verdict.
    acceptance_criteria:
      - The verdict names the evidence.
---
`;

describe("governed document compatibility", () => {
  it("scopes PPN-style supporting records and dormant plans out of dispatch", () => {
    const root = repo();
    write(root, "PROJECT.md", PROJECT);
    write(root, "docs/plans/active-plan.md", ACTIVE_PLAN);
    write(root, "docs/plans/wake-on-trigger.md", `---
arcadia: v1
type: plan
status: dormant
actions:
  - id: operator-cutover
    responsibility: operator
---
`);
    write(root, ".arcadia/continuations/record-verdict.md", `---
arcadia: v1
type: continuation
action: record-verdict
---
`);
    write(root, "docs/proposals/future-work.md", `---
arcadia: v1
type: proposal
status: proposed
---
`);
    // Keep Log validation strict, but a historical Log defect cannot erase a
    // separately valid project-control pointer.
    write(root, "MISSION_LOG.md", `---
arcadia: v1
type: log
slug: demo-log
project: demo
updated: 2026-08-14
---

## 2026-08-14 — Missing result

- **Did:** Recorded the work.
`);

    const discovered = discoverDocs(root);
    expect(discovered.errors).toHaveLength(1);
    expect(discovered.errors[0]).toMatchObject({ relativePath: "MISSION_LOG.md", field: "entry(2026-08-14)" });
    expect(discovered.docs.filter((doc) => doc.type === "scoped_out")).toHaveLength(3);

    const resolution = resolveDispatch(root, "demo");
    expect(resolution.blockers).toEqual([]);
    expect(resolution.context?.action.id).toBe("record-verdict");
    const activePlan = discovered.docs.find((doc) => doc.type === "plan");
    expect(activePlan?.type === "plan" && activePlan.actions[0].responsibility).toBe("requires_review");
  });

  it("continues to fail closed for malformed project-control YAML", () => {
    const root = repo();
    write(root, "PROJECT.md", PROJECT);
    write(root, "docs/plans/active-plan.md", ACTIVE_PLAN);
    write(root, "docs/plans/broken.md", "---\narcadia: v1\ntype: [broken\n---\n");

    const resolution = resolveDispatch(root, "demo");
    expect(resolution.context?.action.id).toBe("record-verdict");
    expect(resolution.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "docs/plans/broken.md", field: "frontmatter" })
    ]));
  });
});
