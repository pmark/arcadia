import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { runOperatorActionSettleAskCommand } from "../src/commands/operatorAction.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { pinnedAskSettlementLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { runPinnedAskSettlement } from "../src/operatorActions/pinnedAskSettlement.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const sourceRoot = path.resolve(import.meta.dirname, "..");
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A registered Project "demo" with a clean main checkout, one recorded `log` Ask and a host state directory. */
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-pinned-ask-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  const state = path.join(root, "state");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  copyFileSync(path.join(sourceRoot, "mise.toml"), path.join(repo, "mise.toml"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "pinned-ask-test@example.invalid");
  git("config", "user.name", "Pinned Ask Test");
  git("config", "commit.gpgsign", "false");
  const action = { id: "first", title: "Prove the runner", status: "open", responsibility: "agent", effort: "session", next_action: "Prove settlement", expected_artifact: "Runner evidence", clarification: "clarified", confidence: "high", acceptance_criteria: ["The runner receipt contains a real newline."], depends_on: [], decisions: [], references: [] };
  const project = { arcadia: "v1", type: "project", slug: "demo", name: "Demo", status: "active", goal: "Prove settlement", outcome: "Safe settlement", milestone: "Settlement", active_plan: "demo-plan", current_action: "first", updated: "2026-10-20" };
  const plan = { arcadia: "v1", type: "plan", slug: "demo-plan", project: "demo", status: "active", milestone: "Settlement", current_action: "first", token_impact: "none", token_budget: "No models", recommended_model: "gpt-6.1-sol", updated: "2026-10-20", actions: [action], questions: [], decisions: [] };
  const writeDoc = (file: string, data: unknown) => writeFileSync(path.join(repo, file), `---\n${stringify(data)}---\n\n# Real document body\n`);
  writeDoc("PROJECT.md", project);
  writeDoc("docs/plans/demo-plan.md", plan);
  git("add", "."); git("commit", "-qm", "Fixture");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const created = upsertProject(db, { name: "Demo", mission: "Hermetic proof", goal: "Safe settlement", status: "active", currentMilestone: "Settlement", nextAction: "Prove settlement", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: created.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: ["demo/first"], order: ["demo/first"], requestId: "fixture-order", apply: true });
  });
  const register = (requestId: string, desired = "Record that the pinned settlement runner works.") => runAgentAskPreviewCommand({
    workspace, dir: repo, request: JSON.stringify({ agent_ask: "v1", request_id: requestId, project: "demo", intent: "log", desired_result: desired })
  }).data.proposal;
  vi.stubEnv("ARCADIA_WORKSPACE", workspace);
  vi.stubEnv("ARCADIA_CONFIG_PATH", path.join(root, "no-host-config.json"));
  const settlements = () => withDatabase(workspace, (db) => (db.prepare("SELECT count(*) AS count FROM agent_ask_settlements").get() as { count: number }).count);
  const env = { ...process.env, ARCADIA_WORKSPACE: workspace, ARCADIA_OPERATOR_SCRIPT_STATE_DIR: state };
  /** Press the button as the dashboard does: its execution context names this exact library entry. */
  const press = (descriptorPath: string) => {
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", path.basename(descriptorPath, ".json"));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", descriptorPath);
    try { return runPinnedAskSettlement(descriptorPath, env); }
    finally { vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", undefined); vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", undefined); }
  };
  return { root, repo, workspace, state, git, register, settlements, press };
}

function generate(f: ReturnType<typeof fixture>, proposal: string, fingerprint: string) {
  return runOperatorActionSettleAskCommand({ workspace: f.workspace, project: "demo", proposal, fingerprint, disposition: "accepted", dir: f.repo }).data;
}

