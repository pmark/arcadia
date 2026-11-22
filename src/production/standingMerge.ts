import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { parse as parseYaml } from "yaml";
import { classifyAuthorityPaths } from "../decisions/batchMerge.js";
import { discoverDocs } from "../docs/discover.js";
import { validateStartRunPins, type StartRunPins } from "../operatorActions/startRunPins.js";
import { readProductionPolicy } from "./policy.js";
import { classifyGatePath, gateSetForProject, loadGateSet, type GateSetDocument } from "./gateSet.js";
import { defaultRunWindowDeps } from "../workMonitoring/runWindow.js";

/**
 * The worker's standing in-run merge conditions (Action
 * worker-applies-standing-merge-conditions; Decision 0260's C1-C5 made
 * mechanical). They apply only to a PR the blast radius marks
 * authority-adjacent, and only while an operator Decision authorizing in-run
 * merges for the run's START card is answered on main. This adds no authority:
 * that Decision is the authority. Every unreadable input parks the PR (the
 * worker refuses it, unchanged), never merges it.
 *
 * C1 the PR's Action is pinned on the START card the operator pressed, and its
 *    requirement content (next_action, acceptance_criteria, references) at
 *    merge-time main hashes to what the card approved at its reviewed revision;
 * C2 an "Independent review, head <exact head>" comment says "Loosens a gate: no";
 * C3 required checks green and merge state CLEAN (the pure worker gate, run
 *    after this one lifts only the authority-adjacent refusal);
 * C4 the diff touches no shared gate-set path, hard class, or batch-merge
 *    decisions/agent_permissions/ci_and_gates path. Only the agent's own work is
 *    judged: a governed-record path (.arcadia/asks/, MISSION_LOG.md, PROJECT.md,
 *    docs/plans/) is skipped only when every commit touching it is a real
 *    Arcadia settlement (see `settlementExemptPaths`); anything else is judged;
 * C5 production is still Active for that card.
 */

export type StandingCondition = "authorization" | "C1" | "C2" | "C4" | "C5";

export type StandingEvaluation =
  | { ok: true; cardId: string; decisionId: string; reviewMarkerUrl: string; classes: string[] }
  | { ok: false; condition: StandingCondition; reason: string };

/** The structural shape of the host `gh` runner. */
export type StandingRunCommand = (input: { command: string; args: string[]; cwd: string; timeoutMs?: number }) => {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string | null;
};

export interface StandingMergeDeps {
  /** The operator-script library of the Project's main checkout. */
  libraryDir?: () => string;
  /** `git show <rev>:<path>` in the Project's repository; null when unreadable. */
  showFile?: (revision: string, relativePath: string) => string | null;
  /** Revision naming merge-time main. */
  mergeTimeMain?: () => string;
  /** The shared gate set; defaults to the list in the repository's checkout of main. */
  gateSet?: () => GateSetDocument;
  /** Decision documents on main as {id,status,question,answer}. */
  decisions?: () => Array<{ id: string; status: string; question: string; answer: string | null }> | null;
}

export interface StandingMergeInput {
  db: Database.Database;
  repoRoot: string;
  baseBranch: string;
  head: string;
  /** `<project>/<action>` as the worker keys it. */
  actionKey: string;
  pullRequestUrl: string;
  /** Every path the candidate diff touches (renames as both paths). */
  changedPaths: readonly string[] | null;
  /** The candidate's commit history, to tell Arcadia's own settlement commits from the agent's work; null or absent exempts nothing. */
  history?: CandidateHistory | null;
  runCommand: StandingRunCommand;
}

/** Read-only view of the commits a candidate adds beyond its base. */
export interface CandidateHistory {
  /** The commit the candidate diverged from (the base of the `base...head` diff). */
  mergeBase: string;
  /** Commits in mergeBase..head that touch the path; null when Git cannot say. */
  commitsTouching(file: string): string[] | null;
  /** A commit's full message; null when unreadable. */
  message(sha: string): string | null;
}

/** Governed-record paths a real settlement commit may carry; docs/decisions/ and every governance file are deliberately absent. */
const SETTLEMENT_RECORD_PATHS = [".arcadia/asks/", "MISSION_LOG.md", "PROJECT.md", "docs/plans/"];
const SETTLEMENT_RECEIPT = /^Written by `arcadia agent-ask settle --apply` \((asksettle_[A-Za-z0-9]+)\)\.$/;
const isSettlementRecordPath = (file: string): boolean =>
  SETTLEMENT_RECORD_PATHS.some((allowed) => (allowed.endsWith("/") ? file.startsWith(allowed) : file === allowed));

