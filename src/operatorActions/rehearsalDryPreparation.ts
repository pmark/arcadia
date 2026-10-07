import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  binding, exactKeys, isObject, isText, RECEIPT_RUN_ID, SHA,
  REQUIRED_COMMIT_FLOOR, type ChainRequiredCommit, CHAIN_FIXTURE
} from "./rehearsalChain.js";
import { chainCoherenceProblems, type CoherenceFile } from "./rehearsalChainCoherence.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveReadySet } from "../docs/dispatch.js";
import { requirementIdentity } from "../sessions/roleLineage.js";

/**
 * The N-neutral rehearsal dry-preparation generator: a resumable, dry-only
 * command that renders a fresh step-01..step-NN baseline (decoupled from the
 * MARKER.md/CHAIN.md genesis template `rehearsalChain.ts` renders, so N=2 is
 * representable, not only the G1-rooted N>=3 chain), checks it with the same
 * coherence guard and Arcadia's own managed-document discovery, and writes a
 * tamper-evident, hash-bound receipt into an isolated output directory it
 * owns. It performs no Git, GitHub, workspace or live-fixture mutation: the
 * parameter file only pins the identity of the existing disposable fixture
 * (path and GitHub repository) a later, separately governed step may apply
 * this baseline to — and that later step is not this generator's output; see
 * `DRY_PREP_NEXT_STEP` for the honest boundary.
 */

export const DRY_PREP_SCHEMA = "arcadia-rehearsal-dry-preparation-v1";
/** Decoupled from `MIN_CHAIN_ACTIONS`/`MAX_CHAIN_ACTIONS` on purpose: the neutral template has no fixed base Actions, so N=2 is representable. */
export const DRY_PREP_MIN_ACTIONS = 2;
export const DRY_PREP_MAX_ACTIONS = 12;
/** The one existing disposable fixture this generator's baseline is ever prepared for; pinned, never taken from the parameter file's free text. */
export const DRY_PREP_FIXTURE_REPO_PATH = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
export const DRY_PREP_FIXTURE_GITHUB_REPO = "pmark/arcadia-three-action-rehearsal-20261004";
/** The live Arcadia workspace and main checkout this generator must never write into, directly or through a symlink alias. */
export const LIVE_ARCADIA_WORKSPACE = "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover";
export const MAIN_ARCADIA_CHECKOUT = "/Users/pmark/Dev/MR/Arcadia/arcadia";
export const OTHER_WORKTREE_ROOTS = ["/Users/pmark/.codex/worktrees", "/Users/pmark/.claude/worktrees"];
export const DRY_PREP_PLAN_SLUG = "neutral-rehearsal-dry-preparation";
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RUN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAGE_MARKER_FILE = ".dry-prep-stage.json";
const SEP = "\n";

export interface DryPrepPreservation {
  resetRunId: string;
  resetHead: string;
  terminalOffRunId: string;
  localMain: string;
}
export interface DryPrepParams {
  schema: typeof DRY_PREP_SCHEMA;
  runId: string;
  actionCount: number;
  fixtureRepoPath: string;
  fixtureGithubRepo: string;
  requiredCommits: ChainRequiredCommit[];
  preservation: DryPrepPreservation;
  notes?: string[];
}
export interface DryPrepParamsValidation {
  params: DryPrepParams | null;
  problems: string[];
  unfilled: string[];
}

