import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LeakSnapshot } from "../src/workspace/leakCheck.js";
import { deriveHistoricalSourcePin, deriveRetainedScoutObservations, evaluateBoundedScoutIsolation, evaluateScoutPreflight, reserveBoundedScoutAttempt, reserveBoundedScoutRepair, validateBoundedScoutDecision, verifyEvidenceManifest } from "../src/scout/isolationPreflight.js";

const root = "/tmp/scout-fixture";
const workspace = `${root}/workspace`;
const fixtureRepo = `${workspace}/repo`;
const trustPath = `${fixtureRepo}/project`;
const liveWorkspacePath = "/Users/operator/workspaces/martianrover";
const configBefore = "version = 1\n";
const trustSection = `[projects."${trustPath}"]\ntrust_level = "trusted"\n`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const unsafeTrustPaths = [
  `${root}/workspace/../outside`,
  `${root}/workspace/repo/evil\\project`,
  `${root}/workspace/repo/${String.fromCharCode(34)}project`
];
const consumedFiles = [
  "report.json", "arcadia-luna-scout-before.json", "arcadia-luna-scout-leak-after.json",
  "arcadia-luna-scout-trust-attribution.json", "evidence/retry-01-ask.json",
  "evidence/operator-approval.json", "evidence/worker-result.json", "evidence/04-todo-final.json",
  "builder/metadata.json", "builder/prompt.md"
];
const tempRoots: string[] = [];
afterEach(() => { for (const rootPath of tempRoots.splice(0)) rmSync(rootPath, { recursive: true, force: true }); });

function makeEvidenceRoot(entries = consumedFiles) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-scout-manifest-"));
  tempRoots.push(root);
  const manifest: Record<string, string> = {};
  for (const [index, relative] of entries.entries()) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    const bytes = `fixture-${index}`;
    writeFileSync(file, bytes);
    manifest[relative] = hash(bytes);
  }
  const raw = JSON.stringify(manifest);
  writeFileSync(path.join(root, "sha256-manifest.json"), raw);
  return { root, expected: hash(raw), manifest };
}

