import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { planAmendmentLauncher, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { validatePlanAmendmentInput, type PlanAmendmentInput } from "../src/operatorActions/planAmendmentContract.js";
import type { PlanAmendmentResult } from "../src/operatorActions/planAmendment.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The two operator cards that must land before the next-run Grant is pressed
 * (Process Critic pre-mortem, 2026-10-19): the shared-runner amendment that makes
 * first-unattended-run wait for the three in-scope Actions, then the make-next
 * card that moves the pointer to the first of them and publishes it. Both run
 * here for real, through the canonical settlement and make-next commands, in a
 * throwaway checkout, bare origin and workspace built from the pinned
 * before-images; nothing touches the live checkout or workspace.
 */
const sourceRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(sourceRoot, "artifacts", "generated", "operator-scripts");
// Frozen copies of PROJECT.md and the Plan as merged by PR #1588 (29e611580), so a later settlement of the live
// Plan can never change what this 2026-10-19 proof builds on.
const frozen = path.join(sourceRoot, "tests", "fixtures", "next-run-pointer-preparation");
const AMEND_ID = "accept-first-unattended-run-depends-on-next-run-actions-20261019";
const POINT_ID = "point-at-test-transient-review-retry-20261019";
const PLAN = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
const PLAN_FILE = `docs/plans/${PLAN}.md`;
const IN_SCOPE = ["test-transient-review-retry-after-exhaustion", "refresh-decision-0130-status-and-1559-fake", "guard-repair-gate-upsert-role"];
const amendDescriptor = JSON.parse(readFileSync(path.join(library, `${AMEND_ID}.json`), "utf8")) as { planAmendment: PlanAmendmentInput } & Record<string, unknown>;
const pointDescriptor = JSON.parse(readFileSync(path.join(library, `${POINT_ID}.json`), "utf8")) as Record<string, unknown>;
const pinned = amendDescriptor.planAmendment;

// Stands in for mise: `exec -- pnpm -s arcadia ...` runs the real CLI from source; anything else runs as given.
const FAKE_MISE = `#!/usr/bin/env node
const cp = require("child_process");
let args = process.argv.slice(2);
if (args[0] === "exec" && args[1] === "--") args = args.slice(2);
if (args[0] === "pnpm" && args[1] === "-s" && args[2] === "arcadia") args = ["node", "--import", "tsx", process.env.FAKE_CLI, ...args.slice(3)];
const r = cp.spawnSync(args[0], args.slice(1), { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
`;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const frontmatter = (text: string) => parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)![1]) as Record<string, unknown>;
const body = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

