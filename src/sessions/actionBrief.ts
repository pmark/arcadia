import { execFileSync } from "node:child_process";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { loadConstitution, readConstitution, type ConstitutionReference } from "../docs/dispatch.js";
import type { PlanDoc } from "../docs/types.js";
import type { SessionAgent } from "./index.js";

/**
 * The actionable brief handed to a managed-production Session at launch.
 *
 * A Session used to be started with the literal prompt `arcadia advance
 * --session <id>`, which prints the receipt's own metadata — session id, packet
 * hash, worktree, reattach command. The agent was never told the Action's
 * `next_action`, its acceptance criteria, or how to finish, so an unattended
 * run had to reconstruct its task from the packet or guess. This module renders
 * the brief that replaces that surface, derived from the authoritative plan
 * document rather than a hardcoded copy, and refuses the launch when the plan
 * or Action cannot supply one.
 */
export interface ActionBriefInput {
  /** The worktree the Session was launched into; the plan document is read from here. */
  repoRoot: string;
  projectSlug: string;
  /** The Session's recorded plan, as stored on its receipt. */
  planSlug: string;
  /** The Session's recorded Action id. */
  actionId: string;
  worktreePath: string;
  branch: string;
  agent: SessionAgent;
  /**
   * The Session's recorded base revision. The Constitution committed there is
   * the contract the Session was granted; a worktree whose CONSTITUTION.md no
   * longer matches it cannot launch.
   */
  baseRevision: string;
}

/**
 * Render one Action brief. Fails closed with a named validation error when the
 * recorded plan or Action is missing, or when the Action declares no acceptance
 * criteria, so a Session can never launch with a brief that does not state what
 * "finished" means.
 */
export function renderActionBrief(input: ActionBriefInput): string {
  const discovered = discoverDocs(input.repoRoot);
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc =>
      doc.type === "plan" &&
      doc.slug.toLowerCase() === input.planSlug.toLowerCase() &&
      doc.project.toLowerCase() === input.projectSlug.toLowerCase()
  );
  if (!plan) {
    throw validationError(
      `A managed-production Session cannot launch: plan "${input.planSlug}" was not found in repository ${input.repoRoot}.`,
      { planSlug: input.planSlug, projectSlug: input.projectSlug, repoRoot: input.repoRoot }
    );
  }

  const action = plan.actions.find((candidate) => candidate.id === input.actionId);
  if (!action) {
    throw validationError(
      `A managed-production Session cannot launch: Action "${input.actionId}" was not found in plan "${input.planSlug}".`,
      { planSlug: input.planSlug, actionId: input.actionId, planPath: plan.relativePath }
    );
  }
  if (action.acceptanceCriteria.length === 0) {
    throw validationError(
      `A managed-production Session cannot launch: Action "${input.actionId}" declares no acceptance criteria.`,
      { planSlug: input.planSlug, actionId: input.actionId, planPath: plan.relativePath }
    );
  }

  const pinned = pinnedConstitution(input);
  const constraints = loadConstitution(input.repoRoot, pinned);

  const lines: string[] = [
    "Arcadia managed-production Action brief",
    "",
    `Project: ${input.projectSlug}`,
    `Plan: ${plan.slug} — ${plan.relativePath}`,
    `Action: ${action.id}`,
    `Title: ${action.title}`,
    `Candidate worktree: ${input.worktreePath}`,
    `Branch: ${input.branch}`,
    "",
    "Next action:",
    action.nextAction ?? "(none declared)",
    "",
    "Acceptance criteria (verbatim, in the plan's order):",
    ...numbered(action.acceptanceCriteria),
    "",
    "Standing constraints — from this Session, do not merge, deploy, publish, push to shared",
    "branches, or edit the Project pointer; those remain operator gates."
  ];
  if (pinned) {
    lines.push("", `The repository's CONSTITUTION.md (sha256 ${pinned.sha256.slice(0, 12)}) also binds this action:`, "", ...constraints);
  }
  lines.push(
    "",
    "Completion protocol — finish by:",
    "  1. Run the repository's declared validation and make it pass.",
    `  2. Request protected preservation through the existing fixed launcher: arcadia-preserve-broker-${input.agent}`,
    "  3. Settle a `complete` Agent Ask with `candidate_revision` equal to this worktree's HEAD and one",
    "     `met` evidence entry per acceptance criterion above, verbatim and in order."
  );
  return lines.join("\n");
}

/**
 * Verify the worktree's CONSTITUTION.md is the one committed at the Session's
 * base revision, and return the reference the brief loads it under (null when
 * neither has one).
 *
 * Compared as Git blob ids, with `git hash-object` applying the same clean
 * filters `git add` would, so a checkout's line-ending conversion is not
 * mistaken for a changed contract. Only a base tree that genuinely has no
 * CONSTITUTION.md yields "none"; any Git read failure refuses the launch.
 */
function pinnedConstitution(input: ActionBriefInput): ConstitutionReference | null {
  const refuse = (reason: string): never => {
    throw validationError(
      `A managed-production Session cannot launch: ${reason} The Constitution is pinned to base revision ${input.baseRevision}.`,
      { planSlug: input.planSlug, actionId: input.actionId, relativePath: "CONSTITUTION.md", baseRevision: input.baseRevision }
    );
  };
  const git = (args: string[]): string => {
    try {
      return execFileSync("git", ["-C", input.repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      return refuse(`git ${args.join(" ")} failed in ${input.repoRoot}, so the Constitution the Session was granted under cannot be verified.`);
    }
  };
  git(["cat-file", "-e", `${input.baseRevision}^{commit}`]);
  const entry = git(["ls-tree", input.baseRevision, "--", "CONSTITUTION.md"]);
  const pinnedBlob = entry ? entry.split(/\s+/)[2] : null;

  const current = readConstitution(input.repoRoot);
  if (current.blocker) refuse(current.blocker.message);
  const currentBlob = current.reference ? git(["hash-object", "--path=CONSTITUTION.md", "--", "CONSTITUTION.md"]) : null;
  if (currentBlob !== pinnedBlob) {
    refuse("CONSTITUTION.md in the worktree differs from the one committed at the Session's base revision. " +
      "Restore the committed Constitution, or land the change through review before launching.");
  }
  return current.reference;
}

function numbered(values: string[]): string[] {
  const width = String(values.length).length;
  return values.map((value, index) => `  ${String(index + 1).padStart(width)}. ${value}`);
}
