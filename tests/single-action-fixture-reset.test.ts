import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvanceQueueCommand } from "../src/commands/advance.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { SingleActionResetError, renderSingleActionReopen, singleActionCompletionId, singleActionOutputs, singleActionProblems } from "../src/operatorActions/singleActionFixtureReset.js";

/**
 * The single-Action fixture reset (operator script reset-single-action-fixture).
 * The behavioral cases run the real script, copied into a throwaway Arcadia
 * checkout with a bare origin, against a throwaway fixture clone whose origin
 * is a local bare repository (reached through the clone's own url.insteadOf, so
 * its configured URL is the real GitHub one), a real throwaway workspace and
 * the real Arcadia CLI, discovery, docs sync and queue. Only `mise`, `pnpm`
 * (workspace pinning) and `timeout` are shims. Like the other operator-script
 * suites, run it unsandboxed: the script's log tee needs /dev/fd.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const SCRIPT = "reset-single-action-fixture";
const REPO = "pmark/arcadia-three-action-rehearsal-20261004";
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const scriptSource = readFileSync(path.join(library, `${SCRIPT}.sh`), "utf8");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};
function git(cwd: string, args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
const commitAll = (cwd: string, message: string) => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};

describe("single-Action reopen rendering (pure)", () => {
  const plan = [
    "---", "arcadia: v1", "type: plan", "slug: p", "status: active", "updated: 2026-10-04", "actions:",
    "  - id: write-start-marker", "    title: T1", "    status: done", "    responsibility: agent", "    next_action: old one", "    acceptance_criteria:", "      - c1",
    "  - id: transform-start-marker", "    title: T2", "    status: open", "    responsibility: agent", "    next_action: old two", "    depends_on: [write-start-marker]",
    "questions: []", "current_action: transform-start-marker", "---", "", "# Body", ""
  ].join("\n");
  const project = ["---", "arcadia: v1", "type: project", "slug: x", "active_plan: p", "current_action: transform-start-marker", "updated: 2026-10-04", "---", "", "# X", ""].join("\n");

  it("reopens one Action: status, next_action, both pointers and both dates; every other line is byte for byte", () => {
    const out = renderSingleActionReopen(plan, project, { actionId: "write-start-marker", runTag: "t1", resetDate: "2026-10-09" });
    const lines = plan.split("\n");
    const after = out.plan.split("\n");
    expect(after).toHaveLength(lines.length);
    const changed = after.map((line, i) => (line === lines[i] ? null : line)).filter((line) => line !== null);
    expect(changed).toEqual([
      "updated: 2026-10-09", "    status: open", expect.stringContaining("    next_action: Implement MARKER.md containing exactly the line"), "current_action: write-start-marker"
    ]);
    expect(out.nextAction).toContain("complete-write-start-marker-t1");
    expect(out.nextAction).toContain("leave `git status` clean after settling");
    expect(out.statusBefore).toBe("done");
    expect(out.completionId).toBe(singleActionCompletionId("write-start-marker", "t1"));
    expect(out.project).toBe(project.replace("current_action: transform-start-marker", "current_action: write-start-marker").replace("updated: 2026-10-04", "updated: 2026-10-09"));
  });

  it("leaves PROJECT.md untouched when it already points at the Action, refuses a stale tag, an earlier host date and a bad Action", () => {
    const pointed = project.replace("transform-start-marker", "write-start-marker");
    expect(renderSingleActionReopen(plan, pointed, { actionId: "write-start-marker", runTag: "t1", resetDate: "2026-10-09" })).toMatchObject({ project: pointed, projectChanged: false });
    const once = renderSingleActionReopen(plan, project, { actionId: "write-start-marker", runTag: "t1", resetDate: "2026-10-09" });
    expect(() => renderSingleActionReopen(once.plan, project, { actionId: "write-start-marker", runTag: "t1", resetDate: "2026-10-09" })).toThrow(/NEXT_ACTION_NOT_FRESH|already carries/);
    expect(() => renderSingleActionReopen(plan, project, { actionId: "write-start-marker", runTag: "t1", resetDate: "2026-10-01" })).toThrow(SingleActionResetError);
    expect(() => renderSingleActionReopen(plan, project, { actionId: "verify-final-rehearsal", runTag: "t1", resetDate: "2026-10-09" })).toThrow(/no Action/);
    expect(singleActionProblems("write-start-marker", "Bad_Tag")).toHaveLength(1);
    expect(singleActionProblems("nope", "ok-1")).toHaveLength(1);
    expect(singleActionProblems("chain-step-12", "a".repeat(41))).toHaveLength(1);
    expect(singleActionProblems("chain-step-12", "run-9")).toEqual([]);
  });

  it("removes only an Action's own artifacts and refuses output it would have to edit out of a shared file", () => {
    const files: Record<string, string> = { "MARKER.md": "three-action rehearsal start\n", "tests/marker.test.mjs": "x", "CHAIN.md": "chain step 04 follows three-action rehearsal verified\nchain step 05 follows chain step 04\n" };
    const read = (file: string) => files[file] ?? null;
    expect(singleActionOutputs("write-start-marker", read)).toEqual({ remove: ["MARKER.md", "tests/marker.test.mjs"], problems: [] });
    expect(singleActionOutputs("chain-step-04", read)).toEqual({ remove: ["CHAIN.md"], problems: [] });
    expect(singleActionOutputs("chain-step-05", read).problems).toHaveLength(1);
    expect(singleActionOutputs("chain-step-06", read)).toEqual({ remove: [], problems: [] });
    expect(singleActionOutputs("transform-start-marker", read)).toEqual({ remove: ["tests/marker.test.mjs"], problems: [] });
    files["MARKER.md"] += "THREE-ACTION REHEARSAL START\n";
    expect(singleActionOutputs("transform-start-marker", read).problems).toHaveLength(1);
  });
});

describe("single-Action reset: static safety", () => {
  it("makes one commit, pushes only fixture main without force, touches no production, Grant, receipt of another script, pull request or Ask settlement", () => {
    const code = scriptSource.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(code.filter((line) => /\bcommit -q\b/.test(line))).toHaveLength(1);
    const pushes = code.filter((line) => /\bpush\b/.test(line) && /\bgit\b/.test(line) && !/echo|refuse "/.test(line));
    expect(pushes).toEqual(["  timeout 120 git -C \"$FIXTURE_REPO\" push -q origin refs/heads/main:refs/heads/main"]);
    expect(scriptSource).not.toMatch(/--force|--force-with-lease|push -f|push .*\+refs|reset --hard|update-ref|rebase|branch -[dDfF]/);
    expect(scriptSource).not.toMatch(/\bgh (api|pr|repo)\b|production (preview|activate|deactivate|status)|settle --apply/);
    expect(scriptSource).not.toMatch(/export ARCADIA_WORKSPACE|ARCADIA_WORKSPACE=/);
    expect(code.join("\n")).not.toMatch(/terminal-?Off|restore-terminal-off|\bG[678]\b/);
    expect(code.filter((line) => /\brm\b/.test(line) && !/fx rm -q --/.test(line))).toEqual([]);
  });
});

/** G1's genesis, rendered from G1's own heredocs into the box's fixture path. */
function renderG1Fixture(directory: string) {
  const script = readFileSync(path.join(library, `${G1}.sh`), "utf8");
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  const program = [constants, `REPO=${JSON.stringify(REPO)}`, "FIXTURE_DATE=2026-10-04", script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
}

const MISE = "#!/bin/sh\nshift 2\ncd \"$FAKE_ARCADIA_ROOT\" || exit 97\nexec \"$@\"\n";
const PNPM = `#!/bin/sh
shift 2
unset VITEST
printf '%s\\n' "$*" >> "$FAKE_ROOT/pnpm-calls.log"
if [ "$1" = workspace ] && [ "$2" = resolve ]; then
  printf '{"ok":true,"data":{"source":"user config","workspacePath":"%s"}}\\n' "$FAKE_WORKSPACE"; exit 0
fi
has=""
for a in "$@"; do [ "$a" = --workspace ] && has=1; done
if [ -n "$has" ]; then exec node --import tsx "$FAKE_ARCADIA_ROOT/src/cli.ts" "$@"; fi
exec node --import tsx "$FAKE_ARCADIA_ROOT/src/cli.ts" "$@" --workspace "$FAKE_WORKSPACE"
`;

function sandbox() {
  const root = temp("single-action-reset-");
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  const tmp = path.join(root, "tmp");
  const fixture = path.join(home, "tmp", "arcadia-three-action-rehearsal");
  const bare = path.join(root, "fixture-origin.git");
  mkdirSync(scripts, { recursive: true });
  for (const dir of [bin, home, tmp, path.dirname(fixture)]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
  writeFileSync(path.join(checkout, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: arcadia\nname: Arcadia\nstatus: active\ngoal: Checkout under test.\noutcome: Checkout under test.\nmilestone: Test\nupdated: 2026-10-05\n---\n\n# Arcadia\n");
  git(checkout, ["init", "-q", "-b", "main"]);
  commitAll(checkout, "init");
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
  git(checkout, ["push", "-q", "-u", "origin", "main"]);
  for (const ext of ["sh", "json"]) copyFileSync(path.join(library, `${SCRIPT}.${ext}`), path.join(scripts, `${SCRIPT}.${ext}`));
  chmodSync(path.join(scripts, `${SCRIPT}.sh`), 0o755);
  const shims: Array<[string, string]> = [["mise", MISE], ["pnpm", PNPM], ["timeout", "#!/bin/sh\nshift\nexec \"$@\"\n"]];
  for (const [name, text] of shims) writeFileSync(path.join(bin, name), text, { mode: 0o755 });
  writeFileSync(path.join(root, "pnpm-calls.log"), "");
  const commitLibrary = () => {
    git(checkout, ["add", "-f", "artifacts/generated/operator-scripts"]);
    git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", "library"]);
    git(checkout, ["push", "-q", "origin", "main"]);
  };
  commitLibrary();
  const run = (args: string[], env: Record<string, string | undefined> = {}) => {
    const childEnv: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: workspace, ...env };
    delete childEnv.VITEST;
    if (!("ARCADIA_WORKSPACE" in env)) delete childEnv.ARCADIA_WORKSPACE;
    return spawnSync("bash", [path.join(scripts, `${SCRIPT}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 280_000, input: "" });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).sort().map((d) => path.join(scripts, "runs", d)) : [];
  const receipt = () => {
    const dirs = runDirs().filter((d) => existsSync(path.join(d, "receipt.json")));
    if (dirs.length === 0) throw new Error("no receipt");
    return JSON.parse(readFileSync(path.join(dirs[dirs.length - 1], "receipt.json"), "utf8"));
  };
  return { root, checkout, scripts, home, workspace, tmp, fixture, bare, run, runDirs, receipt, pnpmCalls: () => readFileSync(path.join(root, "pnpm-calls.log"), "utf8") };
}
type Box = ReturnType<typeof sandbox>;

/** G1's genesis registered (real import, metadata and docs sync), its origin a bare repository behind the clone's own url.insteadOf, plus an earlier candidate branch. */
function fixtureAtGenesis(box: Box) {
  initWorkspace(box.workspace);
  mkdirSync(box.fixture, { recursive: true });
  renderG1Fixture(box.fixture);
  git(box.fixture, ["init", "-q", "-b", "main"]);
  const genesis = commitAll(box.fixture, "Bootstrap three-Action rehearsal fixture");
  git(box.root, ["init", "-q", "--bare", "-b", "main", "fixture-origin.git"]);
  git(box.fixture, ["config", `url.${box.bare}.insteadOf`, `https://github.com/${REPO}.git`]);
  git(box.fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  git(box.fixture, ["push", "-q", "-u", "origin", "main"]);
  const imported = runProjectImportCommand({ workspace: box.workspace, name: "Three Action Rehearsal", mission: "Disposable three-Action rehearsal fixture.", status: "active", milestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", classification: "agent" });
  const projectId = imported.data.project.id;
  runProjectMetadataCommand({ workspace: box.workspace, projectId, repoPath: box.fixture, validationCommands: ["node scripts/check-rehearsal.mjs"] });
  writeFileSync(path.join(box.fixture, ".git", "arcadia-three-action-project-id"), `${projectId}\n`);
  expect((runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { errorCount: number }).errorCount).toBe(0);
  // An earlier candidate, pushed: the reset must leave it exactly as it is.
  git(box.fixture, ["checkout", "-q", "-b", "claude/write-start-marker-earlier"]);
  writeFileSync(path.join(box.fixture, "MARKER.md"), "three-action rehearsal start\n");
  const candidate = commitAll(box.fixture, "Earlier candidate");
  git(box.fixture, ["push", "-q", "origin", "claude/write-start-marker-earlier"]);
  git(box.fixture, ["checkout", "-q", "main"]);
  return { genesis, candidate, projectId };
}

/** What a finished single-Action run leaves on main: the Action done, the pointers advanced, MARKER.md merged, the workspace told. */
function afterSettledRun(box: Box) {
  const planPath = path.join(box.fixture, PLAN_FILE);
  const plan = readFileSync(planPath, "utf8");
  const start = plan.indexOf("  - id: write-start-marker");
  const settled = plan.slice(0, start) + plan.slice(start).replace("    status: open", "    status: done").replace(/^(current_action: ).*$/m, "$1transform-start-marker");
  writeFileSync(planPath, settled.replace(/^updated: .*$/m, "updated: 2026-10-06"));
  const projectPath = path.join(box.fixture, "PROJECT.md");
  writeFileSync(projectPath, readFileSync(projectPath, "utf8").replace(/^current_action: .*$/m, "current_action: transform-start-marker").replace(/^updated: .*$/m, "updated: 2026-10-06"));
  writeFileSync(path.join(box.fixture, "MARKER.md"), "three-action rehearsal start\n");
  const head = commitAll(box.fixture, "Settled earlier single-Action run");
  git(box.fixture, ["push", "-q", "origin", "main"]);
  expect((runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { errorCount: number }).errorCount).toBe(0);
  // Settlement marks the work item done in the workspace as well.
  withDatabase(box.workspace, (db) => { db.prepare("UPDATE work_items SET status = 'done' WHERE doc_ref = ?").run("plan/autonomous-three-action-rehearsal#write-start-marker"); });
  return head;
}

const bareRef = (box: Box, ref: string) => git(box.bare, ["rev-parse", ref]);
const planText = (box: Box, ref: string) => git(box.bare, ["show", `${ref}:${PLAN_FILE}`]);
const workItemStatus = (box: Box) => withDatabase(box.workspace, (db) => (db.prepare("SELECT status FROM work_items WHERE doc_ref = ?").get(`plan/autonomous-three-action-rehearsal#write-start-marker`) as { status: string } | undefined)?.status);
const untouched = (box: Box, head: string, candidate: string) => {
  expect(bareRef(box, "refs/heads/main")).toBe(head);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(head);
  expect(bareRef(box, "refs/heads/claude/write-start-marker-earlier")).toBe(candidate);
};

describe("single-Action reset: behavior", () => {
  it("--dry-run prints the exact diff and planned steps and changes nothing", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const runs = box.runDirs().length;
    const result = box.run(["--dry-run", "--run-tag", "t1"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("== DRY RUN: planned fixture change for write-start-marker (run tag t1), nothing written ==");
    expect(result.stdout).toContain(`Step 1: one commit 'Reopen write-start-marker for single-Action rehearsal t1' on ${head}`);
    expect(result.stdout).toContain("completion id complete-write-start-marker-t1");
    expect(result.stdout).toContain("+    next_action: Implement MARKER.md containing exactly the line");
    expect(result.stdout).toContain("complete-write-start-marker-t1");
    expect(result.stdout).toContain("DRY RUN: no refusal");
    untouched(box, head, candidate);
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    expect(box.runDirs()).toHaveLength(runs);
    const evidence = readdirSync(box.tmp).filter((d) => d.startsWith("single-action-reset-dry-run."));
    expect(evidence).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(box.tmp, evidence[0], "receipt.json"), "utf8"))).toMatchObject({ outcome: "dry_run_ready", mode: "--dry-run", actionId: "write-start-marker", completionId: "complete-write-start-marker-t1" });
    expect(box.pnpmCalls()).not.toMatch(/production|grant/i);
  });

  it("after a settled earlier run: one non-force commit reopens the Action, removes its artifact, syncs and queues it, and leaves earlier candidates untouched; the same tag refuses a rerun", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const base = afterSettledRun(box);
    expect(workItemStatus(box)).toBe("done");
    const dry = box.run(["--dry-run", "--run-tag", "t1"]);
    expect(dry.status, dry.stdout + dry.stderr).toBe(0);
    expect(dry.stdout).toContain("REMOVED: MARKER.md");
    expect(dry.stdout).toContain("-    status: done");
    expect(dry.stdout).toContain("+    status: open");
    expect(dry.stdout).toContain("-current_action: transform-start-marker");
    expect(dry.stdout).toContain("+current_action: write-start-marker");
    untouched(box, base, candidate);

    const result = box.run(["run", "--run-tag", "t1"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expect(head).not.toBe(base);
    expect(git(box.fixture, ["rev-list", "--count", `${base}..${head}`])).toBe("1");
    expect(git(box.fixture, ["rev-parse", `${head}^`])).toBe(base);
    expect(bareRef(box, "refs/heads/main")).toBe(head);
    expect(git(box.fixture, ["log", "-1", "--format=%s"])).toBe("Reopen write-start-marker for single-Action rehearsal t1");
    expect(git(box.fixture, ["diff", "--name-only", base, head]).split("\n").sort()).toEqual(["MARKER.md", "PROJECT.md", PLAN_FILE].sort());
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    expect(existsSync(path.join(box.fixture, "MARKER.md"))).toBe(false);
    const block = planText(box, head).split("\n  - id: transform-start-marker")[0];
    expect(block).toContain("    status: open");
    expect(block).toContain("complete-write-start-marker-t1");
    expect(planText(box, head)).toMatch(/^current_action: write-start-marker$/m);
    expect(git(box.bare, ["show", `${head}:PROJECT.md`])).toMatch(/^current_action: write-start-marker$/m);
    expect(bareRef(box, "refs/heads/claude/write-start-marker-earlier")).toBe(candidate);
    expect(git(box.fixture, ["rev-parse", "refs/heads/claude/write-start-marker-earlier"])).toBe(candidate);
    expect(workItemStatus(box)).toBe("open");
    const queue = runAdvanceQueueCommand({ workspace: box.workspace }).data as unknown as { orderValid: boolean; unpositionedCount: number };
    expect(queue).toMatchObject({ orderValid: true, unpositionedCount: 0 });
    expect(box.receipt()).toMatchObject({ id: SCRIPT, outcome: "succeeded", stage: "complete", actionId: "write-start-marker", runTag: "t1", completionId: "complete-write-start-marker-t1", baseHead: base, newHead: head, remoteMainAfter: head, otherRefsUnchanged: true, removedFiles: ["MARKER.md"], productionPreviewedOrActivated: false, grantsTouched: false, agentAskSettled: false });
    expect(box.pnpmCalls()).not.toMatch(/production|grant/i);

    const again = box.run(["run", "--run-tag", "t1"]);
    expect(again.status).not.toBe(0);
    expect(box.receipt()).toMatchObject({ outcome: "refused" });
    expect(box.receipt().reason).toContain("already succeeded");
    untouched(box, head, candidate);
  });

  it("resumes a commit made but not pushed: the same arguments re-validate it and push without a second commit", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const base = afterSettledRun(box);
    // The script's own commit, made by hand-equivalent steps is not possible, so interrupt a real run at the push: a pre-push hook that fails once.
    const hook = path.join(box.fixture, ".git", "hooks", "pre-push");
    mkdirSync(path.dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const failed = box.run(["run", "--run-tag", "t1"]);
    expect(failed.status).not.toBe(0);
    const committed = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expect(git(box.fixture, ["rev-parse", `${committed}^`])).toBe(base);
    expect(bareRef(box, "refs/heads/main")).toBe(base);
    rmSync(hook);
    const result = box.run(["run", "--run-tag", "t1"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(committed);
    expect(bareRef(box, "refs/heads/main")).toBe(committed);
    expect(git(box.fixture, ["rev-list", "--count", `${base}..${committed}`])).toBe("1");
    expect(bareRef(box, "refs/heads/claude/write-start-marker-earlier")).toBe(candidate);
    expect(box.receipt()).toMatchObject({ outcome: "succeeded", fixtureState: "committed_unpushed", newHead: committed });
  });
});

describe("single-Action reset: refusals change nothing", () => {
  const expectRefused = (box: Box, result: ReturnType<Box["run"]>, stage: string, text: RegExp) => {
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(box.receipt()).toMatchObject({ id: SCRIPT, outcome: "refused", stage, agentAskSettled: false, productionPreviewedOrActivated: false });
    expect(`${box.receipt().reason}\n${result.stdout}${result.stderr}`).toMatch(text);
  };

  it("refuses bad arguments and an exported ARCADIA_WORKSPACE before reading anything", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expectRefused(box, box.run(["run"]), "arguments", /--run-tag is required/);
    expectRefused(box, box.run(["run", "--run-tag", "Bad_Tag"]), "arguments", /--run-tag must be lowercase/);
    expectRefused(box, box.run(["run", "--run-tag", "t1", "--action", "nope"]), "arguments", /not a fixture Action/);
    expectRefused(box, box.run(["run", "--run-tag", "t1"], { ARCADIA_WORKSPACE: box.workspace }), "preflight", /ARCADIA_WORKSPACE is set/);
    expect(box.run(["--bogus"]).status).toBe(2);
    untouched(box, head, candidate);
    expect(box.pnpmCalls()).toBe("");
  });

  it("refuses a dirty Arcadia checkout, a dirty fixture clone, and a clone not level with GitHub main (behind or ahead), with the dry run naming the first", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);

    writeFileSync(path.join(box.checkout, "stray.txt"), "x");
    const dry = box.run(["--dry-run", "--run-tag", "t1"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("WOULD REFUSE [preflight]: the Arcadia checkout must be clean");
    expectRefused(box, box.run(["run", "--run-tag", "t1"]), "preflight", /Arcadia checkout must be clean/);
    rmSync(path.join(box.checkout, "stray.txt"));

    writeFileSync(path.join(box.fixture, "stray.txt"), "x");
    expectRefused(box, box.run(["run", "--run-tag", "t1"]), "local_fixture", /working tree is dirty/);
    rmSync(path.join(box.fixture, "stray.txt"));

    writeFileSync(path.join(box.fixture, "ahead.txt"), "x");
    commitAll(box.fixture, "local only");
    expectRefused(box, box.run(["run", "--run-tag", "t1"]), "local_fixture", /not GitHub main/);
    git(box.fixture, ["reset", "-q", "--hard", head]);

    const other = temp("single-action-other-");
    git(other, ["clone", "-q", box.bare, "clone"]);
    writeFileSync(path.join(other, "clone", "elsewhere.txt"), "x");
    commitAll(path.join(other, "clone"), "moved on GitHub");
    git(path.join(other, "clone"), ["push", "-q", "origin", "main"]);
    expectRefused(box, box.run(["run", "--run-tag", "t1"]), "local_fixture", /not GitHub main/);
    expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(head);
    expect(bareRef(box, "refs/heads/claude/write-start-marker-earlier")).toBe(candidate);
    expect(git(box.bare, ["rev-list", "--count", `${head}..${bareRef(box, "refs/heads/main")}`])).toBe("1");
  });

  it("refuses a pending fixture proposal for the Action without settling it, and a live fixture Session", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate, projectId } = fixtureAtGenesis(box);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    runAgentAskPreviewCommand({ workspace: box.workspace, request: JSON.stringify({
      agent_ask: "v1", request_id: "complete-write-start-marker-stale", project: "three-action-rehearsal", intent: "complete", target_ref: "action/write-start-marker",
      candidate_revision: head, evidence: [{ criterion: "x", status: "met" }], desired_result: "Mark write-start-marker complete."
    }) });
    const dry = box.run(["--dry-run", "--run-tag", "t1"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("complete-write-start-marker-stale");
    expectRefused(box, box.run(["run", "--run-tag", "t1"]), "proposal_gate", /complete-write-start-marker-stale/);
    untouched(box, head, candidate);
    expect(box.runDirs().length).toBeGreaterThan(0);

    const clean = sandbox();
    const fixtureClean = fixtureAtGenesis(clean);
    const cleanHead = git(clean.fixture, ["rev-parse", "refs/heads/main"]);
    withDatabase(clean.workspace, (db) => {
      db.pragma("foreign_keys = OFF");
      db.prepare(`INSERT INTO agent_sessions (id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id, packet_id, packet_path, packet_sha256, authorizing_decisions_json,
        provider_profile, provider, model, base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport, tmux_session_name, status, prepared_at, created_at, updated_at)
        VALUES ('session_live', ?, 'three-action-rehearsal', '/elsewhere', 'p', 'autonomous-three-action-rehearsal', 'write-start-marker', 'w', 'p', 'p', 'h', '[]', 'x', 'claude', 'm', 'b', 'b', '/elsewhere/wt', 'psid', 'd', 'tmux', 'tmux-live', 'running', 'now', 'now', 'now')`).run(fixtureClean.projectId);
    });
    expectRefused(clean, clean.run(["run", "--run-tag", "t1"]), "live_session", /session_live/);
    expect(git(clean.fixture, ["rev-parse", "refs/heads/main"])).toBe(cleanHead);
    expect(projectId).not.toBe(fixtureClean.projectId);
  });

  it("refuses an Action that would not be ready, and one the Plan does not carry", { timeout: 280_000 }, () => {
    const box = sandbox();
    const { candidate } = fixtureAtGenesis(box);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expectRefused(box, box.run(["run", "--run-tag", "t1", "--action", "transform-start-marker"]), "validate_amendment", /would not be ready/);
    expectRefused(box, box.run(["run", "--run-tag", "t1", "--action", "chain-step-04"]), "render", /no Action chain-step-04/);
    untouched(box, head, candidate);
  });
});
