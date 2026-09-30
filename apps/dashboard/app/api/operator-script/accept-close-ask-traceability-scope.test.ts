import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeAgentAsk } from "../../../../../src/ask/agentAsk.js";
import { planAmendmentLauncher, validateOperatorScriptContract } from "../../../../../src/operatorActions/libraryContract.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type PlanAmendmentInput } from "../../../../../src/operatorActions/planAmendment.js";
const root = path.resolve(import.meta.dirname, "../../../../..");
const id = "accept-close-ask-traceability-scope-2026-09-30";
const script = path.join(root, `artifacts/generated/operator-scripts/${id}.sh`);
describe("Traceability action delegates to the shared Plan-amendment runner", () => {
  it("has only declarative pinned authority and a launcher, with no bespoke protocol", () => {
    const text = readFileSync(script, "utf8");
    expect(text).toContain('scripts/run-plan-amendment.mjs');
    expect(text).not.toMatch(/python|agent-ask|--preview|--responsibility|git |fingerprint/);
    expect(text.split("\n").filter(Boolean)).toHaveLength(5);
    const descriptor = JSON.parse(readFileSync(script.replace(/\.sh$/, ".json"), "utf8")) as { planAmendment: PlanAmendmentInput };
    const input = descriptor.planAmendment;
    expect(input.schema).toBe("arcadia-plan-amendment-v1");
    expect(input.settlement).toEqual({ requestId: id, disposition: "accepted", operator: true });
    expect(text).toBe(planAmendmentLauncher(id));
    expect(() => validateOperatorScriptContract(descriptor, id, text)).not.toThrow();
    const source = path.join(root, input.ask.path);
    const archived = path.join(root, ".arcadia/asks/archive", path.basename(input.ask.path));
    const bytes = readFileSync(existsSync(source) ? source : archived, "utf8");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(input.ask.sha256);
    const ask = normalizeAgentAsk({ request: bytes });
    expect(ask.targetRef).toBe(`plan/${input.envelope.plan}`);
    expect(ask.actions[0].targetRef).toBe(`action/${input.envelope.action}`);
    expect(ask.actions[0].acceptance).toEqual(input.envelope.actionAfter.acceptance_criteria);
    // The bounded settlement has already succeeded. The descriptor remains an
    // audit record, so its static envelope—not the mutable current Plan—is the
    // assertion target.
    expect(input.envelope.actionAfter.id).toBe(input.envelope.action);
    expect(input.envelope.actionAfter.responsibility).toBe(input.envelope.actionBefore.responsibility);
    expect(input.envelope.actionAfter.status).toBe("open");
  });
  it("describes the action without executing settlement", () => {
    const result = spawnSync(script, ["--describe"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ id, planAmendment: { schema: "arcadia-plan-amendment-v1" } });
  });
});
