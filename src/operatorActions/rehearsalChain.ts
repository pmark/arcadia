import { capitalNumberWord, numberWord } from "./rehearsalChainCoherence.js";

/**
 * Pure parts of the parameterised N-Action rehearsal-chain operator script set
 * (artifacts/generated/operator-scripts/rehearsal-chain/): the per-run
 * parameter file's validation, the derived Action and completion ids, the
 * fixture Plan and PROJECT.md rendering, completion-id freshness and the
 * previous-head (local-main preservation) decision. Nothing here reads Git,
 * GitHub, a workspace or the clock; the shell scripts gather those facts and
 * pass them in. The coherence guard that refuses any stated Action count other
 * than N lives in rehearsalChainCoherence.ts.
 */

export const CHAIN_PARAMS_SCHEMA = "arcadia-rehearsal-chain-run-v1";
export const CHAIN_FIXTURE = {
  project: "three-action-rehearsal",
  plan: "autonomous-three-action-rehearsal",
  planFile: "docs/plans/autonomous-three-action-rehearsal.md",
  /** G1's three Actions, in order; the chain amends them and appends chain-step-04 onward. */
  baseActions: ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"] as const
};
export const MIN_CHAIN_ACTIONS = 3;
export const MAX_CHAIN_ACTIONS = 12;
/** Any parameter value starting with this marker is a binding still to be filled; every script refuses it. */
export const UNFILLED = "UNFILLED";

/**
 * The fail-closed floor every run's G6 and G7 require on Arcadia main, whatever
 * the parameter file adds: remote preservation (#922), tick-driven PR readiness
 * and reviews (#924), the canonical-name Ask archive (#983), all hard-coded in
 * the run-5 set, the serial PR base stacking fix (#987, merged as #1006) and the
 * pending-completion gate fix (#997, merged as #1010).
 */
export const REQUIRED_COMMIT_FLOOR: Readonly<Record<string, string>> = {
  "9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1": "remote preservation (#922)",
  "0b3686013f0a924c35d58dc7a09c979f1a994c7e": "tick-driven PR readiness and both independent reviews (#924)",
  "bb83f70cbc0d6c08685735d0f192ef20fc0cf5d4": "settlement archives the drafted Ask by its canonical name (#983)",
  "26172c74ae9dcf795cc69cabd8a62616f7ed42c8": "serial Actions' draft PRs stacked on the previous candidate branch (#987, #1006)",
  "a4a7c18450c6fe38beb390d7ce4fd62570ca841f": "a pending completion Ask gating the tick is shown, recovered or integrated (#997, #1010)"
};

export interface ChainCandidate { branch: string; tip: string; pullRequest: number }
export interface ChainRequiredCommit { commit: string; why: string }
export interface ChainRunParams {
  schema: typeof CHAIN_PARAMS_SCHEMA;
  runId: string;
  runLabel: string;
  actionCount: number;
  requiredCommits: ChainRequiredCommit[];
  previousRun: {
    label: string;
    resetId: string;
    terminalOffId: string;
    grantId: string;
    bindings: {
      resetRunId: string;
      resetHead: string;
      terminalOffRunId: string;
      localMain: string;
      candidates: ChainCandidate[];
    };
  };
  notes?: string[];
}
export interface ChainParamsValidation {
  params: ChainRunParams | null;
  /** Shape errors: the file is not a usable parameter file at all. */
  problems: string[];
  /** Paths of bindings still marked UNFILLED (the shape is otherwise valid). */
  unfilled: string[];
}

/** Exported for reuse by other parameter-file validators (for example the dry-preparation generator) so the shape primitives are defined once. */
export const SHA = /^[0-9a-f]{40}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_ID = /^run([0-9]{1,3})-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RUN_LABEL = /^run ([0-9]{1,3})$/;
export const RECEIPT_RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const isUnfilled = (value: unknown): boolean => typeof value === "string" && value.startsWith(UNFILLED);

export function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[], at: string, problems: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push(`${at}.${key} is not a known parameter`);
  for (const key of required) if (!(key in value)) problems.push(`${at}.${key} is required`);
}

/** A binding is either filled (matching `pattern`) or explicitly UNFILLED; anything else is a shape problem. */
export function binding(value: unknown, pattern: RegExp, at: string, problems: string[], unfilled: string[]): void {
  if (isUnfilled(value)) unfilled.push(at);
  else if (typeof value !== "string" || !pattern.test(value)) problems.push(`${at} must match ${pattern} or start with ${UNFILLED}`);
}