/** True only when the workspace recorded this receipt as an accepted, applied settlement for this Project whose documents commit is exactly `sha`. Read-only; any error is false. */
export function settlementReceiptIsReal(db: Database.Database, receiptId: string, sha: string, project: string): boolean {
  try {
    const row = db.prepare("SELECT disposition, project_slug, receipt_json FROM agent_ask_settlements WHERE id = ?").get(receiptId) as
      { disposition: string; project_slug: string; receipt_json: string } | undefined;
    if (!row || row.disposition !== "accepted" || row.project_slug !== project) return false;
    const receipt = JSON.parse(row.receipt_json) as { applied?: unknown; documentsCommit?: unknown };
    return receipt.applied === true && receipt.documentsCommit === sha;
  } catch {
    return false;
  }
}

function frontMatterOf(text: string): Record<string, unknown> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * The changed governed-record paths that only real settlement commits touch.
 * A path is skipped only when ALL hold: it is a settlement record path, at
 * exactly one commit touches it and that commit carries exactly one
 * `Written by ... (asksettle_<id>)` line whose id the workspace recorded for
 * this commit (so a hand-written line is not exempt), and, for PROJECT.md, any
 * new current_action names an Action pinned on the card or is terminal (null).
 * Everything unreadable is left judged.
 */
