import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { buildStartRunPins, runStartRunGateCheckCommand, type StartRunPinsDeps, type StartRunPinsOptions } from "../src/commands/startRun.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { assertProjectLibraryEntry, startRunLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { documentState, runPlanAmendment, type PlanActivationInput } from "../src/operatorActions/planAmendment.js";
import { assertOperatorSettlementContract } from "../src/operatorActions/operatorExecution.js";
import { validateStartRunPins, type StartRunPins } from "../src/operatorActions/startRunPins.js";
import { buildDiagnosticAsk, governingDecisionReferences, GOVERNING_DECISIONS } from "../src/production/startRunSignIn.js";
import { normalizeAgentAsk } from "../src/ask/agentAsk.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * G1 and G2 of the second-Project feasibility report: a START card in Arcadia's library for another Project's Plan (Rebuster's,
 * here a fixture). The card pins that Project's registered primary checkout and its origin main beside Arcadia's own pin; the
 * executor reads the Plan, PROJECT.md and the Project's Decisions there and refuses a moved, dirty or unregistered checkout; the
 * Plan-activation runner settles in that checkout and nowhere else. Arcadia's own cards are unchanged (their suites are untouched).
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(repoRoot, "tests", "fixtures", "start-run");
const EXECUTOR_SOURCE = readFileSync(path.join(repoRoot, "scripts", "start-run.sh"), "utf8");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };

const GIT_ENV = { GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "f@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "f@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
function commitAll(dir: string, files: Record<string, string>, message: string): string {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content, { mode: file.endsWith(".sh") ? 0o755 : 0o644 });
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}
/** A primary checkout with a local bare origin, pushed. */
function repository(root: string, name: string, files: Record<string, string>): { dir: string; origin: string; head: string } {
  const origin = path.join(root, `${name}.git`);
  const dir = path.join(root, name);
  git(root, "init", "--bare", "-b", "main", origin);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  const head = commitAll(dir, files, `${name} main`);
  git(dir, "push", "-u", "origin", "main");
  return { dir, origin, head };
}

const LABEL = "com.arcadia.local.1.worker";
const PROJECT = "rebuster";
const PLAN = "rebuster-fixture-plan";
const PREVIOUS = "rebuster-previous-plan";
const ACTIONS = ["first-rebuster-action", "second-rebuster-action"];
const SCOPED = ACTIONS.map((a) => `${PROJECT}/${a}`);
const DECISIONS = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"];

function basePins(overrides: Partial<StartRunPins> = {}): StartRunPins {
  return {
    schema: "arcadia-start-run-v1", reviewedRevision: "a".repeat(40), executorSha256: "b".repeat(64), workspace: "martianrover", project: PROJECT, plan: PLAN, actions: ACTIONS,
    provider: "claude-code-cli", transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24, intent: "A second-Project fixture run.",
    spendDecision: "0130", integrationDecision: "0058", requiredDecisions: [...DECISIONS], requiredFiles: ["scripts/start-run.sh", "src/sessions/tmuxLauncher.ts", "src/production/workerMerge.ts"],
    production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: LABEL, gateCardId: "enable-capacity-gate-20261017", offId: "restore-off-production",
    grantedBy: "P. Mark Anderson, by pressing this per-run START card from /actions under Decisions 0156 and 0157", consumedHistory: [{ path: "/abs/one.consumed.json", sha256: "c".repeat(64) }],
    projectRepository: { path: "/abs/rebuster", origin: "https://github.com/pmark/rebuster.git", reviewedRevision: "d".repeat(40) },
    ...overrides
  };
}

describe("startRun.projectRepository: the pin validator", () => {
  it("accepts a second Project's repository on an operator-pressed card, and the same card without it", () => {
    const pins = basePins();
    expect(validateStartRunPins(pins)).toBe(pins);
    const own = basePins({ project: "arcadia" });
    delete own.projectRepository;
    expect(validateStartRunPins(own)).toBe(own);
  });
  it.each<[string, (p: Record<string, any>) => void, RegExp]>([
    ["a relative path", (p) => { p.projectRepository.path = "tools/Rebuster"; }, /normalized absolute path/],
    ["an unnormalized path", (p) => { p.projectRepository.path = "/abs/x/../rebuster"; }, /normalized absolute path/],
    ["a trailing slash", (p) => { p.projectRepository.path = "/abs/rebuster/"; }, /normalized absolute path/],
    ["a short revision", (p) => { p.projectRepository.reviewedRevision = "abc123"; }, /40-hex/],
    ["no origin", (p) => { p.projectRepository.origin = ""; }, /origin/],
    ["an extra field", (p) => { p.projectRepository.branch = "main"; }, /exactly the fields/],
    ["a missing field", (p) => { delete p.projectRepository.origin; }, /exactly the fields/],
    ["a delegated card", (p) => { p.delegation = { decision: "0163", originatingCard: "x", originatingRun: "20261101T010000Z-1", originatingReceiptSha256: "0".repeat(64), attempt: 2 }; }, /operator-pressed card/]
  ])("refuses %s", (_label, mutate, message) => {
    const pins = structuredClone(basePins()) as unknown as Record<string, any>;
    mutate(pins);
    expect(() => validateStartRunPins(pins)).toThrow(message);
  });
  it("leaves a START card in a Project library refused, with or without the pin (libraryContract.ts:303-308)", () => {
    expect(() => assertProjectLibraryEntry({ project: PROJECT, startRun: basePins() }, PROJECT)).toThrow("startRun");
  });
});

