import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { compareLeakSnapshots, parseLeakSnapshot, unverifiableReason, type LeakSnapshot } from "../workspace/leakCheck.js";

export interface ScoutPins {
  sourceRevision: string;
  nodeVersion: string;
  model: string;
  effort: string;
  fixtureRoot: string;
  workspace: string;
  fixtureRepo: string;
  liveWorkspacePath: string;
  fixtureTrustPath: string;
}

export interface ScoutPreflightInput {
  pins: ScoutPins;
  before: LeakSnapshot;
  after: LeakSnapshot;
  /** Raw Codex config bytes are supplied by an explicit offline capture, never read from host config here. */
  codexConfigDiff?: { before: string; after: string };
  priorHold: { status: "unresolved" };
}

export interface ScoutPreflightReceipt {
  schema: "arcadia-scout-isolation-preflight-v1";
  verdict: "ready" | "blocked";
  pins: ScoutPins;
  before: ReturnType<typeof summarizeSnapshot>;
  after: ReturnType<typeof summarizeSnapshot>;
  config: { beforeSha256: string; afterSha256: string; exactFixtureTrustChange: boolean } | null;
  priorHold: { unresolved: boolean; resolvedBy: "verified-attribution" | "operator-decision" | null };
  reasons: string[];
}

const HEX_64 = /^[a-f0-9]{64}$/;
const REQUIRED_HASHES = ["userConfig", "codexConfig", "claudeSettings", "claudeTrust", "capacityReceipts"] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeSnapshot(snapshot: LeakSnapshot) {
  return {
    takenAt: snapshot.takenAt,
    liveWorkspace: {
      path: snapshot.liveWorkspace.path,
      projectCount: snapshot.liveWorkspace.projectCount,
      queueRevision: snapshot.liveWorkspace.queueRevision,
      productionPolicy: snapshot.liveWorkspace.productionPolicy,
      productionPolicyReceipts: snapshot.liveWorkspace.productionPolicyReceipts,
      productionAdmissions: snapshot.liveWorkspace.productionAdmissions,
      observed: snapshot.liveWorkspace.error === null
    },
    hashes: { ...snapshot.hashes },
    goBroker: { ...snapshot.goBroker },
    launchAgents: { ...snapshot.launchAgents }
  };
}

