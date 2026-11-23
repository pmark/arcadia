import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
import { candidateChangeGate } from "../src/production/candidateChangeGate.js";
import { answeredDecisionIds, deriveActionsAndOperatorItem, deriveStartCard, type DerivePlanAction } from "../src/operatorActions/startRunDerive.js";
import { checkReplayReceipt, predictOutcomes, replayCardIdentity, buildReplayReceipt, type ReplayReceipt } from "../src/operatorActions/startRunReplayReceipt.js";
import { startRunActivationScope, startRunScopeFingerprint } from "../src/operatorActions/startRunScope.js";
import type { StartRunPins } from "../src/operatorActions/startRunPins.js";

/** Replay bound to the derived card, and operator-needing Actions kept out of it. */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = () => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-replay-binding-"))); directories.push(dir); return dir; };

const PINS: StartRunPins = {
  schema: "arcadia-start-run-v1", reviewedRevision: "a".repeat(40), executorSha256: "e".repeat(64), workspace: "martianrover", project: "arcadia", plan: "fixture-plan",
  actions: ["one", "two"], provider: "claude-code-cli", transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24,
  intent: "Fixture START intent.", spendDecision: "0130", integrationDecision: "0058", requiredDecisions: ["0130"], requiredFiles: ["scripts/start-run.sh"],
  production: { revision: 12, epoch: 3 }, queueRevision: 40, workerLabel: "com.arcadia.local.1.worker", gateCardId: "gate", offId: "off", grantedBy: "Rowan", consumedHistory: []
} as unknown as StartRunPins;
const descriptorBytes = `${JSON.stringify({ id: "standing-start-fixture", kind: "grant", startRun: PINS }, null, 2)}\n`;
const identity = replayCardIdentity(descriptorBytes)!.identity;
const launches = { activation: { ok: true }, ticks: [{ launch: { outcome: "launched", actionKey: "arcadia/one" } }] };
const receiptOf = (patch: Partial<ReplayReceipt> = {}): string => JSON.stringify({ ...buildReplayReceipt("standing-start-fixture", identity, "arcadia", launches, "2026-11-17T00:00:00Z"), ...patch });

describe("the replay receipt is bound to one card", () => {
  it("names the descriptor sha256, the four pinned revisions and one predicted outcome per pinned Action", () => {
    const receipt = JSON.parse(receiptOf());
    expect(receipt).toMatchObject({ descriptorSha256: createHash("sha256").update(descriptorBytes).digest("hex"), reviewedRevision: "a".repeat(40), queueRevision: 40, productionRevision: 12, productionEpoch: 3 });
    expect(receipt.predictions).toEqual([{ action: "one", predicted: "launch" }, { action: "two", predicted: "launch" }]);
    expect(checkReplayReceipt(receiptOf(), identity)).toMatchObject({ ok: true, code: null });
  });

  it("refuses with REPLAY_REQUIRED when no receipt exists or it is not a receipt", () => {
    expect(checkReplayReceipt(null, identity).code).toBe("REPLAY_REQUIRED");
    expect(checkReplayReceipt("{", identity).code).toBe("REPLAY_REQUIRED");
    expect(checkReplayReceipt(JSON.stringify({ schema: "other" }), identity).code).toBe("REPLAY_REQUIRED");
  });

  it.each([
    ["descriptorSha256", "0".repeat(64)], ["reviewedRevision", "b".repeat(40)], ["queueRevision", 41], ["productionRevision", 13], ["productionEpoch", 4]
  ])("refuses with REPLAY_MISMATCH when %s differs from the card", (key, value) => {
    const result = checkReplayReceipt(receiptOf({ [key]: value }), identity);
    expect(result).toMatchObject({ ok: false, code: "REPLAY_MISMATCH" });
    expect(result.detail).toContain(key);
  });

  it("refuses with REPLAY_MISMATCH when a pinned Action has no prediction, and with REPLAY_PREDICTS_NO_LAUNCH when one is not a launch", () => {
    expect(checkReplayReceipt(receiptOf({ predictions: [{ action: "one", predicted: "launch" }] }), identity).code).toBe("REPLAY_MISMATCH");
    const refused = checkReplayReceipt(receiptOf({ predictions: [{ action: "one", predicted: "launch" }, { action: "two", predicted: "blocked" }] }), identity);
    expect(refused).toMatchObject({ ok: false, code: "REPLAY_PREDICTS_NO_LAUNCH" });
    expect(refused.detail).toContain("two (blocked)");
  });

  it("predicts a launch only for an Action a tick launched or one queued behind a launch, never past a refusal or a refused activation", () => {
    expect(predictOutcomes(["one", "two"], "arcadia", { activation: { ok: true }, ticks: [{ launch: { outcome: "blocked", actionKey: "arcadia/one" } }] }).map((p) => p.predicted)).toEqual(["blocked", "not_reached"]);
    expect(predictOutcomes(["one", "two"], "arcadia", { activation: { ok: true }, ticks: [] }).map((p) => p.predicted)).toEqual(["not_reached", "not_reached"]);
    expect(predictOutcomes(["one", "two"], "arcadia", { activation: { ok: false }, ticks: [] }).map((p) => p.predicted)).toEqual(["activation_refused", "activation_refused"]);
  });
});

