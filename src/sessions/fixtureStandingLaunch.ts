import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { readExperimentWorkspace } from "../workspace/config.js";
import { canonicalPath, isInside } from "../workspace/experimentGuard.js";
import { refuseInsideArcadiaSession } from "./operatorLaunch.js";

/**
 * Decision 0100's fixture-only standing launch. It mints the SAME one-shot
 * authorization as a confirmed operator Launch (Decision 0096), but without the
 * interactive confirmation, and only while every condition below holds. Exit
 * authority is not changed here: the host validates, commits, pushes and opens
 * one draft pull request, and never merges.
 *
 * 1. Decision 0100 is ANSWERED with one of {@link FIXTURE_STANDING_ANSWERS},
 *    read from the `arcadia` Project's checked-in Decision document (never the
 *    fixture's own repository, which an agent can write).
 * 2. Today (UTC) is on or before {@link FIXTURE_STANDING_LAST_DAY}.
 * 3. The launch target is a registered disposable fixture: every Git remote of
 *    its repository is in {@link FIXTURE_REMOTE_ALLOWLIST}, or the workspace is
 *    an experiment workspace (Decision 0082) and the repository sits inside its
 *    allowed repository root. Arcadia's own repository is never a fixture.
 * 4. Not inside an Arcadia Session (same refusal as every mint).
 */
export const FIXTURE_STANDING_DECISION_ID = "0100";
export const FIXTURE_STANDING_DECISION_SLUG_PREFIX = "decide-whether-agents-may-launch-actions-in-disposable-fixture";
export const FIXTURE_STANDING_DECISION_PROJECT = "arcadia";
export const FIXTURE_STANDING_LAST_DAY = "2026-10-18";
export const FIXTURE_STANDING_ANSWERS = [
  "Standing fixture launch, with merge on green",
  "Standing fixture launch, you merge"
] as const;
/** Lower-case `owner/name` GitHub repositories registered as disposable fixtures. */
export const FIXTURE_REMOTE_ALLOWLIST: readonly string[] = ["pmark/arcadia-three-action-rehearsal-20261004"];

export interface FixtureStandingBasis {
  decisionId: string;
  decisionAnswer: string;
  agentIdentity: string;
  /** Why the target counted as a disposable fixture. */
  fixtureBasis: "registered_fixture_remote" | "experiment_workspace";
  remotes: string[];
}

type RefusalCode =
  | "fixture_standing_agent_identity_required"
  | "fixture_standing_expired"
  | "fixture_standing_decision_unanswered"
  | "fixture_standing_not_a_fixture";

function refuse(code: RefusalCode, reason: string, details: Record<string, unknown> = {}): never {
  throw validationError(`--fixture-standing refused (${code}): ${reason} No authorization is minted and nothing is launched.`, { code, ...details });
}

