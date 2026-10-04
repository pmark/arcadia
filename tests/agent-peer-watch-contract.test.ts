import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CHANNEL_SUPPORT,
  PEER_WATCH_WINDOWS,
  bindCommentEvidence,
  bindCommitEvidence,
  builderIdentityEmail,
  parseIsoInstant,
  parsePeerWatchCommentBlock,
  parsePeerWatchTrailers,
  renderPeerWatchCommentBlock,
  renderPeerWatchTrailers,
  type AgentRef,
  type BindingExpectation,
  type CommitObservation,
  type IssueCommentObservation
} from "../src/agentWatch/contract.js";
import {
  PEER_WATCH_CLASSIFICATION_TABLE,
  PEER_WATCH_PROVIDER_IDS,
  buildTakeoverRequest,
  classifyPeer,
  validateTakeoverRequest,
  type ClaimObservation,
  type ExitReceiptObservation,
  type OwnershipObservation,
  type PeerTakeoverRequest,
  type PeerWatchClassification,
  type PeerWatchInput,
  type ReleaseFacts,
  type SessionObservation
} from "../src/agentWatch/classify.js";
import { buildProviderCapacityReceipt, type ProviderCapacityReceipt } from "../src/codingAgents/capacity.js";
import { agentIdentityEmail, agentIdentityName } from "../src/codingAgents/agentIdentity.js";
import { sessionAgentForProvider } from "../src/sessions/index.js";
import { GUIDANCE_INDEX, guidanceEntries, guidanceFingerprint } from "../src/projects/agentGuidance.js";

const root = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-04T21:00:00.000Z");
const minutes = (n: number): string => new Date(NOW.getTime() - n * 60_000).toISOString();
const iso = (n: number): string => minutes(n).replace(/\.\d{3}Z$/, "Z");
const SHA = (c: string): string => c.repeat(40);
const BRANCH = "codex/enroll-session-through-governed-host-request-20261003T162700832Z";
const GENERATION = "wtres_3f693df353874d8997";
const action = { project: "arcadia", actionId: "enroll-session-through-governed-host-request" };
const codexStandard: AgentRef = { agent: "codex", tier: "standard" };
const codexEmail = builderIdentityEmail(codexStandard);
const claudeEmail = builderIdentityEmail({ agent: "claude", tier: "heavy" });
const expected: BindingExpectation = { agent: "codex", ...action, branch: BRANCH, claimGeneration: GENERATION };

function commit(overrides: Partial<CommitObservation> = {}): CommitObservation {
  return { sha: SHA("a"), branch: BRANCH, authorEmail: codexEmail, committerEmail: codexEmail, committedAt: minutes(5), message: "fix: work\n\nBody.", ...overrides };
}
function trailered(extra: { heartbeatAt?: Date; claimGeneration?: string; agent?: AgentRef } = {}): string {
  return `chore: heartbeat\n\n${renderPeerWatchTrailers({ agent: extra.agent ?? codexStandard, action, ...extra })}`;
}
function comment(body: string, overrides: Partial<IssueCommentObservation> = {}): IssueCommentObservation {
  return { id: "c1", authorLogin: "pmark", createdAt: minutes(5), updatedAt: null, body, ...overrides };
}
function block(overrides: Partial<Parameters<typeof renderPeerWatchCommentBlock>[0]> = {}): string {
  return renderPeerWatchCommentBlock({ agent: codexStandard, action, claimGeneration: GENERATION, state: "waiting", evidence: [`commit:${SHA("b")}`], issuedAt: new Date(minutes(5)), ...overrides });
}
function claim(overrides: Partial<ClaimObservation> = {}): ClaimObservation {
  return { reservationId: GENERATION, ...action, generation: GENERATION, branch: BRANCH, worktreePath: "/w/enroll", createdAt: minutes(600), ...overrides };
}
function session(overrides: Partial<SessionObservation> = {}): SessionObservation {
  return { id: "sess_1", agent: "codex", status: "running", branch: BRANCH, worktreePath: "/w/enroll", startedAt: minutes(600), lastActivityAt: minutes(590), stallFlaggedAt: null, exitReceipt: null, ...overrides };
}
function receipt(overrides: Partial<ProviderCapacityReceipt> = {}): ProviderCapacityReceipt {
  return {
    version: 1, providerId: "codex-cli", providerLabel: "Codex", profiles: ["codex"], accountScope: "local", source: "codex_app_server",
    evidence: "real", unattended: true, observedAt: minutes(2), observedAgeMs: 120_000, expiresAt: null, confidence: "observed",
    freshness: "fresh", usagePolicy: "included", usagePolicyReason: "plan", windows: [{ label: "5h", usedPercentage: 40, remainingPercentage: 60, resetsAt: minutes(-60) }],
    nextResetAt: minutes(-60), credits: null, bankedResets: [], planScope: null, unsupported: [], availability: "available", telemetry: "fixture",
    ...overrides
  };
}
const ok = <T>(value: T) => ({ readable: true as const, value });
const NO_OWNER: ReleaseFacts = { liveSession: false, reservation: false, manualHandoff: false, releaseRef: "asksettle_released_1" };
function owned(overrides: Partial<OwnershipObservation> = {}): OwnershipObservation {
  return { claim: claim(), principal: { kind: "managed-session", session: session() }, releaseFacts: null, ...overrides };
}
function exitReceipt(overrides: Partial<ExitReceiptObservation> = {}): ExitReceiptObservation {
  return { id: "exit_1", outcome: "incomplete_resumable", leaseHandoff: true, supersededBySessionId: null, isSimulated: false, ...overrides };
}
function terminalOwnership(sessionOverrides: Partial<SessionObservation> = {}, receiptOverrides: Partial<ExitReceiptObservation> = {}): OwnershipObservation {
  return owned({ principal: { kind: "managed-session", session: session({ status: "completed", lastActivityAt: minutes(500), exitReceipt: exitReceipt(receiptOverrides), ...sessionOverrides }) } });
}
const releasedOwnership = (): OwnershipObservation => ({ claim: null, principal: { kind: "none" }, releaseFacts: NO_OWNER });
const POINTER = { project: action.project, actionId: action.actionId };
function input(overrides: Partial<PeerWatchInput> = {}): PeerWatchInput {
  return {
    now: NOW, subject: { agent: "codex", ...action },
    ownership: ok(owned()),
    commits: ok([]), comments: ok([]), capacity: ok(receipt()), trustedCommentAuthors: ["pmark"],
    ...overrides
  };
}