/** Validate one per-run parameter file. Never throws; callers refuse on any problem and on any unfilled binding they need. */
export function validateChainParams(raw: unknown): ChainParamsValidation {
  const problems: string[] = [];
  const unfilled: string[] = [];
  if (!isObject(raw)) return { params: null, problems: ["the parameter file must be a JSON object"], unfilled };
  exactKeys(raw, ["schema", "runId", "runLabel", "actionCount", "requiredCommits", "previousRun", "notes"], ["schema", "runId", "runLabel", "actionCount", "requiredCommits", "previousRun"], "params", problems);
  if (raw.schema !== CHAIN_PARAMS_SCHEMA) problems.push(`params.schema must be ${CHAIN_PARAMS_SCHEMA}`);
  const runMatch = typeof raw.runId === "string" ? RUN_ID.exec(raw.runId) : null;
  if (!runMatch) problems.push(`params.runId must match ${RUN_ID} (for example run6-2026-10-06)`);
  const labelMatch = typeof raw.runLabel === "string" ? RUN_LABEL.exec(raw.runLabel) : null;
  if (!labelMatch) problems.push(`params.runLabel must match ${RUN_LABEL} (for example "run 6")`);
  if (runMatch && labelMatch && Number(runMatch[1]) !== Number(labelMatch[1])) problems.push("params.runLabel and params.runId name different run numbers");
  if (!Number.isInteger(raw.actionCount) || (raw.actionCount as number) < MIN_CHAIN_ACTIONS || (raw.actionCount as number) > MAX_CHAIN_ACTIONS) {
    problems.push(`params.actionCount must be a whole number from ${MIN_CHAIN_ACTIONS} to ${MAX_CHAIN_ACTIONS}`);
  }
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

  const previous = raw.previousRun;
  if (!isObject(previous)) {
    problems.push("params.previousRun must be an object");
  } else {
    exactKeys(previous, ["label", "resetId", "terminalOffId", "grantId", "bindings"], ["label", "resetId", "terminalOffId", "grantId", "bindings"], "params.previousRun", problems);
    if (!isText(previous.label)) problems.push("params.previousRun.label must name the previous run");
    for (const key of ["resetId", "terminalOffId", "grantId"]) {
      if (typeof previous[key] !== "string" || !SLUG.test(previous[key])) problems.push(`params.previousRun.${key} must be an operator-script id (lowercase slug)`);
    }
    const bindings = previous.bindings;
    if (!isObject(bindings)) {
      problems.push("params.previousRun.bindings must be an object");
    } else {
      const at = "params.previousRun.bindings";
      exactKeys(bindings, ["resetRunId", "resetHead", "terminalOffRunId", "localMain", "candidates"], ["resetRunId", "resetHead", "terminalOffRunId", "localMain", "candidates"], at, problems);
      binding(bindings.resetRunId, RECEIPT_RUN_ID, `${at}.resetRunId`, problems, unfilled);
      binding(bindings.resetHead, SHA, `${at}.resetHead`, problems, unfilled);
      binding(bindings.terminalOffRunId, RECEIPT_RUN_ID, `${at}.terminalOffRunId`, problems, unfilled);
      binding(bindings.localMain, SHA, `${at}.localMain`, problems, unfilled);
      if (!Array.isArray(bindings.candidates) || bindings.candidates.length === 0) {
        problems.push(`${at}.candidates must list every earlier candidate (branch, tip, pullRequest)`);
      } else {
        const branches = new Set<string>();
        const numbers = new Set<number>();
        bindings.candidates.forEach((candidate, index) => {
          const c = `${at}.candidates[${index}]`;
          if (!isObject(candidate)) { problems.push(`${c} must be an object`); return; }
          exactKeys(candidate, ["branch", "tip", "pullRequest"], ["branch", "tip", "pullRequest"], c, problems);
          binding(candidate.branch, BRANCH, `${c}.branch`, problems, unfilled);
          if (typeof candidate.branch === "string" && candidate.branch.includes("..")) problems.push(`${c}.branch must not contain ..`);
          binding(candidate.tip, SHA, `${c}.tip`, problems, unfilled);
          if (isUnfilled(candidate.pullRequest)) unfilled.push(`${c}.pullRequest`);
          else if (!Number.isInteger(candidate.pullRequest) || (candidate.pullRequest as number) < 1) problems.push(`${c}.pullRequest must be a positive pull request number or start with ${UNFILLED}`);
          if (typeof candidate.branch === "string" && !isUnfilled(candidate.branch)) {
            if (branches.has(candidate.branch)) problems.push(`${c}.branch repeats an earlier candidate`);
            branches.add(candidate.branch);
          }
          if (Number.isInteger(candidate.pullRequest)) {
            if (numbers.has(candidate.pullRequest as number)) problems.push(`${c}.pullRequest repeats an earlier candidate`);
            numbers.add(candidate.pullRequest as number);
          }
        });
      }
    }
    if (typeof raw.runId === "string" && typeof previous.grantId === "string" && previous.grantId === chainLibraryIds(raw.runId).grant) {
      problems.push("params.previousRun.grantId is this run's own Grant");
    }
  }
  return { params: problems.length === 0 ? (raw as unknown as ChainRunParams) : null, problems, unfilled };
}

/** The chain's Action ids for N Actions: G1's three, then chain-step-04 .. chain-step-NN. */
export function chainActionIds(count: number): string[] {
  if (!Number.isInteger(count) || count < MIN_CHAIN_ACTIONS || count > MAX_CHAIN_ACTIONS) throw new Error(`Action count must be ${MIN_CHAIN_ACTIONS} to ${MAX_CHAIN_ACTIONS}.`);
  const ids: string[] = [...CHAIN_FIXTURE.baseActions];
  for (let step = 4; step <= count; step++) ids.push(`chain-step-${String(step).padStart(2, "0")}`);
  return ids;
}

/** The fresh completion request id one chain Action records its completion under: unique per run and Action. */
export const completionRequestId = (actionId: string, runId: string): string => `complete-${actionId}-${runId}`;

export function chainLibraryIds(runId: string) {
  return {
    reset: `reset-rehearsal-chain-fixture-${runId}`,
    preflight: `preflight-rehearsal-chain-${runId}`,
    grant: `grant-production-rehearsal-chain-${runId}`,
    terminalOff: `restore-terminal-off-rehearsal-chain-${runId}`
  };
}
export const CHAIN_KINDS = ["reset", "preflight", "grant", "terminalOff"] as const;
export type ChainKind = typeof CHAIN_KINDS[number];
/** The shared implementation file each per-run launcher executes. */
export const CHAIN_IMPLEMENTATION: Record<ChainKind, string> = {
  reset: "reset.sh",
  preflight: "preflight.sh",
  grant: "grant.sh",
  terminalOff: "restore-terminal-off.sh"
};