/** Validate one dry-preparation parameter file. Never throws; callers refuse on any problem and on any unfilled binding they need. */
export function validateDryPrepParams(raw: unknown): DryPrepParamsValidation {
  const problems: string[] = [];
  const unfilled: string[] = [];
  if (!isObject(raw)) return { params: null, problems: ["the parameter file must be a JSON object"], unfilled };
  exactKeys(raw, ["schema", "runId", "actionCount", "fixtureRepoPath", "fixtureGithubRepo", "requiredCommits", "preservation", "notes"],
    ["schema", "runId", "actionCount", "fixtureRepoPath", "fixtureGithubRepo", "requiredCommits", "preservation"], "params", problems);
  if (raw.schema !== DRY_PREP_SCHEMA) problems.push(`params.schema must be ${DRY_PREP_SCHEMA}`);
  if (typeof raw.runId !== "string" || !RUN_ID.test(raw.runId)) problems.push(`params.runId must match ${RUN_ID}`);
  if (!Number.isInteger(raw.actionCount) || (raw.actionCount as number) < DRY_PREP_MIN_ACTIONS || (raw.actionCount as number) > DRY_PREP_MAX_ACTIONS) {
    problems.push(`params.actionCount must be a whole number from ${DRY_PREP_MIN_ACTIONS} to ${DRY_PREP_MAX_ACTIONS}`);
  }
  if (raw.fixtureRepoPath !== DRY_PREP_FIXTURE_REPO_PATH) problems.push(`params.fixtureRepoPath must be exactly ${DRY_PREP_FIXTURE_REPO_PATH} (the pinned disposable fixture)`);
  if (raw.fixtureGithubRepo !== DRY_PREP_FIXTURE_GITHUB_REPO) problems.push(`params.fixtureGithubRepo must be exactly ${DRY_PREP_FIXTURE_GITHUB_REPO} (the pinned disposable fixture)`);
  if (raw.notes !== undefined && (!Array.isArray(raw.notes) || !raw.notes.every(isText))) problems.push("params.notes must be a list of strings");

  if (!Array.isArray(raw.requiredCommits) || raw.requiredCommits.length === 0) {
    problems.push("params.requiredCommits must list at least one required Arcadia commit");
  } else {
    const seen = new Set<string>();
    raw.requiredCommits.forEach((entry, index) => {
      const at = `params.requiredCommits[${index}]`;
      if (!isObject(entry)) { problems.push(`${at} must be an object with commit and why`); return; }
      exactKeys(entry, ["commit", "why"], ["commit", "why"], at, problems);
      binding(entry.commit, SHA, `${at}.commit`, problems, unfilled);
      if (!isText(entry.why)) problems.push(`${at}.why must say what the commit provides`);
      if (typeof entry.commit === "string" && SHA.test(entry.commit)) {
        if (seen.has(entry.commit)) problems.push(`${at}.commit repeats an earlier required commit`);
        seen.add(entry.commit);
      }
    });
    for (const [commit, why] of Object.entries(REQUIRED_COMMIT_FLOOR)) {
      if (!seen.has(commit)) problems.push(`params.requiredCommits must include ${commit} (${why}); the floor cannot be removed by a parameter change`);
    }
  }

  const preservation = raw.preservation;
  if (!isObject(preservation)) {
    problems.push("params.preservation must be an object");
  } else {
    const at = "params.preservation";
    exactKeys(preservation, ["resetRunId", "resetHead", "terminalOffRunId", "localMain"], ["resetRunId", "resetHead", "terminalOffRunId", "localMain"], at, problems);
    binding(preservation.resetRunId, RECEIPT_RUN_ID, `${at}.resetRunId`, problems, unfilled);
    binding(preservation.resetHead, SHA, `${at}.resetHead`, problems, unfilled);
    binding(preservation.terminalOffRunId, RECEIPT_RUN_ID, `${at}.terminalOffRunId`, problems, unfilled);
    binding(preservation.localMain, SHA, `${at}.localMain`, problems, unfilled);
  }
  return { params: problems.length === 0 ? (raw as unknown as DryPrepParams) : null, problems, unfilled };
}

// ---------------------------------------------------------------------------
// The neutral step-01..step-NN baseline (no fixed base Actions, unlike rehearsalChain.ts)
// ---------------------------------------------------------------------------

export const neutralStepId = (step: number): string => `step-${String(step).padStart(2, "0")}`;
export function neutralStepIds(count: number): string[] {
  if (!Number.isInteger(count) || count < DRY_PREP_MIN_ACTIONS || count > DRY_PREP_MAX_ACTIONS) {
    throw new Error(`Action count must be ${DRY_PREP_MIN_ACTIONS} to ${DRY_PREP_MAX_ACTIONS}.`);
  }
  return Array.from({ length: count }, (_unused, index) => neutralStepId(index + 1));
}

interface NeutralStepTemplate { title: string; task: string; expectedArtifact: string; criteria: string[] }

/**
 * Concrete, observable, N-independent fixture work: step 01 writes STEPS.md
 * with one fixed marker line; each later step appends one fixed line that
 * names its predecessor, after reading and checking that predecessor's line
 * — the same genuinely-ordered-chain shape `rehearsalChain.ts` uses for
 * MARKER.md/CHAIN.md, generalised to start at step 1 so N=2 is representable.
 * The line text never embeds N, so it never collides with the coherence
 * guard; only this Action's title/task/criteria state "Action k of N".
 */
const stepLine = (step: number) => step === 1 ? "neutral step 01 start" : `neutral step ${neutralStepId(step).slice(-2)} follows neutral step ${neutralStepId(step - 1).slice(-2)}`;

