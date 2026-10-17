import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { planAmendmentLauncher, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { documentState, type PlanActivationInput, type PlanAmendmentResult } from "../src/operatorActions/planAmendment.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const sourceRoot = path.resolve(import.meta.dirname, "..");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const action = (id: string, status: string, depends_on: string[] = []) => ({ id, title: `Do ${id}`, status, responsibility: "agent", effort: "session", next_action: `Do ${id}`, expected_artifact: `${id} evidence`, clarification: "clarified", confidence: "high", acceptance_criteria: [`The ${id} receipt records a real newline.`], depends_on, decisions: [], references: [] });

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-plan-activation-"));
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
  const project = { arcadia: "v1", type: "project", slug: "demo", name: "Demo", status: "active", goal: "Prove activation", outcome: "Safe activation", milestone: "Old milestone", active_plan: "old-plan", current_action: "old-first", updated: "2026-10-01" };
  const oldPlan = { arcadia: "v1", type: "plan", slug: "old-plan", project: "demo", status: "active", milestone: "Old milestone", current_action: "old-first", token_impact: "none", token_budget: "No models", updated: "2026-10-01", actions: [action("old-first", "open")], questions: [], decisions: [], recommended_model: "sonnet", recommended_reasoning_effort: "medium" };
  const newPlan = { arcadia: "v1", type: "plan", slug: "new-plan", project: "demo", status: "draft", milestone: "New milestone: unattended", token_impact: "none", token_budget: "No models", updated: "2026-10-01", actions: [action("done-one", "done"), action("next-one", "open", ["done-one"]), action("later-one", "open", ["next-one"])], questions: [], decisions: [], recommended_model: "standard", recommended_reasoning_effort: "medium" };
  const writeDoc = (file: string, data: unknown) => writeFileSync(path.join(repo, file), `---\n${stringify(data)}---\n\n# Real document body\n`);
  writeDoc("PROJECT.md", project);
  writeDoc("docs/plans/old-plan.md", oldPlan);
  writeDoc("docs/plans/new-plan.md", newPlan);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules\nsrc\nartifacts/generated/operator-scripts/runs/\n");
  symlinkSync(path.join(sourceRoot, "src"), path.join(repo, "src"), "dir");
  symlinkSync(path.join(sourceRoot, "node_modules"), path.join(repo, "node_modules"), "dir");
  for (const file of ["run-plan-amendment.mjs", "plan-amendment-worker.ts"]) copyFileSync(path.join(sourceRoot, "scripts", file), path.join(repo, "scripts", file));
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, db => {
    const row = upsertProject(db, { name: "Demo", mission: "Hermetic proof", goal: "Safe activation", status: "active", currentMilestone: "Old milestone", nextAction: "Prove activation", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: row.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: ["demo/old-first"], order: ["demo/old-first"], requestId: "fixture-order", apply: true });
    return row.id;
  });
  // The Ask is never registered beforehand: the runner records exactly this input, as on the live host.
  const ask = { agent_ask: "v1", request_id: "activate-new", project: "demo", intent: "plan", target_ref: "plan/new-plan", requested_authority: "apply_if_approved", desired_result: "Make new-plan the active Plan at next-one and park old-plan as draft." };
  const askPath = path.join(repo, ".arcadia/asks/agent-ask-activate-new.yaml");
  mkdirSync(path.dirname(askPath), { recursive: true }); writeFileSync(askPath, stringify(ask));
  git("add", "."); git("commit", "-qm", "Pinned source");
  const input: PlanActivationInput = {
    schema: "arcadia-plan-activation-v1",
    checkout: { path: repo, origin, branch: "main", reviewedBase: git("rev-parse", "HEAD") },
    ask: { path: path.relative(repo, askPath), sha256: createHash("sha256").update(readFileSync(askPath)).digest("hex"), proposal: "activate-new" },
    settlement: { requestId: "accept-activate-new", disposition: "accepted", operator: true, activate: true, action: "next-one", model: "standard", effort: "medium", placement: "top" },
    envelope: {
      project: "demo", plan: "new-plan", previousPlan: "old-plan", action: "next-one", log: "MISSION_LOG.md",
      projectBefore: { slug: "demo", active_plan: "old-plan", current_action: "old-first", milestone: "Old milestone" },
      projectAfter: { active_plan: "new-plan", current_action: "next-one", milestone: "New milestone: unattended" },
      planBefore: { slug: "new-plan", project: "demo", status: "draft", current_action: null, milestone: "New milestone: unattended" },
      planAfter: { status: "active", current_action: "next-one", recommended_model: "standard", recommended_reasoning_effort: "medium" },
      previousPlanBefore: { slug: "old-plan", project: "demo", status: "active", current_action: "old-first" },
      previousPlanAfter: { status: "draft", current_action: null },
      actionUnchanged: { id: "next-one", title: "Do next-one", status: "open", responsibility: "agent", clarification: "clarified" },
      queueSegment: ["demo/next-one", "demo/later-one"]
    },
    publication: { remote: "origin", branch: "main" }
  };
  const id = "activate-new-plan";
  const descriptor = path.join(library, `${id}.json`);
  const script = path.join(library, `${id}.sh`);
  const saveDescriptor = () => writeFileSync(descriptor, JSON.stringify({ schema: "arcadia-operator-script-v1", id, script: `${id}.sh`, title: "Hermetic activation", problem: "Prove safe activation", desired_effect: "Activate the pinned Plan", authority: { does: ["Activate this Plan"], never_does: ["Start a Session"] }, success: { effect: "Plan active", next: "Keep receipt" }, failure: { effect: "Refused", next: "Restore named precondition" }, repeatable: false, planActivation: input }, null, 2) + "\n");
  saveDescriptor();
  writeFileSync(script, planAmendmentLauncher(id)); chmodSync(script, 0o755);
  git("add", "."); git("commit", "-qm", "Publish reviewed envelope"); git("push", "-q", "origin", "main");
  const run = () => {
    const execution = spawnSync(script, ["run"], { cwd: repo, encoding: "utf8", timeout: 60_000, env: { ...process.env, ARCADIA_WORKSPACE: workspace, ARCADIA_CONFIG_PATH: path.join(root, "no-host-config.json"), ARCADIA_OPERATOR_SCRIPT_ID: id, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptor } });
    const receipt = JSON.parse(readFileSync(path.join(library, "runs/receipts", `${id}.json`), "utf8")) as PlanAmendmentResult;
    expect(execution.status, execution.stderr + execution.stdout).toBe(receipt.status === "succeeded" ? 0 : 1);
    return receipt;
  };
  const commit = () => { git("add", "."); git("commit", "-qm", "Fixture change"); git("push", "-q", "origin", "main"); };
  const count = () => withDatabase(workspace, db => (db.prepare("SELECT count(*) AS count FROM agent_ask_settlements").get() as { count: number }).count);
  const governed = ["PROJECT.md", "docs/plans/old-plan.md", "docs/plans/new-plan.md"];
  const noMutation = (reason: string) => {
    const head = git("rev-parse", "HEAD");
    const before = governed.map(file => readFileSync(path.join(repo, file), "utf8"));
    const order = withDatabase(workspace, db => [...loadActionOrder(db).positions]);
    const result = run();
    expect(result.reason, result.message).toBe(reason);
    expect(result.status).toBe("failed");
    expect(result.next).toBeTruthy();
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(governed.map(file => readFileSync(path.join(repo, file), "utf8"))).toEqual(before);
    expect(withDatabase(workspace, db => [...loadActionOrder(db).positions])).toEqual(order);
    expect(count()).toBe(0);
    expect(existsSync(path.join(result.runDirectory, "failure-handoff.txt"))).toBe(true);
    return result;
  };
  return { root, repo, workspace, input, descriptor, script, run, commit, git, count, noMutation, saveDescriptor, writeDoc, project, oldPlan, newPlan, projectId };
}