/** The exact per-run launcher: it only runs the shared implementation with this run's reviewed parameter file. */
export function chainLauncher(kind: ChainKind, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error("Invalid chain run id.");
  return [
    "#!/usr/bin/env bash",
    `# Rehearsal chain ${runId}: runs the shared ${CHAIN_IMPLEMENTATION[kind]} with this run's reviewed parameter file and nothing else.`,
    "set -euo pipefail",
    'library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"',
    `exec "$library_dir/rehearsal-chain/${CHAIN_IMPLEMENTATION[kind]}" "$library_dir/rehearsal-chain/params/${runId}.json" "\${1:-run}"`,
    ""
  ].join("\n");
}

export const resetCommitSubject = (params: Pick<ChainRunParams, "runLabel" | "actionCount">): string =>
  `Reset the rehearsal fixture as a ${params.actionCount}-Action serial chain for rehearsal ${params.runLabel}`;

// ---------------------------------------------------------------------------
// Fixture Plan rendering
// ---------------------------------------------------------------------------

const two = (step: number) => String(step).padStart(2, "0");
const chainLine = (step: number) => step === 4 ? "chain step 04 follows three-action rehearsal verified" : `chain step ${two(step)} follows chain step ${two(step - 1)}`;

interface ActionTemplate { title: string; task: string; expectedArtifact: string; criteria: string[] }

/** The three G1 Actions, byte for byte as G1 wrote them (their next_action task is the original sentence without its period). */
const BASE_TEMPLATES: ActionTemplate[] = [
  {
    title: 'Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline.',
    task: 'Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline',
    expectedArtifact: "MARKER.md with the start line",
    criteria: [
      'MARKER.md exists and contains exactly the line "three-action rehearsal start" followed by a trailing newline, with no other content.',
      "The genesis check node scripts/check-rehearsal.mjs passes."
    ]
  },
  {
    title: 'Implement appending the start line transformed to upper case ("THREE-ACTION REHEARSAL START") to MARKER.md, and add tests/marker.test.mjs asserting both lines in order.',
    task: 'Implement appending the line "THREE-ACTION REHEARSAL START" to MARKER.md after the start line, and add tests/marker.test.mjs asserting node --test sees both lines in order',
    expectedArtifact: "MARKER.md with the start and transformed lines, plus a passing tests/marker.test.mjs",
    criteria: [
      'MARKER.md contains exactly the start line followed by "THREE-ACTION REHEARSAL START", each with a trailing newline.',
      'tests/marker.test.mjs exists and passes under node --test, asserting both lines appear in order; "node scripts/check-rehearsal.mjs" passes.'
    ]
  },
  {
    title: 'Implement appending the line "three-action rehearsal verified" to MARKER.md, and extend tests/marker.test.mjs to assert all three lines in order.',
    task: 'Implement appending the line "three-action rehearsal verified" to MARKER.md after the transformed line, and extend tests/marker.test.mjs to assert all three lines in order',
    expectedArtifact: "MARKER.md with all three lines, plus a passing tests/marker.test.mjs",
    criteria: [
      "MARKER.md contains exactly the start, transformed and verified lines in that order, each with a trailing newline.",
      'tests/marker.test.mjs asserts all three lines in order and "node scripts/check-rehearsal.mjs" passes.'
    ]
  }
];

/** Chain step k (4..12): one line in CHAIN.md that names its predecessor's output, so the chain is genuinely ordered. */
function stepTemplate(step: number): ActionTemplate {
  const line = chainLine(step);
  if (step === 4) {
    return {
      title: `Implement CHAIN.md containing exactly the line "${line}" plus a trailing newline, after reading the last line of MARKER.md.`,
      task: `Implement CHAIN.md after reading the last line of MARKER.md, which verify-final-rehearsal wrote and which must be "three-action rehearsal verified" (otherwise stop and report without writing anything); CHAIN.md must contain exactly the line "${line}" plus a trailing newline, and MARKER.md stays unchanged`,
      expectedArtifact: "CHAIN.md whose only line is the chain step 04 line",
      criteria: [
        `CHAIN.md exists and contains exactly the line "${line}" followed by a trailing newline, with no other content.`,
        "MARKER.md is unchanged and the genesis check node scripts/check-rehearsal.mjs passes."
      ]
    };
  }
  const previous = two(step - 1);
  return {
    title: `Implement appending the line "${line}" to CHAIN.md, after reading its last line.`,
    task: `Implement appending one line to CHAIN.md after reading its last line, which chain-step-${previous} wrote and which must start with "chain step ${previous} follows" (otherwise stop and report without writing anything); the new last line is exactly "${line}" plus a trailing newline, and every earlier line and MARKER.md stay unchanged`,
    expectedArtifact: `CHAIN.md ending with the chain step ${two(step)} line`,
    criteria: [
      `CHAIN.md holds exactly one line per chain step from 04 to ${two(step)} in step order, each with a trailing newline; its earlier lines are unchanged and its last line is exactly "${line}".`,
      "MARKER.md is unchanged and the genesis check node scripts/check-rehearsal.mjs passes."
    ]
  };
}

const templateOf = (index: number): ActionTemplate => index < BASE_TEMPLATES.length ? BASE_TEMPLATES[index] : stepTemplate(index + 1);

/** The task sentence of the chain Action at `index` (0-based), without any run note; the single-Action fixture reset reuses it. */
export const chainActionTask = (index: number): string => templateOf(index).task;

