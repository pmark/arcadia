import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAgentAsk } from "../src/ask/agentAsk.js";
import { validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { assertOperatorSettlementContract } from "../src/operatorActions/operatorExecution.js";
import {
  buildDispositionPlan, decideAsk, decideProject, decideReview, previewTouchesOtherCheckout, TODO_BULK_DISPOSITION_20261010 as PINS
} from "../src/operatorActions/todoBulkDisposition.js";

const root = path.resolve(import.meta.dirname, "..");
const ID = "apply-todo-bulk-disposition-20261010";
const library = path.join(root, "artifacts/generated/operator-scripts");
const manifestText = readFileSync(path.join(root, PINS.manifestPath), "utf8");
const descriptor = (): OperatorScriptDescriptor => JSON.parse(readFileSync(path.join(library, `${ID}.json`), "utf8")) as OperatorScriptDescriptor;
const scriptText = readFileSync(path.join(library, `${ID}.sh`), "utf8");
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the pinned /todo bulk disposition plan", () => {
  it("derives exactly the accepted scope from the real list and descriptor", () => {
    const plan = buildDispositionPlan(manifestText, descriptor().agentAskRejections!);
    expect(plan.asks).toHaveLength(184);
    expect(plan.crossRepoSkips).toHaveLength(41);
    expect(new Set(plan.crossRepoSkips.map((a) => a.project))).toEqual(new Set(["private-practice-now", "mission-control-site", "rebuster"]));
    expect(plan.reviews).toHaveLength(61);
    expect(plan.projects.map((p) => p.id).sort()).toEqual([
      "proj_6f9a48901eb64a849f", "proj_9492782cef794dda9d", "proj_9f837e5188534af2b3", "proj_bf52c629aa384f8493",
      "proj_f9af573185984c4bb1", "proj_f9ccab08c6ad4d4298", "proj_fbdbf9d73b2b40d79b", "proj_fc0a2c56e3e7424c84"
    ]);
    expect(plan.asks.every((a) => a.settlementRequestId === `bulk-20261010-${a.proposalId}`)).toBe(true);
    const ids = new Set([...plan.asks.map((a) => a.proposalId), ...plan.reviews.map((r) => r.reviewItemId)]);
    for (const id of [...PINS.neverTouch.proposals, ...PINS.neverTouch.reviewItems]) expect(ids.has(id)).toBe(false);
  });
  it("refuses a list whose bytes changed", () => {
    expect(() => buildDispositionPlan(manifestText + " ", descriptor().agentAskRejections!)).toThrow("sha256");
  });
  it("refuses a declared proposal the list does not reject, and an Arcadia proposal left undeclared", () => {
    const extra = descriptor().agentAskRejections!;
    extra.proposals = [...extra.proposals, "agentask_0000000000000000aa"];
    expect(() => buildDispositionPlan(manifestText, extra)).toThrow("does not reject");
    const plan = buildDispositionPlan(manifestText, descriptor().agentAskRejections!);
    const arcadia = plan.asks.find((a) => a.project === "arcadia")!;
    const missing = descriptor().agentAskRejections!;
    missing.proposals = missing.proposals.filter((id) => id !== arcadia.proposalId);
    expect(() => buildDispositionPlan(manifestText, missing)).toThrow("only cross-repo items may be left out");
  });
  it("refuses a descriptor naming another list", () => {
    const other = { ...descriptor().agentAskRejections!, sha256: "0".repeat(64) };
    expect(() => buildDispositionPlan(manifestText, other)).toThrow("differs from the accepted list");
  });
});

describe("per-item re-checks", () => {
  const planned = { proposalId: "agentask_aaaaaaaaaaaaaaaaaa", key: "k", project: "arcadia", settlementRequestId: "bulk-20261010-agentask_aaaaaaaaaaaaaaaaaa" };
  it("rejects only a pending Ask and resumes its own settlement", () => {
    expect(decideAsk(planned, true, undefined).act).toBe(true);
    expect(decideAsk(planned, false, undefined)).toMatchObject({ act: false, note: expect.stringContaining("missing") });
    expect(decideAsk(planned, true, { requestId: planned.settlementRequestId, disposition: "rejected" })).toMatchObject({ act: false, note: expect.stringContaining("resumed") });
    expect(decideAsk(planned, true, { requestId: "other", disposition: "accepted" })).toMatchObject({ act: false, note: expect.stringContaining("accepted") });
  });
  it("rejects only open or deferred review items", () => {
    expect(decideReview("open").act).toBe(true);
    expect(decideReview("deferred").act).toBe(true);
    expect(decideReview("approved").act).toBe(false);
    expect(decideReview(undefined).act).toBe(false);
  });
  it("completes a fixture Project only when it is still the pinned disposable fixture", () => {
    const pinned = { id: "proj_x", slug: "two-action-rehearsal-v2" };
    const row = { id: "proj_x", slug: "two-action-rehearsal-v2", status: "active", repo_path: "/home/m/tmp/arcadia-two-action-rehearsal-v2" };
    expect(decideProject(pinned, row, "/home/m").act).toBe(true);
    expect(decideProject(pinned, { ...row, status: "completed" }, "/home/m")).toMatchObject({ act: false, note: "already completed" });
    expect(decideProject(pinned, { ...row, slug: "arcadia" }, "/home/m")).toMatchObject({ act: false, failed: true });
    expect(decideProject(pinned, { ...row, repo_path: "/home/m/Dev/arcadia" }, "/home/m")).toMatchObject({ act: false, failed: true });
    expect(decideProject(pinned, undefined, "/home/m")).toMatchObject({ act: false, failed: true });
  });
  it("skips a cross-repo rejection that would archive a file on that repository's checkout", () => {
    expect(previewTouchesOtherCheckout("private-practice-now", [{ path: ".arcadia/asks/archive/x.yaml" }])).toBe(true);
    expect(previewTouchesOtherCheckout("private-practice-now", [])).toBe(false);
    expect(previewTouchesOtherCheckout("arcadia", [{ path: ".arcadia/asks/archive/x.yaml" }])).toBe(false);
  });
});