function neutralStepTemplate(step: number, count: number): NeutralStepTemplate {
  const id = neutralStepId(step);
  const line = stepLine(step);
  if (step === 1) {
    return {
      title: `Implement STEPS.md containing exactly the line "${line}" plus a trailing newline (Action 1 of ${count}).`,
      task: `Implement STEPS.md containing exactly the line "${line}" plus a trailing newline; this is Action 1 of ${count} in one serial chain`,
      expectedArtifact: "STEPS.md whose only line is the neutral step 01 line",
      criteria: [`STEPS.md exists and contains exactly the line "${line}" followed by a trailing newline, with no other content.`]
    };
  }
  const previous = neutralStepId(step - 1);
  return {
    title: `Implement appending the line "${line}" to STEPS.md, after reading its last line (Action ${step} of ${count}).`,
    task: `Implement appending one line to STEPS.md after reading its last line, which ${previous} wrote and which must start with "neutral step ${previous.slice(-2)} follows" or be "neutral step 01 start" (otherwise stop and report without writing anything); the new last line is exactly "${line}" plus a trailing newline, and every earlier line stays unchanged; this is Action ${step} of ${count} in one serial chain`,
    expectedArtifact: `STEPS.md ending with the neutral step ${id.slice(-2)} line`,
    criteria: [`STEPS.md holds exactly one line per step from 01 to ${id.slice(-2)} in step order, each with a trailing newline; its earlier lines are unchanged and its last line is exactly "${line}".`]
  };
}

function neutralActionBlock(step: number, count: number): string[] {
  const id = neutralStepId(step);
  const template = neutralStepTemplate(step, count);
  const previous = step === 1 ? "" : neutralStepId(step - 1);
  return [
    `  - id: ${id}`,
    `    title: ${template.title}`,
    "    status: open",
    "    responsibility: agent",
    "    effort: session",
    `    next_action: ${template.task}`,
    `    expected_artifact: ${template.expectedArtifact}`,
    "    clarification: clarified",
    "    confidence: high",
    "    acceptance_criteria:",
    ...template.criteria.map((criterion) => `      - ${criterion}`),
    `    depends_on: [${previous}]`,
    "    decisions: []"
  ];
}

export const neutralTokenBudget = (count: number) => `token_budget: ${count} trivial file-edit Actions in one serial dry-preparation baseline; no model use to stage it.`;
export const neutralMilestone = (count: number) => `Prepare a reviewed ${count}-Action N-neutral rehearsal baseline.`;
/**
 * `recommended_model` names a tier ("standard"), never a concrete provider
 * model: Decision 0004's vendor-neutral execution profiles let Arcadia select
 * the least-costly compliant coding-agent configuration for that tier, and a
 * staged dry-preparation Plan must not pin a provider ahead of that choice.
 */
export const NEUTRAL_RECOMMENDED_MODEL_TIER = "standard";

export interface RenderedNeutralBaseline { plan: string; project: string; actionIds: string[] }

/** Render a fresh N-neutral Plan and PROJECT.md from scratch (no base document to amend: this is a new baseline, not an amendment of the live fixture). */
export function renderNeutralBaseline(params: Pick<DryPrepParams, "runId" | "actionCount">, resetDate: string): RenderedNeutralBaseline {
  if (!DATE.test(resetDate)) throw new Error(`reset date ${resetDate} is not YYYY-MM-DD`);
  const actionIds = neutralStepIds(params.actionCount);
  const blocks = actionIds.map((_id, index) => neutralActionBlock(index + 1, params.actionCount));
  const plan = [
    "---",
    "arcadia: v1",
    "type: plan",
    `slug: ${DRY_PREP_PLAN_SLUG}`,
    `project: ${CHAIN_FIXTURE.project}`,
    "status: active",
    `milestone: ${neutralMilestone(params.actionCount)}`,
    "token_impact: small",
    neutralTokenBudget(params.actionCount),
    `recommended_model: ${NEUTRAL_RECOMMENDED_MODEL_TIER}`,
    `current_action: ${actionIds[0]}`,
    `updated: ${resetDate}`,
    "actions:",
    ...blocks.flat(),
    "---",
    "",
    `# N-neutral rehearsal dry-preparation baseline (run ${params.runId})`,
    "",
    `Staged baseline Plan for ${params.actionCount} serial Actions (${actionIds.join(", ")}), each a concrete STEPS.md edit. Reviewed input only; applying it to the live fixture is a separate, later, governed step this generator does not perform — see the receipt's nextStep.`,
    ""
  ].join("\n");
  const project = [
    "---",
    "arcadia: v1",
    "type: project",
    `slug: ${CHAIN_FIXTURE.project}`,
    "name: Three Action Rehearsal",
    "status: active",
    `goal: Disposable fixture prepared for a reviewed ${params.actionCount}-Action N-neutral rehearsal baseline.`,
    `outcome: Demonstrate a reviewed ${params.actionCount}-Action N-neutral dry-preparation baseline, staged for later, separately governed fixture application.`,
    `milestone: ${neutralMilestone(params.actionCount)}`,
    `active_plan: ${DRY_PREP_PLAN_SLUG}`,
    `current_action: ${actionIds[0]}`,
    `updated: ${resetDate}`,
    "---",
    "",
    "# Three Action Rehearsal",
    "",
    `Disposable fixture for a staged ${params.actionCount}-Action N-neutral rehearsal baseline.`,
    ""
  ].join("\n");
  return { plan, project, actionIds };
}