export function settlementExemptPaths(
  input: { db: Database.Database; changedPaths: readonly string[]; history: CandidateHistory | null | undefined; head: string },
  pins: Pick<StartRunPins, "project" | "actions">,
  show: (revision: string, file: string) => string | null
): { exempt: Set<string>; pointerParked: string | null } {
  const exempt = new Set<string>();
  const history = input.history;
  if (!history) return { exempt, pointerParked: null };
  const verified = new Map<string, boolean>();
  const isRealSettlement = (sha: string): boolean => {
    const cached = verified.get(sha);
    if (cached !== undefined) return cached;
    const message = history.message(sha);
    const ids = message === null ? [] : [...new Set(message.split("\n").flatMap((line) => SETTLEMENT_RECEIPT.exec(line.trimEnd())?.[1] ?? []))];
    const ok = ids.length === 1 && settlementReceiptIsReal(input.db, ids[0], sha, pins.project);
    verified.set(sha, ok);
    return ok;
  };
  let pointerParked: string | null = null;
  for (const file of input.changedPaths) {
    if (!isSettlementRecordPath(file)) continue;
    const commits = history.commitsTouching(file);
    if (!commits || commits.length !== 1 || !isRealSettlement(commits[0])) continue;
    if (file === "PROJECT.md") {
      const before = show(history.mergeBase, file);
      const after = show(input.head, file);
      const was = before === null ? null : frontMatterOf(before);
      const now = after === null ? null : frontMatterOf(after);
      if (!was || !now) continue;
      const pointer = now.current_action;
      const terminal = pointer === null || pointer === undefined || pointer === "";
      if (pointer !== was.current_action && !terminal && !(typeof pointer === "string" && pins.actions.includes(pointer))) {
        pointerParked = `the settlement moves current_action to ${JSON.stringify(pointer)}, which is not an Action pinned on the pressed card and not terminal`;
        continue;
      }
    }
    exempt.add(file);
  }
  return { exempt, pointerParked };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

export interface RequirementFields {
  next_action: unknown;
  acceptance_criteria?: unknown;
  references?: unknown;
}

/** sha256 of the canonical {next_action, acceptance_criteria, references} object; null when a field is unusable. */
export function requirementHash(action: RequirementFields): string | null {
  if (typeof action.next_action !== "string") return null;
  const list = (value: unknown): string[] | null => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
    return value.map(collapse);
  };
  const criteria = list(action.acceptance_criteria);
  const references = list(action.references);
  if (!criteria || !references) return null;
  const canonical = JSON.stringify({ next_action: collapse(action.next_action), acceptance_criteria: criteria, references: [...references].sort() });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The requirement hash of one Action in a Plan document's YAML front matter; a reason string when unreadable. */
export function planActionHash(planText: string, actionId: string): { hash: string } | { error: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(planText);
  if (!match) return { error: "the Plan has no YAML front matter" };
  let front: unknown;
  try { front = parseYaml(match[1]); } catch (error) { return { error: `the Plan front matter does not parse: ${error instanceof Error ? error.message : String(error)}` }; }
  const actions = (front as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return { error: "the Plan front matter lists no actions" };
  const action = actions.find((entry) => (entry as { id?: unknown } | null)?.id === actionId) as RequirementFields | undefined;
  if (!action) return { error: `the Plan has no Action ${actionId}` };
  const hash = requirementHash(action);
  return hash ? { hash } : { error: `Action ${actionId} has no usable next_action, acceptance_criteria or references` };
}

/** An approved, answered Decision on main whose question or answer names the START card id. */
export function findAuthorizingDecision(
  decisions: ReadonlyArray<{ id: string; status: string; question: string; answer: string | null }>,
  cardId: string
): string | null {
  const names = new RegExp(`(?<![a-z0-9-])${cardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`);
  for (const decision of decisions) {
    if (decision.status !== "approved" || !decision.answer || !decision.answer.trim()) continue;
    if (names.test(decision.question) || names.test(decision.answer)) return decision.id;
  }
  return null;
}

function defaultDecisions(repoRoot: string): ReturnType<NonNullable<StandingMergeDeps["decisions"]>> {
  const found = discoverDocs(repoRoot);
  if ((found.ioErrors ?? []).length > 0) return null;
  return found.docs
    .filter((doc) => doc.type === "decision")
    .map((doc) => doc as unknown as { id: string; status: string; question: string; answer: string | null });
}

/** The `Independent review, head <sha>` marker for exactly this head that says `Loosens a gate: no`. */
export function readReviewMarker(run: StandingRunCommand, repoRoot: string, url: string, head: string): { url: string } | { error: string } {
  const result = run({ command: "gh", args: ["pr", "view", url, "--json", "comments"], cwd: repoRoot, timeoutMs: 30_000 });
  if (result.status !== 0) return { error: `the PR comments could not be read: ${result.error ?? (result.stderr.trim() || `exit ${String(result.status)}`)}` };
  let comments: Array<{ body?: unknown; url?: unknown }>;
  try {
    const parsed = JSON.parse(result.stdout) as { comments?: unknown };
    if (!Array.isArray(parsed.comments)) return { error: "the PR comments were unreadable" };
    comments = parsed.comments as Array<{ body?: unknown; url?: unknown }>;
  } catch {
    return { error: "the PR comments were unusable JSON" };
  }
  for (const comment of [...comments].reverse()) {
    const body = typeof comment.body === "string" ? comment.body : "";
    const marker = /Independent review, head ([0-9a-f]{7,40})/.exec(body);
    if (!marker || !head.startsWith(marker[1])) continue;
    if (!/^\s*[*_`-]*\s*Loosens a gate:\s*no\b/im.test(body)) return { error: `the review of ${head.slice(0, 12)} does not say "Loosens a gate: no"` };
    return typeof comment.url === "string" && comment.url ? { url: comment.url } : { error: "the review marker comment has no URL" };
  }
  return { error: `no "Independent review, head" comment names exactly ${head.slice(0, 12)}` };
}

/** The standing conditions, in order; the first that fails (or cannot be read) parks the PR. */
export function evaluateStandingMerge(input: StandingMergeInput, deps: StandingMergeDeps = {}): StandingEvaluation {
  const park = (condition: StandingCondition, reason: string): StandingEvaluation => ({ ok: false, condition, reason });
  let policy;
  try { policy = readProductionPolicy(input.db); } catch (error) { return park("C5", `the production policy could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  const cardId = policy.authority?.requestId ?? null;
  if (policy.desiredState !== "active" || !cardId) return park("C5", "production is not Active for a pressed START card");
  if (!SLUG.test(cardId)) return park("C5", `the run's card id ${JSON.stringify(cardId)} is not a card slug`);

  let decisions: ReturnType<NonNullable<StandingMergeDeps["decisions"]>>;
  try { decisions = (deps.decisions ?? (() => defaultDecisions(input.repoRoot)))(); } catch { decisions = null; }
  if (!decisions) return park("authorization", "the Decision documents on main could not be read");
  const decisionId = findAuthorizingDecision(decisions, cardId);
  if (!decisionId) return park("authorization", `no approved, answered Decision on main authorizes in-run merges for card ${cardId}`);

  // C1: pinned Action, unchanged requirement content.
  const [, actionId] = input.actionKey.split("/");
  let pins: StartRunPins;
  try {
    const library = (deps.libraryDir ?? (() => defaultRunWindowDeps(input.repoRoot).libraryDir()))();
    const card = JSON.parse(readFileSync(path.join(library, `${cardId}.json`), "utf8")) as { startRun?: unknown };
    pins = validateStartRunPins(card.startRun);
  } catch (error) {
    return park("C1", `the card ${cardId} pins could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pins.delegation) return park("C1", `card ${cardId} was pressed under a delegation, which records no operator-pressed Action content`);
  if (!actionId || !pins.actions.includes(actionId)) return park("C1", `Action ${actionId ?? input.actionKey} is not pinned on card ${cardId}; added scope waits for the operator`);
  const planPath = `docs/plans/${pins.plan}.md`;
  const show = deps.showFile ?? ((revision, file) => {
    try { return gitShow(input.repoRoot, revision, file); } catch { return null; }
  });
  const approvedText = show(pins.reviewedRevision, planPath);
  const currentText = show((deps.mergeTimeMain ?? (() => `refs/remotes/origin/${input.baseBranch}`))(), planPath);
  if (approvedText === null) return park("C1", `${planPath} at the approved revision ${pins.reviewedRevision.slice(0, 12)} could not be read`);
  if (currentText === null) return park("C1", `${planPath} at merge-time main could not be read`);
  const approved = planActionHash(approvedText, actionId);
  if ("error" in approved) return park("C1", `approved revision: ${approved.error}`);
  const current = planActionHash(currentText, actionId);
  if ("error" in current) return park("C1", `merge-time main: ${current.error}`);
  if (approved.hash !== current.hash) return park("C1", `Action ${actionId}'s requirement content changed since the operator approved it on card ${cardId} (${approved.hash.slice(0, 12)} -> ${current.hash.slice(0, 12)}); it waits for re-approval`);

  // C2: independent review marker for the exact head.
  const marker = readReviewMarker(input.runCommand, input.repoRoot, input.pullRequestUrl, input.head);
  if ("error" in marker) return park("C2", marker.error);

  // C4: no gate-set path, hard class or decisions/agent_permissions path.
  if (!input.changedPaths || input.changedPaths.length === 0) return park("C4", "the changed paths of the candidate could not be read");
  let gates;
  try {
    const lookup = gateSetForProject(deps.gateSet ? deps.gateSet() : loadGateSet(input.repoRoot), pins.project);
    if (!lookup.found) return park("C4", lookup.report);
    gates = lookup.entry;
  } catch (error) {
    return park("C4", `the shared gate set could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Judge only the agent's own work: governed-record paths that only real settlement commits touch are skipped.
  const { exempt, pointerParked } = settlementExemptPaths({ db: input.db, changedPaths: input.changedPaths, history: input.history, head: input.head }, pins, show);
  if (pointerParked) return park("C4", pointerParked);
  const judged = input.changedPaths.filter((file) => !exempt.has(file));
  const protectedPaths = judged.filter((file) => classifyGatePath(gates, file).protected);
  if (protectedPaths.length > 0) return park("C4", `the diff touches the shared gate set or a hard class: ${protectedPaths.join(", ")}`);
  const classes = classifyAuthorityPaths(judged);
  const hard = classes.filter((cls) => cls === "decisions" || cls === "agent_permissions" || cls === "ci_and_gates");
  if (hard.length > 0) return park("C4", `the diff touches a hard class: ${hard.join(", ")}`);
  return { ok: true, cardId, decisionId, reviewMarkerUrl: marker.url, classes };
}

function gitShow(repoRoot: string, revision: string, file: string): string | null {
  const result = spawnSync("git", ["show", `${revision}:${file}`], { cwd: repoRoot, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout : null;
}

export interface StandingReceiptFacts {
  cardId: string;
  decisionId: string;
  head: string;
  reviewMarkerUrl: string;
  checkConclusions: string[];
  mergeState: string;
  classes: string[];
  releaseSha: string;
}

/** The merge receipt comment, posted before the merge call. */
export function renderStandingMergeReceipt(facts: StandingReceiptFacts): string {
  return [
    "Standing in-run merge receipt",
    `- Card: ${facts.cardId} (authorized by Decision ${facts.decisionId})`,
    `- Head: ${facts.head}`,
    `- Review marker: ${facts.reviewMarkerUrl}`,
    "- Loosens a gate: no",
    `- Checks: ${facts.checkConclusions.join(", ") || "none"}`,
    `- Merge state: ${facts.mergeState}`,
    `- Classes: ${facts.classes.length ? facts.classes.join(", ") : "none"}`,
    `- Release: ${facts.releaseSha}`
  ].join("\n");
}
