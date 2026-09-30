import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { runAgentAskDraftCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { documentState, type PlanAmendmentInput, type PlanAmendmentResult } from "../src/operatorActions/planAmendment.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const sourceRoot = path.resolve(import.meta.dirname, "..");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-plan-runner-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  const origin = path.join(root, "origin.git");
  const library = path.join(repo, "artifacts/generated/operator-scripts");
  mkdirSync(library, { recursive: true });
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, "scripts"));
  copyFileSync(path.join(sourceRoot, "mise.toml"), path.join(repo, "mise.toml"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "runner-test@example.invalid");
  git("config", "user.name", "Runner Test");
  git("config", "commit.gpgsign", "false");
  git("init", "--bare", "-q", origin);
  git("remote", "add", "origin", origin);
  const action = { id: "first", title: "Prove the runner", status: "open", responsibility: "agent", effort: "session", next_action: "Prove the original scope", expected_artifact: "Runner evidence", clarification: "clarified", confidence: "high", acceptance_criteria: ["Original criterion: real newline."], depends_on: [], decisions: [], references: [] };
  const project = { arcadia: "v1", type: "project", slug: "demo", name: "Demo", status: "active", goal: "Prove settlement", outcome: "Safe settlement", milestone: "Settlement", active_plan: "demo-plan", current_action: "first", updated: "2026-09-30" };
  const plan = { arcadia: "v1", type: "plan", slug: "demo-plan", project: "demo", status: "active", milestone: "Settlement", current_action: "first", token_impact: "none", token_budget: "No models", recommended_model: "gpt-6.1-sol", updated: "2026-09-30", actions: [action], questions: [], decisions: [] };
  const writeDoc = (file: string, data: unknown) => writeFileSync(path.join(repo, file), `---\n${stringify(data)}---\n\n# Real document body\n`);
  writeDoc("PROJECT.md", project);
  writeDoc("docs/plans/demo-plan.md", plan);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules\nsrc\nartifacts/generated/operator-scripts/runs/\n");
  symlinkSync(path.join(sourceRoot, "src"), path.join(repo, "src"), "dir");
  symlinkSync(path.join(sourceRoot, "node_modules"), path.join(repo, "node_modules"), "dir");
  for (const file of ["run-plan-amendment.mjs", "plan-amendment-worker.ts"]) copyFileSync(path.join(sourceRoot, "scripts", file), path.join(repo, "scripts", file));
  initWorkspace(workspace);
  withDatabase(workspace, db => {
    const project = upsertProject(db, { name: "Demo", mission: "Hermetic proof", goal: "Safe settlement", status: "active", currentMilestone: "Settlement", nextAction: "Prove settlement", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: ["demo/first"], order: ["demo/first"], requestId: "fixture-order", apply: true });
  });
  const ask = { agent_ask: "v1", request_id: "amend-first", project: "demo", intent: "plan", target_ref: "plan/demo-plan", desired_result: "Replace only first scope", requested_authority: "apply_if_approved", actions: [{ target_ref: "action/first", desired_result: "Prove the amended scope", acceptance: ["New criterion: real newline.", "Second criterion."], dependencies: [], references: [] }] };
  // Canonical draft and stored proposal, including real YAML newlines.
  const draft = runAgentAskDraftCommand({ workspace, dir: repo, request: stringify(ask) });
  expect(draft.data.workspaceStatus).toBe("previewed");
  git("add", "."); git("commit", "-qm", "Pinned source");
  const base = git("rev-parse", "HEAD");
  const after = { ...action, next_action: ask.actions[0].desired_result, acceptance_criteria: ask.actions[0].acceptance, source: "Agent Ask amend-first" };
  const input: PlanAmendmentInput = { schema: "arcadia-plan-amendment-v1", checkout: { path: repo, origin, branch: "main", reviewedBase: base }, ask: { path: path.relative(repo, draft.data.path), sha256: createHash("sha256").update(readFileSync(draft.data.path)).digest("hex"), proposal: "amend-first" }, settlement: { requestId: "accept-first", disposition: "accepted", operator: true }, envelope: { project: "demo", plan: "demo-plan", action: "first", projectUnchanged: { slug: "demo", active_plan: "demo-plan", current_action: "first" }, planUnchanged: { slug: "demo-plan", project: "demo", status: "active", current_action: "first", milestone: "Settlement" }, actionBefore: action, actionAfter: after, noChange: ["id", "title", "status", "responsibility", "effort", "expected_artifact", "clarification", "confidence", "depends_on", "decisions", "references"] }, publication: { remote: "origin", branch: "main" } };
  const id = "accept-first";
  const descriptor = path.join(library, `${id}.json`);
  const saveDescriptor = () => writeFileSync(descriptor, JSON.stringify({ schema: "arcadia-operator-script-v1", id, script: `${id}.sh`, planAmendment: input }, null, 2) + "\n");
  saveDescriptor();
  const template = readFileSync(path.join(sourceRoot, "artifacts/generated/operator-scripts/accept-close-ask-traceability-scope-2026-09-30.sh"), "utf8");
  const script = path.join(library, `${id}.sh`);
  writeFileSync(script, template.replaceAll("accept-close-ask-traceability-scope-2026-09-30", id));
  chmodSync(script, 0o755);
  git("add", "."); git("commit", "-qm", "Publish reviewed envelope"); git("push", "-q", "origin", "main");
  const run = (extraEnv: NodeJS.ProcessEnv = {}) => {
    const execution = spawnSync(script, ["run"], { cwd: repo, encoding: "utf8", timeout: 60_000, env: { ...process.env, ARCADIA_WORKSPACE: workspace, ARCADIA_CONFIG_PATH: path.join(root, "no-host-config.json"), ...extraEnv } });
    const receipt = JSON.parse(readFileSync(path.join(library, "runs/receipts", `${id}.json`), "utf8")) as PlanAmendmentResult;
    expect(execution.status, execution.stderr + execution.stdout).toBe(receipt.status === "succeeded" ? 0 : 1);
    return receipt;
  };
  const commit = () => { git("add", "."); git("commit", "-qm", "Fixture change"); git("push", "-q", "origin", "main"); };
  const count = () => withDatabase(workspace, db => (db.prepare("SELECT count(*) AS count FROM agent_ask_settlements").get() as { count: number }).count);
  const noMutation = (reason: string, env?: NodeJS.ProcessEnv) => {
    const head = git("rev-parse", "HEAD");
    const before = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    const order = withDatabase(workspace, db => [...loadActionOrder(db).positions]);
    const result = run(env);
    expect(result.reason, result.message).toBe(reason);
    expect(result.status).toBe("failed");
    expect(result.message).toBeTruthy(); expect(result.next).toBeTruthy();
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toBe(before);
    expect(withDatabase(workspace, db => [...loadActionOrder(db).positions])).toEqual(order);
    expect(count()).toBe(0);
    expect(existsSync(path.join(result.runDirectory, "failure-handoff.txt"))).toBe(true);
  };
  return { root, repo, workspace, origin, input, descriptor, script, run, commit, git, count, noMutation, saveDescriptor, writeDoc, plan, action };
}