/** The run note on every Action's next_action: a fresh input revision, the fresh completion id and the clean-tree rule. */
export function chainNextAction(index: number, params: Pick<ChainRunParams, "runId" | "runLabel" | "actionCount">): string {
  const ids = chainActionIds(params.actionCount);
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) throw new Error("Action index out of range.");
  return `${templateOf(index).task} (rehearsal ${params.runLabel}, run id ${params.runId}, Action ${index + 1} of ${params.actionCount} in one serial chain; earlier attempts and candidates stay as evidence; record completion under the unused Agent Ask request id ${completionRequestId(ids[index], params.runId)}; leave \`git status\` clean after settling (settlement archives the drafted Ask file itself; do not commit or keep a copy of it; if a stray draft remains, delete it)).`;
}

/** One Action block exactly as the fixture Plan carries it (two-space list indent, four-space fields). */
function actionBlock(index: number, ids: string[], nextAction: string): string[] {
  const template = templateOf(index);
  return [
    `  - id: ${ids[index]}`,
    `    title: ${template.title}`,
    "    status: open",
    "    responsibility: agent",
    "    effort: session",
    `    next_action: ${nextAction}`,
    `    expected_artifact: ${template.expectedArtifact}`,
    "    clarification: clarified",
    "    confidence: high",
    "    acceptance_criteria:",
    ...template.criteria.map((criterion) => `      - ${criterion}`),
    `    depends_on: [${index === 0 ? "" : ids[index - 1]}]`,
    "    decisions: []"
  ];
}

export const chainTokenBudget = (count: number) =>
  `token_budget: ${count} trivial file-edit Actions in one serial chain; model use is bounded to the ${count} coding Sessions and their two independent reviews each.`;

// ---------------------------------------------------------------------------
// The fixture's statements of the chain's size and purpose (PROJECT.md and the Plan)
// ---------------------------------------------------------------------------

/** The Milestone line both the fixture PROJECT.md and its Plan carry: "Run the bounded nine-Action rehearsal" (G1's own wording for N=3). */
export const chainMilestone = (count: number) => `Run the bounded ${numberWord(count)}-Action rehearsal`;
/** The fixture PROJECT.md goal, outcome and Plan title for N Actions (G1's own wording for N=3, apart from the Plan title's "chain"). */
export const chainProjectGoal = (count: number) => `Disposable fixture proving ${numberWord(count)} serial Actions run unattended from one bounded production Grant.`;
export const chainProjectOutcome = (count: number) =>
  `Demonstrate ${numberWord(count)} dependent Actions preserved, independently reviewed and integrated by the production tick; delete after recorded review.`;
export const chainPlanTitle = (count: number) => `Autonomous ${numberWord(count)}-Action rehearsal chain`;
/** The sentence-initial and hyphenated count words inside the two body paragraphs (replaced wherever the base states any chain size). */
const NUMBER_WORD = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const PROJECT_BODY_COUNT = new RegExp(`^Disposable fixture for the installed (${NUMBER_WORD})-Action autonomous rehearsal\\.$`, "im");
const PLAN_BODY_COUNT = new RegExp(`^Disposable fixture Plan\\. (${NUMBER_WORD}) serial Actions, each preserved to a draft pull$`, "im");
const ORIGINAL_PLAN_TITLE = /^# Autonomous (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)-Action rehearsal(?: chain)?$/im;

const sameWordCase = (found: string, count: number) => found.charAt(0) === found.charAt(0).toUpperCase() && found.charAt(0) !== found.charAt(0).toLowerCase() ? capitalNumberWord(count) : numberWord(count);

export interface RenderedChainPlan {
  plan: string;
  planUpdatedBefore: string;
  actions: Array<{ id: string; nextAction: string; completionId: string; appended: boolean }>;
}

export class ChainPlanError extends Error {
  constructor(public reason: string, message: string) { super(message); }
}
const DATE_LINE = /^updated: ([0-9]{4}-[0-9]{2}-[0-9]{2})$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Render the fixture Plan as a serial chain of N Actions from the base head's
 * Plan: every existing Action keeps every line except its next_action (a new
 * run note), Actions after the base ones are appended in order, the Plan's
 * `updated:` date becomes the reset date and its token budget names N. The
 * base must hold a prefix of the chain whose blocks match the canonical ones
 * apart from next_action; anything else refuses. Docs sync applies a Plan only
 * when its date is not older than the synced record, so a reset date before
 * the base Plan's date refuses.
 */