/** `owner/name` (lower-case) for a GitHub remote URL, else null. */
export function githubRepositoryOf(remoteUrl: string): string | null {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function configuredRemoteUrls(repoRoot: string): string[] {
  // The raw configured values, not `remote get-url`, which applies insteadOf rewriting.
  const result = spawnSync("git", ["-C", repoRoot, "config", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").filter(Boolean).map((line) => line.slice(line.indexOf(" ") + 1).trim());
}

function readDecisionAnswer(db: Database.Database): string {
  const project = getProjectBySlug(db, FIXTURE_STANDING_DECISION_PROJECT);
  const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() : null;
  if (!repoPath) {
    refuse("fixture_standing_decision_unanswered", `Decision ${FIXTURE_STANDING_DECISION_ID} cannot be read: no "${FIXTURE_STANDING_DECISION_PROJECT}" Project with a registered repository exists in this workspace.`);
  }
  const decision = discoverDocs(path.resolve(repoPath)).docs.find((doc) =>
    doc.type === "decision" && doc.id === FIXTURE_STANDING_DECISION_ID && doc.slug.startsWith(FIXTURE_STANDING_DECISION_SLUG_PREFIX)
    && doc.project.toLowerCase() === FIXTURE_STANDING_DECISION_PROJECT);
  if (!decision || decision.type !== "decision") {
    refuse("fixture_standing_decision_unanswered", `Decision ${FIXTURE_STANDING_DECISION_ID} does not exist in the ${FIXTURE_STANDING_DECISION_PROJECT} Project's repository.`);
  }
  if (decision.status !== "approved" || decision.answer === null || !(FIXTURE_STANDING_ANSWERS as readonly string[]).includes(decision.answer)) {
    refuse(
      "fixture_standing_decision_unanswered",
      `Decision ${FIXTURE_STANDING_DECISION_ID} is ${decision.status} with answer ${JSON.stringify(decision.answer)}; it must be answered "${FIXTURE_STANDING_ANSWERS[0]}" or "${FIXTURE_STANDING_ANSWERS[1]}".`,
      { status: decision.status, answer: decision.answer }
    );
  }
  return decision.answer;
}

/**
 * Verify every condition, in order, or throw a named refusal. Returns what the
 * mint's receipt records. `env` and `now` are injectable for tests only.
 */
export function verifyFixtureStandingLaunch(
  db: Database.Database,
  input: { workspace: string; repoRoot: string; projectSlug: string; agentIdentity: string | undefined; env?: NodeJS.ProcessEnv; now: Date }
): FixtureStandingBasis {
  refuseInsideArcadiaSession(input.env);
  const agentIdentity = input.agentIdentity?.trim();
  if (!agentIdentity) refuse("fixture_standing_agent_identity_required", "Name the invoking agent with --agent-identity <name>; the receipt records it.");
  const today = input.now.toISOString().slice(0, 10);
  if (today > FIXTURE_STANDING_LAST_DAY) {
    refuse("fixture_standing_expired", `The standing fixture launch ended after ${FIXTURE_STANDING_LAST_DAY} (UTC); today is ${today}.`, { today });
  }
  const decisionAnswer = readDecisionAnswer(db);

  const arcadia = getProjectBySlug(db, FIXTURE_STANDING_DECISION_PROJECT);
  const arcadiaRepo = arcadia ? getProjectMetadata(db, arcadia.id)?.repo_path?.trim() : null;
  const repo = canonicalPath(path.resolve(input.repoRoot));
  if (input.projectSlug.toLowerCase() === FIXTURE_STANDING_DECISION_PROJECT || (arcadiaRepo && canonicalPath(path.resolve(arcadiaRepo)) === repo)) {
    refuse("fixture_standing_not_a_fixture", "Arcadia's own Project is never a disposable fixture.", { project: input.projectSlug });
  }
  const remotes = configuredRemoteUrls(repo);
  const experiment = readExperimentWorkspace(input.workspace);
  if (experiment && isInside(experiment.allowedRepoRoot, repo)) {
    return { decisionId: FIXTURE_STANDING_DECISION_ID, decisionAnswer, agentIdentity, fixtureBasis: "experiment_workspace", remotes };
  }
  const repositories = remotes.map(githubRepositoryOf);
  if (remotes.length === 0 || repositories.some((name) => name === null || !FIXTURE_REMOTE_ALLOWLIST.includes(name))) {
    refuse(
      "fixture_standing_not_a_fixture",
      `${input.projectSlug}'s repository is not a registered disposable fixture: its Git remotes (${remotes.length ? remotes.join(", ") : "none"}) must all be in the fixture allowlist (${FIXTURE_REMOTE_ALLOWLIST.join(", ")}), or the workspace must be an experiment workspace (Decision 0082).`,
      { project: input.projectSlug, remotes }
    );
  }
  return { decisionId: FIXTURE_STANDING_DECISION_ID, decisionAnswer, agentIdentity, fixtureBasis: "registered_fixture_remote", remotes };
}
