import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { parseDoc } from "../docs/parse.js";
import { loadUserConfig, readExperimentWorkspace } from "../workspace/config.js";
import { canonicalPath, isInside } from "../workspace/experimentGuard.js";
import { refuseInsideArcadiaSession } from "./operatorLaunch.js";

/**
 * Decision 0100's fixture-only standing launch. It mints the SAME one-shot
 * authorization as a confirmed operator Launch (Decision 0096), but without the
 * interactive confirmation, and only while every condition below holds. Exit
 * authority is not changed here: the host validates, commits, pushes and opens
 * one draft pull request, and never merges.
 *
 * 1. Decision 0100 is ANSWERED with one of {@link FIXTURE_STANDING_ANSWERS}. It
 *    is read from the COMMITTED `origin/main` (else `main`, and the receipt says
 *    which) of the `arcadia` Project registered in the LIVE workspace (the user
 *    config default), never from a working tree or from the workspace the caller
 *    happened to pass, so neither can forge it.
 * 2. Today (UTC) is on or before {@link FIXTURE_STANDING_LAST_DAY}; the exit
 *    re-checks this.
 * 3. The launch target is a disposable fixture: the effective fetch and push
 *    target of every Git remote is in {@link FIXTURE_REMOTE_ALLOWLIST} and no
 *    `url.*.insteadOf` or `pushInsteadOf` rewrite exists; or the workspace is an
 *    experiment workspace (Decision 0082), the repository is inside its allowed
 *    root, and it has no remote or only allowlisted ones. Arcadia's own
 *    repository is never a fixture. The exit re-runs this before push and PR.
 * 4. Not inside an Arcadia Session (same refusal as every mint).
 */
export const FIXTURE_STANDING_DECISION_ID = "0100";
export const FIXTURE_STANDING_DECISION_SLUG_PREFIX = "decide-whether-agents-may-launch-actions-in-disposable-fixture";
export const FIXTURE_STANDING_DECISION_PROJECT = "arcadia";
export const FIXTURE_STANDING_ARCADIA_REPOSITORY = "pmark/arcadia";
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
  /** Where Decision 0100 was read: the committed `origin/main` or, only when origin has none, `main`. */
  decisionRef: "origin/main" | "main";
  decisionCommit: string;
  agentIdentity: string;
  /** Why the target counted as a disposable fixture. */
  fixtureBasis: "registered_fixture_remote" | "experiment_workspace";
  remotes: string[];
}

type RefusalCode =
  | "fixture_standing_agent_identity_required"
  | "fixture_standing_expired"
  | "fixture_standing_decision_unanswered"
  | "fixture_standing_workspace_not_live"
  | "fixture_standing_not_a_fixture";

function refuse(code: RefusalCode, reason: string, details: Record<string, unknown> = {}): never {
  throw validationError(`--fixture-standing refused (${code}): ${reason} No authorization is minted and nothing is launched.`, { code, ...details });
}

/** `owner/name` (lower-case) for a GitHub remote URL, else null. */
export function githubRepositoryOf(remoteUrl: string): string | null {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function gitOut(repo: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim() };
}

export type RemoteCheck = { ok: true; remotes: string[]; repository: string | null } | { ok: false; reason: string; remotes: string[] };

/**
 * The effective destinations of every remote of `repo`: the configured values
 * AND what git resolves (`remote get-url --push`, `ls-remote --get-url`). Any
 * `url.*.insteadOf` / `pushInsteadOf` rewrite visible to the repository (any
 * config scope) is refused outright, since it can redirect an allowlisted-looking
 * URL. With `allowNone`, a repository with no remote passes (experiment fixtures).
 */