// ---------------------------------------------------------------------------
// Coherence and real Arcadia managed-document validation
// ---------------------------------------------------------------------------

export function neutralBaselineCoherenceProblems(baseline: RenderedNeutralBaseline, actionCount: number): string[] {
  const files: CoherenceFile[] = [
    { path: `docs/plans/${DRY_PREP_PLAN_SLUG}.md`, text: baseline.plan },
    { path: "PROJECT.md", text: baseline.project }
  ];
  return chainCoherenceProblems(files, actionCount);
}

export interface NeutralBaselineObservation {
  errors: string[];
  readySetBlockers: string[];
  project: { slug: string; activePlan: string | null; currentAction: string | null } | null;
  actions: Array<{ id: string; status: string; responsibility: string; dependsOn: string[] }> | null;
  ready: string[];
  candidates: Array<{ id: string; ready: boolean; gate: unknown; blockers: string[] }>;
  identities: Record<string, { requirementId: string; inputRevision: string; criteriaFingerprint: string }> | null;
}

/** Observe a staged baseline tree with Arcadia's own discovery, ready set and requirementIdentity — the same functions `rehearsalChain.ts`'s amendment validation uses, read-only. */
export function observeNeutralBaseline(root: string): NeutralBaselineObservation {
  const discovered = discoverDocs(root);
  const project = discovered.docs.find((doc) => doc.type === "project");
  const plan = discovered.docs.find((doc) => doc.type === "plan" && doc.slug === DRY_PREP_PLAN_SLUG);
  const ready = resolveReadySet(root, CHAIN_FIXTURE.project);
  let identities: NeutralBaselineObservation["identities"] = null;
  if (plan?.type === "plan") {
    identities = Object.fromEntries(plan.actions.map((action) => {
      const identity = requirementIdentity({ projectSlug: CHAIN_FIXTURE.project, planSlug: DRY_PREP_PLAN_SLUG, action });
      return [action.id, { requirementId: identity.requirementId, inputRevision: identity.inputRevision, criteriaFingerprint: identity.criteriaFingerprint }];
    }));
  }
  return {
    errors: discovered.errors.map((e) => e.message),
    readySetBlockers: ready.blockers.map((e) => e.message),
    project: project?.type === "project" ? { slug: project.slug, activePlan: project.activePlan, currentAction: project.currentAction } : null,
    actions: plan?.type === "plan" ? plan.actions.map((action) => ({ id: action.id, status: action.status, responsibility: action.responsibility, dependsOn: action.dependsOn })) : null,
    ready: ready.ready.map((entry) => entry.actionId),
    candidates: ready.candidates.map((entry) => ({ id: entry.actionId, ready: entry.ready, gate: entry.gate, blockers: entry.blockers.map((blocker) => blocker.field) })),
    identities
  };
}