describe("Plan-amendment operator action: real workspace and canonical preview/apply", () => {
  it("handles real newlines, obtains a fresh fingerprint with legal flags, applies once and publishes", () => {
    const f = fixture();
    const old = runAgentAskSettleCommand({ workspace: f.workspace, proposal: "amend-first", requestId: "accept-first", disposition: "accepted", cwd: f.repo }).data.receipt.previewFingerprint;
    // A queue revision changes the fingerprint without changing the allowed effects.
    withDatabase(f.workspace, db => arrangeActionOrder(db, { currentKeys: ["demo/first"], order: ["demo/first"], requestId: "harmless-order-revision", apply: true }));
    const result = f.run();
    expect(result.reason, result.message).toBe("SETTLED_AND_PUBLISHED");
    const preview = JSON.parse(readFileSync(path.join(result.runDirectory, "preview.json"), "utf8")) as { previewFingerprint: string; applied: boolean };
    expect(preview.applied).toBe(false);
    expect(result.settlement?.previewFingerprint).toBe(preview.previewFingerprint);
    expect(preview.previewFingerprint).not.toBe(old);
    expect(f.count()).toBe(1);
    expect(documentState(readFileSync(path.join(f.repo, "docs/plans/demo-plan.md"), "utf8")).fields.actions).toEqual([f.input.envelope.actionAfter]);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "HEAD")).toBe(f.git("rev-parse", "origin/main"));
  });
  it("rejects the real illegal Plan-amendment responsibility flag before mutation", () => {
    const f = fixture();
    expect(() => runAgentAskSettleCommand({ workspace: f.workspace, proposal: "amend-first", requestId: "illegal-flags", disposition: "accepted", responsibility: "agent", cwd: f.repo })).toThrow("preserve existing Responsibilities");
    (f.input.settlement as unknown as Record<string, unknown>).responsibility = "agent";
    f.saveDescriptor(); f.commit(); f.noMutation("INVALID_CONTRACT");
  });
  it("runs the final authority fence inside the real settlement write interlock", () => {
    const f = fixture();
    const flags = { workspace: f.workspace, proposal: "amend-first", requestId: "accept-first", disposition: "accepted" as const, cwd: f.repo };
    const preview = runAgentAskSettleCommand(flags).data.receipt;
    const before = readFileSync(path.join(f.repo, "docs/plans/demo-plan.md"), "utf8");
    expect(() => runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true,
      beforeGovernanceWrite: db => { expect(db.inTransaction).toBe(true); throw new Error("Authority fence refused drift"); }
    })).toThrow("Authority fence refused drift");
    expect(f.count()).toBe(0);
    expect(readFileSync(path.join(f.repo, "docs/plans/demo-plan.md"), "utf8")).toBe(before);
  });
  it("refuses a proposal already settled under another request", () => {
    const f = fixture();
    const flags = { workspace: f.workspace, proposal: "amend-first", requestId: "different-settlement", disposition: "accepted" as const, cwd: f.repo };
    const preview = runAgentAskSettleCommand(flags).data.receipt;
    runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true });
    const head = f.git("rev-parse", "HEAD");
    const result = f.run(); expect(result.reason).toBe("ANOTHER_PROPOSAL"); expect(f.count()).toBe(1); expect(f.git("rev-parse", "HEAD")).toBe(head);
  });
  it("accepts harmless base advancement without a republished fingerprint", () => {
    const f = fixture(); writeFileSync(path.join(f.repo, "README.md"), "Harmless base advance\n"); f.commit();
    const result = f.run(); expect(result.status, result.message).toBe("succeeded");
  });
  it.each(["status", "responsibility", "acceptance_criteria", "references"])("refuses target %s drift before mutation", field => {
    const f = fixture();
    const changed: Record<string, unknown> = { status: "in_progress", responsibility: "requires_review", acceptance_criteria: ["Drift"], references: ["README.md"] };
    f.writeDoc("docs/plans/demo-plan.md", { ...f.plan, actions: [{ ...f.action, [field]: changed[field] }] }); f.commit(); f.noMutation("TARGET_STATE_DRIFT");
  });
  it("refuses semantic effects outside the pinned replacement", () => {
    const f = fixture(); f.input.envelope.actionAfter.next_action = "Unexpected scope"; f.saveDescriptor(); f.commit(); f.noMutation("UNEXPECTED_EFFECTS");
  });
  it("refuses changed Ask bytes even if its meaning is unchanged", () => {
    const f = fixture(); const file = path.join(f.repo, f.input.ask.path); writeFileSync(file, readFileSync(file, "utf8") + "\n"); f.commit(); f.noMutation("CHANGED_ASK");
  });
  it("refuses dirty main", () => {
    const f = fixture(); writeFileSync(path.join(f.repo, "unrelated.txt"), "Unsaved work"); f.noMutation("DIRTY_CHECKOUT");
  });
  it("refuses unavailable workspace", () => { const f = fixture(); f.noMutation("WORKSPACE_UNAVAILABLE", { ARCADIA_WORKSPACE: path.join(f.root, "missing") }); });
  it("refuses wrong branch", () => { const f = fixture(); f.git("switch", "-qc", "other"); f.noMutation("WRONG_CHECKOUT"); });
  it("refuses another proposal without settling either", () => {
    const f = fixture(); f.input.ask.proposal = "another-proposal"; f.saveDescriptor(); f.commit(); f.noMutation("INVALID_CONTRACT");
  });
  it("replays a completed click without a second settlement or commit", () => {
    const f = fixture(); const first = f.run(); const head = f.git("rev-parse", "HEAD"); const second = f.run();
    expect(second.reason, second.message).toBe("REPLAY_PUBLISHED"); expect(second.settlement).toEqual(first.settlement); expect(f.count()).toBe(1); expect(f.git("rev-parse", "HEAD")).toBe(head);
  });
  it("retains a local settlement on push failure and retries only publication", () => {
    const f = fixture(); const hook = path.join(f.origin, "hooks/pre-receive"); writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const first = f.run(); expect(first.reason, first.message).toBe("PUBLICATION_FAILED"); expect(first.settlement?.applied).toBe(true); expect(f.count()).toBe(1);
    const head = f.git("rev-parse", "HEAD"); expect(head).not.toBe(f.git("rev-parse", "origin/main"));
    // Lose the runner's latest receipt: canonical settlement still recovers after a process loss.
    rmSync(path.join(f.repo, "artifacts/generated/operator-scripts/runs/receipts/accept-first.json"));
    // Simulate the dead invocation's lock: retry recovers without an agent.
    writeFileSync(path.join(f.repo, "artifacts/generated/operator-scripts/runs/receipts/accept-first.lock"), "2147483647");
    rmSync(hook); const retry = f.run(); expect(retry.status, retry.message).toBe("succeeded"); expect(retry.settlement).toEqual(first.settlement); expect(f.count()).toBe(1); expect(f.git("rev-parse", "HEAD")).toBe(head);
  });
  it("keeps a live claim and records a second click as a durable refusal", () => {
    const f = fixture();
    const receipts = path.join(f.repo, "artifacts/generated/operator-scripts/runs/receipts");
    mkdirSync(receipts, { recursive: true });
    writeFileSync(path.join(receipts, "accept-first.lock"), String(process.pid));
    const execution = spawnSync(f.script, ["run"], { cwd: f.repo, encoding: "utf8", env: { ...process.env, ARCADIA_WORKSPACE: f.workspace } });
    expect(execution.status).toBe(1);
    const result = JSON.parse(execution.stdout) as PlanAmendmentResult;
    expect(result.reason).toBe("ALREADY_RUNNING");
    expect(existsSync(path.join(result.runDirectory, "failure-handoff.txt"))).toBe(true);
    expect(readFileSync(path.join(receipts, "accept-first.lock"), "utf8")).toBe(String(process.pid));
    expect(f.count()).toBe(0);
  });
  it("serializes simultaneous stale-lock retries without stealing the new owner's claim", async () => {
    const f = fixture();
    const receipts = path.join(f.repo, "artifacts/generated/operator-scripts/runs/receipts");
    mkdirSync(receipts, { recursive: true });
    writeFileSync(path.join(receipts, "accept-first.lock"), "2147483647");
    const executions = Array.from({ length: 6 }, () => new Promise<PlanAmendmentResult>((resolve, reject) => {
      const child = spawn(f.script, ["run"], { cwd: f.repo, env: { ...process.env, ARCADIA_WORKSPACE: f.workspace }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", chunk => { output += String(chunk); });
      child.once("error", reject);
      child.once("close", () => { try { resolve(JSON.parse(output) as PlanAmendmentResult); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); } });
    }));
    const results = await Promise.all(executions);
    expect(results.filter(result => result.reason === "SETTLED_AND_PUBLISHED")).toHaveLength(1);
    expect(results.every(result => ["SETTLED_AND_PUBLISHED", "REPLAY_PUBLISHED", "ALREADY_RUNNING"].includes(result.reason))).toBe(true);
    expect(f.count()).toBe(1);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "HEAD")).toBe(f.git("rev-parse", "origin/main"));
  });
  it("refuses stale checkout while permitting no governance change", () => {
    const f = fixture(); const head = f.git("rev-parse", "HEAD");
    writeFileSync(path.join(f.repo, "README.md"), "Remote advance\n"); f.commit();
    f.git("reset", "--hard", head); f.noMutation("BASE_NOT_SYNCHRONIZED");
  });
  it("refuses drift after a locally committed settlement without publishing it", () => {
    const f = fixture(); const hook = path.join(f.origin, "hooks/pre-receive"); writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(f.run().reason).toBe("PUBLICATION_FAILED"); rmSync(hook);
    const remote = f.git("rev-parse", "origin/main");
    f.writeDoc("docs/plans/demo-plan.md", { ...f.plan, milestone: "Different milestone", actions: [f.input.envelope.actionAfter] });
    f.git("add", "."); f.git("commit", "-qm", "Plan drift after settlement");
    const result = f.run(); expect(result.reason).toBe("TARGET_STATE_DRIFT"); expect(f.count()).toBe(1); expect(f.git("rev-parse", "origin/main")).toBe(remote);
  });
  it("refuses unavailable origin before new settlement", () => { const f = fixture(); rmSync(f.origin, { recursive: true }); f.noMutation("PUBLICATION_UNAVAILABLE"); });
});
