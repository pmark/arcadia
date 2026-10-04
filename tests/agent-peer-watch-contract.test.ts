import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CHANNEL_SUPPORT,
  PEER_WATCH_WINDOWS,
  bindCommentEvidence,
  bindCommitEvidence,
  builderIdentityEmail,
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
  buildTakeoverRequest,
  classifyPeer,
  validateTakeoverRequest,
  type ClaimObservation,
  type PeerWatchInput,
  type SessionObservation
} from "../src/agentWatch/classify.js";
import type { ProviderCapacityReceipt } from "../src/codingAgents/capacity.js";
import { agentIdentityEmail, agentIdentityName } from "../src/codingAgents/agentIdentity.js";
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
    evidence: "simulated", unattended: true, observedAt: minutes(2), observedAgeMs: 120_000, expiresAt: null, confidence: "observed",
    freshness: "fresh", usagePolicy: "included", usagePolicyReason: "plan", windows: [{ label: "5h", usedPercentage: 40, remainingPercentage: 60, resetsAt: minutes(-60) }],
    nextResetAt: minutes(-60), credits: null, bankedResets: [], planScope: null, unsupported: [], availability: "available", telemetry: "fixture",
    ...overrides
  };
}
const ok = <T>(value: T) => ({ readable: true as const, value });
function input(overrides: Partial<PeerWatchInput> = {}): PeerWatchInput {
  return {
    now: NOW, subject: { agent: "codex", ...action },
    ownership: ok({ claim: claim(), principal: { kind: "managed-session", session: session() } }),
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

describe("peer classification", () => {
  it("classifies the 2026-10-03 enrollment collision as held, never released and never takeover-eligible", () => {
    // Coding turn ended to wait for root review, no process with its cwd in the
    // candidate, local head preserved, no PR, orchestrator still owning.
    const collision = (lastCommitMinutes: number) => input({
      ownership: ok({ claim: claim(), principal: { kind: "native-runtime", agent: "codex", id: "01a102a5-6230-79b0-b1a3-91042a032156" } }),
      commits: ok([commit({ committedAt: minutes(lastCommitMinutes) })]),
      nonProof: { codingTurnEnded: true, processInCandidate: false, localHeadPreserved: true, pullRequestOpen: false }
    });
    for (const [lastCommit, state] of [[45, "idle"], [180, "stalled"]] as const) {
      const result = classifyPeer(collision(lastCommit));
      expect(result.state).toBe(state);
      expect(result.ownership.state).toBe("held");
      expect(result.takeover).toEqual({ eligible: false, basis: null, recovery: null });
      expect(result.permittedActions).not.toContain("continue_released_work");
      expect(result.nonProof).toHaveLength(4);
      expect(result.nonProof.every((entry) => entry.provesRelease === false)).toBe(true);
      const refused = buildTakeoverRequest(result, { agent: "claude", tier: "heavy" });
      expect(refused.ok).toBe(false);
    }
    expect(classifyPeer(collision(180)).escalation).toMatch(/explicit release|governed path/);
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

  it("is exhausted only on fresh capacity evidence of a limit", () => {
    const spent = receipt({ windows: [{ label: "5h", usedPercentage: 100, remainingPercentage: 0, resetsAt: minutes(-90) }] });
    const exhausted = classifyPeer(input({ capacity: ok(spent), commits: ok([commit()]) }));
    expect(exhausted.state).toBe("exhausted");
    expect(exhausted.ownership.state).toBe("held");
    expect(exhausted.takeover.eligible).toBe(false);
    expect(exhausted.permittedActions).toContain("escalate_to_operator");
    expect(exhausted.evidence.find((entry) => entry.channel === "capacity")).toMatchObject({ counted: true, ageMs: 120_000 });
    expect(classifyPeer(input({ capacity: ok(receipt({ availability: "usage_limited" })) })).state).toBe("exhausted");
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
    expect(classifyPeer(input({ ownership: ok({ claim: claim(), principal: { kind: "unknown" } }) })).state).toBe("unknown");
    expect(classifyPeer(input({ ownership: ok({ claim: claim(), principal: { kind: "managed-session", session: session({ agent: "claude" }) } }) })).reason).toMatch(/held by claude/);
  });

  it("only governed release or a reconciled terminal Session makes work continuable, revalidated on the claim fence", () => {
    const released = classifyPeer(input({ ownership: ok({ claim: null, principal: { kind: "unknown" } }) }));
    expect(released).toMatchObject({ state: "idle", ownership: { state: "released" }, takeover: { eligible: true, basis: "claim_released" } });
    const request = buildTakeoverRequest(released, { agent: "opencode", tier: "standard" });
    expect(request.ok).toBe(true);
    if (request.ok) {
      expect(request.request.recovery).toBe("arcadia go --agent opencode");
      expect(validateTakeoverRequest(request.request, released).ok).toBe(true);
      const reclaimed = classifyPeer(input({ commits: ok([commit()]) }));
      expect(validateTakeoverRequest(request.request, reclaimed)).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/ownership is now held/), expect.stringMatching(/claim generation moved/)]) });
    }

    const terminal = classifyPeer(input({ ownership: ok({ claim: claim(), principal: { kind: "managed-session", session: session({ status: "needs_input", exitReceipt: { id: "exit_1", outcome: "incomplete_resumable" } }) } }) }));
    expect(terminal).toMatchObject({ state: "idle", ownership: { state: "principal_terminal", sessionId: "sess_1" }, takeover: { eligible: true, basis: "principal_proven_terminal" } });
    expect(terminal.permittedActions).toEqual(["observe", "continue_released_work"]);

    const exited = classifyPeer(input({ ownership: ok({ claim: claim(), principal: { kind: "managed-session", session: session({ status: "failed", lastActivityAt: minutes(500) }) } }) }));
    expect(exited).toMatchObject({ state: "stalled", ownership: { state: "held" }, takeover: { eligible: false } });
    expect(exited.escalation).toContain("arcadia session reconcile sess_1");
    const elsewhere = classifyPeer(input({ ownership: ok({ claim: claim(), principal: { kind: "managed-session", session: session({ status: "completed", worktreePath: "/w/other", exitReceipt: { id: "exit_2", outcome: "successful_exit" } }) } }) }));
    expect(elsewhere.ownership.state).toBe("held");
  });
});

describe("procedure and code agree", () => {
  const doc = readFileSync(path.join(root, "docs/agent-guidance/agent-peer-watch.md"), "utf8");

  it("states the same freshness windows as the code", () => {
    const stated = Object.fromEntries([...doc.matchAll(/^\| `(\w+Ms)` \| (\d+) \|/gm)].map((match) => [match[1], Number(match[2])]));
    expect(stated).toEqual({ ...PEER_WATCH_WINDOWS });
  });

  it("states the same per-agent channel table as the code", () => {
    const labels = { "Claude Code": "claude", Codex: "codex", OpenCode: "opencode" } as const;
    const rows = Object.fromEntries([...doc.matchAll(/^\| (Claude Code|Codex|OpenCode) \| (.+) \|$/gm)].map((match) => {
      const [identityCommits, contractTrailersToday, issueComments, sessionRows, capacityTelemetry] = match[2].split(" | ");
      return [labels[match[1] as keyof typeof labels], { identityCommits, contractTrailersToday, issueComments, sessionRows, capacityTelemetry }];
    }));
    expect(rows).toEqual(AGENT_CHANNEL_SUPPORT);
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
