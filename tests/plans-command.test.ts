import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderPlansSuccess, runPlansCommand } from "../src/commands/plans.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function loneRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-plans-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

const PROJECT = `---
arcadia: v1
type: project
slug: lone
name: Lone
status: active
goal: Prove a repository can list its own plans.
outcome: The plans command resolves with no workspace present.
milestone: Visibility works in a fresh clone
active_plan: active-plan
updated: 2026-08-26
---

# Lone
`;

const ACTIVE_PLAN = `---
arcadia: v1
type: plan
slug: active-plan
project: lone
status: active
milestone: Ship the visible thing
token_impact: small
token_budget: "Deterministic."
updated: 2026-08-26
actions:
  - id: do-the-thing
    title: Do the thing
    status: open
    responsibility: codex
    next_action: Write the thing to the file.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - The thing exists.
    depends_on: []
---

# Active plan
`;

const PROPOSED_PLAN = `---
arcadia: v1
type: plan
slug: proposed-plan
project: lone
status: proposed
milestone: Not yet Arcadia's business
updated: 2026-08-26
---

# Proposed plan

## If not now, then when?

A second real client's intake, held after the worksheet exists.
`;

const PROPOSED_PLAN_NO_TRIGGER = `---
arcadia: v1
type: plan
slug: untriggered-plan
project: lone
status: dormant
milestone: Sitting with no stated condition
updated: 2026-08-26
---

# Untriggered plan

Nothing here names when this should wake up.
`;

const OTHER_PROJECT_PROPOSED_PLAN = `---
arcadia: v1
type: plan
slug: other-proposed-plan
project: elsewhere
status: proposed
milestone: Belongs to a different project
updated: 2026-08-26
---

# Other project's plan
`;

describe("arcadia plans", () => {
  it("lists a governed plan with its status, milestone, and action counts", () => {
    const root = loneRepo({ "PROJECT.md": PROJECT, "docs/plans/active-plan.md": ACTIVE_PLAN });

    const response = runPlansCommand({ repo: root });

    expect(response.ok).toBe(true);
    expect(response.data.project?.slug).toBe("lone");
    expect(response.data.plans).toHaveLength(1);
    const plan = response.data.plans[0];
    expect(plan.slug).toBe("active-plan");
    expect(plan.status).toBe("active");
    expect(plan.governed).toBe(true);
    expect(plan.isActivePlan).toBe(true);
    expect(plan.actionCounts).toEqual({ open: 1, in_progress: 0, done: 0, blocked: 0 });
  });

  it("surfaces a proposed plan Arcadia does not govern, with its own stated trigger", () => {
    const root = loneRepo({
      "PROJECT.md": PROJECT,
      "docs/plans/active-plan.md": ACTIVE_PLAN,
      "docs/plans/proposed-plan.md": PROPOSED_PLAN
    });

    const response = runPlansCommand({ repo: root });
    const proposed = response.data.plans.find((plan) => plan.slug === "proposed-plan");

    expect(proposed).toBeDefined();
    expect(proposed?.status).toBe("proposed");
    expect(proposed?.governed).toBe(false);
    expect(proposed?.isActivePlan).toBe(false);
    expect(proposed?.actionCounts).toBeNull();
    expect(proposed?.activationNote).toContain("A second real client's intake");
  });

  it("names the gap explicitly when an ungoverned plan states no trigger at all", () => {
    const root = loneRepo({
      "PROJECT.md": PROJECT,
      "docs/plans/active-plan.md": ACTIVE_PLAN,
      "docs/plans/untriggered-plan.md": PROPOSED_PLAN_NO_TRIGGER
    });

    const response = runPlansCommand({ repo: root });
    const lines = renderPlansSuccess(response).join("\n");

    expect(lines).toContain('add an "If not now, then when?" trigger');
  });

  it("excludes a proposed plan belonging to a different project in the same repository", () => {
    const root = loneRepo({
      "PROJECT.md": PROJECT,
      "docs/plans/active-plan.md": ACTIVE_PLAN,
      "docs/plans/other-proposed-plan.md": OTHER_PROJECT_PROPOSED_PLAN
    });

    const response = runPlansCommand({ repo: root });

    expect(response.data.plans.map((plan) => plan.slug)).not.toContain("other-proposed-plan");
  });

  it("throws a validation error instead of silently returning nothing when no PROJECT.md exists", () => {
    const root = loneRepo({ "README.md": "# nothing managed here\n" });

    expect(() => runPlansCommand({ repo: root })).toThrow(/No PROJECT\.md/);
  });
});