export function checkFixtureRemotes(repo: string, options: { allowNone: boolean }): RemoteCheck {
  const rewrites = gitOut(repo, ["config", "--get-regexp", "^url\\..*\\.(insteadof|pushinsteadof)$"]);
  if (rewrites.status === 0 && rewrites.stdout) {
    return { ok: false, remotes: [], reason: `a Git URL rewrite (${rewrites.stdout.split("\n")[0]}) is configured; fixture remotes must be exact` };
  }
  const names = gitOut(repo, ["remote"]).stdout.split("\n").filter(Boolean);
  const urls: string[] = [];
  for (const name of names) {
    const configured = gitOut(repo, ["config", "--get-all", `remote.${name}.url`]).stdout.split("\n");
    const pushConfigured = gitOut(repo, ["config", "--get-all", `remote.${name}.pushurl`]).stdout.split("\n");
    const push = gitOut(repo, ["remote", "get-url", "--all", "--push", name]);
    const fetch = gitOut(repo, ["ls-remote", "--get-url", name]);
    if (push.status !== 0 || fetch.status !== 0) return { ok: false, remotes: urls, reason: `remote ${name} cannot be resolved` };
    urls.push(...configured, ...pushConfigured, ...push.stdout.split("\n"), fetch.stdout);
  }
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return options.allowNone && names.length === 0
      ? { ok: true, remotes: [], repository: null }
      : { ok: false, remotes: [], reason: "it has no Git remote" };
  }
  const repositories = unique.map(githubRepositoryOf);
  const bad = unique.find((_, index) => repositories[index] === null || !FIXTURE_REMOTE_ALLOWLIST.includes(repositories[index]));
  if (bad) return { ok: false, remotes: unique, reason: `remote ${bad} is not in the fixture allowlist (${FIXTURE_REMOTE_ALLOWLIST.join(", ")})` };
  return { ok: true, remotes: unique, repository: repositories[0] };
}

interface CommittedDecision { answer: string; ref: "origin/main" | "main"; commit: string }

/** Decision 0100 as COMMITTED on origin/main (else main) of the Arcadia repository; the working tree is never read. */
function readCommittedDecision(arcadiaRepo: string): CommittedDecision {
  const unanswered = (reason: string, details: Record<string, unknown> = {}): never => refuse("fixture_standing_decision_unanswered", reason, details);
  const hasOrigin = gitOut(arcadiaRepo, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]).status === 0;
  if (hasOrigin) {
    const origin = githubRepositoryOf(gitOut(arcadiaRepo, ["config", "--get", "remote.origin.url"]).stdout);
    if (origin !== FIXTURE_STANDING_ARCADIA_REPOSITORY) {
      unanswered(`the Arcadia repository's origin (${origin ?? "not GitHub"}) is not ${FIXTURE_STANDING_ARCADIA_REPOSITORY}, so its origin/main is not the committed record.`);
    }
  }
  const ref = hasOrigin ? "origin/main" : "main";
  const commit = gitOut(arcadiaRepo, ["rev-parse", "--verify", "--quiet", `${hasOrigin ? "refs/remotes/origin/main" : "refs/heads/main"}^{commit}`]);
  if (commit.status !== 0) unanswered(`Decision ${FIXTURE_STANDING_DECISION_ID} cannot be read: the Arcadia repository has neither origin/main nor main.`);
  const names = gitOut(arcadiaRepo, ["ls-tree", "--name-only", commit.stdout, "docs/decisions/"]).stdout.split("\n");
  const file = names.find((name) => path.posix.basename(name).startsWith(`${FIXTURE_STANDING_DECISION_ID}-${FIXTURE_STANDING_DECISION_SLUG_PREFIX}`));
  if (!file) unanswered(`Decision ${FIXTURE_STANDING_DECISION_ID} is not committed on ${ref} of the Arcadia repository.`);
  const content = spawnSync("git", ["-C", arcadiaRepo, "show", `${commit.stdout}:${file}`], { encoding: "utf8" });
  const { doc } = parseDoc(file!, path.join(arcadiaRepo, file!), content.stdout ?? "");
  if (!doc || doc.type !== "decision" || doc.id !== FIXTURE_STANDING_DECISION_ID || doc.project.toLowerCase() !== FIXTURE_STANDING_DECISION_PROJECT) {
    return unanswered(`Decision ${FIXTURE_STANDING_DECISION_ID} on ${ref} does not parse as the ${FIXTURE_STANDING_DECISION_PROJECT} Project's Decision.`);
  }
  if (doc.status !== "approved" || doc.answer === null || !(FIXTURE_STANDING_ANSWERS as readonly string[]).includes(doc.answer)) {
    return unanswered(
      `Decision ${FIXTURE_STANDING_DECISION_ID} on ${ref} is ${doc.status} with answer ${JSON.stringify(doc.answer)}; it must be committed answered "${FIXTURE_STANDING_ANSWERS[0]}" or "${FIXTURE_STANDING_ANSWERS[1]}".`,
      { status: doc.status, answer: doc.answer }
    );
  }
  return { answer: doc.answer, ref, commit: commit.stdout };
}

function arcadiaRepositoryIn(db: Database.Database): string | null {
  const project = getProjectBySlug(db, FIXTURE_STANDING_DECISION_PROJECT);
  const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() : null;
  return repoPath ? path.resolve(repoPath) : null;
}