describe("commit trailer grammar", () => {
  it("parses a rendered trailer block and treats a message without one as absent", () => {
    const parsed = parsePeerWatchTrailers(trailered({ heartbeatAt: new Date(minutes(5)), claimGeneration: GENERATION }));
    expect(parsed).toEqual({ status: "ok", trailers: { agent: codexStandard, action, heartbeatAt: Date.parse(minutes(5)), claimGeneration: GENERATION } });
    expect(parsePeerWatchTrailers("fix: no trailers\n\nJust prose.")).toEqual({ status: "absent" });
    expect(parsePeerWatchTrailers("subject only")).toEqual({ status: "absent" });
  });

  it("reads only the final paragraph and leaves other Arcadia trailers alone", () => {
    expect(parsePeerWatchTrailers("fix\n\nArcadia-Agent: codex/heavy\nArcadia-Action: arcadia/x\n\nCo-Authored-By: A <a@b>")).toEqual({ status: "absent" });
    expect(parsePeerWatchTrailers("fix\n\nArcadia-Preservation-Request: preserve:abc\nArcadia-Candidate-Fingerprint: abcdef1")).toEqual({ status: "absent" });
  });

  it.each([
    ["duplicate key", `${trailered()}\nArcadia-Agent: codex/heavy`, /duplicate Arcadia-Agent/],
    ["case-variant key", `${trailered()}\narcadia-heartbeat: ${iso(1)}`, /not spelled exactly/],
    ["oversized value", `fix\n\nArcadia-Agent: codex/standard\nArcadia-Action: arcadia/${"a".repeat(140)}`, /exceeds 128 bytes/],
    ["control character", `fix\n\nArcadia-Agent: codex/standard\nArcadia-Action: arcadia/x\u0007y`, /unsafe/],
    ["non-ASCII lookalike", "fix\n\nArcadia-Agent: cоdex/standard\nArcadia-Action: arcadia/x", /unsafe/],
    ["unknown agent", "fix\n\nArcadia-Agent: gemini/standard\nArcadia-Action: arcadia/x", /supported agent/],
    ["heartbeat without action", `fix\n\nArcadia-Agent: codex/standard\nArcadia-Heartbeat: ${iso(1)}`, /Arcadia-Action is required/],
    ["offset timestamp", "fix\n\nArcadia-Agent: codex/standard\nArcadia-Action: arcadia/x\nArcadia-Heartbeat: 2026-10-04T20:00:00+01:00", /UTC timestamp/],
    ["impossible date", "fix\n\nArcadia-Agent: codex/standard\nArcadia-Action: arcadia/x\nArcadia-Heartbeat: 2026-02-31T00:00:00Z", /UTC timestamp/],
    ["malformed claim", "fix\n\nArcadia-Agent: codex/standard\nArcadia-Action: arcadia/x\nArcadia-Claim: bad gen!", /claim generation/],
    ["double space", "fix\n\nArcadia-Agent:  codex/standard\nArcadia-Action: arcadia/x", /exactly one space/],
    ["oversized message", `fix\n\n${"x".repeat(70_000)}\n\n${renderPeerWatchTrailers({ agent: codexStandard, action })}`, /exceeds 65536 bytes/]
  ])("rejects the whole set on %s", (_label, message, reason) => {
    const parsed = parsePeerWatchTrailers(message);
    expect(parsed.status).toBe("rejected");
    if (parsed.status === "rejected") expect(parsed.reasons.join("\n")).toMatch(reason);
  });
});