describe("operator-action settle-ask and the shared pinned settlement runner", () => {
  it("generates a validated pair, settles exactly the pinned Ask once, replays a second press and keeps the checkout clean", () => {
    const f = fixture();
    const proposal = f.register("log-pinned-runner");
    const generated = generate(f, "log-pinned-runner", proposal.fingerprint);
    expect(generated).toMatchObject({ key: "demo--settle-log-pinned-runner", actionsPath: "/actions/demo--settle-log-pinned-runner", written: true, placement: null });
    const descriptor = JSON.parse(readFileSync(generated.descriptorPath, "utf8")) as OperatorScriptDescriptor;
    expect(readFileSync(generated.scriptPath, "utf8")).toBe(pinnedAskSettlementLauncher(generated.id));
    expect(() => validateOperatorScriptContract(descriptor, generated.id, readFileSync(generated.scriptPath, "utf8"))).not.toThrow();
    expect(descriptor).toMatchObject({ project: "demo", repeatable: false, agentAsk: { proposal: "log-pinned-runner", intent: "log", targetRef: null },
      agentAskSettlement: { schema: "arcadia-agent-ask-settlement-v1", project: "demo", proposalFingerprint: proposal.fingerprint, requestId: "settle-log-pinned-runner", disposition: "accepted", placement: null } });
    // Regenerating identical content is idempotent.
    expect(generate(f, "log-pinned-runner", proposal.fingerprint).written).toBe(false);
    f.git("add", "."); f.git("commit", "-qm", "Publish the button");

    const first = f.press(generated.descriptorPath);
    expect(first.status, `${first.reason}: ${first.message}`).toBe("succeeded");
    expect(first.reason).toBe("SETTLED");
    expect(first.settlement).toMatchObject({ proposalRequestId: "log-pinned-runner", settlementRequestId: "settle-log-pinned-runner", disposition: "accepted", applied: true });
    expect(f.settlements()).toBe(1);
    expect(f.git("status", "--porcelain")).toBe("");
    // Receipts live in the host state directory, never inside the Project library.
    expect(JSON.parse(readFileSync(path.join(f.state, "runs/receipts", `${generated.id}.json`), "utf8"))).toMatchObject({ schema: "arcadia-agent-ask-settlement-receipt-v1", status: "succeeded" });
    expect(existsSync(path.join(generated.library, "runs"))).toBe(false);

    const second = f.press(generated.descriptorPath);
    expect(second.status, second.message).toBe("succeeded");
    expect(second.reason).toBe("REPLAYED");
    expect(f.settlements()).toBe(1);
  });

  it("refuses a stale fingerprint, at generation and at the press, without settling anything", () => {
    const f = fixture();
    const proposal = f.register("log-stale-pin");
    const stale = "0".repeat(64);
    expect(() => generate(f, "log-stale-pin", stale)).toThrow(/preview fingerprint/);
    const generated = generate(f, "log-stale-pin", proposal.fingerprint);
    const descriptor = JSON.parse(readFileSync(generated.descriptorPath, "utf8")) as OperatorScriptDescriptor;
    descriptor.agentAskSettlement!.proposalFingerprint = stale;
    writeFileSync(generated.descriptorPath, JSON.stringify(descriptor, null, 2) + "\n");
    f.git("add", "."); f.git("commit", "-qm", "Publish a stale button");
    const head = f.git("rev-parse", "HEAD");
    const result = f.press(generated.descriptorPath);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("STALE_FINGERPRINT");
    expect(f.settlements()).toBe(0);
    expect(f.git("rev-parse", "HEAD")).toBe(head);
  });

  it("refuses an Ask that someone else already settled", () => {
    const f = fixture();
    const proposal = f.register("log-settled-elsewhere");
    const generated = generate(f, "log-settled-elsewhere", proposal.fingerprint);
    f.git("add", "."); f.git("commit", "-qm", "Publish the button");
    const options = { workspace: f.workspace, proposal: "log-settled-elsewhere", requestId: "someone-else", disposition: "rejected" as const, cwd: f.repo };
    const preview = runAgentAskSettleCommand(options).data.receipt;
    runAgentAskSettleCommand({ ...options, preview: preview.previewFingerprint, apply: true });
    const result = f.press(generated.descriptorPath);
    expect(result.reason).toBe("ALREADY_SETTLED");
    expect(f.settlements()).toBe(1);
    expect(() => generate(f, "log-settled-elsewhere", proposal.fingerprint)).toThrow(/already settled/);
  });

  it("confines a pinned settlement to the pinned Project's own library", () => {
    const f = fixture();
    const proposal = f.register("log-confined");
    const generated = generate(f, "log-confined", proposal.fingerprint);
    // The same validated pair copied anywhere else (here: another directory) is not that Project's library.
    const elsewhere = path.join(f.root, "elsewhere/artifacts/generated/operator-scripts");
    mkdirSync(path.dirname(elsewhere), { recursive: true });
    cpSync(generated.library, elsewhere, { recursive: true });
    const result = f.press(path.join(elsewhere, `${generated.id}.json`));
    expect(result.reason).toBe("WRONG_LIBRARY");
    expect(f.settlements()).toBe(0);
    expect(readdirSync(elsewhere).sort()).toEqual([`${generated.id}.json`, `${generated.id}.sh`]);
  });

  it("refuses to settle a pinned descriptor outside the shared runner", () => {
    const f = fixture();
    const proposal = f.register("log-outside-runner");
    const generated = generate(f, "log-outside-runner", proposal.fingerprint);
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", generated.id);
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", generated.descriptorPath);
    expect(() => runAgentAskSettleCommand({ workspace: f.workspace, proposal: "log-outside-runner", requestId: "settle-log-outside-runner", disposition: "accepted", cwd: f.repo }))
      .toThrow(/shared runner/);
  });

  it("refuses a checkout of another repository and an existing-Plan amendment", () => {
    const f = fixture();
    const proposal = f.register("log-wrong-repo");
    const other = path.join(f.root, "other");
    mkdirSync(other);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: other });
    expect(() => runOperatorActionSettleAskCommand({ workspace: f.workspace, project: "demo", proposal: "log-wrong-repo", fingerprint: proposal.fingerprint, disposition: "accepted", dir: other }))
      .toThrow(/not a checkout of demo's repository/);
    const amendment = runAgentAskPreviewCommand({ workspace: f.workspace, dir: f.repo, request: JSON.stringify({
      agent_ask: "v1", request_id: "amend-first-here", project: "demo", intent: "plan", target_ref: "plan/demo-plan", desired_result: "Amend first",
      requested_authority: "apply_if_approved", actions: [{ target_ref: "action/first", desired_result: "Amended", acceptance: ["One amended criterion."], dependencies: [], references: [] }]
    }) }).data.proposal;
    expect(() => generate(f, "amend-first-here", amendment.fingerprint)).toThrow(/Plan-amendment runner/);
  });
});
