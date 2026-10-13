import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LeakSnapshot } from "../src/workspace/leakCheck.js";
import { deriveRetainedScoutObservations, evaluateScoutPreflight } from "../src/scout/isolationPreflight.js";

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

  it("refuses missing typed replay evidence", () => {
    const evidence = retainedEvidence();
    evidence.builder.changedFiles = undefined as never;
    expect(() => deriveRetainedScoutObservations(evidence)).toThrow("missing required typed");
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
    expect(result.reasons).toContain("prior isolation hold remains unresolved; fresh baselines or unverified approval text do not clear it");
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
    expect(result.priorHold.unresolved).toBe(true);
  });

  it("blocks a workspace traversal outside the fixture root", () => {
    const base = input();
    expect(evaluateScoutPreflight({ ...base, pins: { ...base.pins, workspace: `${root}/../live` } }).reasons)
      .toContain("fixture workspace must be an explicit child of the fixture root");
  });

  it.each(unsafeTrustPaths)("blocks a trust path outside or malformed for the fixture repository", (fixtureTrustPath) => {
    const base = input();
    expect(evaluateScoutPreflight({ ...base, pins: { ...base.pins, fixtureTrustPath } }).reasons)
      .toContain("fixture trust path must be a safe child of the pinned fixture repository");
  });

  it("blocks live queue, Project and production changes", () => {
    const base = input();
    const after = snapshot({
      liveWorkspace: { ...base.before.liveWorkspace, queueRevision: 4, projectCount: 3,
        productionPolicy: { desiredState: "active", revision: 5, epoch: 3 } }
    });
    expect(evaluateScoutPreflight({ ...base, after }).reasons)
      .toContain("protected state changed outside the permitted Codex fixture trust entry");
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
    expect(result.priorHold).toEqual({ unresolved: true, resolvedBy: null });
    expect(result.reasons).toContain("prior isolation hold remains unresolved; fresh baselines or unverified approval text do not clear it");
  });

  it("does not accept an arbitrary approval string or missing hold evidence", () => {
    const base = input();
    const arbitrary = evaluateScoutPreflight({ ...base, priorHold: { status: "operator-approved" } as never });
    const missing = evaluateScoutPreflight({ ...base, priorHold: undefined as never });
    expect(arbitrary.verdict).toBe("blocked");
    expect(missing.verdict).toBe("blocked");
    expect(arbitrary.priorHold.unresolved).toBe(true);
    expect(missing.reasons).toContain("prior isolation hold state is missing or invalid");
  });
});