function fixture(options: { amended?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-next-run-pointer-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  const origin = path.join(root, "origin.git");
  const bin = path.join(root, "bin");
  const lib = path.join(repo, "artifacts/generated/operator-scripts");
  for (const dir of [lib, path.join(repo, "docs/plans"), path.join(repo, "scripts"), path.join(repo, ".arcadia/asks"), bin]) mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "pointer-test@example.invalid");
  git("config", "user.name", "Pointer Test");
  git("config", "commit.gpgsign", "false");
  git("init", "--bare", "-q", origin);
  git("remote", "add", "origin", origin);

  // Before-images: the frozen documents with the pinned pointers, the pinned
  // first-unattended-run block, and the three in-scope Actions still open.
  const e = pinned.envelope;
  const projectText = readFileSync(path.join(frozen, "PROJECT.fixture.md"), "utf8");
  const project = { ...frontmatter(projectText), ...e.projectUnchanged };
  writeFileSync(path.join(repo, "PROJECT.md"), `---\n${stringify(project)}---\n${body(projectText)}`);
  const planText = readFileSync(path.join(frozen, "plan.fixture.md"), "utf8");
  const plan = frontmatter(planText);
  const actions = (plan.actions as Record<string, unknown>[]).map((action) =>
    action.id === e.action ? (options.amended ? e.actionAfter : e.actionBefore) : IN_SCOPE.includes(action.id as string) ? { ...action, status: "open" } : action);
  writeFileSync(path.join(repo, PLAN_FILE), `---\n${stringify({ ...plan, ...e.planUnchanged, actions })}---\n${body(planText)}`);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules\nsrc\nartifacts/generated/operator-scripts/runs/\n");
  symlinkSync(path.join(sourceRoot, "src"), path.join(repo, "src"), "dir");
  symlinkSync(path.join(sourceRoot, "node_modules"), path.join(repo, "node_modules"), "dir");
  for (const file of ["run-plan-amendment.mjs", "plan-amendment-worker.ts"]) copyFileSync(path.join(sourceRoot, "scripts", file), path.join(repo, "scripts", file));
  const askPath = pinned.ask.path;
  // Hermetic after the settlement archived the Ask on main: same bytes either way (a pure rename).
  const liveAsk = path.join(sourceRoot, askPath);
  const archivedAsk = path.join(sourceRoot, path.dirname(askPath), "archive", path.basename(askPath));
  copyFileSync(existsSync(liveAsk) ? liveAsk : archivedAsk, path.join(repo, askPath));
  writeFileSync(path.join(bin, "mise"), FAKE_MISE, { mode: 0o755 });

  initWorkspace(workspace);
  const keys = ["first-unattended-run", ...IN_SCOPE].map((id) => `arcadia/${id}`);
  withDatabase(workspace, (db) => {
    const row = upsertProject(db, { name: "Arcadia", mission: "Hermetic proof", goal: "Pointer preparation", status: "active", currentMilestone: "Unattended run", nextAction: "Prepare", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: row.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: keys, order: keys, requestId: "fixture-order", apply: true });
  });
  if (!options.amended) expect(runAgentAskPreviewCommand({ workspace, dir: repo, file: path.join(repo, askPath) }).data.proposal.id).toBeTruthy();
  git("add", "-A"); git("commit", "-qm", "Pinned before-images");
  const base = git("rev-parse", "HEAD");

  // Publish both cards exactly as reviewed, with this checkout pinned in place of the live one.
  const input = structuredClone(pinned);
  input.checkout = { ...input.checkout, path: repo, origin, reviewedBase: base };
  writeFileSync(path.join(lib, `${AMEND_ID}.json`), JSON.stringify({ ...amendDescriptor, planAmendment: input }, null, 2) + "\n");
  writeFileSync(path.join(lib, `${AMEND_ID}.sh`), readFileSync(path.join(library, `${AMEND_ID}.sh`)), { mode: 0o755 });
  copyFileSync(path.join(library, `${POINT_ID}.json`), path.join(lib, `${POINT_ID}.json`));
  writeFileSync(path.join(lib, `${POINT_ID}.sh`), readFileSync(path.join(library, `${POINT_ID}.sh`)), { mode: 0o755 });
  chmodSync(path.join(lib, `${POINT_ID}.sh`), 0o755);
  git("add", "-A"); git("commit", "-qm", "Publish reviewed cards"); git("push", "-q", "origin", "main");

  const env = (id: string) => ({
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CLI: path.join(sourceRoot, "src/cli.ts"),
    ARCADIA_WORKSPACE: workspace, ARCADIA_CONFIG_PATH: path.join(root, "no-host-config.json"),
    ARCADIA_OPERATOR_SCRIPT_ID: id, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(lib, `${id}.json`)
  });
  const amend = () => {
    const run = spawnSync(path.join(lib, `${AMEND_ID}.sh`), ["run"], { cwd: repo, encoding: "utf8", timeout: 120_000, env: env(AMEND_ID) });
    const receipt = JSON.parse(readFileSync(path.join(lib, "runs/receipts", `${AMEND_ID}.json`), "utf8")) as PlanAmendmentResult;
    return { run, receipt };
  };
  const point = () => spawnSync(path.join(lib, `${POINT_ID}.sh`), ["run"], { cwd: repo, encoding: "utf8", timeout: 240_000, env: env(POINT_ID) });
  const pointers = () => [frontmatter(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).current_action, frontmatter(readFileSync(path.join(repo, PLAN_FILE), "utf8")).current_action];
  const planAction = (id: string) => (frontmatter(readFileSync(path.join(repo, PLAN_FILE), "utf8")).actions as Record<string, unknown>[]).find((action) => action.id === id)!;
  const order = () => withDatabase(workspace, (db) => [...loadActionOrder(db).positions]);
  return { repo, git, amend, point, pointers, planAction, order };
}