/** Every way a staged baseline fails Arcadia's own discovery and ready-set judgement; empty means valid. */
export function neutralBaselineProblems(o: NeutralBaselineObservation, expected: { actionIds: string[] }): string[] {
  const problems: string[] = [];
  const ids = expected.actionIds;
  problems.push(...o.errors.map((e) => `docs sync error: ${e}`), ...o.readySetBlockers.map((e) => `ready-set blocker: ${e}`));
  if (o.project === null) problems.push("no PROJECT.md was discovered");
  else if (o.project.slug !== CHAIN_FIXTURE.project || o.project.activePlan !== DRY_PREP_PLAN_SLUG || o.project.currentAction !== ids[0]) {
    problems.push(`PROJECT.md does not point at ${DRY_PREP_PLAN_SLUG}#${ids[0]}`);
  }
  if (o.actions === null) problems.push(`Plan ${DRY_PREP_PLAN_SLUG} was not discovered`);
  else {
    if (JSON.stringify(o.actions.map((a) => a.id)) !== JSON.stringify(ids)) problems.push(`Plan Actions are [${o.actions.map((a) => a.id).join(", ")}], not [${ids.join(", ")}]`);
    else if (o.actions.some((a, i) => JSON.stringify(a.dependsOn) !== JSON.stringify(i === 0 ? [] : [ids[i - 1]]))) problems.push(`Plan depends_on is not the serial chain ${ids.join(" -> ")}`);
    if (o.actions.some((a) => a.status !== "open" || a.responsibility !== "agent")) problems.push("every Action must be open and agent-owned");
  }
  if (JSON.stringify(o.ready) !== JSON.stringify([ids[0]])) problems.push(`the ready set is [${o.ready.join(", ")}], not exactly [${ids[0]}]`);
  for (const c of o.candidates) {
    if (c.id === ids[0]) continue;
    if (c.ready || c.gate !== null || c.blockers.length === 0 || c.blockers.some((b) => !b.endsWith(".depends_on"))) problems.push(`${c.id} is not gated only by depends_on`);
  }
  if (o.identities === null) problems.push("requirement identities could not be computed");
  else for (const id of ids) if (!o.identities[id]) problems.push(`no requirement identity for ${id}`);
  return problems;
}

// ---------------------------------------------------------------------------
// Physical-path containment: never a live path, a symlink alias into one, or
// an unowned destination (Finding 1).
// ---------------------------------------------------------------------------

/** Resolve symlinks in every existing ancestor, then append the not-yet-created tail literally (it cannot be a symlink if it does not exist). */
function nearestRealPath(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const real = existsSync(current) ? realpathSync(current) : current;
  return tail.length > 0 ? path.join(real, ...tail) : real;
}

