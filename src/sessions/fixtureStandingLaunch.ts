import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { parseDoc } from "../docs/parse.js";
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
 * 1. Decision 0100 is ANSWERED with one of {@link FIXTURE_STANDING_ANSWERS}. It
 *    is fetched from `main` of github.com/pmark/arcadia itself (hardcoded host,
 *    repository and path; sanitized environment) and the blob sha is recorded.
 *    No local ref, working tree, workspace database or user config is consulted,
 *    and any fetch failure refuses.
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
  /** Where Decision 0100 was verified: always GitHub's main. */
  decisionSource: string;
  /** The blob sha GitHub returned for the Decision file. */
  decisionBlobSha: string;
  agentIdentity: string;
  /** Why the target counted as a disposable fixture. */
  fixtureBasis: "registered_fixture_remote" | "experiment_workspace";
  remotes: string[];
}

type RefusalCode =
  | "fixture_standing_agent_identity_required"
  | "fixture_standing_expired"
  | "fixture_standing_decision_unanswered"
  | "fixture_standing_decision_unverifiable"
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

/** What GitHub's contents API returns for the Decision file. */
export interface GithubDecisionFile { content: string; sha: string }
export type FetchDecisionFile = () => GithubDecisionFile;

/** The Decision 0100 file, hardcoded: no caller input chooses the repository, ref or path. */
export const FIXTURE_STANDING_DECISION_FILE = "docs/decisions/0100-decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without.md";
export const FIXTURE_STANDING_DECISION_SOURCE = "github.com/pmark/arcadia@main";

/**
 * The real fetch: `gh api` against github.com with a sanitized environment, so
 * GH_HOST, GH_REPO, GH_CONFIG_DIR, proxy variables and the like cannot redirect
 * it. Only PATH, HOME, TMPDIR and a GitHub token (which authenticates to the
 * hardcoded host only) pass through.
 */
export const fetchDecisionFromGithub: FetchDecisionFile = () => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "GH_TOKEN", "GITHUB_TOKEN"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const result = spawnSync(
    "gh",
    ["api", "--hostname", "github.com", `repos/${FIXTURE_STANDING_ARCADIA_REPOSITORY}/contents/${FIXTURE_STANDING_DECISION_FILE}?ref=main`],
    { encoding: "utf8", env, timeout: 30_000 }
  );
  if (result.error || result.status !== 0) {
    throw new Error(`gh api failed (${result.error?.message ?? `exit ${String(result.status)}`}): ${(result.stderr ?? "").trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(result.stdout) as { content?: unknown; sha?: unknown; encoding?: unknown; path?: unknown };
  if (typeof parsed.content !== "string" || typeof parsed.sha !== "string" || parsed.encoding !== "base64" || parsed.path !== FIXTURE_STANDING_DECISION_FILE) {
    throw new Error("GitHub returned an unexpected contents response.");
  }
  return { content: parsed.content, sha: parsed.sha };
};

interface VerifiedDecision { answer: string; blobSha: string }

/**
 * Decision 0100 as `main` of github.com/pmark/arcadia holds it right now: the
 * only authoritative record. No local ref, working tree or workspace database
 * is consulted, and every failure (network, auth, 404, parse) fails closed.
 */
function readAuthoritativeDecision(fetchDecision: FetchDecisionFile): VerifiedDecision {
  const unverifiable = (reason: string): never => refuse("fixture_standing_decision_unverifiable", `Decision ${FIXTURE_STANDING_DECISION_ID} could not be verified on ${FIXTURE_STANDING_DECISION_SOURCE}: ${reason}.`);
  let file: GithubDecisionFile;
  try {
    file = fetchDecision();
  } catch (error) {
    return unverifiable(error instanceof Error ? error.message : String(error));
  }
  if (typeof file.content !== "string" || typeof file.sha !== "string" || !file.sha) return unverifiable("the response carried no content or blob sha");
  const text = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
  const { doc } = parseDoc(FIXTURE_STANDING_DECISION_FILE, FIXTURE_STANDING_DECISION_FILE, text);
  if (!doc || doc.type !== "decision" || doc.id !== FIXTURE_STANDING_DECISION_ID || doc.project.toLowerCase() !== FIXTURE_STANDING_DECISION_PROJECT) {
    return unverifiable("it does not parse as the arcadia Project's Decision 0100");
  }
  if (doc.status !== "approved" || doc.answer === null || !(FIXTURE_STANDING_ANSWERS as readonly string[]).includes(doc.answer)) {
    return refuse(
      "fixture_standing_decision_unanswered",
      `Decision ${FIXTURE_STANDING_DECISION_ID} on ${FIXTURE_STANDING_DECISION_SOURCE} is ${doc.status} with answer ${JSON.stringify(doc.answer)}; it must be answered "${FIXTURE_STANDING_ANSWERS[0]}" or "${FIXTURE_STANDING_ANSWERS[1]}".`,
      { status: doc.status, answer: doc.answer }
    );
  }
  return { answer: doc.answer, blobSha: file.sha };
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
  input: { workspace: string; repoRoot: string; projectSlug: string; agentIdentity: string | undefined; env?: NodeJS.ProcessEnv; now: Date; fetchDecision?: FetchDecisionFile }
): FixtureStandingBasis {
  refuseInsideArcadiaSession(input.env);
  const agentIdentity = input.agentIdentity?.trim();
  if (!agentIdentity) refuse("fixture_standing_agent_identity_required", "Name the invoking agent with --agent-identity <name>; the receipt records it.");
  const today = input.now.toISOString().slice(0, 10);
  if (fixtureStandingExpired(input.now)) {
    refuse("fixture_standing_expired", `The standing fixture launch ended after ${FIXTURE_STANDING_LAST_DAY} (UTC); today is ${today}.`, { today });
  }

  // The authoritative record is GitHub's main, not anything local or caller-steered.
  const decision = readAuthoritativeDecision(input.fetchDecision ?? fetchDecisionFromGithub);
  const experiment = readExperimentWorkspace(input.workspace);
  const repo = canonicalPath(path.resolve(input.repoRoot));
  if (input.projectSlug.toLowerCase() === FIXTURE_STANDING_DECISION_PROJECT) {
    refuse("fixture_standing_not_a_fixture", "Arcadia's own Project is never a disposable fixture.", { project: input.projectSlug });
  }
  const basisBase = {
    decisionId: FIXTURE_STANDING_DECISION_ID, decisionAnswer: decision.answer, decisionSource: FIXTURE_STANDING_DECISION_SOURCE,
    decisionBlobSha: decision.blobSha, agentIdentity
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
