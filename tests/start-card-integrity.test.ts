import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyAuthorityPaths } from "../src/decisions/batchMerge.js";
import { runProductionDeactivateCommand } from "../src/commands/production.js";
import { withDatabase } from "../src/db/connection.js";
import { readProductionPolicy } from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { START_RUN_KEYS } from "../src/operatorActions/startRunPins.js";
import {
  CARD_NOT_DERIVED, DERIVED_CARD_LIFETIME_MS, deriveStartCard, verifyDerivedCard, type DeriveInput, type DeriveResult, type FailedBatchClearance
} from "../src/operatorActions/startRunDerive.js";
import {
  DERIVER_INPUT_SOURCES, DERIVER_PATH, PINS_PATH, checkDeriverInputs, checkStartCardDeriver, checkStartRunKeys
} from "../scripts/check-start-card-deriver.js";

/**
 * Decision 0241: each START card defect recorded on 2026-11-15 replayed against the derived-card path. Every one is either
 * unrepresentable (the deriver has no input that could carry it) or refused (the press-time re-derivation or the Off guard).
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse("2026-11-15T12:00:30Z");
const sha = (char: string) => char.repeat(64);

const input = (overrides: Partial<DeriveInput> = {}): DeriveInput => ({
  originMain: "a".repeat(40), now: new Date(NOW), executorSha256: sha("e"), workspace: "martianrover", workerLabel: "com.arcadia.local.1.worker", gateCardId: "enable-capacity-gate-20261017", offId: "restore-off-production-20261017",
  grant: { open: true, plan: "the-plan", approvalCard: "approve-standing-grant", approvalRun: "20261115T000000Z-1", reason: null },
  plan: { slug: "the-plan", project: "arcadia", status: "active", isProjectActivePlan: true, actions: ["one", "two", "three"].map((id) => ({ id, status: "open", dependsOn: [], criteriaErrors: [] })) },
  production: { desiredState: "inactive", liveAdmissions: 0, revision: 90, epoch: 50 },
  queue: { revision: 290, orderValid: true, unpositionedCount: 0, keys: ["arcadia/one", "arcadia/two", "arcadia/three"] },
  chain: { receiptSha256: sha("a"), pressSha256: sha("b"), attemptsSoFar: 0, latest: null },
  consumedHistory: [{ path: "/runs/receipts/consumed-1.json", sha256: sha("c") }], ...overrides
});
const derived = (overrides: Partial<DeriveInput> = {}) => {
  const result = deriveStartCard(input(overrides));
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.card;
};
const onDisk = (card: ReturnType<typeof derived>, edit: (files: { descriptor: Record<string, any>; launcher: string; manifest: string }) => void = () => undefined) => {
  const files = { descriptor: JSON.parse(card.descriptorBytes) as Record<string, any>, launcher: card.launcher, manifest: card.manifestBytes };
  edit(files);
  return { descriptor: `${JSON.stringify(files.descriptor, null, 2)}\n`, launcher: files.launcher, manifest: files.manifest };
};

describe("recorded defect: a card minted and left 8 hours", () => {
  it("cannot exist: no input or pin carries a lifetime, and every derived card lives 40 minutes", () => {
    expect(DERIVED_CARD_LIFETIME_MS).toBe(40 * MINUTE);
    expect(START_RUN_KEYS.filter((key) => /expir|hours|lifetime|ttl/i.test(key))).toEqual(["packetApprovalHours"]);
    expect(Object.keys(DERIVER_INPUT_SOURCES).filter((key) => /expir|hours|lifetime|ttl/i.test(key))).toEqual([]);
    const card = derived();
    expect(Date.parse(card.expiresAt) - Math.floor(NOW / MINUTE) * MINUTE).toBe(40 * MINUTE);
  });

  it("is refused when pressed 8 hours later, because the press re-derives at the current minute", () => {
    const card = derived();
    const files = onDisk(card);
    const later = deriveStartCard(input({ now: new Date(NOW + 8 * HOUR) }));
    const result = verifyDerivedCard(later, files);
    expect(result).toMatchObject({ verified: false, code: CARD_NOT_DERIVED });
    expect(result.differs).toEqual(expect.arrayContaining(["expires_at", "id"]));
  });
});

describe("recorded defect: an Off with request id .-plan3-pins-13-15-complete-20261115", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("is refused with a named code and leaves the policy revision unchanged", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-card-integrity-"));
    directories.push(directory);
    const workspace = path.join(directory, "workspace");
    initWorkspace(workspace);
    const before = withDatabase(workspace, (db) => readProductionPolicy(db).revision);
    let caught: { code?: string; details?: { reason?: string } } | undefined;
    try { runProductionDeactivateCommand({ workspace, requestId: ".-plan3-pins-13-15-complete-20261115" }); } catch (error) { caught = error as typeof caught; }
    expect(caught?.code).toBe("VALIDATION_ERROR");
    expect(caught?.details?.reason).toBe("MALFORMED_REQUEST_ID");
    expect(withDatabase(workspace, (db) => readProductionPolicy(db).revision)).toBe(before);
  });
});

describe("recorded defect: a card with a hand-edited pin", () => {
  it.each([
    ["the Action list", ({ descriptor }: { descriptor: Record<string, any> }) => { descriptor.startRun.actions = descriptor.startRun.actions.slice(0, 1); }, "startRun.actions"],
    ["the Plan", ({ descriptor }: { descriptor: Record<string, any> }) => { descriptor.startRun.plan = "another-plan"; }, "startRun.plan"],
    ["the concurrency", ({ descriptor }: { descriptor: Record<string, any> }) => { descriptor.startRun.concurrency = 2; }, "startRun.concurrency"],
    ["the provider", ({ descriptor }: { descriptor: Record<string, any> }) => { descriptor.startRun.provider = "other"; }, "startRun.provider"]
  ])("is refused with CARD_NOT_DERIVED, naming the field, when %s is edited", (_label, edit, field) => {
    const card = derived();
    const result = verifyDerivedCard(deriveStartCard(input()), onDisk(card, edit));
    expect(result).toMatchObject({ verified: false, code: "CARD_NOT_DERIVED", derivedCardId: card.id });
    expect(result.differs).toContain(field);
  });

  it("passes an untouched derived card, so the refusal is the edit and nothing else", () => {
    const card = derived();
    expect(verifyDerivedCard(deriveStartCard(input()), onDisk(card))).toMatchObject({ verified: true, code: null, differs: [] });
  });
});

describe("recorded defect: a standing-grant press needing a hand-written pre-mortem pointer", () => {
  const press = (kind: "clean-batch" | "failed-attempt", clearance?: FailedBatchClearance): DeriveResult =>
    deriveStartCard(input({ chain: { receiptSha256: sha("a"), pressSha256: sha("b"), attemptsSoFar: 1, latest: { press: "card/run", kind } }, ...(clearance ? { failedBatchClearance: clearance } : {}) }));

  it("after a clean batch derives the card with no pre-mortem pointer typed anywhere", () => {
    const result = press("clean-batch");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.card.manifestBytes)).not.toHaveProperty("premortem");
    expect(result.card.descriptor.startRun).toMatchObject({ delegation: { previous: { kind: "clean-batch", clearance: { kind: "observed-cleared" } } } });
  });

  it("after a failed batch is refused with FAILED_BATCH_NEEDS_FIX until an independent pre-mortem and a merged fix are recorded", () => {
    expect(press("failed-attempt")).toMatchObject({ ok: false, reason: "FAILED_BATCH_NEEDS_FIX" });
    const recorded = press("failed-attempt", { cause: "worker-merge-race", premortem: "https://github.com/pmark/arcadia/issues/1#issuecomment-9", fix: { pullRequest: "https://github.com/pmark/arcadia/pull/2", commit: "c".repeat(40), reproduction: "src/production/workerMerge.ts" } });
    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.card.descriptor.startRun).toMatchObject({ delegation: { previous: { kind: "failed-attempt", evidence: "https://github.com/pmark/arcadia/issues/1#issuecomment-9" } } });
  });
});

describe("repository check: the deriver takes no agent-supplied input", () => {
  it("passes on the repository as it is", () => {
    expect(checkStartCardDeriver(root)).toEqual([]);
  });

  it("fails when the exported function gains a parameter", () => {
    const source = read(DERIVER_PATH).replace("export function deriveStartCard(input: DeriveInput): DeriveResult", "export function deriveStartCard(input: DeriveInput, expiresHours: number): DeriveResult");
    expect(source).not.toBe(read(DERIVER_PATH));
    expect(checkDeriverInputs(source)).toEqual([expect.stringContaining("exactly one parameter")]);
  });

  it("fails when the input type gains a field outside the fixed set", () => {
    const source = read(DERIVER_PATH).replace("export interface DeriveInput {", "export interface DeriveInput {\n  actionsToPin: string[];");
    expect(checkDeriverInputs(source)).toEqual([expect.stringContaining("gains the field actionsToPin")]);
  });

  it("fails when START_RUN_KEYS gains a key the deriver does not compute, and when the deriver computes an unlisted key", () => {
    const pins = read(PINS_PATH).replace('"actions", "concurrency"', '"actions", "typedCause", "concurrency"');
    expect(pins).not.toBe(read(PINS_PATH));
    expect(checkStartRunKeys(read(DERIVER_PATH), pins)).toEqual([expect.stringContaining("typedCause")]);
    const deriver = read(DERIVER_PATH).replace("provider: DERIVED_PROVIDER,", "provider: DERIVED_PROVIDER, extraKey: 1,");
    expect(deriver).not.toBe(read(DERIVER_PATH));
    expect(checkStartRunKeys(deriver, read(PINS_PATH))).toEqual([expect.stringContaining("extraKey")]);
  });
});

describe("authority classification of the card path", () => {
  it.each([
    DERIVER_PATH, "scripts/start-run.sh", "src/operatorActions/startRunPins.ts", "scripts/production-replay.ts"
  ])("classifies %s as an authority path, so a worker merge cannot take it", (file) => {
    const boundaries = classifyAuthorityPaths([file]);
    expect(boundaries).not.toEqual([]);
    expect(boundaries).not.toContain("unclassifiable_path");
    expect(boundaries).toContain("operator_authority");
  });
});
