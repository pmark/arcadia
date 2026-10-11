import { validationError } from "../cli/errors.js";
import {
  createGithubDecisionFetcher,
  FIXTURE_STANDING_LAST_DAY,
  fixtureStandingExpired,
  readAuthoritativeDecision,
  verifyDisposableFixtureTarget,
  type AuthoritativeDecisionSpec,
  type FetchDecisionFile
} from "./fixtureStandingLaunch.js";
import { refuseInsideArcadiaSession } from "./operatorLaunch.js";

/**
 * Decision 0119's fixture-only build-packet approval. An agent may approve the
 * immutable build packet of an Action (a `CodexBuildPacketApproval` Decision)
 * with no-execute semantics, only while every condition below holds. It reuses
 * Decision 0100's verification wholesale: the same GitHub-verified fetch of a
 * hardcoded Decision file, the same expiry day and the same fixture allowlist
 * (or Decision 0082 experiment workspace). It approves no planning run, Grant or
 * production change, and never applies to Arcadia's own Project.
 *
 * 1. Decision 0119 is ANSWERED {@link FIXTURE_PACKET_ANSWER} on `main` of
 *    github.com/pmark/arcadia (blob sha recorded; any fetch failure refuses).
 * 2. Today (UTC) is on or before {@link FIXTURE_STANDING_LAST_DAY}.
 * 3. The packet's Project repository is a disposable fixture.
 * 4. Not inside an Arcadia Session; `--agent-identity` names the approver.
 */
export const FIXTURE_PACKET_DECISION_ID = "0119";
export const FIXTURE_PACKET_DECISION_FILE = "docs/decisions/0119-decide-whether-agents-may-approve-the-immutable-build-packet-of-an-action-in-a.md";
export const FIXTURE_PACKET_DECISION_SOURCE = "github.com/pmark/arcadia@main";
export const FIXTURE_PACKET_ANSWER = "Agents approve fixture build packets";

export interface FixturePacketApprovalBasis {
  decisionId: string;
  decisionAnswer: string;
  decisionSource: string;
  /** The blob sha GitHub returned for the Decision file. */
  decisionBlobSha: string;
  agentIdentity: string;
  fixtureBasis: "registered_fixture_remote" | "experiment_workspace";
  remotes: string[];
}

const PACKET_DECISION_SPEC: AuthoritativeDecisionSpec = {
  id: FIXTURE_PACKET_DECISION_ID,
  file: FIXTURE_PACKET_DECISION_FILE,
  answers: [FIXTURE_PACKET_ANSWER],
  source: FIXTURE_PACKET_DECISION_SOURCE,
  flag: "--fixture-standing",
  suffix: "No approval is recorded and nothing is launched.",
  unverifiableCode: "fixture_packet_decision_unverifiable",
  unansweredCode: "fixture_packet_decision_unanswered"
};

export const fetchPacketDecisionFromGithub: FetchDecisionFile = createGithubDecisionFetcher(undefined, FIXTURE_PACKET_DECISION_FILE);

export function refuseFixturePacket(code: string, reason: string, details: Record<string, unknown> = {}): never {
  throw validationError(`--fixture-standing refused (${code}): ${reason} No approval is recorded and nothing is launched.`, { code, ...details });
}

/**
 * Verify every condition, in order, or throw a named refusal. `env`, `now` and
 * `fetchDecision` are injectable by function parameter for tests only.
 */
export function verifyFixturePacketApproval(input: {
  workspace: string;
  repoRoot: string;
  projectSlug: string;
  agentIdentity: string | undefined;
  env?: NodeJS.ProcessEnv;
  now: Date;
  fetchDecision?: FetchDecisionFile;
}): FixturePacketApprovalBasis {
  refuseInsideArcadiaSession(input.env);
  const agentIdentity = input.agentIdentity?.trim();
  if (!agentIdentity) refuseFixturePacket("fixture_packet_agent_identity_required", "Name the invoking agent with --agent-identity <name>; the receipt records it.");
  if (fixtureStandingExpired(input.now)) {
    refuseFixturePacket("fixture_packet_expired", `Fixture packet approval ended after ${FIXTURE_STANDING_LAST_DAY} (UTC); today is ${input.now.toISOString().slice(0, 10)}.`);
  }
  const decision = readAuthoritativeDecision(PACKET_DECISION_SPEC, input.fetchDecision ?? fetchPacketDecisionFromGithub);
  const target = verifyDisposableFixtureTarget(input.workspace, input.repoRoot, input.projectSlug, (reason, details) =>
    refuseFixturePacket("fixture_packet_not_a_fixture", reason, details));
  return {
    decisionId: FIXTURE_PACKET_DECISION_ID, decisionAnswer: decision.answer, decisionSource: FIXTURE_PACKET_DECISION_SOURCE,
    decisionBlobSha: decision.blobSha, agentIdentity: agentIdentity, ...target
  };
}
