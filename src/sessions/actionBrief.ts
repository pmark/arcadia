import { execFileSync } from "node:child_process";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { loadConstitution, readConstitution, type ConstitutionReference } from "../docs/dispatch.js";
import type { PlanDoc } from "../docs/types.js";
import { renderGuidanceRetrieval } from "../projects/agentGuidance.js";
import { renderIdentityBlock, renderSessionIdentityBlock, type AgentGitIdentity, type AgentPartner } from "../codingAgents/agentIdentity.js";
import { resolveEscalationTarget, type ModelTierRegistry } from "../codingAgents/modelTiers.js";
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
  /** The canonical incomplete handoff consumed by this Session, when resuming. */
  continuation?: { sessionId: string; candidateRevision: string | null };
  /**
   * The identity the Session's launch environment commits under. Absent, the
   * brief still carries an Identity block, but one that names nobody and
   * tells the agent to resolve its own.
   */
  identity?: AgentGitIdentity | null;
  /** Other agents live on this Project; null when unreadable (the sentence is omitted). */
  partners?: AgentPartner[] | null;
  /**
   * The model this Session started on. With it, the brief adds a "Calling in
   * help" section naming the plan's tier as the escalation target (omitted
   * when the Session already runs the plan's model).
   */
  model?: string | null;
  registry?: ModelTierRegistry;
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
    ...(input.identity
      ? renderIdentityBlock(input.identity, input.partners ?? null)
      : renderSessionIdentityBlock({ agent: input.agent, partners: input.partners ?? null })),
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
  if (input.continuation) {
    lines.push(
      "", "Continuation — this is a resumed Session, not the first Session for this Action:",
      `Previous Session: ${input.continuation.sessionId} (incomplete_resumable).`,
      `Previous preserved candidate revision: ${input.continuation.candidateRevision ?? "unavailable"}.`,
      "The host reused that Session's candidate worktree and branch. Inspect its existing work before editing.",
      "First-Session-only instructions apply to the prior Session where the candidate evidence confirms them.",
      "Continue the remaining acceptance criteria; do not repeat a deliberate first-Session partial exit.",
      "This handoff proves neither completion nor additional authority. The Plan and approval boundaries still bind."
    );
  }
  if (pinned) {
    lines.push("", `The repository's CONSTITUTION.md (sha256 ${pinned.sha256.slice(0, 12)}) also binds this action:`, "", ...constraints);
  }
  const escalation = input.model
    ? resolveEscalationTarget({ agent: input.agent, recommendedModel: plan.recommendedModel, currentModel: input.model, registry: input.registry })
    : null;
  if (input.model && escalation) lines.push(...renderCallingInHelp({ agent: input.agent, model: input.model, escalation }));
  lines.push(...renderGuidanceRetrieval(input.repoRoot, input.agent, `${action.title} ${action.nextAction ?? ""} ${action.references.join(" ")}`));
  lines.push(
    "",
    "Completion protocol — finish by:",
    "  1. Run the repository's declared validation and make it pass.",
    `  2. Request protected preservation through the existing fixed launcher: arcadia-preserve-broker-${input.agent}`,
    "  3. Settle a `complete` Agent Ask with `candidate_revision` equal to this worktree's HEAD and one",
    "     `met` evidence entry per acceptance criterion above, verbatim and in order.",
    "     If your sandbox cannot commit or reach the Arcadia workspace, `arcadia agent-ask draft` it instead",
    "     and leave the drafted file in .arcadia/asks/; the host preserves and settles it when you exit.",
    "     After you settle, `git status` must be clean: settlement archives the drafted Ask file into",
    "     .arcadia/asks/archive/ in its own commit, so never commit the draft or keep a copy of it.",
    "     If a draft of the Ask you just settled still remains in .arcadia/asks/, delete it.",
    "  4. Exit. The host reconciles the Session only once its process has ended."
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

/**
 * "Calling in help": a Session starts on the registry's start-tier model (the
 * smallest by default) and names the plan's tier as the escalation target. What a Session can safely do
 * with that depends on the provider: Claude spawns a subagent on the bigger
 * model (the Agent tool), Codex uses its built-in `spawn_agent` tool with a
 * `model` override, and opencode (and any Session whose in-session path fails)
 * stops and asks for a relaunch at the plan's tier instead of guessing.
 */
export function renderCallingInHelp(input: {
  agent: SessionAgent;
  model: string;
  escalation: { model: string; tier: string | null };
}): string[] {
  const target = `${input.escalation.model}${input.escalation.tier ? ` (${input.escalation.tier} tier)` : ""}`;
  const lines = [
    "",
    `Calling in help — you started on ${input.model}, a smaller model than the one the plan is sized for.`,
    `Started on: ${input.model}. Escalation target: ${target}.`,
    "Do the routine work yourself. Escalate only a sub-problem you cannot settle (a design choice, a stubborn bug,",
    "a review of your own work), and give the helper a self-contained prompt; never hand over the whole Action."
  ];
  if (input.agent === "claude") {
    // The Agent tool takes the sonnet/opus/haiku aliases; a concrete Claude ID maps to its family.
    const alias = /opus|sonnet|haiku/i.exec(input.escalation.model)?.[0].toLowerCase() ?? input.escalation.model;
    lines.push(`In session: spawn a subagent with the Agent tool and \`model: "${alias}"\`.`);
  } else if (input.agent === "codex") {
    lines.push(
      `In session: call \`spawn_agent\` with \`model: "${input.escalation.model}"\` (this brief is the explicit instruction to delegate).`,
      "Do not run a nested `codex exec`: the workspace-write sandbox has no network for child processes."
    );
  }
  lines.push(
    "If there is no working in-session path, or the whole Action is beyond you: stop, run `arcadia agent-ask draft`",
    `with \`intent: proposal\`, \`requested_authority: propose\`, asking for a relaunch at ${target}, then exit.`,
    "Do not guess past what you can verify."
  );
  return lines;
}

function numbered(values: string[]): string[] {
  const width = String(values.length).length;
  return values.map((value, index) => `  ${String(index + 1).padStart(width)}. ${value}`);
}