function snapshot(overrides: Partial<LeakSnapshot> = {}): LeakSnapshot {
  return {
    schema: "arcadia-leak-check-v1",
    takenAt: "2026-10-13T12:00:00.000Z",
    liveWorkspace: {
      path: liveWorkspacePath, projectCount: 2, queueRevision: 3,
      productionPolicy: { desiredState: "inactive", revision: 4, epoch: 2 },
      productionPolicyReceipts: 4, productionAdmissions: 0, error: null
    },
    hashes: {
      userConfig: hash("user"), codexConfig: hash(configBefore), claudeSettings: hash("claude"),
      claudeTrust: hash("trust"), capacityReceipts: hash("capacity")
    },
    goBroker: { "broker.json": hash("broker") }, launchAgents: { "arcadia.plist": hash("launch") },
    ...overrides
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const before = snapshot();
  return {
    pins: {
      sourceRevision: "a".repeat(40), nodeVersion: "v22.23.1", model: "gpt-6-luna", effort: "low",
      fixtureRoot: root, workspace, fixtureRepo, liveWorkspacePath, fixtureTrustPath: trustPath
    },
    before,
    after: snapshot({ hashes: { ...before.hashes, codexConfig: hash(configBefore + trustSection) } }),
    codexConfigDiff: { before: configBefore, after: configBefore + trustSection },
    priorHold: { status: "unresolved" },
    ...overrides
  } as Parameters<typeof evaluateScoutPreflight>[0];
}

function retainedEvidence() {
  return {
    report: {
      outcome: "no", fileProduced: false, exactBytes: false,
      scout: { scopeStop: "Inspected original constraints and retained the one-file request." },
      run: { status: "requires_review", work_item_id: null },
      builder: { validation: [{ output: "ENOENT: HelloWorld.txt missing" }] }
    },
    retryAsk: { data: { intake: { extractedFields: { requestedAction: "implement HelloWorld.txt" }, reviewRequired: true },
      resolvedIntent: { expectedArtifact: "HelloWorld.txt for Luna Scout implementation with tests" }, run: null } },
    approval: { data: { run: null, result: { summary: "R1 approved. Resuming execution." } } },
    worker: { work_item_id: null },
    builder: { changedFiles: [], validation: [] },
    builderPrompt: "Approved review decision. Action: None. Pending approval instructions remain.",
    missingTodo: { data: { askUnavailable: "workspace unavailable", unavailable: ["source unavailable"] } }
  };
}

describe("offline scout isolation preflight", () => {
  const decisionPath = "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md";
  const decisionText = readFileSync(decisionPath, "utf8");

  it("validates the canonical approved Decision 0128 and rejects obsolete or altered approval", () => {
    expect(validateBoundedScoutDecision({ text: decisionText, canonicalPath: decisionPath, now: "2026-10-13T12:00:00Z" }).approved).toBe(true);
    expect(validateBoundedScoutDecision({ text: decisionText, canonicalPath: `docs/decisions/../decisions/${path.basename(decisionPath)}`, now: "2026-10-13T12:00:00Z" }).approved).toBe(false);
    expect(validateBoundedScoutDecision({ text: decisionText.replace("status: approved", "status: rejected"), canonicalPath: decisionPath, now: "2026-10-13T12:00:00Z" }).approved).toBe(false);
    expect(validateBoundedScoutDecision({ text: decisionText.replace("at most3 total live builder attempts", "one live attempt"), canonicalPath: decisionPath, now: "2026-10-13T12:00:00Z" }).approved).toBe(false);
    expect(validateBoundedScoutDecision({ text: `${decisionText}\n# altered scope`, canonicalPath: decisionPath, now: "2026-10-13T12:00:00Z" }).approved).toBe(false);
    expect(validateBoundedScoutDecision({ text: decisionText, canonicalPath: "docs/decisions/0125-old.md", now: "2026-10-13T12:00:00Z" }).approved).toBe(false);
    expect(validateBoundedScoutDecision({ text: decisionText, canonicalPath: decisionPath, now: "2026-10-18T00:00:00Z" }).approved).toBe(false);
  });

  it("admits a fresh, exactly pinned Decision 0128 fixture preflight while historical replay stays held", () => {
    const actualRoot = mkdtempSync(path.join(os.tmpdir(), "scout-authorized-"));
    tempRoots.push(actualRoot);
    const actualWorkspace = path.join(actualRoot, "workspace");
    const actualRepo = path.join(actualWorkspace, "repo");
    const actualTrust = path.join(actualRepo, "project");
    mkdirSync(actualTrust, { recursive: true });
    const livePath = mkdtempSync(path.join(os.tmpdir(), "scout-protected-live-")); tempRoots.push(livePath);
    const base = input();
    const before = snapshot({ liveWorkspace: { ...base.before.liveWorkspace, path: livePath } });
    const result = evaluateBoundedScoutIsolation({
      pins: { ...base.pins, fixtureRoot: actualRoot, workspace: actualWorkspace, fixtureRepo: actualRepo, fixtureTrustPath: actualTrust, liveWorkspacePath: livePath },
      before, after: before, decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z"
    });
    expect(result.reasons).toEqual([]);
    expect(result.verdict).toBe("isolated");
    expect(result.executionAuthorized).toBe(false);
    expect(result.scope).toBe("bounded-decision-0128-isolation-only");
    expect(result.attemptLimitSeconds).toBe(90);
    expect(result.decision.sha256).toBe(hash(decisionText));
    expect(evaluateScoutPreflight(input()).verdict).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("trust_level");
  });

  it("blocks stale witnesses, a live-overlapping fixture, and symlinked fixture paths", () => {
    const actualRoot = mkdtempSync(path.join(os.tmpdir(), "scout-authorized-refusal-"));
    tempRoots.push(actualRoot);
    const actualWorkspace = path.join(actualRoot, "workspace");
    const actualRepo = path.join(actualWorkspace, "repo");
    const actualTrust = path.join(actualRepo, "project");
    mkdirSync(actualTrust, { recursive: true });
    const livePath = mkdtempSync(path.join(os.tmpdir(), "scout-protected-live-")); tempRoots.push(livePath);
    const base = input();
    const pins = { ...base.pins, fixtureRoot: actualRoot, workspace: actualWorkspace, fixtureRepo: actualRepo, fixtureTrustPath: actualTrust, liveWorkspacePath: livePath };
    const liveSnapshot = snapshot({ liveWorkspace: { ...base.before.liveWorkspace, path: livePath } });
    const old = snapshot({ takenAt: "2026-10-13T11:00:00Z" });
    expect(evaluateBoundedScoutIsolation({ pins, before: old, after: old, decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).reasons)
      .toContain("protected-state witnesses must be ordered, current, and no more than five minutes old");
    const overlap = { ...pins, liveWorkspacePath: actualRoot };
    expect(evaluateBoundedScoutIsolation({ pins: overlap, before: liveSnapshot, after: liveSnapshot, decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).reasons)
      .toContain("fixture scope overlaps the protected live workspace");
    const symlinkParent = path.join(actualRoot, "alias"); symlinkSync(livePath, symlinkParent);
    const nestedFixture = path.join(symlinkParent, "fixture");
    const nestedWorkspace = path.join(nestedFixture, "workspace");
    const nestedRepo = path.join(nestedWorkspace, "repo");
    const nestedTrust = path.join(nestedRepo, "project"); mkdirSync(nestedTrust, { recursive: true });
    const symlinkAncestorPins = { ...pins, fixtureRoot: nestedFixture, workspace: nestedWorkspace, fixtureRepo: nestedRepo, fixtureTrustPath: nestedTrust };
    expect(evaluateBoundedScoutIsolation({ pins: symlinkAncestorPins, before: liveSnapshot, after: liveSnapshot,
      decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).reasons)
      .toContain("fixture scope overlaps the protected live workspace");
    expect(evaluateBoundedScoutIsolation({ pins: { ...pins, liveWorkspacePath: path.join(actualRoot, "missing-live") }, before: liveSnapshot, after: liveSnapshot,
      decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).verdict).toBe("blocked");
    const changedProtected = snapshot({ hashes: { ...base.before.hashes, userConfig: hash("unexpected config change") } });
    expect(evaluateBoundedScoutIsolation({ pins, before: base.before, after: changedProtected,
      decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).verdict).toBe("blocked");
    const link = path.join(actualRoot, "linked-workspace");
    writeFileSync(path.join(actualRoot, "marker"), "fixture");
    symlinkSync(path.join(actualRoot, "marker"), link);
    expect(evaluateBoundedScoutIsolation({ pins: { ...pins, fixtureTrustPath: link }, before: base.before, after: base.after,
      decision: { text: decisionText, canonicalPath: decisionPath }, now: "2026-10-13T12:00:00Z" }).verdict).toBe("blocked");
  });

  it("reserves attempts atomically and keeps one goal budget across changed source revisions", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "scout-budget-")); tempRoots.push(dir);
    const ledgerPath = path.join(dir, "attempt-budget.json");
    const fixtureRoot = path.join(dir, "fixture"); mkdirSync(fixtureRoot);
    const reserve = (sha: string, now: string) => reserveBoundedScoutAttempt({ ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: sha, now });
    expect(reserve("a".repeat(40), "2026-10-13T12:00:00Z").reason).toContain("initialization is required");
    const first = reserveBoundedScoutAttempt({ ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: "a".repeat(40), initialize: true, now: "2026-10-13T12:00:00Z" });
    const second = reserve("b".repeat(40), "2026-10-13T12:10:00Z");
    const third = reserve("c".repeat(40), "2026-10-13T12:20:00Z");
    expect([first.attemptNumber, second.attemptNumber, third.attemptNumber]).toEqual([1, 2, 3]);
    expect(reserve("d".repeat(40), "2026-10-13T12:30:00Z").reason).toContain("exhausted");
    expect(first.ledger?.deadline).toBe("2026-10-13T13:30:00.000Z");
    expect(reserve("e".repeat(40), "2026-10-13T11:59:00Z").reason).toContain("backwards");
    const repair1 = reserveBoundedScoutRepair({ ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: "d".repeat(40), now: "2026-10-13T12:25:00Z" });
    const repair2 = reserveBoundedScoutRepair({ ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: "e".repeat(40), now: "2026-10-13T12:26:00Z" });
    expect([repair1.repairCycle, repair2.repairCycle]).toEqual([1, 2]);
    expect(repair2.ledger?.attempts).toHaveLength(3);
    expect(reserveBoundedScoutRepair({ ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: "f".repeat(40), now: "2026-10-13T12:27:00Z" }).reason)
      .toContain("two-repair-cycle budget is exhausted");
    expect(reserveBoundedScoutAttempt({ ledgerPath: path.join(dir, "attacker-choice.json"), trustedLedgerPath: ledgerPath,
      fixtureRoot, sourceRevision: "f".repeat(40), initialize: true, now: "2026-10-13T12:30:00Z" }).reason).toContain("trusted ledger assignment pin");
  });

  it("fails closed on corrupt, duplicate-locked, expired, or malformed budget state", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "scout-budget-fail-")); tempRoots.push(dir);
    const ledgerPath = path.join(dir, "attempt-budget.json");
    writeFileSync(ledgerPath, "{broken");
    const fixtureRoot = path.join(dir, "fixture"); mkdirSync(fixtureRoot);
    const input = { ledgerPath, trustedLedgerPath: ledgerPath, fixtureRoot, sourceRevision: "a".repeat(40), now: "2026-10-13T12:00:00Z" };
    expect(reserveBoundedScoutAttempt(input).reason).toContain("corrupt");
    rmSync(ledgerPath);
    writeFileSync(`${ledgerPath}.lock`, "held");
    expect(reserveBoundedScoutAttempt(input).reason).toContain("locked");
    rmSync(`${ledgerPath}.lock`);
    expect(reserveBoundedScoutAttempt({ ...input, now: "2026-10-18T00:00:00Z" }).reason).toContain("expired");
    const goodPath = path.join(dir, "valid-budget.json");
    expect(reserveBoundedScoutAttempt({ ...input, ledgerPath: goodPath, trustedLedgerPath: goodPath, initialize: true }).ok).toBe(true);
    const malformed = JSON.parse(readFileSync(goodPath, "utf8")) as { deadline: string };
    malformed.deadline = "2026-10-13T14:00:00.000Z";
    writeFileSync(goodPath, JSON.stringify(malformed));
    expect(reserveBoundedScoutAttempt({ ...input, ledgerPath: goodPath, trustedLedgerPath: goodPath, now: "2026-10-13T12:01:00Z" }).reason).toContain("malformed");
  });

  it("requires a custody-pinned manifest covering every consumed replay file", () => {
    const full = makeEvidenceRoot();
    expect(verifyEvidenceManifest(full.root, full.expected)).toEqual({ checked: consumedFiles.length, mismatches: [], manifestSha256: full.expected });
    const omitted = makeEvidenceRoot(consumedFiles.filter((file) => file !== "report.json"));
    expect(verifyEvidenceManifest(omitted.root, omitted.expected).mismatches).toContain("manifest omits consumed evidence");
  });

  it("rejects empty, tampered, altered-file, and unsafe-path manifests", () => {
    const empty = makeEvidenceRoot([]);
    expect(verifyEvidenceManifest(empty.root, empty.expected).mismatches).toContain("manifest schema, paths, or hashes are invalid");
    const tampered = makeEvidenceRoot();
    expect(verifyEvidenceManifest(tampered.root, "0".repeat(64)).mismatches).toContain("manifest SHA does not match custody pin");
    const changed = makeEvidenceRoot();
    writeFileSync(path.join(changed.root, "report.json"), "changed");
    expect(verifyEvidenceManifest(changed.root, changed.expected).mismatches).toContain("report.json");
    const unsafe = makeEvidenceRoot([...consumedFiles, "../outside"]);
    expect(verifyEvidenceManifest(unsafe.root, unsafe.expected).mismatches).toContain("manifest schema, paths, or hashes are invalid");
  });

  it("reports source history as changed only from two distinct valid saved SHAs", () => {
    expect(deriveHistoricalSourcePin("a".repeat(40), "b".repeat(40)).status).toBe("changed-between-captured-heads");
    expect(deriveHistoricalSourcePin("a".repeat(40), "a".repeat(40)).status).toBe("unverified");
    expect(deriveHistoricalSourcePin("not-a-sha", undefined).status).toBe("unverified");
  });

  it("derives the preserved scope, packet markers, null Action, and missing-file observations", () => {
    const facts = deriveRetainedScoutObservations(retainedEvidence());
    expect(facts.originalScopeOneFile).toBe(true);
    expect(facts.generatedScopeAppendedTests).toBe(true);
    expect(facts.actionNone).toBe(true);
    expect(facts.approvalClaimsResumeWithoutRun).toBe(true);
    expect(facts.promptApprovedHeading && facts.promptReviewMarker && facts.promptDecisionMarker && facts.promptNoneMarker).toBe(true);
    expect(facts.expectedUtf8Hex).toBe("48656c6c6f20576f726c64210a");
    expect(facts.validationMissingFile).toBe(true);
    expect(facts.todoSourceAvailable).toBe(false);
  });

  it("reflects mutations to saved scope, packet and approval evidence instead of hard-coding them", () => {
    const evidence = retainedEvidence();
    evidence.retryAsk.data.resolvedIntent.expectedArtifact = "HelloWorld.txt only";
    evidence.approval.data.result.summary = "R1 approved.";
    evidence.builderPrompt = "No packet markers.";
    const facts = deriveRetainedScoutObservations(evidence);
    expect(facts.generatedScopeAppendedTests).toBe(false);
    expect(facts.approvalClaimsResumeWithoutRun).toBe(false);
    expect(facts.promptApprovedHeading).toBe(false);
    expect(facts.promptNoneMarker).toBe(false);
  });

  it("requires the permitted trust table to be absent before the append", () => {
    const before = `${configBefore}[projects."${trustPath}"]\ntrust_level = "untrusted"\n`;
    const after = `${before}\n${trustSection}`;
    const base = input();
    const result = evaluateScoutPreflight({
      ...base,
      before: snapshot({ hashes: { ...base.before.hashes, codexConfig: hash(before) } }),
      after: snapshot({ hashes: { ...base.before.hashes, codexConfig: hash(after) } }),
      codexConfigDiff: { before, after }
    });
    expect(result.config?.exactFixtureTrustChange).toBe(false);
  });

  it.each([
    `[projects."${trustPath}"] # existing commented table`,
    `[ projects . "${trustPath}" ]`,
    `[projects.'${trustPath}']`,
    `[projects."${trustPath.replaceAll("/", "\\u002f")}"]`,
    `[projects.\n"${trustPath}"]`
  ])("fails closed on existing or unsupported project table syntax, including escaped paths", (header) => {
    const before = `${configBefore}${header}\ntrust_level = "untrusted"\n`;
    const after = `${before}\n${trustSection}`;
    const base = input();
    const result = evaluateScoutPreflight({
      ...base,
      before: snapshot({ hashes: { ...base.before.hashes, codexConfig: hash(before) } }),
      after: snapshot({ hashes: { ...base.before.hashes, codexConfig: hash(after) } }),
      codexConfigDiff: { before, after }
    });
    expect(result.config?.exactFixtureTrustChange).toBe(false);
  });

  it("only reports HelloWorld missing when the retained validation names that file", () => {
    const evidence = retainedEvidence();
    evidence.report.builder.validation = [{ output: "ENOENT: unrelated.txt missing" }];
    expect(deriveRetainedScoutObservations(evidence).validationMissingFile).toBe(false);
    evidence.report.builder.validation = [{ output: "ENOENT: HelloWorld.txt.bak missing" }];
    expect(deriveRetainedScoutObservations(evidence).validationMissingFile).toBe(false);
    evidence.report.builder.validation = [{ output: "ENOENT: HelloWorld.txt missing" }];
    expect(deriveRetainedScoutObservations(evidence).validationMissingFile).toBe(true);
  });

  it("refuses missing typed replay evidence", () => {
    const evidence = retainedEvidence();
    evidence.builder.changedFiles = undefined as never;
    expect(() => deriveRetainedScoutObservations(evidence)).toThrow("required replay evidence is missing or malformed");
  });

  it("records every immutable runtime, model and explicit scope pin without config content", () => {
    const result = evaluateScoutPreflight(input());
    expect(result.pins).toEqual({
      sourceRevision: "a".repeat(40), nodeVersion: "v22.23.1", model: "gpt-6-luna", effort: "low",
      fixtureRoot: root, workspace, fixtureRepo, liveWorkspacePath, fixtureTrustPath: trustPath
    });
    expect(result.before.hashes.codexConfig).toBe(hash(configBefore));
    expect(JSON.stringify(result)).not.toContain(configBefore);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons).toContain("historical isolation hold unresolved; this observation-only slice has no hold-resolution implementation");
  });

  it("admits only the exact new fixture trust section with reproducible before and after hashes", () => {
    const result = evaluateScoutPreflight(input());
    expect(result.config?.exactFixtureTrustChange).toBe(true);
    expect(result.config?.beforeSha256).toBe(hash(configBefore));
    expect(result.config?.afterSha256).toBe(hash(configBefore + trustSection));
  });

  it.each([
    `[projects."${trustPath}"]\ntrust_level = "trusted"\nother = "extra"\n`,
    `[projects."${trustPath}"]\ntrust_level = "trusted"\n[other]\nvalue = "x"\n`,
    `[projects."${trustPath}"]\ntrust_level = "trusted"\n[projects."${trustPath}"]\ntrust_level = "trusted"\n`,
    `[[projects."${trustPath}"]]\ntrust_level = "trusted"\n`,
    `[projects.\n"${trustPath}"]\ntrust_level = "trusted"\n`
  ])("rejects non-exact or malformed trust content", (section) => {
    const base = input();
    const afterText = configBefore + section;
    const after = snapshot({ hashes: { ...base.before.hashes, codexConfig: hash(afterText) } });
    const result = evaluateScoutPreflight({ ...base, after, codexConfigDiff: { before: configBefore, after: afterText } });
    expect(result.verdict).toBe("blocked");
    expect(result.config?.exactFixtureTrustChange).toBe(false);
  });

  it("blocks missing before observations", () => {
    const base = input();
    const before = snapshot({ liveWorkspace: { ...base.before.liveWorkspace, queueRevision: null } });
    expect(evaluateScoutPreflight({ ...base, before }).verdict).toBe("blocked");
  });

  it("accepts an observed absent protected file when its before and after hashes stay null", () => {
    const base = input();
    const hashes = { ...base.before.hashes, userConfig: null };
    const before = snapshot({ hashes });
    const after = snapshot({ hashes: { ...hashes, codexConfig: hash(configBefore + trustSection) } });
    const result = evaluateScoutPreflight({ ...base, before, after });
    expect(result.reasons).not.toContain("protected before/after observations are missing or unobserved");
    expect(result.priorHold).toEqual({ status: "unresolved" });
  });

  it("accepts the recorded go-broker link marker schema and emits only a digest", () => {
    const base = input();
    const before = snapshot({ goBroker: { "link:/opt/arcadia/broker": "link:/opt/arcadia/broker" } });
    const after = snapshot({ goBroker: { "link:/opt/arcadia/broker": "link:/opt/arcadia/broker" },
      hashes: { ...base.before.hashes, codexConfig: hash(configBefore + trustSection) } });
    const result = evaluateScoutPreflight({ ...base, before, after });
    expect(result.before?.goBroker.entries).toBe(1);
    expect(JSON.stringify(result)).not.toContain("/opt/arcadia/broker");
  });

  it("blocks a workspace traversal outside the fixture root", () => {
    const base = input();
    expect(evaluateScoutPreflight({ ...base, pins: { ...base.pins, workspace: `${root}/../live` } }).reasons)
      .toContain("fixture workspace must be inside the explicit fixture root");
  });

  it.each(unsafeTrustPaths)("blocks a trust path outside or malformed for the fixture repository", (fixtureTrustPath) => {
    const base = input();
    expect(evaluateScoutPreflight({ ...base, pins: { ...base.pins, fixtureTrustPath } }).reasons)
      .toContain("fixture trust path must equal or be inside the pinned repository");
  });

  it("blocks live queue, Project and production changes", () => {
    const base = input();
    const after = snapshot({
      liveWorkspace: { ...base.before.liveWorkspace, queueRevision: 4, projectCount: 3,
        productionPolicy: { desiredState: "active", revision: 5, epoch: 3 } }
    });
    expect(evaluateScoutPreflight({ ...base, after }).reasons)
      .toContain("after snapshot is malformed, unobserved, or contains unknown fields");
  });

  it.each([
    { nodeVersion: "v26.9.0" }, { model: "gpt-6-astra" }, { effort: "medium" }, { sourceRevision: "main" }
  ])("blocks a mismatched execution pin", (pin) => {
    const base = input();
    expect(evaluateScoutPreflight({ ...base, pins: { ...base.pins, ...pin } }).verdict).toBe("blocked");
  });

  it("keeps the historical hold blocked when a new clean baseline is supplied", () => {
    const result = evaluateScoutPreflight(input());
    expect(result.verdict).toBe("blocked");
    expect(result.priorHold).toEqual({ status: "unresolved" });
    expect(result.reasons).toContain("historical isolation hold unresolved; this observation-only slice has no hold-resolution implementation");
  });

  it("does not accept an arbitrary approval string or missing hold evidence", () => {
    const base = input();
    const arbitrary = evaluateScoutPreflight({ ...base, priorHold: { status: "operator-approved" } as never });
    const missing = evaluateScoutPreflight({ ...base, priorHold: undefined as never });
    expect(arbitrary.verdict).toBe("blocked");
    expect(missing.verdict).toBe("blocked");
    expect(arbitrary.priorHold).toEqual({ status: "unresolved" });
    expect(missing.reasons).toContain("prior isolation hold is missing or invalid");
  });

  it("returns a sanitized blocked receipt for null or unknown input shapes", () => {
    const base = input();
    const nullLive = evaluateScoutPreflight({ ...base, before: { ...base.before, liveWorkspace: null } });
    const nullPins = evaluateScoutPreflight({ ...base, pins: null });
    const secretField = evaluateScoutPreflight({ ...base, secret: "do-not-return" });
    const secretSnapshot = evaluateScoutPreflight({ ...base, before: { ...base.before, leakedToken: "do-not-return" } });
    for (const receipt of [nullLive, nullPins, secretField, secretSnapshot]) {
      expect(receipt.verdict).toBe("blocked");
      expect(JSON.stringify(receipt)).not.toContain("do-not-return");
    }
  });

  it("allows the Codex trust entry at the fixture repository root while blocking repositories outside scope", () => {
    const base = input();
    const rootTrust = { ...base, pins: { ...base.pins, fixtureTrustPath: fixtureRepo } };
    const acceptedScope = evaluateScoutPreflight(rootTrust);
    expect(acceptedScope.reasons).not.toContain("fixture trust path must equal or be inside the pinned repository");
    const outsideRepo = evaluateScoutPreflight({ ...base, pins: { ...base.pins, fixtureRepo: `${root}/outside` } });
    expect(outsideRepo.reasons).toContain("fixture repository must be inside the disposable workspace");
  });
});