describe("issue-comment block grammar", () => {
  it("parses one rendered block and ignores comments without one", () => {
    const parsed = parsePeerWatchCommentBlock(`EVIDENCE / HANDOFF\n\n${block()}\n\nCody Mason <cody.mason@agents.arcadia.local>`);
    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") expect(parsed.block).toMatchObject({ agent: codexStandard, action, claimGeneration: GENERATION, state: "waiting", evidence: [`commit:${SHA("b")}`] });
    expect(parsePeerWatchCommentBlock("CLAIM REQUEST\n```text\nWork unit:\n```")).toEqual({ status: "absent" });
  });

  it("rejects two top-level blocks but ignores blocks quoted inside another fence or a blockquote", () => {
    expect(parsePeerWatchCommentBlock(`${block()}\n\n${block({ state: "working" })}`)).toMatchObject({ status: "rejected", reasons: [expect.stringMatching(/more than one/)] });
    expect(parsePeerWatchCommentBlock(`Quoting a peer:\n\n\`\`\`\`markdown\n${block()}\n\`\`\`\``)).toEqual({ status: "absent" });
    expect(parsePeerWatchCommentBlock(`> ${block().split("\n").join("\n> ")}`)).toEqual({ status: "absent" });
    const mixed = parsePeerWatchCommentBlock(`\`\`\`\`text\n${block({ state: "release_requested" })}\n\`\`\`\`\n\n${block()}`);
    expect(mixed.status).toBe("ok");
    if (mixed.status === "ok") expect(mixed.block.state).toBe("waiting");
  });

  it("ignores an unknown version and rejects malformed or spoofed blocks", () => {
    expect(parsePeerWatchCommentBlock(block().replace("arcadia-peer-watch-v1", "arcadia-peer-watch-v2"))).toEqual({ status: "unsupported_version", schema: "arcadia-peer-watch-v2" });
    for (const [body, reason] of [
      [block().replace("arcadia-peer-watch-v1", "something-else"), /unrecognized schema/],
      [block().replace("state: waiting", "state: waiting\nauthor: pmark (codex owner)"), /unknown field author/],
      [block().replace("state: waiting", "state: waiting\nstate: working"), /duplicate field state/],
      [block().replace("state: waiting", "state: released"), /unknown state/],
      [block().replace(/issued_at: .*/, "issued_at: yesterday"), /UTC timestamp/],
      [block().replace(/\n```$/, ""), /unterminated/],
      [block({ evidence: Array.from({ length: 9 }, (_, i) => `pr:${i + 1}`) }), /more than 8 evidence/],
      [block({ evidence: ["commit:abc"] }), /invalid evidence ref/],
      [block().replace("state: waiting", `state: waiting\n${"evidence: pr:1\n".repeat(20)}`), /exceeds 16 lines|duplicate field/],
      [block().replace("state: waiting", `state: waiting\nx${"y".repeat(2100)}`), /exceeds 2048 bytes/]
    ] as const) {
      const parsed = parsePeerWatchCommentBlock(body);
      expect(parsed.status, String(reason)).toBe("rejected");
      if (parsed.status === "rejected") expect(parsed.reasons.join("\n")).toMatch(reason);
    }
  });
});

describe("binding evidence to the governed claim", () => {
  const now = NOW.getTime();

  it("counts owner commits with or without trailers", () => {
    expect(bindCommitEvidence(commit(), expected, now)).toMatchObject({ counted: true, reason: "owner commit without contract trailers" });
    expect(bindCommitEvidence(commit({ message: trailered({ heartbeatAt: new Date(minutes(5)), claimGeneration: GENERATION }) }), expected, now)).toMatchObject({ counted: true, reason: "owner heartbeat commit" });
  });

  it("does not count forged, foreign, replayed or future commits", () => {
    const cases: Array<[Partial<CommitObservation>, RegExp]> = [
      [{ authorEmail: claudeEmail, committerEmail: claudeEmail, message: trailered() }, /different agent identity/],
      [{ authorEmail: "mark@martianrover.com", committerEmail: "mark@martianrover.com" }, /not authored by an agent identity/],
      [{ authorEmail: "controller@arcadia.local", committerEmail: "controller@arcadia.local" }, /not authored by an agent identity/],
      [{ authorEmail: agentIdentityEmail(agentIdentityName("codex", "standard", "critic")), committerEmail: agentIdentityEmail(agentIdentityName("codex", "standard", "critic")) }, /different agent identity/],
      [{ committerEmail: claudeEmail }, /different agent identity/],
      [{ message: trailered({ agent: { agent: "codex", tier: "heavy" } }) }, /disagrees with the commit author/],
      [{ branch: "codex/other" }, /candidate branch/],
      [{ committedAt: minutes(-30) }, /in the future/],
      [{ message: trailered({ heartbeatAt: new Date(minutes(400)) }) }, /replayed or forged/],
      [{ message: trailered({ claimGeneration: "wtres_000000000000000000" }) }, /different claim generation/],
      [{ message: `${trailered()}\nArcadia-Agent: codex/standard` }, /trailers rejected/],
      [{ sha: "abc123" }, /full commit sha/]
    ];
    for (const [overrides, reason] of cases) {
      const bound = bindCommitEvidence(commit(overrides), expected, now);
      expect(bound.counted, String(reason)).toBe(false);
      expect(bound.reason).toMatch(reason);
    }
  });

  it("binds comments to a trusted author, the current generation and server time, counting a replay once", () => {
    const comments = [
      comment(block(), { id: "c1" }),
      comment(block(), { id: "c2", createdAt: minutes(4) }),
      comment(block({ state: "working" }), { id: "c3", authorLogin: "mallory" }),
      comment(block({ state: "escalated" }), { id: "c4", updatedAt: minutes(1) }),
      comment(block({ claimGeneration: "wtres_000000000000000000", state: "working" }), { id: "c5" }),
      comment(block({ issuedAt: new Date(minutes(300)), state: "offer_help" }), { id: "c6" }),
      comment(block({ agent: { agent: "claude", tier: "heavy" }, state: "offer_help" }), { id: "c7" }),
      comment(block({ issuedAt: new Date(minutes(-30)), state: "working" }), { id: "c8", createdAt: minutes(-30) })
    ];
    const bound = Object.fromEntries(bindCommentEvidence(comments, expected, ["pmark"], now).map((entry) => [entry.ref, entry]));
    expect(bound["comment:c1"]).toMatchObject({ counted: true });
    expect(bound["comment:c2"]).toMatchObject({ counted: false, reason: "replay of an earlier block" });
    expect(bound["comment:c3"].reason).toMatch(/not a trusted poster/);
    expect(bound["comment:c4"].reason).toBe("edited comment");
    expect(bound["comment:c5"].reason).toMatch(/current claim generation/);
    expect(bound["comment:c6"].reason).toMatch(/replayed or forged/);
    expect(bound["comment:c7"].reason).toMatch(/different agent/);
    expect(bound["comment:c8"].reason).toMatch(/in the future/);
    expect(bindCommentEvidence([comment(block())], expected, [], now)[0].counted).toBe(false);
  });
});

describe("strict timestamps and branch names", () => {
  it("parses only zoned ISO 8601 instants and refuses impossible dates", () => {
    expect(parseIsoInstant("2026-10-04T13:00:00-07:00")).toBe(Date.parse("2026-10-04T20:00:00Z"));
    expect(parseIsoInstant("2026-10-04T20:00:00.123456789Z")).toBe(Date.parse("2026-10-04T20:00:00.123Z"));
    for (const bad of ["2026-02-31T00:00:00Z", "2026-10-04 20:00:00", "Sun Oct 4 2026", "2026-10-04T20:00:00", "2026-13-01T00:00:00Z", "1791144000000", ""]) expect(parseIsoInstant(bad), bad).toBeNull();
  });

  it("compares branches with or without refs/heads/ and refuses an unparseable commit date", () => {
    expect(bindCommitEvidence(commit({ branch: `refs/heads/${BRANCH}` }), expected, NOW.getTime()).counted).toBe(true);
    expect(bindCommitEvidence(commit(), { ...expected, branch: `refs/heads/${BRANCH}` }, NOW.getTime()).counted).toBe(true);
    expect(bindCommitEvidence(commit({ committedAt: "Sun Oct 4 20:55:00 2026 +0000" }), expected, NOW.getTime())).toMatchObject({ counted: false, reason: "commit time unreadable" });
  });
});

function expectNotReleased(result: PeerWatchClassification): void {
  expect(result.ownership.state).not.toBe("released");
  expect(result.ownership.state).not.toBe("principal_terminal");
  expect(result.takeover).toEqual({ eligible: false, basis: null });
  expect(result.permittedActions).not.toContain("continue_released_work");
  expect(buildTakeoverRequest(result, { agent: "claude", tier: "heavy" }).ok).toBe(false);
}

describe("peer classification", () => {
  it("classifies the 2026-10-03 enrollment collision as held, never released and never takeover-eligible", () => {
    // Coding turn ended to wait for root review, no process with its cwd in the
    // candidate, local head preserved, no PR, orchestrator still owning.
    const collision = (lastCommitMinutes: number) => input({
      ownership: ok(owned({ principal: { kind: "native-runtime", agent: "codex", id: "01a102a5-6230-79b0-b1a3-91042a032156" } })),
      commits: ok([commit({ committedAt: minutes(lastCommitMinutes) })]),
      nonProof: { codingTurnEnded: true, processInCandidate: false, localHeadPreserved: true, pullRequestOpen: false }
    });
    for (const [lastCommit, state] of [[45, "idle"], [180, "stalled"]] as const) {
      const result = classifyPeer(collision(lastCommit));
      expect(result.state).toBe(state);
      expect(result.ownership.state).toBe("held");
      expectNotReleased(result);
      expect(result.nonProof).toHaveLength(4);
      expect(result.nonProof.every((entry) => entry.provesRelease === false)).toBe(true);
    }
    expect(classifyPeer(collision(180)).escalation).toMatch(/explicit release|governed path/);
  });

  it("never infers release from an absent claim alone (B1)", () => {
    const cases: Array<[string, OwnershipObservation, "held" | "unknown"]> = [
      ["running Session", { claim: null, principal: { kind: "managed-session", session: session({ status: "running" }) }, releaseFacts: NO_OWNER }, "held"],
      ["prepared Session", { claim: null, principal: { kind: "managed-session", session: session({ status: "prepared" }) }, releaseFacts: NO_OWNER }, "held"],
      ["unknown principal", { claim: null, principal: { kind: "unknown" }, releaseFacts: NO_OWNER }, "unknown"],
      ["release facts not read", { claim: null, principal: { kind: "none" }, releaseFacts: null }, "unknown"],
      ["reservation without claim", { claim: null, principal: { kind: "none" }, releaseFacts: { ...NO_OWNER, reservation: true } }, "unknown"],
      ["live Session row elsewhere", { claim: null, principal: { kind: "none" }, releaseFacts: { ...NO_OWNER, liveSession: true } }, "unknown"],
      ["manual handoff", { claim: null, principal: { kind: "prepared", agent: "codex", id: "manual-handoff" }, releaseFacts: { ...NO_OWNER, manualHandoff: true } }, "held"],
      ["native principal", { claim: null, principal: { kind: "native-runtime", agent: "codex", id: "rt" }, releaseFacts: NO_OWNER }, "held"]
    ];
    for (const [label, ownership, expectedOwnership] of cases) {
      const result = classifyPeer(input({ ownership: ok(ownership) }));
      expect(result.ownership.state, label).toBe(expectedOwnership);
      expect(result.state, label).toBe("unknown");
      expectNotReleased(result);
      expect(result.permittedActions, label).toContain("escalate_to_operator");
    }
    const released = classifyPeer(input({ ownership: ok(releasedOwnership()) }));
    expect(released).toMatchObject({ state: "idle", ownership: { state: "released", releaseRef: "asksettle_released_1" }, takeover: { eligible: true, basis: "claim_released" } });
    // A managed Session principal without a claim never proves release, whatever its state.
    for (const [label, principalSession] of [
      ["completed and reconciled", session({ status: "completed", exitReceipt: exitReceipt({ outcome: "accepted_completion", leaseHandoff: false }) })],
      ["failed, unreconciled", session({ status: "failed", exitReceipt: null })],
      ["needs_input", session({ status: "needs_input", exitReceipt: exitReceipt({ outcome: "needs_input", leaseHandoff: false }) })],
      ["different agent", session({ agent: "claude", status: "completed", exitReceipt: exitReceipt() })],
      ["different branch", session({ status: "completed", branch: "codex/other", exitReceipt: exitReceipt() })]
    ] as const) {
      const result = classifyPeer(input({ ownership: ok({ claim: null, principal: { kind: "managed-session", session: principalSession }, releaseFacts: NO_OWNER }) }));
      expect(result.ownership.state, label).toBe("unknown");
      expectNotReleased(result);
    }
  });

  it("proves a principal terminal only for a real, unsuperseded incomplete_resumable lease handoff (B2)", () => {
    const terminal = classifyPeer(input({ ownership: ok(terminalOwnership()) }));
    expect(terminal).toMatchObject({ state: "idle", ownership: { state: "principal_terminal", sessionId: "sess_1", exitReceiptId: "exit_1" }, takeover: { eligible: true, basis: "principal_proven_terminal" }, permittedActions: ["observe", "continue_released_work"] });
    const cases: Array<[string, OwnershipObservation, RegExp]> = [
      ["unreconciled", owned({ principal: { kind: "managed-session", session: session({ status: "failed", lastActivityAt: minutes(500) }) } }), /arcadia session reconcile sess_1/],
      ["needs_input status", terminalOwnership({ status: "needs_input" }), /operator question/],
      ["needs_input outcome", terminalOwnership({}, { outcome: "needs_input", leaseHandoff: false }), /operator question/],
      ["failed_execution", terminalOwnership({}, { outcome: "failed_execution", leaseHandoff: false }), /failed_execution/],
      ["missing_evidence", terminalOwnership({}, { outcome: "missing_evidence", leaseHandoff: false }), /missing_evidence/],
      ["successful_exit", terminalOwnership({}, { outcome: "successful_exit", leaseHandoff: false }), /successful_exit/],
      ["accepted_completion", terminalOwnership({}, { outcome: "accepted_completion", leaseHandoff: false }), /accepted_completion/],
      ["resumable without lease handoff", terminalOwnership({}, { leaseHandoff: false }), /not a resumable lease handoff/],
      ["superseded", terminalOwnership({}, { supersededBySessionId: "sess_2" }), /superseded by sess_2/],
      ["simulated", terminalOwnership({}, { isSimulated: true }), /simulated/],
      ["other candidate", terminalOwnership({ worktreePath: "/w/other" }), /different candidate/]
    ];
    for (const [label, ownership, escalation] of cases) {
      const result = classifyPeer(input({ ownership: ok(ownership) }));
      expect(result.ownership.state, label).toBe("held");
      expectNotReleased(result);
      expect(result.escalation, label).toMatch(escalation);
      expect(result.permittedActions, label).toContain("escalate_to_operator");
    }
    // Fresh activity keeps it healthy, and the escalation still stands.
    const fresh = classifyPeer(input({ ownership: ok(terminalOwnership({}, { outcome: "failed_execution", leaseHandoff: false })), commits: ok([commit()]) }));
    expect(fresh).toMatchObject({ state: "healthy", permittedActions: ["observe", "escalate_to_operator"] });
  });

  it("checks the principal agent on every non-released state (B3)", () => {
    for (const ownership of [
      terminalOwnership({ agent: "claude" }),
      owned({ principal: { kind: "managed-session", session: session({ agent: "claude" }) } }),
      owned({ principal: { kind: "native-runtime", agent: "opencode", id: "rt" } }),
      owned({ principal: { kind: "native-runtime", agent: null, id: "rt" } }),
      owned({ principal: { kind: "unknown" } }),
      owned({ principal: { kind: "none" } }),
      { claim: null, principal: { kind: "managed-session", session: session({ agent: "claude", status: "running" }) }, releaseFacts: NO_OWNER } satisfies OwnershipObservation
    ]) {
      const result = classifyPeer(input({ ownership: ok(ownership), commits: ok([commit()]) }));
      expect(result.ownership.state).toBe("unknown");
      expect(result.state).toBe("unknown");
      expectNotReleased(result);
    }
    expect(classifyPeer(input({ ownership: ok(terminalOwnership({ agent: "claude" })) })).ownership.reason).toMatch(/held by claude/);
  });

  it("is healthy on fresh bound activity and carries the evidence with its age", () => {
    const result = classifyPeer(input({ commits: ok([commit({ message: trailered({ heartbeatAt: new Date(minutes(5)) }) })]) }));
    expect(result.state).toBe("healthy");
    expect(result.latestActivity).toMatchObject({ channel: "commits", ageMs: 5 * 60_000, counted: true });
    expect(result.permittedActions).toEqual(["observe"]);
    expect(classifyPeer(input({ comments: ok([comment(block())]) })).state).toBe("healthy");
  });

  it("does not count a stale heartbeat or a forged trailer as fresh activity", () => {
    const stale = classifyPeer(input({ commits: ok([commit({ committedAt: minutes(180), message: trailered({ heartbeatAt: new Date(minutes(180)) }) })]) }));
    expect(stale.state).toBe("stalled");
    expect(stale.latestActivity?.ageMs).toBe(180 * 60_000);
    const forged = classifyPeer(input({ commits: ok([commit({ authorEmail: claudeEmail, committerEmail: claudeEmail, message: trailered({ heartbeatAt: new Date(minutes(1)) }) })]) }));
    expect(forged.state).toBe("stalled");
    expect(forged.evidence.find((entry) => entry.channel === "commits")).toMatchObject({ counted: false });
    expect(forged.ownership.state).toBe("held");
    expect(forged.permittedActions).toEqual(["observe", "offer_help", "escalate_to_operator"]);
  });

  it("is exhausted only on fresh real capacity evidence of a limit, even over a fresh commit", () => {
    const spent = receipt({ windows: [{ label: "5h", usedPercentage: 100, remainingPercentage: 0, resetsAt: minutes(-90) }] });
    const exhausted = classifyPeer(input({ capacity: ok(spent), commits: ok([commit({ committedAt: minutes(0.5) })]) }));
    expect(exhausted.state).toBe("exhausted");
    expect(exhausted.latestActivity).toMatchObject({ channel: "commits", ageMs: 30_000 });
    expect(exhausted.ownership.state).toBe("held");
    expect(exhausted.takeover.eligible).toBe(false);
    expect(exhausted.permittedActions).toContain("escalate_to_operator");
    expect(exhausted.evidence.find((entry) => entry.channel === "capacity")).toMatchObject({ counted: true, ageMs: 120_000 });
    expect(classifyPeer(input({ capacity: ok(receipt({ availability: "usage_limited" })) })).state).toBe("exhausted");
    const simulated = classifyPeer(input({ capacity: ok(receipt({ ...spent, evidence: "simulated" })), commits: ok([commit()]) }));
    expect(simulated.state).toBe("healthy");
    expect(simulated.evidence.find((entry) => entry.channel === "capacity")).toMatchObject({ counted: false, reason: expect.stringMatching(/simulated, never live proof/) });
    // Stale, elapsed-reset, unknown or another provider's evidence cannot show exhaustion.
    for (const capacity of [
      receipt({ ...spent, observedAt: minutes(30), freshness: "stale" }),
      receipt({ ...spent, observedAt: minutes(30) }),
      receipt({ windows: [{ label: "5h", usedPercentage: 100, remainingPercentage: 0, resetsAt: minutes(1) }] }),
      receipt({ ...spent, source: "none", confidence: "unknown" }),
      receipt({ ...spent, source: "operator_config" }),
      receipt({ ...spent, providerId: "claude-code-cli" })
    ]) expect(classifyPeer(input({ capacity: ok(capacity), commits: ok([commit()]) })).state).toBe("healthy");
  });

  it("is unknown when ownership or a channel needed to prove silence is unreadable", () => {
    expect(classifyPeer(input({ ownership: { readable: false, reason: "database locked" } }))).toMatchObject({ state: "unknown", ownership: { state: "unknown" }, permittedActions: ["observe", "escalate_to_operator"] });
    const comments = classifyPeer(input({ comments: { readable: false, reason: "rate limited" } }));
    expect(comments.state).toBe("unknown");
    expect(comments.unreadable).toEqual(["issue_comments"]);
    expect(classifyPeer(input({ capacity: { readable: false, reason: "telemetry missing" } })).state).toBe("unknown");
    // Positive fresh evidence on a readable channel still shows health.
    expect(classifyPeer(input({ comments: { readable: false, reason: "rate limited" }, commits: ok([commit()]) })).state).toBe("healthy");
  });
});

describe("takeover requests (I1, I3)", () => {
  const later = (ms: number): Date => new Date(NOW.getTime() + ms);
  const context = (overrides: Partial<Parameters<typeof validateTakeoverRequest>[2]> = {}) => ({ now: later(60_000), pointer: POINTER, ...overrides });
  const releasedNow = (at = later(30_000), facts: ReleaseFacts = NO_OWNER) => classifyPeer(input({ now: at, ownership: ok({ ...releasedOwnership(), releaseFacts: facts }) }));
  function built(): PeerTakeoverRequest {
    const request = buildTakeoverRequest(classifyPeer(input({ ownership: ok(releasedOwnership()) })), { agent: "opencode", tier: "standard" });
    if (!request.ok) throw new Error(request.reasons.join("; "));
    return request.request;
  }

  it("names the preview and --apply forms of the governed recovery and the target Action", () => {
    const request = built();
    expect(request.recovery).toEqual({ preview: "arcadia go --agent opencode", apply: "arcadia go --agent opencode --apply" });
    expect(request.target).toEqual(POINTER);
    expect(request.proof.releaseRef).toBe("asksettle_released_1");
    expect(validateTakeoverRequest(request, releasedNow(), context())).toMatchObject({ ok: true });
    const terminal = buildTakeoverRequest(classifyPeer(input({ ownership: ok(terminalOwnership()) })), { agent: "claude", tier: "heavy" });
    expect(terminal.ok).toBe(true);
    if (terminal.ok) expect(validateTakeoverRequest(terminal.request, classifyPeer(input({ now: later(10_000), ownership: ok(terminalOwnership()) })), context())).toMatchObject({ ok: true });
  });

  it("refuses a request whose recovery, requester, pointer, fence or timing does not hold", () => {
    const request = built();
    const refusals: Array<[string, unknown, PeerWatchClassification, ReturnType<typeof context>, RegExp]> = [
      ["forged recovery", { ...request, recovery: { preview: "arcadia go --agent opencode", apply: "rm -rf ~" } }, releasedNow(), context(), /governed command/],
      ["requester swapped", { ...request, requester: { agent: "codex", tier: "heavy" } }, releasedNow(), context(), /governed command/],
      ["unsupported requester", { ...request, requester: { agent: "gemini", tier: "heavy" } }, releasedNow(), context(), /supported agent/],
      ["pointer moved", request, releasedNow(), context({ pointer: { project: "arcadia", actionId: "implement-agent-peer-watch-reader" } }), /pointer does not name/],
      ["pointer unreadable", request, releasedNow(), context({ pointer: null }), /pointer does not name/],
      ["target differs", { ...request, target: { project: "arcadia", actionId: "other-action" } }, releasedNow(), context(), /target Action differs/],
      ["re-claimed", request, classifyPeer(input({ now: later(30_000), commits: ok([commit()]) })), context(), /ownership is now held/],
      ["re-claimed and re-released", request, releasedNow(later(30_000), { ...NO_OWNER, releaseRef: "asksettle_released_2" }), context(), /release identity changed/],
      ["stale current", request, releasedNow(new Date("2020-01-01T00:00:00Z")), context(), /older than the request|not fresh/],
      ["current older than request", request, releasedNow(new Date(NOW.getTime() - 1000)), context(), /older than the request/],
      ["request too old", request, releasedNow(later(PEER_WATCH_WINDOWS.takeoverMaxAgeMs + 30_000)), context({ now: later(PEER_WATCH_WINDOWS.takeoverMaxAgeMs + 60_000) }), /request is not fresh/]
    ];
    for (const [label, candidate, current, ctx, reason] of refusals) {
      const decision = validateTakeoverRequest(candidate, current, ctx);
      expect(decision.ok, label).toBe(false);
      if (!decision.ok) expect(decision.reasons.join("\n"), label).toMatch(reason);
    }
  });

  it("refuses malformed input instead of throwing", () => {
    for (const malformed of [{}, null, "request", [], { ...built(), proof: null }, { ...built(), observed: { classifiedAt: 1 } }, { ...built(), basis: "silence" }]) {
      const decision = validateTakeoverRequest(malformed, releasedNow(), context());
      expect(decision.ok).toBe(false);
    }
  });

  it("never makes a release without a release reference takeover-eligible", () => {
    const unref = classifyPeer(input({ ownership: ok({ ...releasedOwnership(), releaseFacts: { ...NO_OWNER, releaseRef: null } }) }));
    expect(unref).toMatchObject({ state: "idle", ownership: { state: "released", releaseRef: null }, takeover: { eligible: false, basis: null }, permittedActions: ["observe", "escalate_to_operator"] });
    expect(buildTakeoverRequest(unref, { agent: "codex", tier: "standard" }).ok).toBe(false);
    const request = built();
    expect(validateTakeoverRequest(request, releasedNow(later(30_000), { ...NO_OWNER, releaseRef: null }), context()).ok).toBe(false);
  });

  it("refuses an invalid validation clock or classification times, and returns a normalized copy", () => {
    const stale = { ...built(), observed: { ...built().observed, classifiedAt: "2020-01-01T00:00:00Z" } };
    const staleCurrent = { ...releasedNow(), classifiedAt: "2020-01-01T00:00:00Z" };
    for (const now of [new Date(Number.NaN), "2026-10-04T21:00:00Z" as unknown as Date, undefined as unknown as Date]) {
      expect(validateTakeoverRequest(stale, staleCurrent, { now, pointer: POINTER })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/clock/)] });
    }
    expect(validateTakeoverRequest({ ...built(), observed: { ...built().observed, classifiedAt: "not a time" } }, releasedNow(), context()).ok).toBe(false);
    expect(validateTakeoverRequest(built(), { ...releasedNow(), classifiedAt: "" }, context()).ok).toBe(false);
    const extras = { ...built(), evil: 1, requester: { ...built().requester, extra: 1 }, observed: { ...built().observed, state: "healthy", evidenceRefs: ["commit:x", 1, {}] } };
    const decision = validateTakeoverRequest(extras, releasedNow(), context());
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.request).not.toBe(extras);
      expect(decision.request).not.toHaveProperty("evil");
      expect(decision.request.requester).toEqual({ agent: "opencode", tier: "standard" });
      expect(decision.request.observed).toMatchObject({ state: "idle", evidenceRefs: ["commit:x"] });
    }
  });
});

/**
 * Real fixtures for every classification-table row, including the review
 * probes, so the published table is the behaviour and cannot drift.
 */
type TableFixture = { label: string; input: PeerWatchInput; actions: string[] | null };
const fx = (label: string, overrides: Partial<PeerWatchInput>, actions: string[] | null): TableFixture => ({ label, input: input(overrides), actions });
const ESCALATE = ["observe", "escalate_to_operator"];
const CONTINUE = ["observe", "continue_released_work"];
const raw = (value: unknown): PeerWatchInput["ownership"] => ({ readable: true, value }) as unknown as PeerWatchInput["ownership"];
const TABLE_FIXTURES: Record<(typeof PEER_WATCH_CLASSIFICATION_TABLE)[number]["id"], TableFixture[]> = {
  "ownership-unreadable": [
    fx("rows unreadable", { ownership: { readable: false, reason: "locked" } }, ESCALATE),
    fx("releaseFacts {}", { ownership: raw({ claim: null, principal: { kind: "none" }, releaseFacts: {} }) }, ESCALATE),
    fx("claim undefined", { ownership: raw({ claim: undefined, principal: { kind: "none" }, releaseFacts: NO_OWNER }) }, ESCALATE),
    fx("principal without kind", { ownership: raw({ claim: null, principal: {}, releaseFacts: NO_OWNER }) }, ESCALATE),
    fx("receipt missing isSimulated", { ownership: raw(owned({ principal: { kind: "managed-session", session: { ...session({ status: "completed" }), exitReceipt: { id: "x", outcome: "incomplete_resumable", leaseHandoff: true, supersededBySessionId: null } as unknown as ExitReceiptObservation } } })) }, ESCALATE),
    fx("receipt leaseHandoff 1", { ownership: raw(terminalOwnership({}, { leaseHandoff: 1 as unknown as boolean })) }, ESCALATE),
    fx("receipt superseded ''", { ownership: raw(terminalOwnership({}, { supersededBySessionId: "" })) }, ESCALATE),
    fx("Session status queued", { ownership: raw(terminalOwnership({ status: "queued" as SessionObservation["status"] })) }, ESCALATE)
  ],
  "principal-mismatch": [
    fx("running claude Session for codex", { ownership: ok(owned({ principal: { kind: "managed-session", session: session({ agent: "claude" }) } })) }, ESCALATE),
    fx("terminal claude Session for codex", { ownership: ok(terminalOwnership({ agent: "claude" })) }, ESCALATE),
    fx("native principal with no agent", { ownership: ok(owned({ principal: { kind: "native-runtime", agent: null, id: "rt" } })) }, ESCALATE),
    fx("no claim, prepared principal of another agent", { ownership: ok({ claim: null, principal: { kind: "prepared", agent: "opencode", id: "h" }, releaseFacts: NO_OWNER }) }, ESCALATE),
    fx("no claim, reservation without a principal", { ownership: ok({ claim: null, principal: { kind: "none" }, releaseFacts: { ...NO_OWNER, reservation: true } }) }, ESCALATE)
  ],
  "no-claim-unaffirmed": [
    fx("facts not read", { ownership: ok({ claim: null, principal: { kind: "none" }, releaseFacts: null }) }, ESCALATE),
    fx("principal unknown", { ownership: ok({ claim: null, principal: { kind: "unknown" }, releaseFacts: NO_OWNER }) }, ESCALATE),
    fx("terminal Session principal", { ownership: ok({ claim: null, principal: { kind: "managed-session", session: session({ status: "failed", exitReceipt: null }) }, releaseFacts: NO_OWNER }) }, ESCALATE)
  ],
  "no-claim-owner-exists": [
    fx("running Session", { ownership: ok({ claim: null, principal: { kind: "managed-session", session: session() }, releaseFacts: NO_OWNER }) }, ESCALATE),
    fx("manual handoff", { ownership: ok({ claim: null, principal: { kind: "prepared", agent: "codex", id: "manual" }, releaseFacts: { ...NO_OWNER, manualHandoff: true } }) }, ESCALATE)
  ],
  released: [fx("affirmed release", { ownership: ok(releasedOwnership()) }, CONTINUE)],
  "released-unreferenced": [fx("no release reference", { ownership: ok({ ...releasedOwnership(), releaseFacts: { ...NO_OWNER, releaseRef: null } }) }, ESCALATE)],
  "principal-terminal": [
    fx("resumable handoff", { ownership: ok(terminalOwnership()) }, CONTINUE),
    fx("resumable handoff, refs/heads/ claim branch", { ownership: ok({ ...terminalOwnership(), claim: claim({ branch: `refs/heads/${BRANCH}` }) }) }, CONTINUE)
  ],
  "exited-not-resumable": [
    fx("missing_evidence", { ownership: ok(terminalOwnership({}, { outcome: "missing_evidence", leaseHandoff: false })), commits: ok([commit({ committedAt: minutes(60) })]) }, null),
    fx("terminal beside an affirmed live Session", { ownership: ok({ ...terminalOwnership(), releaseFacts: { ...NO_OWNER, liveSession: true } }) }, null),
    fx("terminal beside an affirmed manual handoff", { ownership: ok({ ...terminalOwnership(), releaseFacts: { ...NO_OWNER, manualHandoff: true } }) }, null)
  ],
  exhausted: [fx("budget limited", { capacity: ok(receipt({ availability: "budget_limited" })) }, ["observe", "offer_help", "escalate_to_operator"])],
  healthy: [fx("fresh commit", { commits: ok([commit()]) }, ["observe"])],
  idle: [fx("quiet hour", { commits: ok([commit({ committedAt: minutes(60) })]) }, ["observe", "offer_help"])],
  "silence-unproven": [fx("commits unreadable", { commits: { readable: false, reason: "git unavailable" } }, ESCALATE)],
  stalled: [fx("silent", {}, ["observe", "offer_help", "escalate_to_operator"])]
};

describe("fail-closed input", () => {
  it("classifies an invalid clock or subject as unknown without throwing", () => {
    for (const now of [new Date(Number.NaN), "2026-10-04T21:00:00Z", undefined]) {
      const result = classifyPeer({ ...input({ ownership: ok(releasedOwnership()) }), now: now as unknown as Date });
      expect(result).toMatchObject({ state: "unknown", ownership: { state: "unknown" }, takeover: { eligible: false } });
    }
    expect(classifyPeer({ ...input(), subject: { agent: "gemini", project: "arcadia", actionId: "x" } as unknown as PeerWatchInput["subject"] }).state).toBe("unknown");
    expect(classifyPeer({ ...input(), commits: { readable: true, value: [{ sha: 1 }] } as unknown as PeerWatchInput["commits"] }).state).toBe("unknown");
    expect(classifyPeer(null as unknown as PeerWatchInput).state).toBe("unknown");
  });

  it("never grants takeover when any ownership field is missing, mistyped or outside its value set", () => {
    const generic = [undefined, null, "", 0, 1, Number.NaN, "true"];
    const without = (values: unknown[], ...drop: unknown[]) => values.filter((value) => !drop.some((d) => Object.is(d, value)));
    // [path, values that must fail closed]; values valid for a field (null where nullable, "true" for a free id) are excluded.
    const terminalFields: Array<[string[], unknown[]]> = [
      [["claim"], without(generic, null)], [["principal"], generic], [["releaseFacts"], without(generic, null)],
      ...["reservationId", "generation"].map((key): [string[], unknown[]] => [["claim", key], without(generic, "true")]),
      ...["project", "actionId", "branch", "worktreePath", "createdAt"].map((key): [string[], unknown[]] => [["claim", key], generic]),
      [["principal", "kind"], generic], [["principal", "session"], generic],
      [["principal", "session", "id"], without(generic, "true")],
      ...["agent", "status", "branch", "worktreePath"].map((key): [string[], unknown[]] => [["principal", "session", key], generic]),
      ...["startedAt", "lastActivityAt", "stallFlaggedAt"].map((key): [string[], unknown[]] => [["principal", "session", key], without(generic, null)]),
      [["principal", "session", "exitReceipt"], without(generic, null)],
      [["principal", "session", "exitReceipt", "id"], without(generic, "true")],
      ...["outcome", "leaseHandoff", "isSimulated"].map((key): [string[], unknown[]] => [["principal", "session", "exitReceipt", key], generic]),
      [["principal", "session", "exitReceipt", "supersededBySessionId"], without(generic, null, "true")]
    ];
    const releasedFields: Array<[string[], unknown[]]> = [
      [["claim"], without(generic, null)], [["principal"], generic], [["principal", "kind"], generic], [["releaseFacts"], generic],
      ...["liveSession", "reservation", "manualHandoff"].map((key): [string[], unknown[]] => [["releaseFacts", key], generic]),
      [["releaseFacts", "releaseRef"], without(generic, "true")]
    ];
    const set = (target: Record<string, unknown>, keys: string[], value: unknown): Record<string, unknown> => {
      const copy = structuredClone(target);
      let node: Record<string, unknown> = copy;
      for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
      if (value === undefined) delete node[keys.at(-1)!]; else node[keys.at(-1)!] = value;
      return copy;
    };
    let checked = 0;
    for (const [base, fields] of [[terminalOwnership(), terminalFields], [releasedOwnership(), releasedFields]] as const) {
      expect(classifyPeer(input({ ownership: ok(base) })).takeover.eligible).toBe(true);
      for (const [keys, values] of fields) for (const value of values) {
        const result = classifyPeer(input({ ownership: raw(set(base as unknown as Record<string, unknown>, keys, value)) }));
        expect(result.takeover.eligible, `${keys.join(".")} = ${String(value)}`).toBe(false);
        expect(result.ownership.state, `${keys.join(".")} = ${String(value)}`).not.toBe("principal_terminal");
        if (result.ownership.state === "released") expect(result.ownership.releaseRef, `${keys.join(".")} = ${String(value)}`).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("takeover eligibility exhaustive sweep", () => {
  it("grants takeover only under the full release or Decision 0051 conditions across every principal, receipt and fact combination", () => {
    const claims: Array<ClaimObservation | null> = [null, claim(), claim({ branch: `refs/heads/${BRANCH}` }), claim({ worktreePath: "/w/other" })];
    const agents = ["codex", "claude", "opencode", null, undefined];
    const statuses = ["prepared", "running", "completed", "failed", "needs_input"];
    const outcomes = ["successful_exit", "failed_execution", "missing_evidence", "needs_input", "incomplete_resumable", "accepted_completion"];
    const receipts: unknown[] = [null];
    for (const outcome of outcomes) for (const leaseHandoff of [true, false]) for (const supersededBySessionId of [null, "sess_2"]) for (const isSimulated of [true, false]) receipts.push({ id: "e", outcome, leaseHandoff, supersededBySessionId, isSimulated });
    const principals: Array<Record<string, unknown>> = [{ kind: "none" }, { kind: "unknown" }];
    for (const agent of agents) {
      principals.push({ kind: "native-runtime", agent, id: null }, { kind: "prepared", agent, id: "x" });
      for (const status of statuses) for (const exit of receipts) for (const branch of [BRANCH, "codex/other"]) for (const worktreePath of ["/w/enroll", "/w/other"]) {
        principals.push({ kind: "managed-session", session: { ...session({ status: status as SessionObservation["status"], branch, worktreePath }), agent, exitReceipt: exit } });
      }
    }
    const facts: Array<ReleaseFacts | null> = [null];
    for (const liveSession of [true, false]) for (const reservation of [true, false]) for (const manualHandoff of [true, false]) for (const releaseRef of [null, "rel_1"]) facts.push({ liveSession, reservation, manualHandoff, releaseRef });
    let eligible = 0;
    for (const c of claims) for (const principal of principals) for (const releaseFacts of facts) {
      const result = classifyPeer(input({ ownership: raw({ claim: c, principal, releaseFacts }) }));
      if (!result.takeover.eligible) continue;
      eligible++;
      const s = principal.kind === "managed-session" ? principal.session as Record<string, unknown> : null;
      const exit = s?.exitReceipt as Record<string, unknown> | null | undefined;
      if (result.ownership.state === "released") {
        expect(c).toBeNull();
        expect(principal.kind).toBe("none");
        expect(releaseFacts).toMatchObject({ liveSession: false, reservation: false, manualHandoff: false, releaseRef: "rel_1" });
      } else {
        expect(result.ownership.state).toBe("principal_terminal");
        expect(c).not.toBeNull();
        expect(s).toMatchObject({ agent: "codex", branch: BRANCH, worktreePath: c!.worktreePath });
        expect(["completed", "failed", "needs_input"]).toContain(s!.status);
        expect(s!.status).not.toBe("needs_input");
        expect(exit).toMatchObject({ outcome: "incomplete_resumable", leaseHandoff: true, supersededBySessionId: null, isSimulated: false });
        expect(releaseFacts?.liveSession === true || releaseFacts?.manualHandoff === true).toBe(false);
      }
    }
    expect(eligible).toBeGreaterThan(0);
  });
});

describe("procedure and code agree", () => {
  const doc = readFileSync(path.join(root, "docs/agent-guidance/agent-peer-watch.md"), "utf8");

  it("states the same freshness windows as the code", () => {
    const stated = Object.fromEntries([...doc.matchAll(/^\| `(\w+Ms)` \| (\d+) \|/gm)].map((match) => [match[1], Number(match[2])]));
    expect(stated).toEqual({ ...PEER_WATCH_WINDOWS });
  });

  it("publishes the code's classification table, and every row is the behaviour of a fixture", () => {
    const section = doc.slice(doc.indexOf("| Evidence | State | Ownership | Watcher may |"));
    const rows = [...section.matchAll(/^\| (.+) \| (.+) \| (.+) \| (.+) \|$/gm)].slice(1, 1 + PEER_WATCH_CLASSIFICATION_TABLE.length)
      .map((match) => ({ evidence: match[1], state: match[2], ownership: match[3], watcher: match[4] }));
    expect(rows).toEqual(PEER_WATCH_CLASSIFICATION_TABLE.map(({ evidence, state, ownership, watcher }) => ({ evidence, state, ownership, watcher })));
    for (const row of PEER_WATCH_CLASSIFICATION_TABLE) {
      expect(TABLE_FIXTURES[row.id].length, row.id).toBeGreaterThan(0);
      for (const fixture of TABLE_FIXTURES[row.id]) {
        const label = `${row.id}: ${fixture.label}`;
        const result = classifyPeer(fixture.input);
        if (row.state !== "by activity") expect(result.state, label).toBe(row.state);
        expect(result.ownership.state, label).toBe(row.ownership);
        if (fixture.actions) expect(result.permittedActions, label).toEqual(fixture.actions);
        else expect(result.permittedActions, label).toContain("escalate_to_operator");
        expect(result.takeover.eligible, label).toBe(row.id === "released" || row.id === "principal-terminal");
      }
    }
  });

  it("states the same per-agent channel table as the code, backed by repository facts", () => {
    const labels = { "Claude Code": "claude", Codex: "codex", OpenCode: "opencode" } as const;
    const rows = Object.fromEntries([...doc.matchAll(/^\| (Claude Code|Codex|OpenCode) \| (.+) \|$/gm)].map((match) => {
      const [identityCommits, contractTrailersToday, issueComments, sessionRows, capacityTelemetry] = match[2].split(" | ");
      return [labels[match[1] as keyof typeof labels], { identityCommits, contractTrailersToday, issueComments, sessionRows, capacityTelemetry }];
    }));
    expect(rows).toEqual(AGENT_CHANNEL_SUPPORT);
    for (const agent of ["claude", "codex", "opencode"] as const) {
      // Session rows: each provider id launches through a Session adapter for that agent.
      expect(sessionAgentForProvider(PEER_WATCH_PROVIDER_IDS[agent]), agent).toBe(agent);
      // Capacity: given an observation, only a provider with a host telemetry source maps to one.
      const providerId = PEER_WATCH_PROVIDER_IDS[agent];
      const record = { provider: providerId, providerId, profiles: [], availability: "available" as const, observedTasks: 0, usageLimitedTasks: 0, budgetLimitedTasks: 0, remainingTokens: null, resetAt: null, context: null, rateLimits: [{ label: "5h", usedPercentage: 10, resetsAt: minutes(-60) }], credits: null, bankedResets: [], planScope: null, capturedAt: minutes(1), telemetry: "fixture" };
      const source = buildProviderCapacityReceipt({ providerId, profiles: [], record, now: NOW }).source;
      expect(source === "none" ? "no" : "yes", agent).toBe(AGENT_CHANNEL_SUPPORT[agent].capacityTelemetry);
    }
    // No source file emits the contract trailers yet.
    const emitters = ["src/sessions/index.ts", "src/sessions/candidatePreservation.ts", "src/sessions/launch.ts"].filter((file) => readFileSync(path.join(root, file), "utf8").includes("Arcadia-Heartbeat"));
    expect(emitters).toEqual([]);
  });

  it("is registered in the guidance index with a current fingerprint and states the release rule in prose and code", () => {
    const entry = guidanceEntries(readFileSync(path.join(root, GUIDANCE_INDEX), "utf8")).find((candidate) => candidate.id === "agent-peer-watch");
    expect(entry?.path).toBe("docs/agent-guidance/agent-peer-watch.md");
    expect(entry?.sha256).toBe(guidanceFingerprint(doc));
    expect(doc).toContain("**None of these proves that ownership was released:**");
    for (const phrase of ["a coding turn ending", "no process running inside the candidate", "a preserved local head", "silence on any channel"]) expect(doc).toContain(phrase);
    const code = readFileSync(path.join(root, "src/agentWatch/classify.ts"), "utf8");
    expect(code).toContain("a coding turn ending, a missing\n * process, a preserved local head, an absent pull request, or silence is never\n * proof that ownership was released.");
  });
});