function isUnder(child: string, ancestor: string): boolean {
  if (child === ancestor) return true;
  const rel = path.relative(ancestor, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * `outputDir` must resolve (after following every existing symlink) inside
 * this candidate's own worktree or an OS temporary directory, and never
 * inside the main operator-scripts library, the pinned live fixture, the live
 * Arcadia workspace, the main Arcadia checkout, or another worktree's
 * checkout. A symlink anywhere in the path that aliases into one of those is
 * caught by resolving the real path before any comparison.
 */
export function assertSafeOutputDir(outputDir: string, repoRoot: string): string[] {
  if (existsSync(outputDir) && lstatSync(outputDir).isSymbolicLink()) {
    return [`outputDir ${outputDir} is itself a symlink; this command refuses to follow it rather than risk writing through an alias`];
  }
  const resolved = nearestRealPath(outputDir);
  const realRepoRoot = nearestRealPath(repoRoot);
  const denylist: Array<[string, string]> = [
    ["the pinned live fixture repository", DRY_PREP_FIXTURE_REPO_PATH],
    ["the live Arcadia workspace", LIVE_ARCADIA_WORKSPACE],
    ["the main Arcadia checkout", MAIN_ARCADIA_CHECKOUT],
    ["the main operator-scripts library", path.join(repoRoot, "artifacts", "generated", "operator-scripts")],
    ["candidate Git metadata", path.join(repoRoot, ".git")]
  ];
  for (const [label, denyPath] of denylist) {
    if (isUnder(resolved, nearestRealPath(denyPath))) {
      return [`outputDir ${resolved} resolves inside ${label} (${denyPath}); choose a fresh isolated staging directory`];
    }
  }
  if (isUnder(resolved, realRepoRoot)) return [];
  for (const root of OTHER_WORKTREE_ROOTS) {
    if (isUnder(resolved, nearestRealPath(root))) return [`outputDir resolves inside another candidate's worktree (${root})`];
  }
  const tmpRoot = nearestRealPath(os.tmpdir());
  if (![tmpRoot, nearestRealPath("/tmp")].some((root) => isUnder(resolved, root))) {
    return [`outputDir ${resolved} is neither inside this candidate's own worktree (${realRepoRoot}) nor inside a temporary directory (${tmpRoot}); this command refuses an output location it does not own`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Hash-bound, tamper-evident, resumable staging (the dry-only command; Finding 2)
// ---------------------------------------------------------------------------

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
/** The semantic descriptor of a run, independent of incidental parameter-file formatting or notes. */
export function dryPrepDescriptor(params: Pick<DryPrepParams, "runId" | "actionCount" | "fixtureRepoPath" | "fixtureGithubRepo">, resetDate: string) {
  return { schema: DRY_PREP_SCHEMA, runId: params.runId, actionCount: params.actionCount, fixtureRepoPath: params.fixtureRepoPath, fixtureGithubRepo: params.fixtureGithubRepo, resetDate };
}

export interface DryPrepReceipt {
  schema: typeof DRY_PREP_SCHEMA;
  runId: string;
  actionCount: number;
  resetDate: string;
  paramsHash: string;
  descriptorHash: string;
  baselineHash: string;
  planHash: string;
  projectHash: string;
  sourceHash: string;
  actionIds: string[];
  fixtureRepoPath: string;
  fixtureGithubRepo: string;
  generatedAt: string;
  nextStep: string;
  authorityNeeded: string;
}

export type DryPrepResult =
  | { status: "staged"; resumed: false; receipt: DryPrepReceipt }
  | { status: "resumed"; resumed: true; receipt: DryPrepReceipt }
  | { status: "refused"; problems: string[] };

/**
 * Honest about what this generator does NOT produce: the existing chain
 * runner (`rehearsalChain.ts` / `rehearsalChainDescriptors.ts`) is rooted in
 * G1's three base Action ids (write-start-marker, transform-start-marker,
 * verify-final-rehearsal) and its own N>=3 floor, so this baseline's
 * step-01..step-NN ids are not directly consumable by the existing reset ->
 * preflight -> grant -> terminal Off scripts without a separate, not-yet-built
 * translation. This receipt names that boundary rather than implying an
 * unsupported runnable gate.
 */
const DRY_PREP_NEXT_STEP = (p: Pick<DryPrepParams, "fixtureRepoPath" | "fixtureGithubRepo">) =>
  `No live mutation was performed. This baseline's step-01..step-NN Actions are NOT the ids the existing rehearsal-chain reset/preflight/grant/terminal-Off scripts (rehearsalChain.ts, rooted in G1's write-start-marker/transform-start-marker/verify-final-rehearsal and N>=3) expect; applying this baseline to ${p.fixtureRepoPath} (${p.fixtureGithubRepo}) needs a separate, not-yet-built adapter or a hand-authored rehearsal-chain parameter file reusing the existing ids, reviewed through the governed Ask path before any Session starts. This command never writes into artifacts/generated/operator-scripts, the live workspace, or the live fixture.`;
export const DRY_PREP_AUTHORITY_NEEDED = "An operator Decision (deploy/publish/spend/credentials/production boundary) before any later step presses G6/G7/G8 or reinstalls/restarts shared host state; this dry preparation requires none.";

/** Source files this generator reuses, including the real discovery/parser/dispatch/role dependencies its validation calls; their bytes are bound into the receipt so a change to any of them invalidates a resumed stage. */
function sourceHashOf(repoRoot: string): string {
  const files = [
    "scripts/prepare-rehearsal-dry-baseline.ts",
    "src/operatorActions/rehearsalChain.ts",
    "src/operatorActions/rehearsalChainCoherence.ts",
    "src/operatorActions/rehearsalDryPreparation.ts",
    "src/docs/discover.ts",
    "src/docs/dispatch.ts",
    "src/docs/parse.ts",
    "src/docs/frontmatter.ts",
    "src/sessions/roleLineage.ts",
    "src/sessions/enrollment.ts"
  ];
  return sha256Hex(files.map((file) => readFileSync(path.join(repoRoot, file), "utf8")).join(SEP));
}

/** Publish complete files by rename, so interruption cannot leave truncated metadata or follow a target-file alias. */
function writeStageFile(file: string, text: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, file);
}

interface StageMarker { schema: typeof DRY_PREP_SCHEMA; runId: string }
const markerPath = (outputDir: string) => path.join(outputDir, STAGE_MARKER_FILE);
const receiptPathOf = (outputDir: string) => path.join(outputDir, "receipt.json");
const planPathOf = (fixtureDir: string) => path.join(fixtureDir, "docs", "plans", `${DRY_PREP_PLAN_SLUG}.md`);
const projectPathOf = (fixtureDir: string) => path.join(fixtureDir, "PROJECT.md");

function readJson<T>(filePath: string): { value: T | null; malformed: boolean } {
  if (!existsSync(filePath)) return { value: null, malformed: false };
  try { return { value: JSON.parse(readFileSync(filePath, "utf8")) as T, malformed: false }; } catch { return { value: null, malformed: true }; }
}

/** The actual on-disk staged bytes must still match the receipt's per-file hashes; a missing or tampered file refuses rather than silently resuming (Finding 2). */
function staleArtifactProblems(fixtureDir: string, receipt: DryPrepReceipt): string[] {
  const problems: string[] = [];
  const planPath = planPathOf(fixtureDir);
  const projectPath = projectPathOf(fixtureDir);
  if (!existsSync(planPath)) problems.push("the staged Plan file is missing");
  else if (sha256Hex(readFileSync(planPath, "utf8")) !== receipt.planHash) problems.push("the staged Plan file does not match the receipt (tampered or regenerated since staging)");
  if (!existsSync(projectPath)) problems.push("the staged PROJECT.md is missing");
  else if (sha256Hex(readFileSync(projectPath, "utf8")) !== receipt.projectHash) problems.push("the staged PROJECT.md does not match the receipt (tampered or regenerated since staging)");
  return problems;
}

/** Refuse symlinks and special files anywhere in a prior stage before reading or writing through them. */
function stageTreeProblems(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const problems: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) problems.push(`unsafe staged entry: ${target}`);
    else if (entry.isDirectory()) problems.push(...stageTreeProblems(target));
  }
  return problems;
}

/**
 * Stage one dry preparation: render the N-neutral baseline, check it with the
 * coherence guard and Arcadia's own discovery, and write a hash-bound
 * receipt. Resumable: an existing receipt whose hashes still match, and whose
 * staged files on disk still match the receipt's own per-file hashes, is
 * reused untouched; anything else refuses, naming what changed or is
 * missing/tampered, without touching the prior stage. An unowned, non-empty
 * output directory refuses before any write; a malformed marker or receipt
 * refuses rather than being silently bypassed. Never touches Git, GitHub, the
 * live workspace or the live fixture.
 */
export function stageDryPreparation(params: DryPrepParams, resetDate: string, outputDir: string, repoRoot: string): DryPrepResult {
  const validation = validateDryPrepParams(params);
  if (validation.problems.length || validation.unfilled.length) return { status: "refused", problems: [...validation.problems, ...validation.unfilled] };
  const unsafe = assertSafeOutputDir(outputDir, repoRoot);
  if (unsafe.length > 0) return { status: "refused", problems: unsafe };
  if (!DATE.test(resetDate)) return { status: "refused", problems: [`resetDate ${resetDate} is not YYYY-MM-DD`] };

  const resolvedOutput = path.resolve(outputDir);
  if (existsSync(resolvedOutput)) {
    if (!lstatSync(resolvedOutput).isDirectory()) return { status: "refused", problems: ["outputDir must be a directory"] };
    const treeProblems = stageTreeProblems(resolvedOutput);
    if (treeProblems.length) return { status: "refused", problems: treeProblems };
    const marker = readJson<StageMarker>(markerPath(resolvedOutput));
    if (marker.malformed) return { status: "refused", problems: [`${resolvedOutput}'s owned-stage marker is malformed; preserved untouched. Choose a fresh output directory.`] };
    if (!marker.value) {
      const entries = readdirSync(resolvedOutput);
      if (entries.length > 0) return { status: "refused", problems: [`${resolvedOutput} already holds unrelated content and no owned-stage marker; this command refuses to stage into a directory it does not own. Choose an empty or fresh output directory.`] };
    } else if (marker.value.runId !== params.runId || marker.value.schema !== DRY_PREP_SCHEMA) {
      return { status: "refused", problems: [`${resolvedOutput} is an owned stage for a different run (${marker.value.runId}); this command refuses to reuse it for ${params.runId}. Choose a fresh output directory.`] };
    }
  } else {
    mkdirSync(resolvedOutput, { recursive: true });
  }
  if (!readJson<StageMarker>(markerPath(resolvedOutput)).value) {
    writeStageFile(markerPath(resolvedOutput), `${JSON.stringify({ schema: DRY_PREP_SCHEMA, runId: params.runId } satisfies StageMarker)}\n`);
  }

  const baseline = renderNeutralBaseline(params, resetDate);
  const coherenceProblems = neutralBaselineCoherenceProblems(baseline, params.actionCount);
  if (coherenceProblems.length > 0) return { status: "refused", problems: coherenceProblems };

  const paramsHash = sha256Hex(JSON.stringify(params));
  const descriptorHash = sha256Hex(JSON.stringify(dryPrepDescriptor(params, resetDate)));
  const planHash = sha256Hex(baseline.plan);
  const projectHash = sha256Hex(baseline.project);
  const baselineHash = sha256Hex(`${planHash}${SEP}${projectHash}`);
  const sourceHash = sourceHashOf(repoRoot);

  const fixtureDir = path.join(resolvedOutput, "fixture");
  const receiptPath = receiptPathOf(resolvedOutput);
  const receiptRead = readJson<DryPrepReceipt>(receiptPath);
  if (receiptRead.malformed) return { status: "refused", problems: [`${resolvedOutput}'s receipt.json is malformed; preserved untouched. Choose a fresh output directory.`] };

  if (receiptRead.value) {
    const existing = receiptRead.value;
    const changed: string[] = [];
    if (existing.paramsHash !== paramsHash) changed.push("validated parameter content changed");
    if (existing.descriptorHash !== descriptorHash) changed.push("the run's descriptor changed (runId/actionCount/fixture pins/resetDate)");
    if (existing.baselineHash !== baselineHash) changed.push("the rendered baseline changed");
    if (existing.sourceHash !== sourceHash) changed.push("the reused generator source changed");
    const expectedStable = {
      schema: DRY_PREP_SCHEMA, runId: params.runId, actionCount: params.actionCount, resetDate,
      planHash, projectHash, actionIds: baseline.actionIds,
      fixtureRepoPath: params.fixtureRepoPath, fixtureGithubRepo: params.fixtureGithubRepo,
      nextStep: DRY_PREP_NEXT_STEP(params), authorityNeeded: DRY_PREP_AUTHORITY_NEEDED
    };
    const receiptKeys = [...Object.keys(expectedStable), "paramsHash", "descriptorHash", "baselineHash", "sourceHash", "generatedAt"];
    if (!isObject(existing) || Object.keys(existing).some((key) => !receiptKeys.includes(key))) changed.push("receipt contains unsupported fields");
    if (typeof existing.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(existing.generatedAt) || !Number.isFinite(Date.parse(existing.generatedAt))) changed.push("receipt generatedAt is invalid");
    for (const [key, value] of Object.entries(expectedStable)) {
      if (JSON.stringify(existing[key as keyof DryPrepReceipt]) !== JSON.stringify(value)) changed.push(`receipt field ${key} changed`);
    }
    if (changed.length > 0) {
      return { status: "refused", problems: [`${resolvedOutput} already holds a dry-preparation receipt for ${existing.runId}; ${changed.join("; ")}. Choose a fresh output directory, or rerun with the original inputs.`] };
    }
    const stale = staleArtifactProblems(fixtureDir, existing);
    if (stale.length > 0) {
      return { status: "refused", problems: [`${resolvedOutput}'s receipt matches these inputs, but its staged artifacts do not: ${stale.join("; ")}. Preserved untouched; choose a fresh output directory.`] };
    }
    return { status: "resumed", resumed: true, receipt: existing };
  }

  // No finalized receipt yet: either a fresh stage or an interrupted one. Never clobber drifted content from a different, unfinished attempt.
  for (const [filePath, text] of [[planPathOf(fixtureDir), baseline.plan], [projectPathOf(fixtureDir), baseline.project]] as const) {
    if (existsSync(filePath) && readFileSync(filePath, "utf8") !== text) {
      return { status: "refused", problems: [`${filePath} already holds different staged content and no finalized receipt exists; this may be another run's interrupted attempt. Preserved untouched; choose a fresh output directory.`] };
    }
  }
  mkdirSync(path.join(fixtureDir, "docs", "plans"), { recursive: true });
  writeStageFile(projectPathOf(fixtureDir), baseline.project);
  writeStageFile(planPathOf(fixtureDir), baseline.plan);

  const observation = observeNeutralBaseline(fixtureDir);
  const schemaProblems = neutralBaselineProblems(observation, { actionIds: baseline.actionIds });
  if (schemaProblems.length > 0) return { status: "refused", problems: schemaProblems };

  const receipt: DryPrepReceipt = {
    schema: DRY_PREP_SCHEMA, runId: params.runId, actionCount: params.actionCount, resetDate,
    paramsHash, descriptorHash, baselineHash, planHash, projectHash, sourceHash,
    actionIds: baseline.actionIds, fixtureRepoPath: params.fixtureRepoPath, fixtureGithubRepo: params.fixtureGithubRepo,
    generatedAt: new Date().toISOString(),
    nextStep: DRY_PREP_NEXT_STEP(params), authorityNeeded: DRY_PREP_AUTHORITY_NEEDED
  };
  writeStageFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { status: "staged", resumed: false, receipt };
}

