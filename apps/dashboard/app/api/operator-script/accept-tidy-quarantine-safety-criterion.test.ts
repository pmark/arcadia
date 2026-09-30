import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type PlanAmendmentInput } from "../../../../../src/operatorActions/planAmendment.js";

const root = path.resolve(import.meta.dirname, "../../../../..");
const id = "accept-tidy-quarantine-safety-criterion-2026-09-30";
const script = path.join(root, `artifacts/generated/operator-scripts/${id}.sh`);

describe("Tidy quarantine criterion action delegates to the shared Plan-amendment runner", () => {
  it("has only declarative pinned authority and preserves the two safety criteria", () => {
    const text = readFileSync(script, "utf8");
    expect(text).toContain("scripts/run-plan-amendment.mjs");
    expect(text).not.toMatch(/python|agent-ask|--preview|--responsibility|git |fingerprint/);
    expect(text.split("\n").filter(Boolean)).toHaveLength(5);
    const descriptor = JSON.parse(readFileSync(script.replace(/\.sh$/, ".json"), "utf8")) as { planAmendment: PlanAmendmentInput };
    const input = descriptor.planAmendment;
    expect(input.schema).toBe("arcadia-plan-amendment-v1");
    expect(input.settlement).toEqual({ requestId: id, disposition: "accepted", operator: true });
    expect(input.envelope.actionAfter.status).toBe("open");
    expect(input.envelope.actionAfter.acceptance_criteria).toEqual([
      "#735: START_HERE.md states that current tidy quarantines branch refs under refs/arcadia/tidy/<run>/heads/<branch> and restores them with arcadia tidy undo <run>; it does not describe archive/<branch> as an active recovery path.",
      "#739: tidy does not retire a live non-Arcadia agent worktree that has not committed yet.",
      "#740: tidy --apply does not retire branches on preview-time verdicts, and never runs update-ref -d on a branch checked out in another worktree."
    ]);
  });

  it("describes the action without executing settlement", () => {
    const result = spawnSync(script, ["--describe"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ id, planAmendment: { schema: "arcadia-plan-amendment-v1" } });
  });
});