describe("agentAskRejections in the operator-script contract", () => {
  const plain = () => { const d = descriptor(); return d; };
  it("accepts the real one-shot descriptor and its launcher", () => {
    expect(validateOperatorScriptContract(descriptor(), ID, scriptText).agentAskRejections?.proposals).toHaveLength(184);
  });
  it.each([
    ["a repeatable scope", (d: OperatorScriptDescriptor) => { d.repeatable = true; }, "one-shot"],
    ["a combined agentAsk", (d: OperatorScriptDescriptor) => { d.agentAsk = { proposal: "x", intent: "log", targetRef: null }; }, "cannot be combined"],
    ["a duplicate proposal", (d: OperatorScriptDescriptor) => { d.agentAskRejections!.proposals.push(d.agentAskRejections!.proposals[0]); }, "distinct"],
    ["a non-proposal id", (d: OperatorScriptDescriptor) => { d.agentAskRejections!.proposals[0] = "pr-opened-arcadia-pr1212"; }, "distinct"],
    ["an absolute manifest path", (d: OperatorScriptDescriptor) => { d.agentAskRejections!.manifest = "/etc/list.json"; }, "repository-relative"],
    ["a traversing manifest path", (d: OperatorScriptDescriptor) => { d.agentAskRejections!.manifest = "../list.json"; }, "repository-relative"],
    ["an extra field", (d: OperatorScriptDescriptor) => { (d.agentAskRejections as unknown as Record<string, unknown>).disposition = "accepted"; }, "exactly"]
  ])("refuses %s", (_label, mutate, text) => {
    const d = plain(); mutate(d);
    expect(() => validateOperatorScriptContract(d, ID, scriptText)).toThrow(text);
  });
  it("still refuses the shared Plan-amendment runner without a planAmendment", () => {
    expect(() => validateOperatorScriptContract(descriptor(), ID, scriptText + "\nnode scripts/run-plan-amendment.mjs\n")).toThrow("shared runner");
  });
});

describe("the settlement guard enforces the pinned rejection scope", () => {
  const ask = { requestId: "anything", intent: "action", targetRef: null } as unknown as NormalizedAgentAsk;
  function context(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "todo-bulk-guard-")); roots.push(dir);
    for (const suffix of [".json", ".sh"]) copyFileSync(path.join(library, ID + suffix), path.join(dir, ID + suffix));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", ID);
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", path.join(dir, `${ID}.json`));
    return dir;
  }
  it("admits a pinned proposal only when it is rejected", () => {
    context();
    const pinned = descriptor().agentAskRejections!.proposals[0];
    expect(() => assertOperatorSettlementContract(ask, { proposalId: pinned, disposition: "rejected" })).not.toThrow();
    expect(() => assertOperatorSettlementContract(ask, { proposalId: pinned, disposition: "accepted" })).toThrow("only reject");
    expect(() => assertOperatorSettlementContract({ ...ask, intent: "plan", targetRef: "plan/x" }, { proposalId: pinned, disposition: "accepted" })).toThrow("only reject");
  });
  it("refuses a proposal outside the pin, including the protected ones", () => {
    context();
    for (const id of ["agentask_0000000000000000aa", ...PINS.neverTouch.proposals]) {
      expect(() => assertOperatorSettlementContract(ask, { proposalId: id, disposition: "rejected" })).toThrow("only reject");
    }
    expect(() => assertOperatorSettlementContract(ask)).toThrow("only reject");
  });
});

describe("the launcher", () => {
  it("describes itself and refuses unknown arguments without running anything", () => {
    const sh = path.join(library, `${ID}.sh`);
    const described = spawnSync(sh, ["--describe"], { encoding: "utf8" });
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toMatchObject({ id: ID, repeatable: false });
    const bad = spawnSync(sh, ["--force"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("usage:");
  });
});