function exactTrustEntryDiff(beforeText: string, afterText: string, fixtureTrustPath: string): boolean {
  if (/[\n\r\\"]/.test(fixtureTrustPath)) return false;
  const section = `[projects."${fixtureTrustPath}"]\ntrust_level = "trusted"\n`;
  if (!afterText.endsWith(section)) return false;
  const reconstructed = afterText.slice(0, -section.length);
  return reconstructed === beforeText && !beforeText.includes(`[projects."${fixtureTrustPath}"]`);
}

function snapshotObserved(snapshot: LeakSnapshot): boolean {
  try {
    return snapshot.schema === "arcadia-leak-check-v1"
      && typeof snapshot.takenAt === "string" && !Number.isNaN(Date.parse(snapshot.takenAt))
      && snapshot.liveWorkspace.error === null
      && typeof snapshot.liveWorkspace.path === "string" && path.isAbsolute(snapshot.liveWorkspace.path)
      && Number.isSafeInteger(snapshot.liveWorkspace.projectCount) && Number(snapshot.liveWorkspace.projectCount) >= 0
      && Number.isSafeInteger(snapshot.liveWorkspace.queueRevision) && Number(snapshot.liveWorkspace.queueRevision) >= 0
      && snapshot.liveWorkspace.productionPolicy !== null
      && snapshot.liveWorkspace.productionPolicy?.desiredState === "inactive"
      && Number.isSafeInteger(snapshot.liveWorkspace.productionPolicy?.revision) && Number(snapshot.liveWorkspace.productionPolicy?.revision) >= 0
      && Number.isSafeInteger(snapshot.liveWorkspace.productionPolicy?.epoch) && Number(snapshot.liveWorkspace.productionPolicy?.epoch) >= 0
      && Number.isSafeInteger(snapshot.liveWorkspace.productionPolicyReceipts) && Number(snapshot.liveWorkspace.productionPolicyReceipts) >= 0
      && Number.isSafeInteger(snapshot.liveWorkspace.productionAdmissions) && Number(snapshot.liveWorkspace.productionAdmissions) >= 0
      && REQUIRED_HASHES.every((key) => Object.hasOwn(snapshot.hashes, key)
        && (snapshot.hashes[key] === null || (typeof snapshot.hashes[key] === "string" && HEX_64.test(snapshot.hashes[key]))))
      && Object.keys(snapshot.hashes).length === REQUIRED_HASHES.length
      && Object.values(snapshot.goBroker).every((value) => typeof value === "string" && HEX_64.test(value))
      && Object.values(snapshot.launchAgents).every((value) => typeof value === "string" && HEX_64.test(value));
  } catch {
    return false;
  }
}

export function evaluateScoutPreflight(input: ScoutPreflightInput): ScoutPreflightReceipt {
  const { pins, before, after } = input;
  const reasons: string[] = [];
  const fixtureRoot = path.resolve(pins.fixtureRoot);
  const workspace = path.resolve(pins.workspace);
  const fixtureRepo = path.resolve(pins.fixtureRepo);
  const trustPath = path.resolve(pins.fixtureTrustPath);
  const liveWorkspacePath = path.resolve(pins.liveWorkspacePath);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pins.sourceRevision)) reasons.push("source revision must be an immutable 40- or 64-character SHA");
  if (!/^v22\./.test(pins.nodeVersion)) reasons.push("runtime must be Node 22");
  if (pins.model !== "gpt-6-luna" || pins.effort !== "low") reasons.push("model and effort must be exactly gpt-6-luna/low");
  if (workspace === fixtureRoot || !workspace.startsWith(`${fixtureRoot}${path.sep}`)) reasons.push("fixture workspace must be an explicit child of the fixture root");
  if (fixtureRepo === workspace || !fixtureRepo.startsWith(`${workspace}${path.sep}`)) reasons.push("fixture repository must be an explicit child of the fixture workspace");
  if (trustPath === fixtureRepo || !trustPath.startsWith(`${fixtureRepo}${path.sep}`)
    || pins.fixtureTrustPath.includes("\\") || pins.fixtureTrustPath.includes('"')) reasons.push("fixture trust path must be a safe child of the pinned fixture repository");
  if (!path.isAbsolute(pins.liveWorkspacePath) || liveWorkspacePath === workspace || liveWorkspacePath.startsWith(`${workspace}${path.sep}`)) reasons.push("live protected workspace must be explicitly pinned and distinct from the fixture workspace");
  if (before.liveWorkspace.path !== liveWorkspacePath || after.liveWorkspace.path !== liveWorkspacePath) reasons.push("before and after snapshots must match the explicit live protected-workspace pin");
  if (!snapshotObserved(before) || !snapshotObserved(after) || unverifiableReason(before, after)) reasons.push("protected before/after observations are missing or unobserved");

  const changes = compareLeakSnapshots(before, after);
  let config: ScoutPreflightReceipt["config"] = null;
  const configChanges = changes.filter((change) => change.field === "hashes.codexConfig");
  const nonConfigChanges = changes.filter((change) => change.field !== "hashes.codexConfig");
  if (nonConfigChanges.length) reasons.push("protected state changed outside the permitted Codex fixture trust entry");
  if (configChanges.length) {
    const diff = input.codexConfigDiff;
    if (!diff || sha256(diff.before) !== before.hashes.codexConfig || sha256(diff.after) !== after.hashes.codexConfig
      || !exactTrustEntryDiff(diff.before, diff.after, path.resolve(pins.fixtureTrustPath))) {
      reasons.push("Codex config change is unattributed; exact fixture trust content proof is required");
      config = { beforeSha256: before.hashes.codexConfig ?? "", afterSha256: after.hashes.codexConfig ?? "", exactFixtureTrustChange: false };
    } else {
      config = { beforeSha256: sha256(diff.before), afterSha256: sha256(diff.after), exactFixtureTrustChange: true };
    }
  }

  const priorHoldValid = input.priorHold?.status === "unresolved";
  if (!priorHoldValid) reasons.push("prior isolation hold state is missing or invalid");
  reasons.push("prior isolation hold remains unresolved; fresh baselines or unverified approval text do not clear it");
  return {
    schema: "arcadia-scout-isolation-preflight-v1",
    verdict: reasons.length === 0 ? "ready" : "blocked",
    pins,
    before: summarizeSnapshot(before),
    after: summarizeSnapshot(after),
    config,
    priorHold: { unresolved: true, resolvedBy: null },
    reasons
  };
}