export function renderChainPlan(basePlan: string, params: Pick<ChainRunParams, "runId" | "runLabel" | "actionCount">, resetDate: string): RenderedChainPlan {
  if (!DATE.test(resetDate)) throw new ChainPlanError("INVALID_RESET_DATE", `reset date ${resetDate} is not YYYY-MM-DD`);
  const ids = chainActionIds(params.actionCount);
  const lines = basePlan.split("\n");
  if (lines[0] !== "---") throw new ChainPlanError("NOT_A_PLAN", "the base Plan does not start with front matter");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new ChainPlanError("NOT_A_PLAN", "the base Plan's front matter is not closed");
  const front = lines.slice(1, end);
  const dateLines = front.map((line, i) => [line, i] as const).filter(([line]) => DATE_LINE.test(line));
  if (dateLines.length !== 1) throw new ChainPlanError("DATE_LINE", "the base Plan does not carry exactly one updated: date line");
  const planUpdatedBefore = DATE_LINE.exec(dateLines[0][0])![1];
  if (resetDate < planUpdatedBefore) {
    throw new ChainPlanError("RESET_DATE_BEFORE_PLAN", `the reset date ${resetDate} is before the base Plan's updated: ${planUpdatedBefore}; docs sync would skip the amendment as older than its record`);
  }
  const budgetLines = front.filter((line) => line.startsWith("token_budget: "));
  if (budgetLines.length !== 1) throw new ChainPlanError("TOKEN_BUDGET", "the base Plan does not carry exactly one token_budget line");
  if (front.filter((line) => line.startsWith("milestone: ")).length !== 1) throw new ChainPlanError("MILESTONE", "the base Plan does not carry exactly one milestone line");
  const actionsAt = front.indexOf("actions:");
  if (actionsAt < 0) throw new ChainPlanError("NO_ACTIONS", "the base Plan has no actions: list");
  let actionsEnd = actionsAt + 1;
  while (actionsEnd < front.length && (front[actionsEnd].startsWith("  ") || front[actionsEnd] === "")) actionsEnd++;
  const blockLines = front.slice(actionsAt + 1, actionsEnd);
  const blocks: string[][] = [];
  for (const line of blockLines) {
    if (line.startsWith("  - id: ")) blocks.push([line]);
    else if (blocks.length === 0) throw new ChainPlanError("ACTION_BLOCKS", "the base Plan's actions: list does not start with an Action");
    else blocks[blocks.length - 1].push(line);
  }
  const baseIds = blocks.map((block) => block[0].slice("  - id: ".length));
  if (baseIds.length < MIN_CHAIN_ACTIONS || baseIds.length > ids.length || baseIds.some((id, i) => id !== ids[i])) {
    throw new ChainPlanError("BASE_ACTIONS", `the base Plan's Actions [${baseIds.join(", ")}] are not a prefix of the ${params.actionCount}-Action chain [${ids.join(", ")}] of at least ${MIN_CHAIN_ACTIONS}`);
  }
  const rendered: string[] = [];
  const actions: RenderedChainPlan["actions"] = [];
  ids.forEach((id, index) => {
    const nextAction = chainNextAction(index, params);
    const fresh = actionBlock(index, ids, nextAction);
    if (index < blocks.length) {
      const base = blocks[index];
      const nextAt = base.findIndex((line) => line.startsWith("    next_action: "));
      const freshNextAt = fresh.findIndex((line) => line.startsWith("    next_action: "));
      const without = (block: string[], at: number) => block.filter((_line, i) => i !== at);
      if (nextAt < 0 || base.filter((line) => line.startsWith("    next_action: ")).length !== 1
        || JSON.stringify(without(base, nextAt)) !== JSON.stringify(without(fresh, freshNextAt))) {
        throw new ChainPlanError("BASE_ACTION_CHANGED", `the base Plan's ${id} differs from the canonical chain Action beyond its next_action`);
      }
      if (base[nextAt] === fresh[freshNextAt]) throw new ChainPlanError("NEXT_ACTION_NOT_FRESH", `the base Plan already carries this run's next_action for ${id}`);
    }
    rendered.push(...fresh);
    actions.push({ id, nextAction, completionId: completionRequestId(id, params.runId), appended: index >= blocks.length });
  });
  const frontLine = (line: string) => DATE_LINE.test(line) ? `updated: ${resetDate}`
    : line.startsWith("token_budget: ") ? chainTokenBudget(params.actionCount)
    : line.startsWith("milestone: ") ? `milestone: ${chainMilestone(params.actionCount)}`
    : line;
  const newFront = [
    ...front.slice(0, actionsAt + 1).map(frontLine),
    ...rendered,
    ...front.slice(actionsEnd).map(frontLine)
  ];
  const body = lines.slice(end).join("\n")
    .replace(ORIGINAL_PLAN_TITLE, `# ${chainPlanTitle(params.actionCount)}`)
    .replace(PLAN_BODY_COUNT, (_line, found: string) => `Disposable fixture Plan. ${sameWordCase(found, params.actionCount)} serial Actions, each preserved to a draft pull`);
  return { plan: ["---", ...newFront, body].join("\n"), planUpdatedBefore, actions };
}

export interface RenderedChainProject {
  project: string;
  projectUpdatedBefore: string;
  /** False when the base PROJECT.md already states this run's N and nothing needed rendering (the file is returned byte for byte). */
  changed: boolean;
}

const PROJECT_DATE_LINE = /^updated: ([0-9]{4}-[0-9]{2}-[0-9]{2})$/;
/** The front-matter fields rendered for N; every other key (pointers, status, name, slug, type) is left exactly as it is. */
const PROJECT_FIELDS: Array<[string, (count: number) => string]> = [
  ["goal", chainProjectGoal],
  ["outcome", chainProjectOutcome],
  ["milestone", chainMilestone]
];

/**
 * Render the fixture PROJECT.md's statements of the chain's size and purpose
 * for N Actions: its goal, outcome and milestone lines and the body paragraph
 * that names the rehearsal. Its pointer and status fields (active_plan,
 * current_action, status), name and slug are never touched; when anything
 * changes its `updated:` date becomes the reset date (docs sync skips a Project
 * document older than the synced record), and a reset date before the base
 * file's own date refuses. A body paragraph in a form the renderer does not know
 * is left alone: the coherence guard refuses it if it states another count.
 */