/** True once `now` (UTC) is past the last day of Decision 0100's window. */
export function fixtureStandingExpired(now: Date): boolean {
  return now.toISOString().slice(0, 10) > FIXTURE_STANDING_LAST_DAY;
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
  if (fixtureStandingExpired(input.now)) {
    refuse("fixture_standing_expired", `The standing fixture launch ended after ${FIXTURE_STANDING_LAST_DAY} (UTC); today is ${today}.`, { today });
  }

  // The Decision is always read from the LIVE workspace's Arcadia repository.
  const configured = loadUserConfig(input.env ?? process.env).defaultWorkspace;
  if (!configured) refuse("fixture_standing_workspace_not_live", "No live (default) workspace is configured, so Decision 0100 cannot be read from the live record.");
  const live = canonicalPath(path.resolve(configured));
  const workspace = canonicalPath(path.resolve(input.workspace));
  const experiment = readExperimentWorkspace(input.workspace);
  if (workspace !== live && !experiment) {
    refuse("fixture_standing_workspace_not_live", `Workspace ${workspace} is neither the live workspace (${live}) nor an experiment workspace (Decision 0082).`, { workspace, live });
  }
  const arcadiaRepo = workspace === live && !experiment ? arcadiaRepositoryIn(db) : withReadOnlyDatabase(live, arcadiaRepositoryIn);
  if (!arcadiaRepo) {
    refuse("fixture_standing_decision_unanswered", `Decision ${FIXTURE_STANDING_DECISION_ID} cannot be read: the live workspace has no "${FIXTURE_STANDING_DECISION_PROJECT}" Project with a registered repository.`);
  }
  const decision = readCommittedDecision(arcadiaRepo);

  const repo = canonicalPath(path.resolve(input.repoRoot));
  if (input.projectSlug.toLowerCase() === FIXTURE_STANDING_DECISION_PROJECT || canonicalPath(arcadiaRepo) === repo) {
    refuse("fixture_standing_not_a_fixture", "Arcadia's own Project is never a disposable fixture.", { project: input.projectSlug });
  }
  const basisBase = {
    decisionId: FIXTURE_STANDING_DECISION_ID, decisionAnswer: decision.answer, decisionRef: decision.ref, decisionCommit: decision.commit, agentIdentity
  };
  const inExperiment = Boolean(experiment) && isInside(experiment!.allowedRepoRoot, repo);
  const remotes = checkFixtureRemotes(repo, { allowNone: inExperiment });
  if (!remotes.ok) {
    refuse(
      "fixture_standing_not_a_fixture",
      `${input.projectSlug}'s repository is not a registered disposable fixture: ${remotes.reason}. Its remotes must all be allowlisted${experiment ? "" : ", or the workspace must be an experiment workspace (Decision 0082)"}.`,
      { project: input.projectSlug, remotes: remotes.remotes }
    );
  }
  if (inExperiment) return { ...basisBase, fixtureBasis: "experiment_workspace", remotes: remotes.remotes };
  if (!remotes.repository) {
    refuse("fixture_standing_not_a_fixture", `${input.projectSlug}'s repository has no allowlisted remote and is not inside an experiment workspace's allowed root.`, { project: input.projectSlug });
  }
  return { ...basisBase, fixtureBasis: "registered_fixture_remote", remotes: remotes.remotes };
}

/**
 * The exit's re-check for a `fixture_standing` authorization, run before the push
 * and again before the pull request: the window must still be open and the
 * repository's remotes must still be exactly the fixture's. Returns the
 * repository to pass as `gh --repo`, or why the publish is refused.
 */
export function verifyFixtureStandingExit(standing: FixtureStandingBasis, repoRoot: string, now: Date): { ok: true; ghRepo: string | null } | { ok: false; reason: string } {
  if (fixtureStandingExpired(now)) {
    return { ok: false, reason: `Decision ${standing.decisionId}'s standing fixture window ended after ${FIXTURE_STANDING_LAST_DAY} (UTC); nothing is pushed or opened.` };
  }
  const check = checkFixtureRemotes(canonicalPath(path.resolve(repoRoot)), { allowNone: standing.fixtureBasis === "experiment_workspace" });
  if (!check.ok) {
    return { ok: false, reason: `The repository is no longer a registered fixture (${check.reason}); nothing is pushed or opened.` };
  }
  return { ok: true, ghRepo: check.repository };
}