function readWithin(root: string, relative: string): Buffer {
  if (path.isAbsolute(relative)) throw new Error(`absolute manifest path refused: ${relative}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`manifest path escapes fixture root: ${relative}`);
  const real = realpathSync(target);
  const info = lstatSync(target);
  if (!real.startsWith(`${root}${path.sep}`) || info.isSymbolicLink() || !info.isFile()) throw new Error(`manifest entry is not a contained regular file: ${relative}`);
  return readFileSync(real);
}

export function verifyEvidenceManifest(fixtureRootInput: string): { checked: number; mismatches: string[] } {
  const root = realpathSync(fixtureRootInput);
  const manifest = JSON.parse(readWithin(root, "sha256-manifest.json").toString("utf8")) as Record<string, string>;
  const mismatches: string[] = [];
  for (const [relative, expected] of Object.entries(manifest)) {
    if (!HEX_64.test(expected)) { mismatches.push(relative); continue; }
    try {
      if (sha256(readWithin(root, relative)) !== expected) mismatches.push(relative);
    } catch {
      mismatches.push(relative);
    }
  }
  return { checked: Object.keys(manifest).length, mismatches };
}

function jsonWithin<T>(root: string, relative: string): T {
  return JSON.parse(readWithin(root, relative).toString("utf8")) as T;
}

export function deriveRetainedScoutObservations(input: {
  report: Record<string, any>;
  retryAsk: Record<string, any>;
  approval: Record<string, any>;
  worker: Record<string, any>;
  builder: Record<string, any>;
  builderPrompt: string;
  missingTodo: Record<string, any>;
}) {
  const requestedAction = input.retryAsk?.data?.intake?.extractedFields?.requestedAction;
  const generatedArtifact = input.retryAsk?.data?.resolvedIntent?.expectedArtifact;
  if (input.report.outcome !== "no" || input.report.fileProduced !== false || input.report.exactBytes !== false
    || input.report.run?.status !== "requires_review" || !Array.isArray(input.builder.changedFiles)
    || !Array.isArray(input.builder.validation) || !Array.isArray(input.report.builder?.validation)
    || typeof generatedArtifact !== "string" || typeof requestedAction !== "string"
    || typeof input.approval?.data?.result?.summary !== "string" || typeof input.worker.work_item_id === "undefined") {
    throw new Error("retained scout evidence is missing required typed Ask, Run, builder, or outcome observations");
  }
  const scopeRetained = requestedAction === "implement HelloWorld.txt"
    && /original constraints/i.test(String(input.report.scout?.scopeStop ?? ""));
  return {
    requestedFile: "HelloWorld.txt",
    expectedUtf8Hex: "48656c6c6f20576f726c64210a",
    expectedByteLength: 13,
    originalScopeOneFile: scopeRetained,
    generatedScopeAppendedTests: /tests/i.test(generatedArtifact),
    generatedExpectedArtifactLength: generatedArtifact.length,
    askRequiresReview: input.retryAsk?.data?.intake?.reviewRequired === true,
    promptApprovedHeading: /approved/i.test(input.builderPrompt),
    promptReviewMarker: /review/i.test(input.builderPrompt),
    promptDecisionMarker: /decision/i.test(input.builderPrompt),
    promptActionMarker: /action/i.test(input.builderPrompt),
    promptNoneMarker: /none/i.test(input.builderPrompt),
    runAbsentFromAsk: input.retryAsk?.data?.run === null,
    runAbsentFromApproval: input.approval?.data?.run === null,
    approvalClaimsResumeWithoutRun: input.approval?.data?.run == null && /resuming execution/i.test(input.approval.data.result.summary),
    runStatus: input.report.run?.status ?? null,
    actionNone: input.report.run?.work_item_id == null && input.worker.work_item_id == null,
    changedFiles: input.builder.changedFiles.length,
    validationMissingFile: input.report.builder.validation.some((item: any) => item.output?.includes("ENOENT")) === true,
    todoSourceAvailable: !(typeof input.missingTodo?.data?.askUnavailable === "string"
      || (Array.isArray(input.missingTodo?.data?.unavailable) && input.missingTodo.data.unavailable.length > 0))
  };
}

export function replayRetainedScout(fixtureRootInput: string) {
  const root = realpathSync(fixtureRootInput);
  const integrity = verifyEvidenceManifest(root);
  if (integrity.mismatches.length) throw new Error(`retained evidence integrity failed (${integrity.mismatches.length} manifest mismatch(es))`);
  const report = jsonWithin<any>(root, "report.json");
  const before = parseLeakSnapshot(readWithin(root, "arcadia-luna-scout-before.json").toString("utf8"), "retained before snapshot");
  const leakAfter = jsonWithin<any>(root, "arcadia-luna-scout-leak-after.json");
  const attribution = jsonWithin<any>(root, "arcadia-luna-scout-trust-attribution.json");
  const retryAsk = jsonWithin<any>(root, "evidence/retry-01-ask.json");
  const approval = jsonWithin<any>(root, "evidence/operator-approval.json");
  const worker = jsonWithin<any>(root, "evidence/worker-result.json");
  const builder = jsonWithin<any>(root, "builder/metadata.json");
  const builderPrompt = readWithin(root, "builder/prompt.md").toString("utf8");
  const missingTodo = jsonWithin<any>(root, "evidence/04-todo-final.json");
  const observations = deriveRetainedScoutObservations({ report, retryAsk, approval, worker, builder, builderPrompt, missingTodo });
  const trustOnlyUnresolved = report.isolation?.rawLeakCheckOk === false
    && attribution.fixtureTrustSectionFound === true && attribution.baselineHashReconstructed === false;
  const verified = [
    "The retained trial produced no exact HelloWorld.txt artifact.",
    ...(observations.originalScopeOneFile
      ? ["The retained retry Ask records the original one-file HelloWorld.txt scope before its generated artifact adds tests."] : []),
    `The recorded Run status was ${report.run?.status ?? "unavailable"}, with no work item id.`,
    "The approval packet and worker receipts did not prove an authorized completed Run.",
    "The retained source revision changed during the trial, so its source pin was not immutable.",
    "The historical Codex config delta has hashes but no successful content reconstruction."
  ];
  const hypotheses = [
    "The approval response, null Action/work-item identifiers, and pending-approval packet may jointly explain the builder refusal; the sole root cause is not isolated.",
    "The Codex config delta may be the fixture trust entry; current evidence does not prove that attribution."
  ];
  return {
    schema: "arcadia-scout-offline-replay-v1",
    evidenceIntegrity: integrity,
    productOutcome: report.outcome,
    verified,
    hypotheses,
    observations: {
      ...observations,
      trustOnlyAttribution: trustOnlyUnresolved ? "unresolved" : "not-proven",
      historicalLeakCheckRejected: leakAfter?.ok === false
    },
    historicalBeforeState: {
      observed: before.liveWorkspace.error === null,
      projectCount: before.liveWorkspace.projectCount,
      queueRevision: before.liveWorkspace.queueRevision,
      productionDesiredState: before.liveWorkspace.productionPolicy?.desiredState ?? null,
      protectedContent: { ...before.hashes }
    },
    historicalSourcePin: {
      setupRevision: report.setupSourceHead ?? null,
      finishRevision: report.finishSourceHead ?? null,
      immutable: report.setupSourceHead === report.finishSourceHead
        && /immutable/i.test(String(report.sourceRuntimePin ?? ""))
    },
    modelCallsMadeByReplay: 0,
    preflightVerdict: "blocked",
    blockers: ["Historical config hold unresolved", "Historical source/runtime pin was not immutable", "Offline replay does not resolve live Project/queue/production authority"]
  };
}