export function renderChainProject(baseProject: string, params: Pick<ChainRunParams, "actionCount">, resetDate: string): RenderedChainProject {
  if (!DATE.test(resetDate)) throw new ChainPlanError("INVALID_RESET_DATE", `reset date ${resetDate} is not YYYY-MM-DD`);
  const lines = baseProject.split("\n");
  if (lines[0] !== "---") throw new ChainPlanError("NOT_A_PROJECT", "the base PROJECT.md does not start with front matter");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new ChainPlanError("NOT_A_PROJECT", "the base PROJECT.md's front matter is not closed");
  const front = lines.slice(1, end);
  const dateLines = front.filter((line) => PROJECT_DATE_LINE.test(line));
  if (dateLines.length !== 1) throw new ChainPlanError("PROJECT_DATE_LINE", "the base PROJECT.md does not carry exactly one updated: date line");
  const projectUpdatedBefore = PROJECT_DATE_LINE.exec(dateLines[0])![1];
  for (const [key] of PROJECT_FIELDS) {
    if (front.filter((line) => line.startsWith(`${key}: `)).length !== 1) throw new ChainPlanError("PROJECT_FIELD", `the base PROJECT.md does not carry exactly one ${key}: line`);
  }
  const rendered = front.map((line) => {
    for (const [key, text] of PROJECT_FIELDS) if (line.startsWith(`${key}: `)) return `${key}: ${text(params.actionCount)}`;
    return line;
  });
  const baseBody = lines.slice(end).join("\n");
  const body = baseBody.replace(PROJECT_BODY_COUNT, `Disposable fixture for the installed ${numberWord(params.actionCount)}-Action autonomous rehearsal.`);
  const changed = rendered.some((line, index) => line !== front[index]) || body !== baseBody;
  if (!changed) return { project: baseProject, projectUpdatedBefore, changed: false };
  if (resetDate < projectUpdatedBefore) {
    throw new ChainPlanError("RESET_DATE_BEFORE_PROJECT", `the reset date ${resetDate} is before the base PROJECT.md's updated: ${projectUpdatedBefore}; docs sync would skip the Project amendment as older than its record`);
  }
  return {
    project: ["---", ...rendered.map((line) => PROJECT_DATE_LINE.test(line) ? `updated: ${resetDate}` : line), body].join("\n"),
    projectUpdatedBefore,
    changed: true
  };
}

// ---------------------------------------------------------------------------
// Completion-id freshness and the previous-head decision
// ---------------------------------------------------------------------------

/**
 * Every completion id must be distinct and unused: never a request id already
 * recorded as an Agent Ask proposal in the workspace, and never one already
 * archived or drafted in the fixture tree.
 */
export function completionIdProblems(completionIds: string[], usedRequestIds: Iterable<string>, fixtureAskFiles: Iterable<string> = []): string[] {
  const used = new Set(usedRequestIds);
  const files = [...fixtureAskFiles];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of completionIds) {
    if (!SLUG.test(id)) problems.push(`completion id ${id} is not a lowercase slug`);
    if (seen.has(id)) problems.push(`completion id ${id} is named twice`);
    seen.add(id);
    if (used.has(id)) problems.push(`completion id ${id} is already used by an Agent Ask proposal in the workspace`);
    if (files.some((file) => file.endsWith(`agent-ask-${id}.yaml`))) problems.push(`completion id ${id} already has an Ask file in the fixture tree`);
  }
  return problems;
}

export interface FixtureStartFacts {
  /** GitHub main of the fixture now. */
  remoteMain: string;
  /** The fixture clone's local main now. */
  localMain: string;
  /** The previous run's reset head (its receipt's newHead): where the new line must start. */
  resetHead: string;
  /** The local main the previous run's terminal Off recorded and the parameter file pins. */
  expectedLocalMain: string;
  /** True when resetHead is an ancestor of (or equal to) expectedLocalMain. */
  resetHeadIsAncestorOfExpectedLocalMain: boolean;
  /**
   * Each earlier candidate, already verified identical locally, on GitHub and
   * as its pull request head, with whether expectedLocalMain is contained in
   * (an ancestor of or equal to) its tip.
   */
  candidates: Array<ChainCandidate & { containsExpectedLocalMain: boolean }>;
  /** True when localMain is exactly this run's validated reset commit on resetHead. */
  localMainIsResetCommit: boolean;
  /** True when remoteMain is exactly this run's validated reset commit on resetHead. */
  remoteMainIsResetCommit: boolean;
}
export type FixtureStartState = "move_local_main" | "at_base" | "committed_unpushed" | "pushed";
export interface FixtureStartDecision {
  state: FixtureStartState | null;
  /** Earlier candidates whose remote tip contains the pinned local main (the previous run's locally integrated work). */
  preservedOn: ChainCandidate[];
  refusals: string[];
}

/**
 * Where the reset starts, from facts the shell gathered. The new line always
 * starts from the previous run's reset head on GitHub. The pinned local main
 * (work the previous run integrated by local fast-forward) must strictly
 * descend from that head and be contained in at least one earlier candidate's
 * remote branch and pull request (all of which the shell verified untouched),
 * in every state. A local main ahead of the reset head is moved back only when
 * it is exactly that pinned commit; otherwise the reset refuses and nothing
 * moves.
 */
