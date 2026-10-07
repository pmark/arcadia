import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DRY_PREP_FIXTURE_GITHUB_REPO, DRY_PREP_FIXTURE_REPO_PATH, DRY_PREP_SCHEMA, NEUTRAL_RECOMMENDED_MODEL_TIER,
  assertSafeOutputDir, dryPrepDescriptor, neutralBaselineCoherenceProblems, neutralBaselineProblems,
  neutralStepIds, observeNeutralBaseline, renderNeutralBaseline, sha256Hex,
  stageDryPreparation, validateDryPrepParams,
  type DryPrepParams
} from "../src/operatorActions/rehearsalDryPreparation.js";
import { REQUIRED_COMMIT_FLOOR, type ChainRequiredCommit } from "../src/operatorActions/rehearsalChain.js";

/**
 * The N-neutral rehearsal dry-preparation generator: parameter validation,
 * the fresh step-01..step-NN baseline (for N=2, N=3 and another supported N,
 * judged by Arcadia's real discovery, ready set and requirementIdentity), the
 * coherence guard, and the resumable hash-bound staging command. Everything
 * here is file-local and dry: no Git, GitHub, workspace or model is touched.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");

const REQUIRED_COMMITS: ChainRequiredCommit[] = Object.entries(REQUIRED_COMMIT_FLOOR).map(([commit, why]) => ({ commit, why }));
const PRESERVATION = { resetRunId: "20261006T173810Z-40687", resetHead: "f478438a00d98dae34434ca2b6ddebc3da0e9b73", terminalOffRunId: "20261006T175308Z-12860", localMain: "f478438a00d98dae34434ca2b6ddebc3da0e9b73" };

function baseParams(actionCount = 3, runId = "dry-prep-run1-2026-10-07"): DryPrepParams {
  return {
    schema: DRY_PREP_SCHEMA,
    runId,
    actionCount,
    fixtureRepoPath: DRY_PREP_FIXTURE_REPO_PATH,
    fixtureGithubRepo: DRY_PREP_FIXTURE_GITHUB_REPO,
    requiredCommits: REQUIRED_COMMITS,
    preservation: PRESERVATION
  };
}

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

describe("validateDryPrepParams", () => {
  it("accepts a fully filled parameter file pinning run identity, N, the fixture and preservation bindings", () => {
    const { params, problems, unfilled } = validateDryPrepParams(baseParams());
    expect(problems).toEqual([]);
    expect(unfilled).toEqual([]);
    expect(params?.actionCount).toBe(3);
  });

  it.each([2, 3, 5, 12])("accepts N=%i within the supported bound", (actionCount) => {
    const { problems } = validateDryPrepParams(baseParams(actionCount));
    expect(problems).toEqual([]);
  });

  it.each([
    ["N below the floor", (p: Record<string, any>) => { p.actionCount = 1; }, "actionCount"],
    ["N above the ceiling", (p: Record<string, any>) => { p.actionCount = 13; }, "actionCount"],
    ["a fractional N", (p: Record<string, any>) => { p.actionCount = 2.5; }, "actionCount"],
    ["a wrong schema", (p: Record<string, any>) => { p.schema = "x"; }, "params.schema"],
    ["an unpinned fixture path", (p: Record<string, any>) => { p.fixtureRepoPath = "/tmp/other-fixture"; }, "fixtureRepoPath"],
    ["an unpinned GitHub repository", (p: Record<string, any>) => { p.fixtureGithubRepo = "someone-else/rehearsal"; }, "fixtureGithubRepo"],
    ["an unknown key", (p: Record<string, any>) => { p.extra = true; }, "params.extra is not a known parameter"],
    ["no required commits", (p: Record<string, any>) => { p.requiredCommits = []; }, "requiredCommits"],
    ["a required-commit list without the floor", (p: Record<string, any>) => { p.requiredCommits = p.requiredCommits.slice(1); }, "the floor cannot be removed"],
    ["a malformed preservation reset head", (p: Record<string, any>) => { p.preservation.resetHead = "abc"; }, "resetHead"]
  ])("refuses %s (authority boundary)", (_label, mutate, expected) => {
    const params = structuredClone(baseParams()) as unknown as Record<string, any>;
    mutate(params);
    const { params: valid, problems } = validateDryPrepParams(params);
    expect(valid).toBeNull();
    expect(problems.join("; ")).toContain(expected);
  });

  it("tracks UNFILLED preservation bindings separately from shape problems", () => {
    const params = structuredClone(baseParams()) as unknown as Record<string, any>;
    params.preservation.resetHead = "UNFILLED: fill in from the prior run's reset receipt";
    const { problems, unfilled } = validateDryPrepParams(params);
    expect(problems).toEqual([]);
    expect(unfilled).toContain("params.preservation.resetHead");
  });
});

describe("the step-01..step-NN baseline", () => {
  it.each([2, 3, 5])("renders N=%i coherently with serial depends_on and no run-specific amendment cloning", (actionCount) => {
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount }, "2026-10-07");
    expect(baseline.actionIds).toEqual(neutralStepIds(actionCount));
    expect(baseline.actionIds[0]).toBe("step-01");
    expect(baseline.actionIds.at(-1)).toBe(`step-${String(actionCount).padStart(2, "0")}`);
    expect(neutralBaselineCoherenceProblems(baseline, actionCount)).toEqual([]);
    // Every rendering is derived purely from N and the run id: no base document is read or amended.
    expect(baseline.plan).not.toContain("UNFILLED");
  });

  it("the coherence guard refuses a baseline rendered for the wrong N (a drifted rendering, caught before any write)", () => {
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount: 3 }, "2026-10-07");
    expect(neutralBaselineCoherenceProblems(baseline, 5).join("; ")).toMatch(/states 3 Actions but this run's chain has 5/);
  });

  it("names a model tier, never a hard-coded provider model, in the staged Plan", () => {
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount: 3 }, "2026-10-07");
    expect(baseline.plan).toContain(`recommended_model: ${NEUTRAL_RECOMMENDED_MODEL_TIER}`);
    expect(NEUTRAL_RECOMMENDED_MODEL_TIER).toBe("standard");
    expect(baseline.plan).not.toMatch(/recommended_model: claude|recommended_model: gpt|recommended_model: codex/);
  });

  it("each Action names concrete, observable fixture work (STEPS.md content), not a vague placeholder", () => {
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount: 3 }, "2026-10-07");
    expect(baseline.plan).toContain("STEPS.md");
    expect(baseline.plan).toContain('exactly the line "neutral step 01 start"');
    expect(baseline.plan).toContain('"neutral step 02 follows neutral step 01"');
    expect(baseline.plan).not.toMatch(/awaiting later unspecified|placeholder for Action/i);
  });

  it.each([2, 3, 5])("Arcadia's own discovery, ready set and requirementIdentity validate N=%i: only step-01 is ready, in a serial chain, every Action open and agent-owned", (actionCount) => {
    const root = temp("dry-prep-baseline-");
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount }, "2026-10-07");
    writeFileSync(path.join(root, "PROJECT.md"), baseline.project, "utf8");
    mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    writeFileSync(path.join(root, "docs", "plans", "neutral-rehearsal-dry-preparation.md"), baseline.plan, "utf8");
    const observation = observeNeutralBaseline(root);
    expect(neutralBaselineProblems(observation, { actionIds: baseline.actionIds })).toEqual([]);
    expect(observation.ready).toEqual(["step-01"]);
    expect(observation.actions?.map((a) => a.dependsOn)).toEqual(baseline.actionIds.map((_id, i) => (i === 0 ? [] : [baseline.actionIds[i - 1]])));
  });
});

describe("stageDryPreparation (the dry-only command)", () => {
  it("stages a fresh baseline into an isolated output directory and writes a hash-bound receipt naming the next gated step", () => {
    const output = temp("dry-prep-output-");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("staged");
    if (result.status !== "staged") throw new Error("expected staged");
    expect(result.receipt.actionIds).toEqual(["step-01", "step-02", "step-03"]);
    expect(result.receipt.fixtureRepoPath).toBe(DRY_PREP_FIXTURE_REPO_PATH);
    expect(result.receipt.nextStep).toContain("separate, not-yet-built adapter");
    expect(result.receipt.nextStep).toContain("NOT the ids the existing rehearsal-chain");
    expect(result.receipt.nextStep).not.toMatch(/\bG6\b runs|press G7|activates production/);
    expect(existsSync(path.join(output, "fixture", "PROJECT.md"))).toBe(true);
    expect(existsSync(path.join(output, "fixture", "docs", "plans", "neutral-rehearsal-dry-preparation.md"))).toBe(true);
    expect(existsSync(path.join(output, "receipt.json"))).toBe(true);
  });

  it("never performs a live mutation: it writes only under the output directory it was given", () => {
    const output = temp("dry-prep-output-");
    const before = readFileSync(path.join(repoRoot, "PROJECT.md"), "utf8");
    stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(readFileSync(path.join(repoRoot, "PROJECT.md"), "utf8")).toBe(before);
  });

  it("refuses to stage inside the main operator-scripts library", () => {
    const unsafe = assertSafeOutputDir(path.join(repoRoot, "artifacts", "generated", "operator-scripts", "dry-prep"), repoRoot);
    expect(unsafe.join("; ")).toContain("main operator-scripts library");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", path.join(repoRoot, "artifacts", "generated", "operator-scripts", "dry-prep"), repoRoot);
    expect(result.status).toBe("refused");
  });

  it("reproducibility: the same inputs reuse the proven stage without rewriting it", () => {
    const output = temp("dry-prep-output-");
    const first = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(first.status).toBe("staged");
    const planPath = path.join(output, "fixture", "docs", "plans", "neutral-rehearsal-dry-preparation.md");
    const writtenAt = readFileSync(planPath, "utf8");
    const second = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(second.status).toBe("resumed");
    if (second.status !== "resumed") throw new Error("expected resumed");
    if (first.status !== "staged") throw new Error("expected staged");
    expect(second.receipt).toEqual(first.receipt);
    expect(readFileSync(planPath, "utf8")).toBe(writtenAt);
  });

  it("changed N refuses the existing output directory and touches nothing already staged", () => {
    const output = temp("dry-prep-output-");
    stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    const receiptBefore = readFileSync(path.join(output, "receipt.json"), "utf8");
    const changed = stageDryPreparation(baseParams(5), "2026-10-07", output, repoRoot);
    expect(changed.status).toBe("refused");
    if (changed.status !== "refused") throw new Error("expected refused");
    expect(changed.problems.join("; ")).toContain("descriptor changed");
    expect(readFileSync(path.join(output, "receipt.json"), "utf8")).toBe(receiptBefore);
  });

  it("a stale receipt (changed reused generator source) refuses and names the drift", () => {
    const output = temp("dry-prep-output-");
    const first = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(first.status).toBe("staged");
    const receipt = JSON.parse(readFileSync(path.join(output, "receipt.json"), "utf8"));
    receipt.sourceHash = "0000000000000000000000000000000000000000000000000000000000000000";
    writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("reused generator source changed");
  });

  it("interruption and replay: a rerun after the owned marker and the fixture tree were written but before the receipt completes safely, overwriting identical bytes", () => {
    const output = temp("dry-prep-output-");
    const params = baseParams(3);
    const baseline = renderNeutralBaseline({ runId: params.runId, actionCount: 3 }, "2026-10-07");
    mkdirSync(path.join(output, "fixture", "docs", "plans"), { recursive: true });
    writeFileSync(path.join(output, ".dry-prep-stage.json"), `${JSON.stringify({ schema: DRY_PREP_SCHEMA, runId: params.runId })}\n`, "utf8");
    writeFileSync(path.join(output, "fixture", "PROJECT.md"), baseline.project, "utf8");
    writeFileSync(path.join(output, "fixture", "docs", "plans", "neutral-rehearsal-dry-preparation.md"), baseline.plan, "utf8");
    expect(existsSync(path.join(output, "receipt.json"))).toBe(false);
    const result = stageDryPreparation(params, "2026-10-07", output, repoRoot);
    expect(result.status).toBe("staged");
    expect(existsSync(path.join(output, "receipt.json"))).toBe(true);
  });

  it("refuses a symlink inside an interrupted owned stage without writing its target", () => {
    const output = temp("dry-prep-owned-alias-");
    const target = temp("dry-prep-unowned-target-");
    writeFileSync(path.join(output, ".dry-prep-stage.json"), JSON.stringify({ schema: DRY_PREP_SCHEMA, runId: baseParams().runId }));
    symlinkSync(target, path.join(output, "fixture"));
    const result = stageDryPreparation(baseParams(), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    expect(existsSync(path.join(target, "PROJECT.md"))).toBe(false);
  });

  it("refuses main even when main is supplied as repoRoot", () => {
    expect(assertSafeOutputDir("/Users/pmark/Dev/MR/Arcadia/arcadia/generated-dry-test", "/Users/pmark/Dev/MR/Arcadia/arcadia").join("; ")).toContain("main Arcadia checkout");
  });

  it("an unowned, non-empty output directory refuses before any write", () => {
    const output = temp("dry-prep-unowned-");
    writeFileSync(path.join(output, "unrelated.txt"), "someone else's content", "utf8");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("unrelated content");
    expect(existsSync(path.join(output, "receipt.json"))).toBe(false);
  });

  it("a malformed owned-stage marker refuses rather than being silently bypassed", () => {
    const output = temp("dry-prep-malformed-marker-");
    writeFileSync(path.join(output, ".dry-prep-stage.json"), "{not json", "utf8");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("marker is malformed");
  });

  it("a malformed receipt refuses rather than being silently treated as absent", () => {
    const output = temp("dry-prep-malformed-receipt-");
    stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    writeFileSync(path.join(output, "receipt.json"), "{not json", "utf8");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("receipt.json is malformed");
  });

  it("rejects staged-content tampering even when its per-file receipt hash is updated", () => {
    const output = temp("dry-prep-receipt-tamper-");
    stageDryPreparation(baseParams(), "2026-10-07", output, repoRoot);
    const planFile = path.join(output, "fixture", "docs", "plans", "neutral-rehearsal-dry-preparation.md");
    const changed = readFileSync(planFile, "utf8") + "\ntampered\n";
    writeFileSync(planFile, changed);
    const receiptFile = path.join(output, "receipt.json");
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    receipt.planHash = sha256Hex(changed);
    receipt.nextStep = "approved to execute";
    writeFileSync(receiptFile, JSON.stringify(receipt));
    const result = stageDryPreparation(baseParams(), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refusal");
    expect(result.problems.join("; ")).toContain("receipt field planHash changed");
    expect(result.problems.join("; ")).toContain("receipt field nextStep changed");
  });

  it("refuses extra authority fields in a resumed receipt", () => {
    const output = temp("dry-prep-receipt-fields-");
    stageDryPreparation(baseParams(), "2026-10-07", output, repoRoot);
    const file = path.join(output, "receipt.json");
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    receipt.authorityGranted = true;
    writeFileSync(file, JSON.stringify(receipt));
    const result = stageDryPreparation(baseParams(), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refusal");
    expect(result.problems.join("; ")).toContain("unsupported fields");
  });

  it("tamper detection: deleting a staged artifact after a successful stage refuses resume rather than silently reusing it", () => {
    const output = temp("dry-prep-tamper-");
    const first = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(first.status).toBe("staged");
    rmSync(path.join(output, "fixture", "PROJECT.md"));
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("staged PROJECT.md is missing");
  });

  it("tamper detection: editing a staged artifact's bytes after a successful stage refuses resume", () => {
    const output = temp("dry-prep-tamper-edit-");
    const first = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(first.status).toBe("staged");
    const planPath = path.join(output, "fixture", "docs", "plans", "neutral-rehearsal-dry-preparation.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\ntampered\n`, "utf8");
    const result = stageDryPreparation(baseParams(3), "2026-10-07", output, repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("does not match the receipt (tampered or regenerated");
  });

  it("refuses an output directory reached through a symlink into the main operator-scripts library", () => {
    const alias = temp("dry-prep-alias-");
    const link = path.join(alias, "link-to-library");
    symlinkSync(path.join(repoRoot, "artifacts", "generated", "operator-scripts"), link);
    const result = stageDryPreparation(baseParams(3), "2026-10-07", path.join(link, "dry-prep"), repoRoot);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("main operator-scripts library");
  });

  it("refuses an output directory reached through a symlink into the pinned live fixture path's parent", () => {
    const alias = temp("dry-prep-alias-fixture-");
    const fixtureParent = path.dirname(DRY_PREP_FIXTURE_REPO_PATH);
    if (!existsSync(fixtureParent)) return; // the pinned fixture is not present on this host; the denylist only matters when it exists
    const link = path.join(alias, "link-to-fixture-parent");
    symlinkSync(fixtureParent, link);
    const unsafe = assertSafeOutputDir(path.join(link, path.basename(DRY_PREP_FIXTURE_REPO_PATH)), repoRoot);
    expect(unsafe.join("; ")).toContain("pinned live fixture repository");
  });

  it("drift/refusal: Arcadia's own discovery refuses a baseline whose serial depends_on chain was corrupted after rendering", () => {
    const root = temp("dry-prep-corrupt-");
    const baseline = renderNeutralBaseline({ runId: "dry-prep-run1-2026-10-07", actionCount: 3 }, "2026-10-07");
    mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    writeFileSync(path.join(root, "PROJECT.md"), baseline.project, "utf8");
    const corrupted = baseline.plan.replace("depends_on: [step-01]", "depends_on: []");
    writeFileSync(path.join(root, "docs", "plans", "neutral-rehearsal-dry-preparation.md"), corrupted, "utf8");
    const observation = observeNeutralBaseline(root);
    expect(neutralBaselineProblems(observation, { actionIds: baseline.actionIds }).join("; ")).toContain("not the serial chain");
  });

  it("the descriptor hash is a normalized summary: notes changes invalidate the receipt while leaving its descriptor unchanged", () => {
    const output = temp("dry-prep-output-");
    const withNotes = { ...baseParams(3), notes: ["first note"] };
    stageDryPreparation(withNotes, "2026-10-07", output, repoRoot);
    const receiptBefore = readFileSync(path.join(output, "receipt.json"), "utf8");
    const changedNotes = { ...baseParams(3), notes: ["a different note, same descriptor"] };
    const result = stageDryPreparation(changedNotes, "2026-10-07", output, repoRoot);
    // The raw parameter bytes differ (paramsHash would differ) but the semantic descriptor does not, so this is reported as a change (paramsHash) while descriptorHash stays stable.
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("expected refused");
    expect(result.problems.join("; ")).toContain("validated parameter content changed");
    expect(result.problems.join("; ")).not.toContain("descriptor changed");
    expect(readFileSync(path.join(output, "receipt.json"), "utf8")).toBe(receiptBefore);
  });
});

describe("dryPrepDescriptor", () => {
  it("is a pure, deterministic function of the run's identity, N, fixture pins and reset date", () => {
    const a = dryPrepDescriptor(baseParams(3), "2026-10-07");
    const b = dryPrepDescriptor(baseParams(3), "2026-10-07");
    expect(sha256Hex(JSON.stringify(a))).toBe(sha256Hex(JSON.stringify(b)));
    const c = dryPrepDescriptor(baseParams(5), "2026-10-07");
    expect(sha256Hex(JSON.stringify(a))).not.toBe(sha256Hex(JSON.stringify(c)));
  });
});