describe("next-run pointer preparation: contracts", () => {
  it("the amendment card is the exact shared-runner launcher with a valid envelope that changes only depends_on and source", () => {
    validatePlanAmendmentInput(pinned);
    expect(readFileSync(path.join(library, `${AMEND_ID}.sh`), "utf8")).toBe(planAmendmentLauncher(AMEND_ID));
    validateOperatorScriptContract(amendDescriptor, AMEND_ID, readFileSync(path.join(library, `${AMEND_ID}.sh`), "utf8"));
    const { actionBefore, actionAfter } = pinned.envelope;
    const changed = Object.keys({ ...actionBefore, ...actionAfter }).filter((key) => JSON.stringify(actionBefore[key]) !== JSON.stringify(actionAfter[key]));
    expect(changed.sort()).toEqual(["depends_on", "source"]);
    expect(actionAfter.depends_on).toEqual([...(actionBefore.depends_on as string[]), ...IN_SCOPE]);
    expect(pinned.envelope.projectUnchanged.current_action).toBe("first-unattended-run");
  });
  it("the pointer card is a valid one-shot library entry that only calls make-next and a plain push", () => {
    const script = readFileSync(path.join(library, `${POINT_ID}.sh`), "utf8");
    validateOperatorScriptContract(pointDescriptor, POINT_ID, script);
    expect(pointDescriptor.repeatable).toBe(false);
    const code = script.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
    expect(code).not.toMatch(/agent-ask|--force|push -f|production activate|queue reorder|queue arrange/);
    expect(script).toContain("advance queue make-next");
  });
});

describe("next-run pointer preparation: real settlement and make-next", () => {
  it("amends first-unattended-run, then moves and publishes the pointer, leaving the queue order alone", () => {
    const f = fixture();
    const orderBefore = f.order();
    const { run, receipt } = f.amend();
    expect(receipt.reason, receipt.message + run.stderr).toBe("SETTLED_AND_PUBLISHED");
    expect(f.planAction("first-unattended-run").depends_on).toEqual(pinned.envelope.actionAfter.depends_on);
    expect(f.pointers()).toEqual(["first-unattended-run", "first-unattended-run"]);

    const head = f.git("rev-parse", "HEAD");
    const point = f.point();
    expect(point.status, point.stdout + point.stderr).toBe(0);
    expect(f.pointers()).toEqual([IN_SCOPE[0], IN_SCOPE[0]]);
    expect(f.git("rev-parse", "HEAD^")).toBe(head);
    expect(f.git("log", "-1", "--format=%s")).toBe(`chore(arcadia): point at ${IN_SCOPE[0]}`);
    expect(f.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort()).toEqual(["PROJECT.md", PLAN_FILE].sort());
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(f.git("rev-parse", "HEAD"));
    expect(f.order()).toEqual(orderBefore);

    // A second press finds the pointer already published and changes nothing.
    const published = f.git("rev-parse", "HEAD");
    const again = f.point();
    expect(again.status, again.stdout + again.stderr).toBe(0);
    expect(again.stdout).toContain("already names");
    expect(f.git("rev-parse", "HEAD")).toBe(published);
  }, 300_000);

  it("refuses to move the pointer before the amendment is on main, writing nothing", () => {
    const f = fixture();
    const head = f.git("rev-parse", "HEAD");
    const point = f.point();
    expect(point.status).not.toBe(0);
    expect(point.stderr + point.stdout).toContain(`press ${AMEND_ID} first`);
    expect(f.git("rev-parse", "HEAD")).toBe(head);
    expect(f.pointers()).toEqual(["first-unattended-run", "first-unattended-run"]);
  }, 120_000);

  it("refuses outside the operator-action library", () => {
    const f = fixture({ amended: true });
    const head = f.git("rev-parse", "HEAD");
    const run = spawnSync(path.join(f.repo, "artifacts/generated/operator-scripts", `${POINT_ID}.sh`), ["run"], { cwd: f.repo, encoding: "utf8", env: { ...process.env, ARCADIA_OPERATOR_SCRIPT_ID: "" } });
    expect(run.status).not.toBe(0);
    expect(run.stderr + run.stdout).toContain("operator-action library");
    expect(f.git("rev-parse", "HEAD")).toBe(head);
  }, 120_000);
});
