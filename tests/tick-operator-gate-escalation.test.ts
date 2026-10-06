import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDecisionApproveCommand } from "../src/commands/decision.js";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { renderProductionStatusSuccess, runProductionStatusCommand } from "../src/commands/production.js";
import { git, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Issue #997: when the worker tick skips a launch because
 * resolveProjectTransition answers `decision` for an in-scope Action (a
 * pending Agent Ask proposal or an open Decision naming it), `arcadia
 * production status` shows exactly one `operator_gate_pending` entry for it,
 * logged once however many ticks it holds, and cleared when the gate is gone.
 * Run 2's shape (a stale pending `complete` proposal for an amended Action)
 * is pinned in rehearsal-run-3-amended-action.test.ts, and the #994 and #995
 * shapes in tests/fast-rehearsal/.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => rehearsals.splice(0).forEach((rehearsal) => rehearsal.dispose()));

const DECISION_ID = "0900";

/** An open Decision whose `action:` names write-marker-a, committed to the fixture and synced. */
function addOpenDecision(rehearsal: Rehearsal): string {
  const relativePath = path.join("docs", "decisions", `${DECISION_ID}-confirm-marker-a.md`);
  mkdirSync(path.join(rehearsal.repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(rehearsal.repo, relativePath), [
    "---", "arcadia: v1", "type: decision", `id: "${DECISION_ID}"`, "slug: confirm-marker-a", `project: ${rehearsal.projectSlug}`,
    "status: open", "question: Write marker A now?", "confidence: high", `plan: ${rehearsal.planSlug}`,
    "action: write-marker-a", "updated: 2026-09-26",
    "options:", "  - label: Write it now", "    consequence: write-marker-a dispatches.", "    recommended: true",
    "  - label: Hold it", "    consequence: write-marker-a stays gated.", "    recommended: false",
    "---", "", `# Decision ${DECISION_ID}: Write marker A now?`, ""
  ].join("\n"));
  git(rehearsal.repo, ["add", relativePath]);
  git(rehearsal.repo, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qm", "Open a Decision gating write-marker-a"]);
  runDocsSyncCommand({ workspace: rehearsal.workspace, project: rehearsal.projectSlug, apply: true });
  return relativePath;
}

const gateLines = (rehearsal: Rehearsal) => rehearsal.log.filter((line) => line.includes("(operator_gate_pending)"));

describe("the worker tick's operator gate escalation (Issue #997)", () => {
  it("shows one deduplicated entry for an open Decision naming the Action, clears it while production is Off, and clears it for good once the Decision is answered", () => {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate("gate-grant-1");
    const relativePath = addOpenDecision(rehearsal);

    const held = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    for (const tick of held) expect(tick.launch).toMatchObject({ outcome: "skipped", reason: expect.stringContaining("Write marker A now?") });
    const status = rehearsal.status();
    expect(status.operatorEscalations.map((entry) => [entry.actionKey, entry.kind])).toEqual([[rehearsal.actionA, "operator_gate_pending"]]);
    const [entry] = status.operatorEscalations;
    expect(entry.message).toBe(`Launch of ${rehearsal.actionA} is held by pending Decision ${DECISION_ID}: Write marker A now?`);
    expect(entry.remedy).toContain(`arcadia decision approve ${DECISION_ID} --project ${rehearsal.projectSlug} --answer 'Write it now'`);
    expect(entry.remedy).toContain(relativePath);
    const text = renderProductionStatusSuccess(runProductionStatusCommand({ workspace: rehearsal.workspace })).join("\n");
    expect(text).toContain(`${rehearsal.actionA} [operator_gate_pending]`);
    expect(gateLines(rehearsal)).toHaveLength(1);

    // Off: the tick launches nothing at all, so no gate holds a launch and the entry clears.
    rehearsal.deactivate("gate-off");
    rehearsal.tick();
    expect(rehearsal.status().operatorEscalations).toEqual([]);
    // On again: a new episode, recorded and logged once more.
    rehearsal.activate("gate-grant-2");
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.status().operatorEscalations.map((e) => e.kind)).toEqual(["operator_gate_pending"]);
    expect(gateLines(rehearsal)).toHaveLength(2);

    runDecisionApproveCommand({ workspace: rehearsal.workspace, project: rehearsal.projectSlug, id: DECISION_ID, answer: "Write it now" });
    const launched = rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 2).at(-1)!;
    expect(launched.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionA });
    expect(rehearsal.status().operatorEscalations).toEqual([]);
    expect(gateLines(rehearsal)).toHaveLength(2);
  });
});