export function decideFixtureStart(facts: FixtureStartFacts): FixtureStartDecision {
  const refusals: string[] = [];
  const preservedOn = facts.candidates.filter((candidate) => candidate.containsExpectedLocalMain).map(({ branch, tip, pullRequest }) => ({ branch, tip, pullRequest }));
  if (facts.expectedLocalMain !== facts.resetHead) {
    if (!facts.resetHeadIsAncestorOfExpectedLocalMain) {
      refusals.push(`the pinned local main ${facts.expectedLocalMain} does not descend from the previous run's reset head ${facts.resetHead}`);
    }
    if (preservedOn.length === 0) {
      refusals.push(`the pinned local main ${facts.expectedLocalMain} is not contained in any earlier candidate's remote branch and pull request, so moving local main back could lose work`);
    }
  }
  const settle = (state: FixtureStartState): FixtureStartDecision => ({ state: refusals.length === 0 ? state : null, preservedOn, refusals });
  if (facts.localMainIsResetCommit && facts.remoteMainIsResetCommit && facts.localMain === facts.remoteMain) return settle("pushed");
  if (facts.remoteMain !== facts.resetHead) {
    refusals.push(`GitHub main is ${facts.remoteMain}, not the previous run's reset head ${facts.resetHead} or this run's reset commit; the fixture moved by another path`);
    return settle("at_base");
  }
  if (facts.localMainIsResetCommit) return settle("committed_unpushed");
  if (facts.localMain === facts.resetHead) return settle("at_base");
  if (facts.localMain !== facts.expectedLocalMain) {
    refusals.push(`local main is ${facts.localMain}, not the previous run's reset head ${facts.resetHead}, this run's reset commit, or the ${facts.expectedLocalMain} the previous run's terminal Off recorded and the parameter file pins`);
  }
  return settle("move_local_main");
}

/**
 * The previous run's terminal-Off work reconciliation must be fully covered by
 * the pinned candidate list: every integrated or preserved Session with a
 * branch appears with the same tip and pull request, and nothing was left
 * live, dirty or unreconciled.
 */