describe("arcadia start-run pins --project: a second Project's card (G1)", () => {
  const EXECUTOR = "#!/usr/bin/env bash\n# fixture executor\n";
  const ARCADIA_PIN = "a".repeat(40);
  const PROJECT_PIN = "e".repeat(40);
  const planDoc = (project = PROJECT, status = "active") => `---\nslug: ${PLAN}\nproject: ${project}\nstatus: ${status}\nactions:\n${ACTIONS.map((a) => `  - id: ${a}\n    status: open\n`).join("")}---\nbody\n`;
  const decision = "---\nstatus: approved\nanswer: Yes\n---\n";

  function fixture(options: { registered?: "project" | "arcadia" | "none" | "missing"; projectFiles?: Record<string, string>; arcadiaFiles?: Record<string, string>; commonDir?: string; projectOrigin?: string } = {}) {
    const arcadia = temp("arcadia-pins-arcadia-");
    const project = temp("arcadia-pins-rebuster-");
    mkdirSync(path.join(arcadia, ".git"));
    mkdirSync(path.join(project, ".git"));
    const library = path.join(arcadia, "artifacts", "generated", "operator-scripts");
    const arcadiaFiles: Record<string, string> = options.arcadiaFiles ?? { "scripts/start-run.sh": EXECUTOR, "src/sessions/tmuxLauncher.ts": "x", "src/production/workerMerge.ts": "x", "docs/plans/arcadia-plan.md": planDoc("arcadia") };
    const projectFiles: Record<string, string> = options.projectFiles ?? { [`docs/plans/${PLAN}.md`]: planDoc(), "PROJECT.md": `---\nslug: ${PROJECT}\nactive_plan: ${PLAN}\n---\n` };
    const calls: Array<{ repo: string; args: string[] }> = [];
    const deps: StartRunPinsDeps = {
      git: (repo, args) => {
        calls.push({ repo, args });
        const isProject = repo === project;
        if (args[0] === "ls-remote") return Buffer.from(`${options.projectOrigin !== undefined && isProject ? options.projectOrigin : isProject ? PROJECT_PIN : ARCADIA_PIN}\trefs/heads/main\n`);
        if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return Buffer.from(repo + "\n");
        if (args[0] === "rev-parse" && args.includes("--git-common-dir")) return Buffer.from((isProject && options.commonDir ? options.commonDir : path.join(repo, ".git")) + "\n");
        if (args[0] === "remote" && args[1] === "get-url") return Buffer.from(isProject ? "https://github.com/pmark/rebuster.git\n" : "https://github.com/pmark/arcadia.git\n");
        if (args[0] === "ls-tree") return Buffer.from(isProject ? "" : DECISIONS.map((id) => `docs/decisions/${id}-fixture.md`).join("\n") + "\n");
        if (args[0] === "show") {
          const [revision, spec] = [args[1].slice(0, args[1].indexOf(":")), args[1].slice(args[1].indexOf(":") + 1)];
          if (revision !== (isProject ? PROJECT_PIN : ARCADIA_PIN)) throw new Error(`a read at the wrong revision ${revision}`);
          const content = !isProject && /^docs\/decisions\//.test(spec) ? decision : (isProject ? projectFiles : arcadiaFiles)[spec];
          if (content === undefined) throw new Error("missing");
          return Buffer.from(content);
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      now: () => new Date("2026-11-25T00:00:00.000Z"),
      launchctlList: () => `PID\tStatus\tLabel\n123\t0\t${LABEL}\n`,
      production: () => ({ workspacePath: "/w/martianrover", desiredState: "inactive", revision: 83, epoch: 46, liveAdmissions: 0 }),
      queue: () => ({ revision: 290, orderValid: true, unpositionedCount: 0, ordered: SCOPED.map((orderKey) => ({ orderKey })) }),
      listFiles: (directory) => directory === library ? ["earlier.consumed.json", "enable-capacity-gate-20261017.json", "restore-off-production-bug-plan-first-supervised-run-2026-10-11.json"] : [],
      sha256File: (file) => sha(path.basename(file)),
      projectRepository: (_workspace, slug) => slug !== PROJECT || options.registered === "none" ? null
        : options.registered === "arcadia" ? arcadia : options.registered === "missing" ? path.join(project, "gone") : project
    };
    const args: StartRunPinsOptions = { plan: PLAN, actions: ACTIONS.join(","), provider: "claude-code-cli", expiresHours: 12, repository: arcadia, project: PROJECT };
    return { deps, args, arcadia, project, calls };
  }

  it("pins the Project's registered repository and its origin main, and reads the Plan there; the executor and Decisions stay Arcadia's", () => {
    const f = fixture();
    const result = buildStartRunPins(f.args, f.deps);
    expect(validateStartRunPins(result.startRun)).toBe(result.startRun);
    expect(result.startRun).toMatchObject({ reviewedRevision: ARCADIA_PIN, executorSha256: sha(EXECUTOR), project: PROJECT, plan: PLAN, actions: ACTIONS });
    expect(result.startRun.projectRepository).toEqual({ path: f.project, origin: "https://github.com/pmark/rebuster.git", reviewedRevision: PROJECT_PIN });
    expect(result.startRun.delegation).toBeUndefined();
    // The Plan is read only from the Project's repository at its pin; the executor and every required Decision only from Arcadia's.
    const shows = f.calls.filter((call) => call.args[0] === "show").map((call) => `${call.repo === f.project ? "project" : "arcadia"} ${call.args[1]}`);
    expect(shows).toContain(`project ${PROJECT_PIN}:docs/plans/${PLAN}.md`);
    expect(shows.filter((entry) => entry.startsWith("project "))).toEqual([`project ${PROJECT_PIN}:docs/plans/${PLAN}.md`]);
    expect(shows).toContain(`arcadia ${ARCADIA_PIN}:scripts/start-run.sh`);
    expect(shows.filter((entry) => entry.includes("docs/decisions/")).every((entry) => entry.startsWith("arcadia "))).toBe(true);
    expect(result.observations.notes.join(" ")).toContain(`registered repository ${f.project}`);
    // Read-only git verbs only.
    expect(f.calls.every(({ args }) => ["ls-remote", "rev-parse", "ls-tree", "show", "remote"].includes(args[0]))).toBe(true);
    expect(f.calls.filter(({ args }) => args[0] === "remote").every(({ args }) => args.join(" ") === "remote get-url origin")).toBe(true);
  });

  it("computes exactly the same card as before when --project names the Project whose repository is this one", () => {
    const f = fixture({ registered: "arcadia" });
    const args = { ...f.args, plan: "arcadia-plan", project: "arcadia" };
    f.deps.queue = () => ({ revision: 290, orderValid: true, unpositionedCount: 0, ordered: ACTIONS.map((a) => ({ orderKey: `arcadia/${a}` })) });
    f.deps.projectRepository = () => f.arcadia;
    const withProject = buildStartRunPins(args, f.deps);
    const { project: _omitted, ...withoutFlag } = args;
    expect(withProject).toEqual(buildStartRunPins(withoutFlag, f.deps));
    expect(withProject.startRun).not.toHaveProperty("projectRepository");
  });

  it.each<[string, Parameters<typeof fixture>[0], Partial<StartRunPinsOptions>, RegExp]>([
    ["an unregistered Project", { registered: "none" }, {}, /no registered repository/],
    ["a registered path that does not exist", { registered: "missing" }, {}, /does not exist/],
    ["a linked worktree instead of the primary checkout", { commonDir: "/elsewhere/.git" }, {}, /not a primary checkout/],
    ["a Project origin main that is not a commit", { projectOrigin: "nothing" }, {}, /did not return a commit id/],
    ["a Plan that is not in the Project repository", { projectFiles: {} }, {}, /not readable at origin main e{40}/],
    ["a Plan of another Project", { projectFiles: { [`docs/plans/${PLAN}.md`]: planDoc("someone-else") } }, {}, /belongs to Project someone-else, not --project rebuster/],
    ["a delegated successor", {}, { delegatedFrom: "start-run-origin-20261101/20261101T010000Z-111" }, /pressed by the operator only/],
    ["a day-grant card", {}, { dayGrantFrom: "day-grant-20261125/20261125T010000Z-1" }, /pressed by the operator only/],
    ["a malformed Project slug", {}, { project: "Not A Slug" }, /--project must be a Project slug/]
  ])("refuses %s", (_label, options, argOverrides, message) => {
    const f = fixture(options);
    expect(() => buildStartRunPins({ ...f.args, ...argOverrides }, f.deps)).toThrow(message);
  });
});

describe("arcadia start-run gate-check --require-registered-repository", () => {
  const decisionDoc = (action: string) => ["---", "arcadia: v1", "type: decision", "id: \"0001\"", "slug: hold-the-action", `project: ${PROJECT}`, "status: open",
    `action: ${action}`, "question: Should the pinned Action proceed?", "updated: 2026-11-25", "---", "", "# Decision", ""].join("\n");
  function fixture() {
    const project = temp("arcadia-gate-rebuster-");
    const other = temp("arcadia-gate-other-");
    for (const dir of [project, other]) {
      mkdirSync(path.join(dir, "docs", "decisions"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "decisions", "0001-hold-the-action.md"), decisionDoc(ACTIONS[0]));
    }
    const workspace = temp("arcadia-gate-workspace-");
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const row = upsertProject(db, { name: PROJECT, mission: "Fixture", goal: "Fixture", status: "active", currentMilestone: "M", nextAction: "N", workClassification: "agent" });
      upsertProjectMetadata(db, { projectId: row.id, repoPath: project });
    });
    return { project, other, workspace };
  }
  it("reads the Project's own Decisions in its registered repository", () => {
    const f = fixture();
    const result = runStartRunGateCheckCommand({ project: PROJECT, actions: ACTIONS, repository: f.project, workspace: f.workspace, requireRegisteredRepository: true });
    expect(result.data.blocking.map((item) => [item.action, item.kind, item.id])).toEqual([[ACTIONS[0], "decision", "0001"]]);
  });
  it("refuses any other repository, and a Project with none registered", () => {
    const f = fixture();
    expect(() => runStartRunGateCheckCommand({ project: PROJECT, actions: ACTIONS, repository: f.other, workspace: f.workspace, requireRegisteredRepository: true })).toThrow(/is not Project rebuster's registered repository/);
    expect(() => runStartRunGateCheckCommand({ project: "unknown", actions: ACTIONS, repository: f.project, workspace: f.workspace, requireRegisteredRepository: true })).toThrow(/none registered/);
    // Without the flag (every Arcadia card) the command reads the repository it is given, as before.
    expect(runStartRunGateCheckCommand({ project: PROJECT, actions: ACTIONS, repository: f.other, workspace: f.workspace }).data.blocking).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The executor (scripts/start-run.sh) for a second Project's card: a hermetic rig like tests/start-run-executor.test.ts's box,
// with an Arcadia checkout holding the executor and the card, and a Rebuster checkout holding the Plan.
// ---------------------------------------------------------------------------------------------------------------------------
type ProjectScenario = "same" | "origin-moved" | "behind" | "ahead" | "dirty" | "untracked" | "branch" | "other-origin" | "worktree" | "arcadia-path" | "symlink-arcadia";
interface RigOptions { planStatus?: "active" | "draft"; project?: ProjectScenario; registered?: "project" | "elsewhere" }
const ID = "start-rebuster-fixture-20261125";

function rig(options: RigOptions = {}) {
  const root = temp("arcadia-start-run-second-");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  const draft = options.planStatus === "draft";

  // Arcadia: a base commit (the installed release), then the reviewed main with the executor and the required Decisions.
  const decisions = Object.fromEntries(DECISIONS.map((id) => [`docs/decisions/${id}-fixture.md`, `---\nid: "${id}"\nstatus: approved\nanswer: Yes\n---\n`]));
  const arcadia = repository(root, "arcadia", { ".gitignore": "artifacts/generated/\nnode_modules\n", "README.md": "base\n" });
  const installed = arcadia.head;
  const pin = commitAll(arcadia.dir, {
    "scripts/start-run.sh": EXECUTOR_SOURCE, "src/sessions/tmuxLauncher.ts": "export {};\n", "src/production/workerMerge.ts": "export {};\n",
    "PROJECT.md": "---\nslug: arcadia\nactive_plan: arcadia-own-plan\n---\n", ...decisions
  }, "reviewed main");
  git(arcadia.dir, "push", "origin", "main");
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(arcadia.dir, "node_modules"));

  // Rebuster: its own Plan, PROJECT.md and previous Plan; pinned at its origin main.
  const plan = `---\nslug: ${PLAN}\nproject: ${PROJECT}\nstatus: ${draft ? "draft" : "active"}\nactions:\n${ACTIONS.map((a) => `  - id: ${a}\n    status: open\n`).join("")}---\nbody\n`;
  const project = repository(root, "rebuster", {
    "PROJECT.md": `---\nslug: ${PROJECT}\nactive_plan: ${draft ? PREVIOUS : PLAN}\n---\n`,
    [`docs/plans/${PLAN}.md`]: plan,
    [`docs/plans/${PREVIOUS}.md`]: `---\nslug: ${PREVIOUS}\nproject: ${PROJECT}\nstatus: ${draft ? "active" : "draft"}\nactions: []\n---\n`
  });
  let projectPin = project.head;
  let pinnedPath = project.dir;
  const scenario = options.project ?? "same";
  if (scenario === "origin-moved" || scenario === "behind") {
    const other = path.join(root, "rebuster-other");
    git(root, "clone", project.origin, other);
    const moved = commitAll(other, { "docs/note.md": "moved\n" }, "origin moved");
    git(other, "push", "origin", "main");
    if (scenario === "behind") projectPin = moved;  // the card pins the new origin main; the checkout was never brought there
  } else if (scenario === "ahead") commitAll(project.dir, { "docs/local.md": "local only\n" }, "local ahead of the pin");
  else if (scenario === "dirty") writeFileSync(path.join(project.dir, "PROJECT.md"), readFileSync(path.join(project.dir, "PROJECT.md"), "utf8") + "edit\n");
  else if (scenario === "untracked") writeFileSync(path.join(project.dir, "scratch.txt"), "untracked\n");
  else if (scenario === "branch") git(project.dir, "switch", "-c", "other");
  else if (scenario === "other-origin") git(project.dir, "remote", "set-url", "origin", path.join(root, "somewhere-else.git"));
  else if (scenario === "worktree") { pinnedPath = path.join(root, "rebuster-worktree"); git(project.dir, "worktree", "add", "--detach", pinnedPath, "HEAD"); pinnedPath = realpathSync(pinnedPath); git(pinnedPath, "switch", "-c", "main-copy"); }
  else if (scenario === "arcadia-path") pinnedPath = arcadia.dir;
  else if (scenario === "symlink-arcadia") { pinnedPath = path.join(root, "rebuster-link"); symlinkSync(arcadia.dir, pinnedPath); }

  const library = path.join(arcadia.dir, "artifacts", "generated", "operator-scripts");
  mkdirSync(library, { recursive: true });
  const history = path.join(library, "earlier.consumed.json");
  writeFileSync(history, '{"state":"CONSUMED"}\n');
  const pins = basePins({
    reviewedRevision: pin, executorSha256: sha(EXECUTOR_SOURCE), consumedHistory: [{ path: history, sha256: sha('{"state":"CONSUMED"}\n') }],
    projectRepository: { path: pinnedPath, origin: project.origin, reviewedRevision: projectPin }
  });
  const activation: PlanActivationInput = {
    schema: "arcadia-plan-activation-v1",
    checkout: { path: project.dir, origin: project.origin, branch: "main", reviewedBase: projectPin },
    ask: { path: ".arcadia/asks/agent-ask-activate-rebuster.yaml", sha256: "e".repeat(64), proposal: "activate-rebuster" },
    settlement: { requestId: "accept-activate-rebuster", disposition: "accepted", operator: true, activate: true, action: ACTIONS[0], model: "standard", effort: "medium", placement: "top" },
    envelope: {
      project: PROJECT, plan: PLAN, previousPlan: PREVIOUS, action: ACTIONS[0], log: "MISSION_LOG.md",
      projectBefore: { slug: PROJECT, active_plan: PREVIOUS, current_action: null, milestone: "Old" },
      projectAfter: { active_plan: PLAN, current_action: ACTIONS[0], milestone: "New milestone" },
      planBefore: { slug: PLAN, project: PROJECT, status: "draft", current_action: null, milestone: "New milestone" },
      planAfter: { status: "active", current_action: ACTIONS[0], recommended_model: "standard", recommended_reasoning_effort: "medium" },
      previousPlanBefore: { slug: PREVIOUS, project: PROJECT, status: "active", current_action: null },
      previousPlanAfter: { status: "draft", current_action: null },
      actionUnchanged: { id: ACTIONS[0], title: "First", status: "open", responsibility: "agent", clarification: "clarified" },
      queueSegment: SCOPED
    },
    publication: { remote: "origin", branch: "main" }
  };
  const descriptor: OperatorScriptDescriptor = {
    schema: "arcadia-operator-script-v1", id: ID, kind: "grant", title: "START: Rebuster fixture", script: `${ID}.sh`, repeatable: false,
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"), startRun: pins, ...(draft ? { planActivation: activation } : {})
  };
  const script = startRunLauncher(ID);
  if (scenario !== "arcadia-path") validateOperatorScriptContract(descriptor, ID, script);
  const scriptPath = path.join(library, `${ID}.sh`);
  const descriptorPath = path.join(library, `${ID}.json`);
  writeFileSync(scriptPath, script, { mode: 0o755 });
  writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2) + "\n");
  writeFileSync(path.join(library, ".start-run-test-fixture"), "4");
  mkdirSync(path.join(library, "reviewed"));
  writeFileSync(path.join(library, "reviewed", `${ID}.json`), JSON.stringify({ sh: sha(readFileSync(scriptPath)), json: sha(readFileSync(descriptorPath)), executor: sha(EXECUTOR_SOURCE) }));

  mkdirSync(path.join(workspace, "config"), { recursive: true });
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  writeFileSync(path.join(workspace, "config", "arcadia.json"), "{}");
  writeFileSync(path.join(workspace, ".arcadia", "worker-claude-usage-heartbeat.json"), JSON.stringify({ at: Date.now(), binding: null }));
  writeFileSync(path.join(workspace, ".arcadia", "worker.pid"), JSON.stringify({ pid: 1111, owner: "owner-1111" }));
  mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`), "<plist/>");

  mkdirSync(bin, { recursive: true });
  const shim = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  shim("mise", `exec "${path.join(fixtures, "fake-mise")}" "$@"`);
  shim("launchctl", `exec node "${path.join(fixtures, "fake-launchctl.mjs")}" "$@"`);
  shim("fake-release-node", `exec node "${path.join(fixtures, "fake-release-node.mjs")}" "$@"`);
  shim("timeout", 'shift; exec "$@"');
  shim("sleep", "exit 0");
  shim("ps", 'if [ "$1" = "-axo" ]; then exit 0; fi\necho " 1"');
  shim("tmux", 'echo "no server running on /private/tmp/tmux-501/default" >&2; exit 1');
  // The fakes, as copied into this rig: the gate read also answers the registered-repository requirement, and the Plan-activation
  // stand-in settles in the Project's checkout (state.planRepository), as the real runner does for this card.
  const fakeArcadia = readFileSync(path.join(fixtures, "fake-arcadia.mjs"), "utf8").replace('case "start-run gate-check": {',
    'case "start-run gate-check": {\n    if (args.includes("--require-registered-repository") && get("--repository") !== state.registeredRepository) { process.stderr.write("WRONG_CHECKOUT: not the registered repository\\n"); process.exit(2); }');
  expect(fakeArcadia).toContain("--require-registered-repository");
  writeFileSync(path.join(bin, "fake-arcadia.mjs"), fakeArcadia);
  writeFileSync(path.join(bin, "fake-plan-runner.mjs"), readFileSync(path.join(fixtures, "fake-plan-runner.mjs"), "utf8").replaceAll("state.repository", "state.planRepository"));

  const state: Record<string, any> = {
    workspace, repository: arcadia.dir, planRepository: project.dir, plan: PLAN,
    registeredRepository: options.registered === "elsewhere" ? path.join(root, "elsewhere") : project.dir,
    production: { desiredState: "inactive", revision: 83, epoch: 46, liveAdmissions: 0, authority: null },
    queue: { revision: 290, orderValid: true, unpositionedCount: 0, ordered: SCOPED.map((orderKey) => ({ orderKey })) },
    capacity: { observation: { providers: [{ providerId: "claude-code-cli", admitted: true, code: null, reason: "5-hour 20%", receipt: { source: "claude_status_line" } }] } },
    freeze: "allow", broker: { revision: installed, ready: true, transports: true },
    ensure: { fail: false }, activate: { mode: "ok" }, planRunner: { mode: "ok" },
    worker: { pid: 1111, alive: true, heartbeat: "fresh", newPid: process.pid }
  };
  writeFileSync(path.join(root, "state.json"), JSON.stringify(state, null, 2));

  const marker = path.join(library, `${ID}.consumed.json`);
  const pressEnv = (): Record<string, string> => {
    const runId = `20261125000000000-${randomUUID()}`;
    const dir = path.join(library, "runs", "operator", ID, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "descriptor.json"), readFileSync(descriptorPath));
    writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId, scriptId: ID, status: "running", pid: process.pid, startedAt: new Date(Date.now() - 1000).toISOString() }));
    return { ARCADIA_OPERATOR_SCRIPT_RUN_ID: runId, ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: dir, ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR: path.join(dir, "descriptor.json") };
  };
  const calls = () => (existsSync(path.join(root, "calls.log")) ? readFileSync(path.join(root, "calls.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { tool: string; args: string[] }) : []);
  const runDirs = () => (existsSync(path.join(library, "runs", ID)) ? readdirSync(path.join(library, "runs", ID)).sort() : []);
  function run(mode: "run" | "preflight" = "run") {
    const before = new Set(runDirs());
    const env: NodeJS.ProcessEnv = {
      ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_BIN: bin, FAKE_ARCADIA_ROOT: repoRoot,
      ...(mode === "run" ? { ARCADIA_OPERATOR_SCRIPT_ID: ID, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptorPath, ...pressEnv() } : {})
    };
    for (const key of ["ANTHROPIC_API_KEY", "CODEX_SANDBOX", "ARCADIA_WORKSPACE", "VITEST"]) delete env[key];
    const result = spawnSync(scriptPath, [mode], { env, encoding: "utf8", timeout: 200_000 });
    const created = runDirs().filter((name) => !before.has(name));
    const dir = created.length ? path.join(library, "runs", ID, created[created.length - 1]) : null;
    const receipt = dir && existsSync(path.join(dir, "receipt.json")) ? JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8")) as Record<string, any> : null;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, receipt };
  }
  const mutating = () => calls().filter((call) => call.tool === "plan-runner" || call.tool === "worker-install" || (call.tool === "launchctl" && call.args[0] === "kickstart") ||
    (call.tool === "arcadia" && (["go-broker ensure", "production activate", "production deactivate"].includes(call.args.slice(0, 2).join(" ")) || (call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only")))));
  return { root, arcadia, project, pin, projectPin, pinnedPath, library, marker, descriptorPath, run, calls, mutating };
}
type Rig = ReturnType<typeof rig>;

/** Refused before the first mutation: nothing consumed, nothing changed in either checkout. */
function expectRefusedClean(r: Rig, result: ReturnType<Rig["run"]>, phase: string, reason: RegExp, projectHead: string) {
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.receipt).toMatchObject({ outcome: "refused", phase, allowanceConsumed: false, mutations: [] });
  expect(result.receipt!.reason).toMatch(reason);
  expect(existsSync(r.marker)).toBe(false);
  expect(r.mutating()).toEqual([]);
  expect(git(r.arcadia.dir, "rev-parse", "HEAD")).toBe(r.pin);
  expect(git(r.project.dir, "rev-parse", "HEAD")).toBe(projectHead);
}

describe("start-run executor: a second Project's card (G1)", () => {
  it("preflights against the Project's own checkout and Decisions, at its own pin", () => {
    const r = rig();
    const result = r.run("preflight");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "preflight_ok", phase: "P2", allowanceConsumed: false, mutations: [] });
    expect(result.receipt!.record).toMatchObject({ project: PROJECT, plan: PLAN, reviewedRevision: r.pin, needsPlanActivation: false, projectRepository: { path: r.project.dir, origin: r.project.origin, reviewedRevision: r.projectPin } });
    // The operator gate reads the Project's Decisions in its checkout and requires it to be the registered repository.
    const gate = r.calls().find((call) => call.args.slice(0, 2).join(" ") === "start-run gate-check")!;
    expect(gate.args).toEqual(expect.arrayContaining(["--project", PROJECT, "--repository", r.project.dir, "--require-registered-repository"]));
    // B1: the sign-in sequence runs under the Project of the checkout that holds the executor (PROJECT.md at the pin), never Rebuster.
    const signIn = r.calls().find((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in")!;
    expect(signIn.args).toEqual(expect.arrayContaining(["--project", "arcadia", "--repository", r.arcadia.dir, "--check-only"]));
    expect(result.receipt!.record.signInProject).toBe("arcadia");
    expect(r.mutating()).toEqual([]);
  }, 120_000);

  it.each<[ProjectScenario, RegExp]>([
    ["origin-moved", /the Project's origin main is [0-9a-f]{40}, not its pinned revision/],
    ["behind", /the Project checkout .* is at [0-9a-f]{40}, not its pinned revision/],
    ["ahead", /the Project checkout .* is at [0-9a-f]{40}, not its pinned revision/],
    ["dirty", /the Project checkout .* must be clean/],
    ["untracked", /the Project checkout .* must be clean/],
    ["branch", /the Project checkout .* must be on main/],
    ["other-origin", /origin is not the pinned origin/],
    ["worktree", /is not a primary checkout/],
    ["symlink-arcadia", /is not a checkout's toplevel/]
  ])("refuses in P1 when the Project checkout is %s, consuming nothing", (scenario, reason) => {
    const r = rig({ project: scenario });
    const head = git(r.project.dir, "rev-parse", "HEAD");
    expectRefusedClean(r, r.run(), "P1", reason, head);
  }, 120_000);

  it("refuses in P0 a projectRepository that names the executor's own checkout", () => {
    const r = rig({ project: "arcadia-path" });
    expectRefusedClean(r, r.run(), "P0", /names the executor's own checkout/, r.project.head);
  }, 120_000);

  it("refuses in P2 when the pinned checkout is not the workspace's registered repository", () => {
    const r = rig({ registered: "elsewhere" });
    expectRefusedClean(r, r.run(), "P2", /operator gate could not be read/, r.project.head);
  }, 120_000);

  it("activates the draft Plan in the Project's checkout, then starts; Arcadia's checkout gets no Plan commit", () => {
    const r = rig({ planStatus: "draft" });
    const result = r.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "succeeded", phase: "P6", allowanceConsumed: true, productionActivated: true, planActivatedByThisCard: true });
    expect(result.receipt!.record.needsPlanActivation).toBe(true);
    expect(r.mutating().map((call) => call.tool === "arcadia" ? call.args.slice(0, 2).join(" ") : call.tool)).toEqual(["go-broker ensure", "worker-install", "start-run sign-in", "plan-runner", "production activate"]);
    // The activation is one commit on the Project's pin, published to the Project's origin; its Plan is now active there.
    expect(git(r.project.dir, "rev-parse", "HEAD~1")).toBe(r.projectPin);
    expect(git(r.project.origin, "rev-parse", "main")).toBe(git(r.project.dir, "rev-parse", "HEAD"));
    expect(readFileSync(path.join(r.project.dir, "docs", "plans", `${PLAN}.md`), "utf8")).toMatch(/^status: active$/m);
    // Arcadia moved only by the sign-in sequence's diagnostic Decision; it never holds the Rebuster Plan.
    expect(git(r.arcadia.dir, "diff", "--name-only", r.pin, "HEAD").split("\n").every((file) => file.startsWith("docs/decisions/"))).toBe(true);
    expect(existsSync(path.join(r.arcadia.dir, "docs", "plans", `${PLAN}.md`))).toBe(false);
    const signIn = r.calls().find((call) => call.args.slice(0, 2).join(" ") === "start-run sign-in" && !call.args.includes("--check-only"))!;
    expect(signIn.args).toEqual(expect.arrayContaining(["--project", "arcadia", "--repository", r.arcadia.dir]));
    const activate = r.calls().find((call) => call.args.slice(0, 2).join(" ") === "production activate")!;
    expect(activate.args).toEqual(expect.arrayContaining(["--project", PROJECT, "--plan", `${PROJECT}/${PLAN}`, "--repository", r.arcadia.dir]));
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The Plan-activation runner (src/operatorActions/planAmendment.ts) for a START card in Arcadia's library that activates another
// Project's Plan in that Project's registered checkout (G2). Built like tests/plan-activation-runner.test.ts, in process.
// ---------------------------------------------------------------------------------------------------------------------------
const action = (id: string, status: string, depends_on: string[] = []) => ({ id, title: `Do ${id}`, status, responsibility: "agent", effort: "session", next_action: `Do ${id}`, expected_artifact: `${id} evidence`, clarification: "clarified", confidence: "high", acceptance_criteria: [`The ${id} receipt records a real newline.`], depends_on, decisions: [], references: [] });

function activationFixture() {
  const root = temp("arcadia-second-activation-");
  const repo = path.join(root, "demo");
  const workspace = path.join(root, "workspace");
  const arcadiaLibrary = path.join(root, "arcadia", "artifacts", "generated", "operator-scripts");
  mkdirSync(arcadiaLibrary, { recursive: true });
  const project = { arcadia: "v1", type: "project", slug: "demo", name: "Demo", status: "active", goal: "Prove activation", outcome: "Safe activation", milestone: "Old milestone", active_plan: "old-plan", current_action: "old-first", updated: "2026-10-01" };
  const oldPlan = { arcadia: "v1", type: "plan", slug: "old-plan", project: "demo", status: "active", milestone: "Old milestone", current_action: "old-first", token_impact: "none", token_budget: "No models", updated: "2026-10-01", actions: [action("old-first", "open")], questions: [], decisions: [], recommended_model: "sonnet", recommended_reasoning_effort: "medium" };
  const newPlan = { arcadia: "v1", type: "plan", slug: "new-plan", project: "demo", status: "draft", milestone: "New milestone: unattended", token_impact: "none", token_budget: "No models", updated: "2026-10-01", actions: [action("next-one", "open"), action("later-one", "open", ["next-one"])], questions: [], decisions: [], recommended_model: "standard", recommended_reasoning_effort: "medium" };
  const doc = (data: unknown) => `---\n${stringify(data)}---\n\n# Real document body\n`;
  const ask = { agent_ask: "v1", request_id: "activate-new", project: "demo", intent: "plan", target_ref: "plan/new-plan", requested_authority: "apply_if_approved", desired_result: "Make new-plan the active Plan at next-one and park old-plan as draft." };
  const created = repository(root, "demo", {
    "PROJECT.md": doc(project), "docs/plans/old-plan.md": doc(oldPlan), "docs/plans/new-plan.md": doc(newPlan),
    "MISSION_LOG.md": doc({ arcadia: "v1", type: "log", slug: "demo-mission-log", project: "demo", updated: "2026-10-01" }),
    ".arcadia/asks/agent-ask-activate-new.yaml": stringify(ask), ".gitignore": "node_modules\n"
  });
  // A second, unregistered clone of the same Project: a checkout the card does not pin.
  const clone = path.join(root, "demo-clone");
  git(root, "clone", "-q", created.origin, clone);
  git(repo, "config", "user.email", "runner-test@example.invalid"); git(repo, "config", "user.name", "Runner Test"); git(repo, "config", "commit.gpgsign", "false");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const row = upsertProject(db, { name: "Demo", mission: "Hermetic proof", goal: "Safe activation", status: "active", currentMilestone: "Old milestone", nextAction: "Prove activation", workClassification: "agent" });
    upsertProjectMetadata(db, { projectId: row.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: ["demo/old-first"], order: ["demo/old-first"], requestId: "fixture-order", apply: true });
  });
  const askPath = path.join(repo, ".arcadia/asks/agent-ask-activate-new.yaml");
  const input = (checkout = repo): PlanActivationInput => ({
    schema: "arcadia-plan-activation-v1",
    checkout: { path: checkout, origin: created.origin, branch: "main", reviewedBase: created.head },
    ask: { path: ".arcadia/asks/agent-ask-activate-new.yaml", sha256: sha(readFileSync(askPath)), proposal: "activate-new" },
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
  });
  const id = "start-demo-fixture-20261125";
  const descriptorPath = path.join(arcadiaLibrary, `${id}.json`);
  writeFileSync(path.join(arcadiaLibrary, `${id}.sh`), startRunLauncher(id), { mode: 0o755 });
  /** Write this START card into Arcadia's library: its startRun block pins `pinned` (or no projectRepository) and activates in `checkout`. */
  const card = (options: { checkout?: string; pinned?: Partial<NonNullable<StartRunPins["projectRepository"]>> | null } = {}) => {
    const startRun = basePins({ project: "demo", plan: "new-plan", actions: ["next-one"], projectRepository: { path: repo, origin: created.origin, reviewedRevision: created.head, ...(options.pinned ?? {}) } });
    if (options.pinned === null) delete startRun.projectRepository;
    writeFileSync(descriptorPath, JSON.stringify({ schema: "arcadia-operator-script-v1", id, script: `${id}.sh`, kind: "grant", title: "START: demo", problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" }, repeatable: false, expires_at: "2099-01-01T00:00:00Z", startRun, planActivation: input(options.checkout) }, null, 2) + "\n");
  };
  // The runner's own checkout: Arcadia's, which holds the card's library (scripts/plan-amendment-worker.ts runs from there).
  let runnerCheckout = path.join(root, "arcadia");
  const runFrom = (dir: string) => { runnerCheckout = dir; };
  const run = () => {
    const names = ["ARCADIA_WORKSPACE", "ARCADIA_CONFIG_PATH", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR"];
    const previous = names.map((name) => process.env[name]);
    Object.assign(process.env, { ARCADIA_WORKSPACE: workspace, ARCADIA_CONFIG_PATH: path.join(root, "no-host-config.json"), ARCADIA_OPERATOR_SCRIPT_ID: id, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptorPath });
    try { return runPlanAmendment(descriptorPath, { runnerCheckout }); }
    finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); }
  };
  const count = () => withDatabase(workspace, (db) => (db.prepare("SELECT count(*) AS count FROM agent_ask_settlements").get() as { count: number }).count);
  const governed = ["PROJECT.md", "docs/plans/old-plan.md", "docs/plans/new-plan.md"];
  const noMutation = (reason: string) => {
    const heads = [repo, clone].map((dir) => git(dir, "rev-parse", "HEAD"));
    const before = [repo, clone].flatMap((dir) => governed.map((file) => readFileSync(path.join(dir, file), "utf8")));
    const order = withDatabase(workspace, (db) => [...loadActionOrder(db).positions]);
    const result = run();
    expect(result.reason, result.message).toBe(reason);
    expect(result.status).toBe("failed");
    expect([repo, clone].map((dir) => git(dir, "rev-parse", "HEAD"))).toEqual(heads);
    expect([repo, clone].flatMap((dir) => governed.map((file) => readFileSync(path.join(dir, file), "utf8")))).toEqual(before);
    expect(withDatabase(workspace, (db) => [...loadActionOrder(db).positions])).toEqual(order);
    expect(count()).toBe(0);
    return result;
  };
  return { root, repo, clone, origin: created.origin, base: created.head, workspace, card, run, runFrom, count, noMutation, descriptorPath };
}

describe("Plan activation from a START card in Arcadia's library, in another Project's registered checkout (G2)", () => {
  it("settles and publishes in the registered checkout the card pins, and replays once", () => {
    const f = activationFixture();
    f.card();
    const result = f.run();
    expect(result.reason, result.message).toBe("SETTLED_AND_PUBLISHED");
    const fields = (file: string) => documentState(readFileSync(path.join(f.repo, file), "utf8")).fields;
    expect(fields("PROJECT.md")).toMatchObject({ active_plan: "new-plan", current_action: "next-one" });
    expect(fields("docs/plans/new-plan.md")).toMatchObject({ status: "active", current_action: "next-one" });
    expect(withDatabase(f.workspace, (db) => [...loadActionOrder(db).positions.keys()])).toEqual(["demo/next-one", "demo/later-one"]);
    expect(git(f.repo, "rev-parse", "HEAD~1")).toBe(f.base);
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(git(f.origin, "rev-parse", "main"));
    const replay = f.run();
    expect(replay.reason, replay.message).toBe("REPLAY_PUBLISHED");
    expect(f.count()).toBe(1);
  });

  it.each<[string, Parameters<ReturnType<typeof activationFixture>["card"]>[0]]>([
    ["another clone of the same Project, which the card does not pin", { checkout: "CLONE" }],
    ["an activation outside the library's checkout without a pinned projectRepository", { pinned: null }],
    ["a projectRepository that names another path than the activation's checkout", { pinned: { path: "CLONE" } }],
    ["a projectRepository with another origin", { pinned: { origin: "https://github.com/someone/else.git" } }],
    ["a projectRepository at another revision than the reviewed base", { pinned: { reviewedRevision: "f".repeat(40) } }]
  ])("refuses WRONG_CHECKOUT for %s", (_label, options) => {
    const f = activationFixture();
    const swap = (value?: string) => value === "CLONE" ? realpathSync(f.clone) : value;
    f.card({ checkout: swap(options?.checkout), pinned: options?.pinned === null ? null : options?.pinned ? { ...options.pinned, ...(options.pinned.path ? { path: swap(options.pinned.path) } : {}) } : undefined });
    expect(f.noMutation("WRONG_CHECKOUT").message).toContain("Library checkout");
  });

  it("refuses WRONG_CHECKOUT when the pinned checkout is not the workspace's registered repository", () => {
    const f = activationFixture();
    const clone = realpathSync(f.clone);
    // The card pins the clone and activates there, consistently, but the workspace registers the other checkout.
    f.card({ checkout: clone, pinned: { path: clone } });
    expect(f.noMutation("WRONG_CHECKOUT").message).toContain("Workspace Project repository");
  });

  it("refuses WRONG_CHECKOUT when the checkout moved past its pinned revision with origin, before any settlement", () => {
    const f = activationFixture();
    f.card();
    commitAll(f.repo, { "README.md": "harmless advance\n" }, "advance");
    git(f.repo, "push", "-q", "origin", "main");
    const result = f.noMutation("WRONG_CHECKOUT");
    expect(result.message).toContain("Project checkout versus its pinned revision");
  });

  it("refuses WRONG_CHECKOUT for a card in another checkout's library than the runner's own (N1)", () => {
    const f = activationFixture();
    f.card();
    f.runFrom(repoRoot);  // the runner runs from a different checkout than the one holding the card's library
    expect(f.noMutation("WRONG_CHECKOUT").message).toContain("Library checkout");
  });

  it("still refuses DIRTY_CHECKOUT in the Project checkout", () => {
    const f = activationFixture();
    f.card();
    writeFileSync(path.join(f.repo, "unrelated.txt"), "Unsaved work");
    f.noMutation("DIRTY_CHECKOUT");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// B1 (round-1 review): a second Project's card records its Decision 0161 sign-in diagnostic in Arcadia, through the REAL Agent
// Ask route (assertOperatorSettlementContract, then settlement's own Project repository resolution and Decision numbering).
// ---------------------------------------------------------------------------------------------------------------------------
describe("a second Project's START card files its sign-in diagnostic Decision in Arcadia through the real settlement route (B1)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const CARD = "start-rebuster-signin-20261125";
  const projectDoc = (slug: string) => ["---", "arcadia: v1", "type: project", `slug: ${slug}`, `name: ${slug}`, "status: active",
    "mission: m.", "goal: g.", "active_plan: p", "current_action: a", "updated: 2026-11-25", "---", "", `# ${slug}`, ""].join("\n");
  const planDoc = (slug: string) => ["---", "arcadia: v1", "type: plan", "slug: p", `project: ${slug}`, "status: active", "milestone: M", "current_action: a",
    "token_impact: small", "token_budget: Deterministic.", "recommended_model: gpt-5.6-sol", "updated: 2026-11-25", "actions:", "  - id: a", "    title: A", "    status: open", "    responsibility: agent",
    "    effort: session", "    next_action: Do a.", "    expected_artifact: Proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Proof exists.", "    depends_on: []", "    decisions: []", "    references: []", "questions: []", "---", "", "# P", ""].join("\n");
  const decisionDoc = (id: string, slug: string) => ["---", "arcadia: v1", "type: decision", `id: "${id}"`, `slug: d-${id}`, `project: ${slug}`,
    "status: approved", "question: q?", "options:", "  - label: A", "    consequence: c", "answer: A", "updated: 2026-11-25", "---", "", "# D", ""].join("\n");

  function fixture() {
    const root = temp("arcadia-second-signin-");
    const workspace = path.join(root, "workspace");
    // Arcadia numbers its Decisions up to 0293; Rebuster only to 0006 (the live counts the review found).
    const arcadia = repository(root, "arcadia", {
      ".gitignore": "artifacts/generated/\n", "PROJECT.md": projectDoc("arcadia"), "docs/plans/p.md": planDoc("arcadia"), ".arcadia/asks/archive/.gitkeep": "",
      ...Object.fromEntries([...GOVERNING_DECISIONS, "0293"].map((id) => [`docs/decisions/${id}-d-${id}.md`, decisionDoc(id, "arcadia")]))
    });
    const rebuster = repository(root, "rebuster", {
      "PROJECT.md": projectDoc(PROJECT), "docs/plans/p.md": planDoc(PROJECT), ".arcadia/asks/archive/.gitkeep": "",
      ...Object.fromEntries(["0001", "0006"].map((id) => [`docs/decisions/${id}-d-${id}.md`, decisionDoc(id, PROJECT)]))
    });
    for (const dir of [arcadia.dir, rebuster.dir]) {
      for (const [key, value] of [["user.email", "t@example.invalid"], ["user.name", "T"], ["commit.gpgsign", "false"]]) git(dir, "config", key, value);
    }
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      for (const [name, dir] of [["arcadia", arcadia.dir], [PROJECT, rebuster.dir]] as const) {
        const row = upsertProject(db, { name, mission: "m.", goal: "g.", status: "active", currentMilestone: "M", nextAction: "N", workClassification: "agent" });
        upsertProjectMetadata(db, { projectId: row.id, repoPath: dir });
      }
    });
    const library = path.join(arcadia.dir, "artifacts", "generated", "operator-scripts");
    mkdirSync(library, { recursive: true });
    const write = (pins: StartRunPins) => {
      writeFileSync(path.join(library, `${CARD}.json`), JSON.stringify({ schema: "arcadia-operator-script-v1", id: CARD, kind: "grant", title: "START", script: `${CARD}.sh`, repeatable: false,
        problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" }, expires_at: "2099-01-01T00:00:00Z", startRun: pins }));
      writeFileSync(path.join(library, `${CARD}.sh`), startRunLauncher(CARD));
      vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", CARD);
      vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", path.join(library, `${CARD}.json`));
    };
    const diagnostic = (project: string) => buildDiagnosticAsk({
      context: { project, cardId: CARD, runId: "20261125T060326Z-62346", policyRevision: 83, policyEpoch: 46 },
      date: "2026-11-25", nonce: "57aeaf14-1111-4222-8333-444455556666", binding: { release: "a".repeat(40), handlerHash: "b".repeat(64) },
      answer: `A grant digest ${"c".repeat(64)}`, digest: "c".repeat(64), expiresAt: "2026-11-26T06:13:00.000Z", references: governingDecisionReferences(arcadia.dir)
    });
    const crossPins = () => basePins({ projectRepository: { path: rebuster.dir, origin: rebuster.origin, reviewedRevision: rebuster.head } });
    return { workspace, arcadia, rebuster, write, diagnostic, crossPins };
  }

  it("numbers and commits the Decision in Arcadia's repository, and leaves Rebuster untouched", () => {
    const f = fixture();
    f.write(f.crossPins());
    const d = f.diagnostic("arcadia");
    runAgentAskPreviewCommand({ workspace: f.workspace, request: JSON.stringify(d.ask) });
    const flags = { workspace: f.workspace, proposal: d.requestId, requestId: d.settlementRequestId, disposition: "accepted" as const, cwd: f.arcadia.dir };
    const preview = runAgentAskSettleCommand(flags).data.receipt;
    expect(preview.projectSlug).toBe("arcadia");
    const created = (preview.review!.documents as Array<{ path: string; before: string | null }>).filter((doc) => doc.before === null && doc.path.startsWith("docs/decisions/"));
    expect(created.map((doc) => doc.path)).toEqual(["docs/decisions/0294-authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-25-57aeaf14.md"]);
    const applied = runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true }).data.receipt;
    expect(applied.applied).toBe(true);
    expect(existsSync(path.join(f.arcadia.dir, created[0].path))).toBe(true);
    expect(git(f.arcadia.dir, "log", "-1", "--name-only", "--format=")).toContain(created[0].path);
    expect(git(f.rebuster.dir, "rev-parse", "HEAD")).toBe(f.rebuster.head);
    expect(readdirSync(path.join(f.rebuster.dir, "docs", "decisions")).sort()).toEqual(["0001-d-0001.md", "0006-d-0006.md"]);
  });

  it("refuses a diagnostic under the second Project for such a card, and an Arcadia card keeps its own Project", () => {
    const f = fixture();
    f.write(f.crossPins());
    const ask = (project: string) => normalizeAgentAsk({ request: JSON.stringify(f.diagnostic(project).ask) });
    expect(() => assertOperatorSettlementContract(ask(PROJECT))).toThrow(/only its own Decision 0161/);
    expect(() => assertOperatorSettlementContract(ask("arcadia"))).not.toThrow();
    // An Arcadia card (no projectRepository): its own Project only, exactly as before.
    const own = basePins({ project: "arcadia" });
    delete own.projectRepository;
    f.write(own);
    expect(() => assertOperatorSettlementContract(ask("arcadia"))).not.toThrow();
    expect(() => assertOperatorSettlementContract(ask(PROJECT))).toThrow(/only its own Decision 0161/);
  });
});