describe("a replay that stopped before a launch decision is inconclusive, not a refusal", () => {
  const refusedFirst = { activation: { ok: true }, ticks: [{ launch: { outcome: "refused", actionKey: "arcadia/one" } }] };
  const receiptFor = (report: Parameters<typeof buildReplayReceipt>[3]) => JSON.stringify(buildReplayReceipt("standing-start-fixture", identity, "arcadia", report, "2026-11-22T00:00:00Z"));
  it("predicts inconclusive (<stop reason>) for every pinned Action when the replay stopped on an external effect", () => {
    const stopped = { ...refusedFirst, stop: { reason: "external_effect" } };
    expect(predictOutcomes(["one", "two"], "arcadia", stopped).map((p) => p.predicted)).toEqual(["inconclusive (external_effect)", "inconclusive (external_effect)"]);
    const check = checkReplayReceipt(receiptFor(stopped), identity);
    expect(check).toMatchObject({ ok: false, code: "REPLAY_PREDICTS_NO_LAUNCH" });
    expect(check.detail).toContain("inconclusive");
    expect(check.detail).toContain("external_effect");
  });
  it("keeps a settled refusal a refusal, and predicts launch once tick 2 launched after the answered mirror Issue and Codex read", () => {
    expect(predictOutcomes(["one"], "arcadia", { ...refusedFirst, stop: { reason: "steady_state" } })[0].predicted).toBe("refused");
    const twoTicks = { activation: { ok: true }, stop: { reason: "launched" }, ticks: [refusedFirst.ticks[0], { launch: { outcome: "launched", actionKey: "arcadia/one" } }] };
    expect(predictOutcomes(["one", "two"], "arcadia", twoTicks).map((p) => p.predicted)).toEqual(["launch", "launch"]);
    expect(checkReplayReceipt(receiptFor(twoTicks), identity).ok).toBe(true);
  });
});

describe("the replay and the executor's P6 build one scope", () => {
  const NOW = new Date("2026-11-17T10:00:00.000Z");
  /** P6's own fingerprint snippet, run exactly as scripts/start-run.sh runs it, with the pinned values as its arguments. */
  const p6Fingerprint = (override: Partial<Record<"intent" | "transitions" | "provider" | "hours" | "concurrency", string>> = {}): string => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "start-run.sh"), "utf8");
    const start = source.indexOf("EXPECTED_FINGERPRINT=\"$(node -e '") + "EXPECTED_FINGERPRINT=\"$(node -e '".length;
    let snippet = source.slice(start, source.indexOf("' \"$INTENT\"", start));
    if (override.concurrency) snippet = snippet.replace("maxConcurrentSessions: 1", `maxConcurrentSessions: ${override.concurrency}`);
    const scope = startRunActivationScope(PINS, NOW);
    const result = spawnSync(process.execPath, ["-e", snippet, override.intent ?? PINS.intent, "arcadia", "arcadia/fixture-plan", JSON.stringify(scope.actions), override.provider ?? PINS.provider, override.transitions ?? PINS.transitions.join(","), scope.packetApprovalExpiresAt, PINS.integrationDecision], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };

  it("the executor's scope fingerprint equals the shared function's", () => {
    const scope = startRunActivationScope(PINS, NOW);
    expect(scope.packetApprovalExpiresAt).toBe("2026-11-18T10:00:00.000Z");
    expect(p6Fingerprint()).toBe(startRunScopeFingerprint(scope));
  });

  it.each([
    ["intent", { intent: "Another intent." }], ["transitions", { transitions: "validation" }], ["provider", { provider: "codex-cli" }], ["concurrency", { concurrency: "2" }]
  ] as const)("a fixture that changes %s in only one place fails", (_name, override) => {
    expect(p6Fingerprint(override)).not.toBe(startRunScopeFingerprint(startRunActivationScope(PINS, NOW)));
  });

  it("a different grant-hours input gives the shared function a different scope", () => {
    expect(startRunScopeFingerprint(startRunActivationScope({ ...PINS, packetApprovalHours: 12 }, NOW))).not.toBe(p6Fingerprint());
  });
});

const action = (id: string, extra: Partial<DerivePlanAction> = {}): DerivePlanAction => ({ id, status: "open", dependsOn: [], criteriaErrors: [], decisions: [], references: [], ...extra });
const keys = (...ids: string[]) => ids.map((id) => `arcadia/${id}`);