export function reconciliationProblems(lines: Array<Record<string, unknown>>, candidates: ChainCandidate[]): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    const state = String(line.state ?? "");
    if (!["integrated", "preserved", "no_committed_work"].includes(state)) {
      problems.push(`the previous terminal Off left session ${String(line.session)} ${state || "unclassified"}`);
      continue;
    }
    if (state === "no_committed_work") continue;
    const branch = String(line.branch ?? "");
    const tip = String(line.tip ?? "");
    const pr = String(line.pullRequest ?? "");
    const number = /\/pull\/([0-9]+)$/.exec(pr)?.[1];
    const pinned = candidates.find((candidate) => candidate.branch === branch);
    if (!pinned) problems.push(`the previous terminal Off reconciled ${branch} (${tip}) but the parameter file does not pin it`);
    else if (pinned.tip !== tip) problems.push(`the parameter file pins ${branch} at ${pinned.tip} but the previous terminal Off reconciled it at ${tip}`);
    else if (number === undefined) problems.push(`the previous terminal Off recorded no pull request for ${branch} (${pr || "none"}), so its preservation cannot be pinned`);
    else if (Number(number) !== pinned.pullRequest) problems.push(`the parameter file pins ${branch} to pull request #${pinned.pullRequest} but the previous terminal Off recorded ${pr}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The operational queue after the reset's docs sync (Issue #1015)
// ---------------------------------------------------------------------------

/** The queue order keys of the chain's Actions, in chain order. */
export const chainQueueKeys = (actionIds: string[]): string[] => actionIds.map((id) => `${CHAIN_FIXTURE.project}/${id}`);

export interface ChainQueueEntry { key: string; status: string }
/** What `arcadia advance queue --json` reports that the chain's queue step needs. */
export interface ChainQueueFacts {
  revision: number;
  orderValid: boolean;
  unpositionedCount: number;
  /** Every entry that carries an order key, in the queue's current order. */
  entries: ChainQueueEntry[];
}
export interface ChainQueuePlan {
  /** Chain keys the queue does not list at all (docs sync did not make them approved Actions): the queue step refuses. */
  missing: string[];
  /** The complete order to arrange: every other key in its current relative order, then the chain keys in chain order. */
  order: string[];
  /** Other (non-chain) keys that hold no position yet; arranging freezes them in their current projected order. */
  othersUnpositioned: string[];
  /** True when nothing needs arranging: orderValid, no unpositioned Action and the chain keys already in chain order. */
  satisfied: boolean;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
const inChainOrder = (keys: string[], chainKeys: string[]) => sameList(keys.filter((key) => chainKeys.includes(key)), chainKeys);

/**
 * Where the chain's Actions go in the operational queue: after every other
 * key, in chain order, keeping every other key's relative order. The governed
 * arrange command needs every active approved key exactly once, so the plan is
 * the complete order; an already valid queue whose chain keys are in chain
 * order needs no change (a resumed reset).
 */
export function planChainQueueOrder(facts: ChainQueueFacts, chainKeys: string[]): ChainQueuePlan {
  const keys = facts.entries.map((entry) => entry.key);
  const missing = chainKeys.filter((key) => !keys.includes(key));
  const others = facts.entries.filter((entry) => !chainKeys.includes(entry.key));
  return {
    missing,
    order: [...others.map((entry) => entry.key), ...chainKeys],
    othersUnpositioned: others.filter((entry) => entry.status === "unpositioned").map((entry) => entry.key),
    satisfied: missing.length === 0 && facts.orderValid && facts.unpositionedCount === 0 && inChainOrder(keys, chainKeys)
  };
}

/**
 * Every way the queue after the chain's arrangement is not what the reset must
 * leave: orderValid with zero unpositioned (the governed answer, never inferred
 * from an exit code), the planned order exactly, and every non-chain key in the
 * relative order it had before.
 */
export function chainQueueProblems(before: ChainQueueFacts, after: ChainQueueFacts, chainKeys: string[], plan: Pick<ChainQueuePlan, "order">): string[] {
  const problems: string[] = [];
  if (after.orderValid !== true) problems.push("the queue is not orderValid after the arrangement");
  if (after.unpositionedCount !== 0) problems.push(`${after.unpositionedCount} Action(s) are still unpositioned after the arrangement`);
  const afterKeys = after.entries.map((entry) => entry.key);
  if (!sameList(afterKeys, plan.order)) problems.push(`the queue order after the arrangement is not the planned order: [${afterKeys.join(", ")}] instead of [${plan.order.join(", ")}]`);
  const others = (entries: ChainQueueEntry[]) => entries.map((entry) => entry.key).filter((key) => !chainKeys.includes(key));
  if (!sameList(others(before.entries), others(after.entries))) problems.push("the arrangement changed the relative order of a non-chain Action");
  if (!inChainOrder(afterKeys, chainKeys)) problems.push("the chain's Actions are not in chain order after the arrangement");
  return problems;
}

/** The deterministic request id of one arrangement: fixed per run and queue revision, so a replay is recognised and a changed queue gets its own. */
export const chainQueueRequestId = (runId: string, revision: number): string => `arrange-rehearsal-chain-queue-${runId}-r${revision}`;

// ---------------------------------------------------------------------------
// The amended fixture, judged by Arcadia's own discovery and docs sync
// ---------------------------------------------------------------------------

export interface ChainIdentity { requirementId: string; inputRevision: string; criteriaFingerprint: string }
export interface ChainAmendmentObservation {
  importSlug: string;
  errors: string[];
  rejected: string[];
  readySetBlockers: string[];
  project: { slug: string; activePlan: string | null; currentAction: string | null } | null;
  actions: Array<{ id: string; status: string; responsibility: string; dependsOn: string[] }> | null;
  ready: string[];
  candidates: Array<{ id: string; ready: boolean; gate: unknown; blockers: string[] }>;
  beforeErrors: string[];
  beforeActions: Array<Record<string, unknown>> | null;
  afterActions: Array<Record<string, unknown>> | null;
  genesisIdentity: Record<string, ChainIdentity> | null;
  beforeIdentity: Record<string, ChainIdentity> | null;
  afterIdentity: Record<string, ChainIdentity> | null;
}

const withoutNextAction = (action: Record<string, unknown>) => {
  const { nextAction: _ignored, ...rest } = action;
  return JSON.stringify(rest);
};

/**
 * Every way the amended fixture fails; empty means valid. G1's own rules (zero
 * docs-sync errors, the pointer at write-start-marker, the serial chain, every
 * Action open and agent-owned, write-start-marker alone ready, every other
 * Action gated only by depends_on), plus: each base Action changed only in its
 * next_action, which is exactly this run's text and gives it a fresh
 * requirement input revision with an unchanged criteria fingerprint (G1's
 * three keep G1's criteria), and each appended Action carries this run's text.
 */
export function amendmentProblems(o: ChainAmendmentObservation, expected: { project: string; plan: string; actionIds: string[]; nextActions: string[] }): string[] {
  const problems: string[] = [];
  const ids = expected.actionIds;
  problems.push(...o.errors.map((e) => `docs sync error: ${e}`), ...o.rejected.map((e) => `rejected document: ${e}`), ...o.readySetBlockers.map((e) => `ready-set blocker: ${e}`), ...o.beforeErrors.map((e) => `base discovery error: ${e}`));
  if (o.importSlug !== expected.project) problems.push(`project import would register slug ${o.importSlug}, not ${expected.project}`);
  if (o.project === null) problems.push("no PROJECT.md was discovered");
  else if (o.project.slug !== expected.project || o.project.activePlan !== expected.plan || o.project.currentAction !== ids[0]) problems.push(`PROJECT.md does not point at ${expected.plan}#${ids[0]}`);
  if (o.actions === null) problems.push(`Plan ${expected.plan} was not discovered`);
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
  if (o.beforeActions === null || o.afterActions === null) problems.push("the base or amended Plan was not discovered");
  else {
    const baseCount = o.beforeActions.length;
    if (JSON.stringify(o.beforeActions.map((a) => a.id)) !== JSON.stringify(ids.slice(0, baseCount))) problems.push("the base Plan's Actions are not a prefix of the chain");
    if (JSON.stringify(o.afterActions.map((a) => a.id)) !== JSON.stringify(ids)) problems.push("the amended Plan's Actions are not the chain");
    else {
      o.afterActions.forEach((after, i) => {
        if (after.nextAction !== expected.nextActions[i]) problems.push(`the amended ${ids[i]} next_action is not this run's text`);
        if (i < baseCount && withoutNextAction(o.beforeActions![i]) !== withoutNextAction(after)) problems.push(`the amendment changed ${ids[i]} beyond its next_action`);
      });
    }
    if (o.genesisIdentity === null || o.beforeIdentity === null || o.afterIdentity === null) problems.push("requirement identities could not be computed");
    else {
      ids.forEach((id, i) => {
        const after = o.afterIdentity![id];
        if (!after) { problems.push(`no requirement identity for ${id}`); return; }
        if (i < baseCount) {
          const before = o.beforeIdentity![id];
          if (!before || before.inputRevision === after.inputRevision) problems.push(`the amendment did not give ${id} a fresh requirement input revision`);
          if (!before || before.criteriaFingerprint !== after.criteriaFingerprint) problems.push(`the amendment changed the acceptance criteria fingerprint of ${id}`);
        }
        const genesis = o.genesisIdentity![id];
        if (i < CHAIN_FIXTURE.baseActions.length && (!genesis || genesis.criteriaFingerprint !== after.criteriaFingerprint)) problems.push(`${id}'s acceptance criteria differ from G1's`);
        if (genesis && genesis.inputRevision === after.inputRevision) problems.push(`${id}'s amended input revision equals G1's original`);
      });
    }
  }
  return problems;
}