describe("Plan-activation operator action through the shared runner", () => {
  it("activates exactly the pinned images, places the segment at the top, publishes and replays once", () => {
    const f = fixture();
    const base = f.git("rev-parse", "HEAD");
    const result = f.run();
    expect(result.reason, result.message).toBe("SETTLED_AND_PUBLISHED");
    const fields = (file: string) => documentState(readFileSync(path.join(f.repo, file), "utf8")).fields;
    expect(fields("PROJECT.md")).toMatchObject({ active_plan: "new-plan", current_action: "next-one", milestone: "New milestone: unattended" });
    expect(fields("docs/plans/new-plan.md")).toMatchObject({ status: "active", current_action: "next-one", recommended_model: "standard", recommended_reasoning_effort: "medium", actions: f.newPlan.actions });
    expect(fields("docs/plans/old-plan.md")).toMatchObject({ status: "draft", actions: f.oldPlan.actions });
    expect(fields("docs/plans/old-plan.md")).not.toHaveProperty("current_action");
    expect(withDatabase(f.workspace, db => [...loadActionOrder(db).positions.keys()])).toEqual(["demo/next-one", "demo/later-one"]);
    const changed = f.git("diff", "--no-renames", "--name-only", base, "HEAD").split("\n").sort();
    expect(changed).toEqual([".arcadia/asks/agent-ask-activate-new.yaml", ".arcadia/asks/archive/agent-ask-activate-new.yaml", "MISSION_LOG.md", "PROJECT.md", "docs/plans/new-plan.md", "docs/plans/old-plan.md"]);
    expect(f.git("rev-parse", "HEAD")).toBe(f.git("rev-parse", "origin/main"));
    const head = f.git("rev-parse", "HEAD");
    const replay = f.run();
    expect(replay.reason, replay.message).toBe("REPLAY_PUBLISHED");
    expect(replay.settlement).toEqual(result.settlement);
    expect(f.count()).toBe(1);
    expect(f.git("rev-parse", "HEAD")).toBe(head);
  });
  it.each([
    ["Project pointer", (f: ReturnType<typeof fixture>) => f.writeDoc("PROJECT.md", { ...f.project, current_action: "other-action" })],
    ["previous Plan status", (f: ReturnType<typeof fixture>) => f.writeDoc("docs/plans/old-plan.md", { ...f.oldPlan, current_action: "other-action" })],
    ["activated Plan status", (f: ReturnType<typeof fixture>) => f.writeDoc("docs/plans/new-plan.md", { ...f.newPlan, status: "active" })],
    ["first Action", (f: ReturnType<typeof fixture>) => f.writeDoc("docs/plans/new-plan.md", { ...f.newPlan, actions: f.newPlan.actions.map(a => a.id === "next-one" ? { ...a, status: "in_progress" } : a) })]
  ])("refuses %s drift before settlement", (_label, drift) => {
    const f = fixture(); drift(f); f.commit(); f.noMutation("TARGET_STATE_DRIFT");
  });
  it("refuses a different Ask: one that also amends Actions", () => {
    const f = fixture();
    const file = path.join(f.repo, f.input.ask.path);
    const ask = { agent_ask: "v1", request_id: "activate-new", project: "demo", intent: "plan", target_ref: "plan/new-plan", requested_authority: "apply_if_approved", desired_result: "Activate and rewrite", actions: [{ target_ref: "action/next-one", desired_result: "Do something else", acceptance: ["Something else is proven."], dependencies: [], references: [] }] };
    writeFileSync(file, stringify(ask));
    f.input.ask.sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    f.saveDescriptor(); f.commit(); f.noMutation("ANOTHER_PROPOSAL");
  });
  it("refuses changed Ask bytes", () => {
    const f = fixture(); const file = path.join(f.repo, f.input.ask.path); writeFileSync(file, readFileSync(file, "utf8") + "\n"); f.commit(); f.noMutation("CHANGED_ASK");
  });
  it("refuses while a Session for the Project is running", () => {
    const f = fixture();
    withDatabase(f.workspace, db => {
      db.pragma("foreign_keys = OFF");
      const at = "2026-10-17T12:00:00.000Z";
      db.prepare(`INSERT INTO agent_sessions (
        id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id,
        work_item_id, packet_id, packet_path, packet_sha256, authorizing_decisions_json,
        execution_profile_json, provider_profile, provider, model, effort,
        provider_mapping_id, provider_binding_id, base_revision, branch, worktree_path,
        provider_session_id, display_name, terminal_transport, tmux_session_name, status,
        prepared_at, started_at, ended_at, exit_status, created_at, updated_at
      ) VALUES (
        'session-live', @project, 'demo', @repo, 'docs/plans/old-plan.md', 'old-plan', 'old-first',
        'work-live', 'packet-live', 'prompt.md', 'sha', '[]', NULL, 'test', 'claude-code-cli',
        'sonnet', 'high', NULL, NULL, 'base', 'claude/live', @repo, 'provider-live',
        'Live session', 'tmux', 'tmux-live', 'running', @at, @at, NULL, NULL, @at, @at
      )`).run({ project: f.projectId, repo: f.repo, at });
    });
    const result = f.noMutation("SETTLEMENT_REFUSED");
    expect(result.message).toContain("Reconcile the Project's existing Session or Run");
  });
  it("refuses an inconsistent envelope at the library contract", () => {
    const f = fixture();
    const d = JSON.parse(readFileSync(f.descriptor, "utf8"));
    const script = planAmendmentLauncher(d.id);
    expect(validateOperatorScriptContract(d, d.id, script).planActivation).toEqual(f.input);
    for (const mutate of [
      (i: PlanActivationInput) => { i.envelope.planAfter.recommended_model = "opus"; },
      (i: PlanActivationInput) => { (i.settlement as Record<string, unknown>).placement = "after"; },
      (i: PlanActivationInput) => { i.envelope.previousPlanAfter.current_action = "old-first"; },
      (i: PlanActivationInput) => { i.envelope.queueSegment = ["demo/later-one"]; }
    ]) {
      const changed = structuredClone(d); mutate(changed.planActivation);
      expect(() => validateOperatorScriptContract(changed, d.id, script)).toThrow();
    }
    expect(() => validateOperatorScriptContract({ ...d, planAmendment: {} }, d.id, script)).toThrow();
    expect(() => validateOperatorScriptContract({ ...d, repeatable: true }, d.id, script)).toThrow("one-shot");
    expect(() => validateOperatorScriptContract(d, d.id, script + "echo bespoke\n")).toThrow("shared runner launcher");
  });
});