describe("the deriver stops before an Action that needs the operator", () => {
  it("ends the card before the first Action citing an unanswered Decision, and records it as the one operator item", () => {
    const actions = [action("one"), action("two", { decisions: ["0300"] }), action("three")];
    expect(deriveActionsAndOperatorItem("arcadia", actions, keys("one", "two", "three"), [])).toEqual({
      actions: ["one"], operatorItem: { action: "two", reasons: ["cites unanswered Decision 0300"] }
    });
    expect(deriveActionsAndOperatorItem("arcadia", actions, keys("one", "two", "three"), ["0300"])).toEqual({ actions: ["one", "two", "three"], operatorItem: null });
  });

  it("derives an Action whose references name operator_authority or production_policy paths; the merge-time diff judges authority", () => {
    expect(classifyAuthorityPaths(["scripts/start-run.sh"])).toContain("operator_authority");
    expect(classifyAuthorityPaths(["src/production/policy.ts"])).toContain("production_policy");
    const actions = [action("one", { references: ["docs/notes-to-self.md", "README.md"] }), action("two", { references: ["scripts/start-run.sh", "src/production/policy.ts"] }), action("three")];
    expect(deriveActionsAndOperatorItem("arcadia", actions, keys("one", "two", "three"), [])).toEqual({ actions: ["one", "two", "three"], operatorItem: null });
  });

  it("still stops before an Action citing an unanswered Decision even when it also names authority paths", () => {
    const actions = [action("one"), action("two", { decisions: ["0300"], references: ["scripts/start-run.sh"] })];
    expect(deriveActionsAndOperatorItem("arcadia", actions, keys("one", "two"), [])).toEqual({
      actions: ["one"], operatorItem: { action: "two", reasons: ["cites unanswered Decision 0300"] }
    });
  });

  it("an Action that is not ready ends the card without being an operator item", () => {
    const actions = [action("one"), action("two", { status: "blocked", decisions: ["0300"] })];
    expect(deriveActionsAndOperatorItem("arcadia", actions, keys("one", "two"), [])).toEqual({ actions: ["one"], operatorItem: null });
  });

  it("counts a Decision answered only when its record on main is approved with an answer", () => {
    const files: Record<string, string> = {
      "docs/decisions/0300-a.md": "---\nid: \"0300\"\nstatus: approved\nanswer: A. Yes\n---\n",
      "docs/decisions/0301-b.md": "---\nid: \"0301\"\nstatus: open\n---\n",
      "docs/decisions/0302-c.md": "---\nid: \"0302\"\nstatus: approved\n---\n"
    };
    expect(answeredDecisionIds(["0300", "0301", "0302", "0303"], Object.keys(files), (file) => files[file])).toEqual(["0300"]);
  });

  it("derives nothing, with the named reason, when the operator item is first in the queue", () => {
    const input = {
      originMain: "a".repeat(40), now: new Date("2026-11-17T10:00:30Z"), executorSha256: "e".repeat(64), workspace: "martianrover", workerLabel: "com.arcadia.local.1.worker",
      gateCardId: "gate", offId: "off", grant: { open: true, plan: "fixture-plan", approvalCard: "card", approvalRun: "run", reason: null },
      plan: { slug: "fixture-plan", project: "arcadia", status: "active", isProjectActivePlan: true, actions: [action("one", { decisions: ["0300"] }), action("two")] },
      production: { desiredState: "inactive", liveAdmissions: 0, revision: 12, epoch: 3 }, queue: { revision: 40, orderValid: true, unpositionedCount: 0, keys: keys("one", "two") },
      chain: { receiptSha256: "1".repeat(64), pressSha256: "2".repeat(64), attemptsSoFar: 0, latest: null }, consumedHistory: [], answeredDecisions: []
    };
    const result = deriveStartCard(input);
    expect(result).toMatchObject({ ok: false, reason: "OPERATOR_ITEM_FIRST" });
    expect(result.ok === false && result.message).toContain("one");
  });
});

describe("the worker-merge authority gate is unchanged", () => {
  const git = (cwd: string, ...args: string[]) => { const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }); expect(r.status, r.stderr).toBe(0); return r.stdout.trim(); };

  it("still holds a candidate that touches an authority path the Action did not declare", () => {
    const repo = tempDir();
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(path.join(repo, "README.md"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    const from = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "-b", "candidate");
    // `scripts/start-run.sh` is an authority path; the Action declared only README.md in its references.
    mkdirSync(path.join(repo, "scripts"));
    writeFileSync(path.join(repo, "scripts", "start-run.sh"), "#!/usr/bin/env bash\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "touch authority path");
    const to = git(repo, "rev-parse", "HEAD");
    expect(candidateChangeGate(repo, from, to)).toMatch(/it touches checked-in authority boundaries \(/);
    git(repo, "checkout", "-q", "-b", "plain", from);
    writeFileSync(path.join(repo, "README.md"), "changed\n");
    git(repo, "commit", "-q", "-am", "plain");
    expect(candidateChangeGate(repo, from, git(repo, "rev-parse", "HEAD"))).toBeNull();
  });
});
