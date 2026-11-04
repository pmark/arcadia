import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildStartRunDayPins, buildStartRunPins, runStartRunDayEvidenceCommand, type StartRunPinsDeps, type StartRunPinsOptions } from "../src/commands/startRun.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { validateOperatorScriptContract, assertProjectLibraryEntry, startRunLauncher, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { dayGrantLauncher, inspectDayGrantChain, isOperatorBrowserPress, refusalKey, validateDayGrantDelegation, validateDayGrantPins, validateDayGrantPrevious } from "../src/operatorActions/startRunDayGrant.js";
import { delegatedPressMarker, StartRunDelegationError } from "../src/operatorActions/startRunDelegation.js";
import { validateStartRunPins, type StartRunPins } from "../src/operatorActions/startRunPins.js";
import { ensureProductionPolicyTables, readDayGrantEvidence } from "../src/production/policy.js";
import { DAY_CARD, DAY_PLAN, DAY_RUN, dayGrantPins, dayScenarios, evidenceOf, named, pressKey, TAILNET_PRESS_HEADERS, writeDayApproval, writeDayScenario, writeStartPress } from "./helpers/dayGrantFixture.js";

/**
 * Decision 0173: the computation behind `start-run pins --day-grant-from`, the day-grant card and its executor, the press
 * marker, the production record, and the same scenario table the executor runs in tests/start-run-executor.test.ts.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(repoRoot, "tests", "fixtures", "start-run");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const NOW = Date.parse("2026-11-10T12:00:00Z");
const SCOPE = { project: "arcadia", plan: DAY_PLAN, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130" };
const code = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof StartRunDelegationError ? error.code : String(error); } return "none"; };

describe("Decision 0173 chain", () => {
  it.each(dayScenarios(NOW).map((scenario) => [scenario.label, scenario] as const))("%s", (_label, scenario) => {
    const library = tempDir("arcadia-day-");
    const written = writeDayScenario(library, scenario, NOW);
    const result = code(() => inspectDayGrantChain({
      library, approvalCard: written.approval.card, approvalRun: written.approval.run, approvalReceiptSha256: written.approval.receiptSha256, approvalPressSha256: written.approval.pressSha256,
      now: new Date(NOW), evidence: written.evidence, policyRevision: written.policyRevision, excludePress: null, scope: scenario.plan ? { ...SCOPE, plan: scenario.plan } : SCOPE,
      previous: scenario.previous ?? null, attempt: scenario.attempt
    }));
    expect(result).toBe(scenario.code);
  });

  it("counts attempts across days: yesterday's attempt still uses one of the three", () => {
    const library = tempDir("arcadia-day-");
    const { approval, ...rest } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 3_600_000, baseline: 91 } }, NOW);
    writeStartPress(library, { card: "start-yesterday", at: NOW - 30 * 3_600_000, status: "succeeded", receipt: { outcome: "succeeded", reason: "", allowanceConsumed: true } }, 0);
    // Before the approval: production's record of it is older than the baseline, and it is still an attempt under Decision 0170.
    const evidence = { transitions: rest.evidence.transitions, activations: [{ requestId: "start-yesterday", revisionAfter: 90, at: new Date(NOW - 30 * 3_600_000).toISOString(), admitted: 1 }] };
    const chain = inspectDayGrantChain({
      library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256,
      now: new Date(NOW), evidence, policyRevision: 91, excludePress: null, scope: SCOPE, previous: named(pressKey("start-yesterday"), "stuck-run", "failed-attempt"), attempt: 2
    });
    expect(chain).toMatchObject({ attemptsSoFar: 1, rePressesToday: 0, latest: { press: pressKey("start-yesterday"), kind: "failed-attempt" } });
  });

  it("counts a dashboard reactivation that admitted a Session as an attempt, since an undercount is the worse error", () => {
    const library = tempDir("arcadia-day-");
    const { approval } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 3_600_000, baseline: 91 } }, NOW);
    const base = { library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, now: new Date(NOW), policyRevision: 91, excludePress: null, scope: SCOPE, previous: null };
    const evidence = { transitions: [], activations: [{ requestId: "dashboard-toggle-1-abcd", revisionAfter: 90, at: new Date(NOW - 30 * 3_600_000).toISOString(), admitted: 1 }] };
    expect(inspectDayGrantChain({ ...base, evidence, attempt: 2 }).attemptsSoFar).toBe(1);
    expect(code(() => inspectDayGrantChain({ ...base, evidence, attempt: 1 }))).toBe("ATTEMPT_MISMATCH");
  });

  it("refuses a press directory it cannot list, instead of reading it as no earlier press", () => {
    const library = tempDir("arcadia-day-");
    const { approval } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 3_600_000 } }, NOW);
    const unreadable = path.join(library, "runs", "operator", "start-unlistable");
    mkdirSync(unreadable, { recursive: true });
    chmodSync(unreadable, 0o000);
    try {
      expect(code(() => inspectDayGrantChain({ library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, now: new Date(NOW), evidence: { transitions: [], activations: [] }, policyRevision: 83, excludePress: null, scope: SCOPE, previous: null, attempt: 1 }))).toBe("PRESS_UNREADABLE");
    } finally { chmodSync(unreadable, 0o755); }
  });

  it("treats a stray file in the press tree as no press", () => {
    const library = tempDir("arcadia-day-");
    const { approval } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 3_600_000 } }, NOW);
    writeFileSync(path.join(library, "runs", "operator", ".DS_Store"), "x");
    writeFileSync(path.join(library, "runs", "operator", DAY_CARD, ".DS_Store"), "x");
    expect(inspectDayGrantChain({ library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, now: new Date(NOW), evidence: { transitions: [], activations: [] }, policyRevision: 83, excludePress: null, scope: SCOPE, previous: null, attempt: 1 }).latest).toBeNull();
  });

  it("does not count a START before Decision 0170 as an attempt, on either record", () => {
    const library = tempDir("arcadia-day-");
    const { approval } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 3_600_000, baseline: 91 } }, NOW);
    writeStartPress(library, { card: "start-before-0170", at: Date.parse("2026-11-02T06:33:24Z"), status: "succeeded", receipt: { outcome: "succeeded", reason: "" } }, 0);
    const chain = inspectDayGrantChain({
      library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256,
      now: new Date(NOW), evidence: { transitions: [], activations: [] }, policyRevision: 91, excludePress: null, scope: SCOPE, previous: null, attempt: 1
    });
    expect(chain).toMatchObject({ attemptsSoFar: 0, latest: null });
  });

  it("ends the day at hour 24 exactly and opens the window from the press", () => {
    const library = tempDir("arcadia-day-");
    const pressedAt = NOW - 3_600_000;
    const approval = writeDayApproval(library, { pressedAt });
    const at = (ms: number) => code(() => inspectDayGrantChain({ library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, now: new Date(ms), evidence: { transitions: [], activations: [] }, policyRevision: 83, excludePress: null, scope: SCOPE, previous: null, attempt: 1 }));
    expect(at(pressedAt)).toBe("none");
    expect(at(pressedAt + 24 * 3_600_000 - 1)).toBe("none");
    expect(at(pressedAt + 24 * 3_600_000)).toBe("WINDOW_EXPIRED");
    expect(at(pressedAt - 1)).toBe("WINDOW_EXPIRED");
  });

  it("excludes only the press running now, so a re-press of the same card still counts its earlier press", () => {
    const library = tempDir("arcadia-day-");
    const approval = writeDayApproval(library, { pressedAt: NOW - 3_600_000 });
    writeStartPress(library, { card: "start-a", at: NOW - 600_000, receipt: {} }, 0);
    const base = { library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, now: new Date(NOW), evidence: { transitions: [], activations: [] }, policyRevision: 83, scope: SCOPE };
    expect(inspectDayGrantChain({ ...base, excludePress: "another-press" }).latest).toEqual({ press: pressKey("start-a"), kind: "no-session" });
    expect(inspectDayGrantChain({ ...base, excludePress: "20261104000000000-start-a" }).latest).toBeNull();
  });

  it("names a refusal by phase and reason with run-specific numbers and ids removed", () => {
    expect(refusalKey({ phase: "P1", reason: "origin main is abc1234def, not 9876fed at 2026-11-04T08:41:35Z" })).toBe(refusalKey({ phase: "P1", reason: "origin main is 111aaaa2222, not 333bbbb at 2026-11-05T01:02:03Z" }));
    expect(refusalKey({ phase: "P1", reason: "origin moved" })).not.toBe(refusalKey({ phase: "P2", reason: "origin moved" }));
    expect(refusalKey(null)).toBeNull();
  });
});

describe("Decision 0173 press marker and the /actions gate", () => {
  const card = { startRun: { delegation: { decision: "0173", approvalCard: DAY_CARD, approvalRun: DAY_RUN } as never } };
  const markerCode = (descriptor: Parameters<typeof delegatedPressMarker>[0], requested: unknown) => code(() => delegatedPressMarker(descriptor, requested));
  it("records Rowan's press as delegated, never as the operator's", () => {
    expect(delegatedPressMarker(card, { decision: "0173", agent: "rowan" })).toEqual({ kind: "delegated", agent: "rowan", decision: "0173", originatingRun: `${DAY_CARD}/${DAY_RUN}` });
    expect(markerCode(card, undefined)).toBe("DELEGATED_CARD");
    expect(markerCode(card, { decision: "0163", agent: "rowan" })).toBe("INVALID_DELEGATED_PRESS");
    expect(markerCode(card, { decision: "0173", agent: "operator" })).toBe("INVALID_DELEGATED_PRESS");
  });
  it("refuses a delegated press of a day-grant card, which never counts as the approval", () => {
    expect(markerCode({ startRun: undefined }, { decision: "0173", agent: "rowan" })).toBe("NOT_DELEGATED_CARD");
  });
  it("leaves an ordinary operator press of an ordinary card recording nothing", () => {
    expect(delegatedPressMarker({ startRun: {} }, undefined)).toBeNull();
  });
  it("takes a press from a browser at the Tailnet address, where browsers send Origin and no Sec-Fetch headers", () => {
    expect(isOperatorBrowserPress(TAILNET_PRESS_HEADERS)).toBe(true);
    // Through `tailscale serve`, if it keeps the Host: https with no port.
    expect(isOperatorBrowserPress({ origin: "https://arcadia-1.alpine-rattlesnake.ts.net", host: "arcadia-1.alpine-rattlesnake.ts.net" })).toBe(true);
  });
  it.each<[string, { origin: string | null; host: string | null }]>([
    ["a scripted POST with no Origin", { origin: null, host: TAILNET_PRESS_HEADERS.host }],
    ["a request with no Host", { origin: TAILNET_PRESS_HEADERS.origin, host: null }],
    ["the opaque Origin", { origin: "null", host: TAILNET_PRESS_HEADERS.host }],
    ["an Origin on another port", { origin: "http://arcadia-1.alpine-rattlesnake.ts.net:3030", host: TAILNET_PRESS_HEADERS.host }],
    ["an Origin on another host", { origin: "http://elsewhere.example:3020", host: TAILNET_PRESS_HEADERS.host }],
    ["an Origin with a path", { origin: `${TAILNET_PRESS_HEADERS.origin}/actions`, host: TAILNET_PRESS_HEADERS.host }],
    ["another scheme", { origin: "file://arcadia-1.alpine-rattlesnake.ts.net:3020", host: TAILNET_PRESS_HEADERS.host }],
    ["the host's own browser at 127.0.0.1", { origin: "http://127.0.0.1:3020", host: "127.0.0.1:3020" }],
    ["the host's own browser at localhost", { origin: "http://localhost:3020", host: "localhost:3020" }],
    ["a name under localhost", { origin: "http://arcadia.localhost:3020", host: "arcadia.localhost:3020" }],
    ["IPv6 loopback", { origin: "http://[::1]:3020", host: "[::1]:3020" }],
    ["the rest of 127/8", { origin: "http://127.1.2.3:3020", host: "127.1.2.3:3020" }],
    ["the IPv4-mapped loopback", { origin: "http://[::ffff:7f00:1]:3020", host: "[::ffff:7f00:1]:3020" }],
    ["the any address", { origin: "http://0.0.0.0:3020", host: "0.0.0.0:3020" }],
    ["a loopback Host behind a Tailnet Origin", { origin: TAILNET_PRESS_HEADERS.origin, host: "127.0.0.1:3020" }]
  ])("refuses %s", (_label, headers) => {
    expect(isOperatorBrowserPress(headers)).toBe(false);
  });
});

describe("Decision 0173 card and block contracts", () => {
  const descriptor = (overrides: Partial<OperatorScriptDescriptor> = {}, id = "approve-day"): OperatorScriptDescriptor => ({
    schema: "arcadia-operator-script-v1", id, kind: "grant", title: "Approve a day", script: `${id}.sh`, repeatable: false, expires_at: "2026-11-05T00:00:00Z",
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    dayGrant: dayGrantPins() as never, ...overrides
  });
  it("refuses a START card that also carries a day-grant block, so a press can never run the one under the other's gate", () => {
    const pinsWithBoth = pins(undefined);
    delete (pinsWithBoth as { delegation?: unknown }).delegation;
    pinsWithBoth.requiredDecisions = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"];
    const card = descriptor({ startRun: pinsWithBoth as never }, "approve-day");
    expect(() => validateOperatorScriptContract(card, "approve-day", startRunLauncher("approve-day"))).toThrow(/no other capability/);
    expect(() => validateOperatorScriptContract(card, "approve-day", dayGrantLauncher("approve-day"))).toThrow(/no other capability/);
  });
  it("accepts the exact launcher and one-shot grant, and nothing else", () => {
    expect(validateOperatorScriptContract(descriptor(), "approve-day", dayGrantLauncher("approve-day")).dayGrant).toBeDefined();
    expect(() => validateOperatorScriptContract(descriptor(), "approve-day", "#!/bin/sh\narcadia production activate\n")).toThrow(/shared day-grant launcher/);
    expect(() => validateOperatorScriptContract(descriptor({ repeatable: true }), "approve-day", dayGrantLauncher("approve-day"))).toThrow(/one-shot/);
    expect(() => validateOperatorScriptContract(descriptor({ expires_at: undefined }), "approve-day", dayGrantLauncher("approve-day"))).toThrow(/one-shot/);
    expect(() => validateOperatorScriptContract(descriptor({ dayGrant: undefined }), "approve-day", dayGrantLauncher("approve-day"))).toThrow(/pinned dayGrant/);
    expect(() => assertProjectLibraryEntry({ ...descriptor(), project: "other" }, "other")).toThrow(/dayGrant/);
  });
  it("pins exactly the day's scope at concurrency one", () => {
    expect(validateDayGrantPins(dayGrantPins()).concurrency).toBe(1);
    for (const bad of [{ concurrency: 2 }, { provider: "codex-cli" }, { decision: "0163" }, { extra: 1 }, { plan: "Bad Plan" }]) expect(() => validateDayGrantPins(dayGrantPins(bad))).toThrow();
  });
  const block = (overrides: Record<string, unknown> = {}) => ({ decision: "0173", approvalCard: DAY_CARD, approvalRun: DAY_RUN, approvalReceiptSha256: "a".repeat(64), approvalPressSha256: "b".repeat(64), attempt: 2, previous: named(pressKey("start-a"), "stuck-run", "failed-attempt"), ...overrides });
  it("needs a named cause, an evidence pointer and a clearance on a successor", () => {
    expect(validateDayGrantDelegation(block()).attempt).toBe(2);
    expect(() => validateDayGrantDelegation(block({ attempt: 4 }))).toThrow(/1 to 3/);
    const previous = named(pressKey("start-a"), "stuck-run", "failed-attempt");
    expect(() => validateDayGrantPrevious({ ...previous, cause: "Not A Slug" })).toThrow(/slug/);
    expect(() => validateDayGrantPrevious({ ...previous, evidence: "/absolute/path" })).toThrow(/evidence/);
    expect(() => validateDayGrantPrevious({ ...previous, clearance: { kind: "because" } })).toThrow(/clearance/);
    expect(() => validateDayGrantPrevious({ ...previous, clearance: { kind: "merged-fix", pullRequest: "https://github.com/pmark/arcadia/pull/1", commit: "short", reproduction: "tests/x.test.ts" } })).toThrow(/commit/);
    expect(validateDayGrantPrevious({ ...previous, clearance: { kind: "merged-fix", pullRequest: "https://github.com/pmark/arcadia/pull/1", commit: "c".repeat(40), reproduction: "tests/x.test.ts" } }).clearance.kind).toBe("merged-fix");
  });
  const pins = (delegation: unknown, overrides: Partial<StartRunPins> = {}) => ({
    schema: "arcadia-start-run-v1", reviewedRevision: "a".repeat(40), executorSha256: "b".repeat(64), workspace: "martianrover", project: "arcadia", plan: "any-active-plan", actions: ["whatever-the-queue-holds"],
    provider: "claude-code-cli", transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24, intent: "i", spendDecision: "0130", integrationDecision: "0058",
    requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0170", "0173"], requiredFiles: ["scripts/start-run.sh"],
    production: { revision: 1, epoch: 1 }, queueRevision: 1, workerLabel: "com.arcadia.local.1.worker", gateCardId: "gate", offId: "off", grantedBy: "Rowan", consumedHistory: [{ path: "/abs/x.consumed.json", sha256: "c".repeat(64) }], delegation, ...overrides
  });
  it("binds a START card to the active Plan's queue, not to a hard-coded Action list, and requires Decisions 0163, 0170 and 0173", () => {
    expect(() => validateStartRunPins(pins(block()))).not.toThrow();
    expect(() => validateStartRunPins(pins(block(), { requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0173"] }))).toThrow(/Decision 0170/);
    expect(() => validateStartRunPins(pins(block(), { requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0170"] }))).toThrow(/Decision 0173/);
    expect(() => validateStartRunPins(pins(block({ extra: 1 })))).toThrow(/exactly/);
  });
});

describe("Decision 0173 production record", () => {
  it("counts only committed admissions of each activation as an admitted Session", () => {
    const db = new Database(":memory:");
    ensureProductionPolicyTables(db);
    const receipt = db.prepare(`INSERT INTO production_policy_receipts (id, request_id, transition, revision_before, revision_after, epoch_after, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, 1, '{}', ?)`);
    receipt.run("r0", "older-card", "activate", 89, 90, "2026-11-02T06:33:24.000Z");
    receipt.run("r1", "start-a", "activate", 91, 92, "2026-11-04T08:45:00.000Z");
    receipt.run("r2", "rowan-off-a", "deactivate", 92, 93, "2026-11-04T10:00:00.000Z");
    receipt.run("r3", "start-b", "activate", 93, 94, "2026-11-04T11:00:00.000Z");
    const admission = db.prepare(`INSERT INTO production_admissions (id, request_id, action_key, project_slug, plan_slug, provider, epoch, policy_revision, status, issued_at, expires_at, committed_at) VALUES (?, ?, 'arcadia/a', 'arcadia', 'p', 'claude-code-cli', 1, ?, ?, 'x', 'y', ?)`);
    admission.run("a1", "a1", 92, "released", "2026-11-04T09:00:00.000Z");
    admission.run("a2", "a2", 94, "fenced", null);
    admission.run("a3", "a3", 94, "released", null);
    const evidence = readDayGrantEvidence(db, "2026-11-03T19:26:51Z");
    expect(evidence.activations).toEqual([
      { requestId: "start-a", revisionAfter: 92, at: "2026-11-04T08:45:00.000Z", admitted: 1 },
      { requestId: "start-b", revisionAfter: 94, at: "2026-11-04T11:00:00.000Z", admitted: 0 }
    ]);
    expect(evidence.transitions.map((t) => t.requestId)).toEqual(["start-a", "rowan-off-a", "start-b"]);
    db.close();
  });
});

describe("arcadia start-run day-evidence", () => {
  it("reads an empty production record from a fresh workspace, read-only", () => {
    const workspace = path.join(tempDir("arcadia-day-evidence-"), "workspace");
    initWorkspace(workspace);
    expect(runStartRunDayEvidenceCommand({ workspace }).data).toEqual({ transitions: [], activations: [] });
  });
});

describe("arcadia start-run pins --day-grant-from and day-pins", () => {
  const PIN = "a".repeat(40);
  const decisionDoc = (answer: string) => `---\nstatus: approved\nanswer: ${answer}\n---\n`;
  const allDecisions = ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163", "0170"];
  function fixture(options: { answer?: string; decisionBody?: string; planStatus?: string; pointer?: string; workers?: string; evidence?: ReturnType<typeof evidenceOf>["evidence"] } = {}) {
    const repository = tempDir("arcadia-day-pins-");
    const library = path.join(repository, "artifacts", "generated", "operator-scripts");
    mkdirSync(library, { recursive: true });
    const decisions: Record<string, string> = Object.fromEntries(allDecisions.map((id) => [id, decisionDoc("Yes")]));
    decisions["0173"] = decisionDoc(options.answer ?? '"A. Daily grant: START and routine run operations"') + (options.decisionBody ?? "");
    const files: Record<string, string> = {
      "scripts/start-run.sh": "#!/bin/sh\n", "scripts/day-grant.sh": "#!/bin/sh\n# day\n", "src/sessions/tmuxLauncher.ts": "x", "src/production/workerMerge.ts": "x", "tests/replay.test.ts": "x",
      [`docs/plans/${DAY_PLAN}.md`]: `---\nslug: ${DAY_PLAN}\nproject: arcadia\nstatus: ${options.planStatus ?? "active"}\nactions:\n  - id: first-action\n    status: open\n---\n`,
      "PROJECT.md": `---\nslug: arcadia\nactive_plan: ${options.pointer ?? DAY_PLAN}\n---\n`
    };
    const deps: StartRunPinsDeps = {
      git: (_repo, args) => {
        if (args[0] === "ls-remote") return Buffer.from(`${PIN}\trefs/heads/main\n`);
        if (args[0] === "rev-parse") return Buffer.from(path.join(repository, ".git") + "\n");
        if (args[0] === "ls-tree") return Buffer.from(Object.keys(decisions).map((id) => `docs/decisions/${id}-fixture.md`).join("\n") + "\n");
        if (args[0] === "merge-base") { if (args[2] === "c".repeat(40)) return Buffer.from(""); throw new Error("not an ancestor"); }
        if (args[0] === "show") {
          const spec = args[1].slice(args[1].indexOf(":") + 1);
          const id = /^docs\/decisions\/(\d{4})-/.exec(spec)?.[1];
          const content = id ? decisions[id] : files[spec];
          if (content === undefined) throw new Error("missing");
          return Buffer.from(content);
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      now: () => new Date(NOW),
      launchctlList: () => "123\t0\tcom.arcadia.local.1.worker\n",
      production: () => ({ workspacePath: "/w/martianrover", desiredState: "inactive", revision: 83, epoch: 46, liveAdmissions: 0 }),
      queue: () => ({ revision: 290, orderValid: true, unpositionedCount: 0, ordered: [{ orderKey: "arcadia/first-action" }] }),
      listFiles: (directory) => directory === library ? ["earlier.consumed.json", "enable-capacity-gate-20261017.json", "restore-off-production-bug-plan-first-supervised-run-2026-10-11.json"] : [],
      sha256File: (file) => sha(path.basename(file)),
      dayEvidence: () => options.evidence ?? { transitions: [], activations: [] }
    };
    const args: StartRunPinsOptions = { plan: DAY_PLAN, actions: "first-action", provider: "claude-code-cli", expiresHours: 12, repository, dayGrantFrom: `${DAY_CARD}/${DAY_RUN}` };
    return { deps, args, library, repository };
  }
  it("emits a first press with no cause, recording Rowan's press and the approval it rests on", () => {
    const f = fixture();
    const approval = writeDayApproval(f.library, { pressedAt: NOW - 3_600_000 });
    const { startRun } = buildStartRunPins(f.args, f.deps);
    expect(validateStartRunPins(startRun)).toBe(startRun);
    expect(startRun.delegation).toEqual({ decision: "0173", approvalCard: DAY_CARD, approvalRun: DAY_RUN, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256, attempt: 1, previous: null });
    expect(startRun.requiredDecisions).toEqual(expect.arrayContaining(["0163", "0170", "0173"]));
    expect(startRun.grantedBy).toMatch(/^Rowan, pressing this START card from \/actions under Decision 0173/);
  });
  it("takes the press and its kind from the record and only the cause from Rowan", () => {
    const f = fixture();
    writeDayApproval(f.library, { pressedAt: NOW - 3_600_000 });
    writeStartPress(f.library, { card: "start-a", at: NOW - 600_000, receipt: {} }, 0);
    expect(() => buildStartRunPins(f.args, f.deps)).toThrow(/PREVIOUS|needs its cause named/);
    const { startRun } = buildStartRunPins({ ...f.args, previousCause: "origin-moved", previousEvidence: "docs/notes.md", observedCleared: "https://github.com/pmark/arcadia/actions/runs/1" }, f.deps);
    expect(startRun.delegation).toMatchObject({ attempt: 1, previous: { press: pressKey("start-a"), kind: "no-session", cause: "origin-moved" } });
  });
  it("needs a named fix on origin main with its reproduction present", () => {
    const f = fixture();
    writeDayApproval(f.library, { pressedAt: NOW - 3_600_000 });
    writeStartPress(f.library, { card: "start-a", at: NOW - 600_000, receipt: {} }, 0);
    const fix = { previousCause: "launcher-bug", previousEvidence: "docs/notes.md", fixPullRequest: "https://github.com/pmark/arcadia/pull/2", fixCommit: "c".repeat(40), reproduction: "tests/replay.test.ts" };
    expect((buildStartRunPins({ ...f.args, ...fix }, f.deps).startRun.delegation as { previous: { clearance: { kind: string } } }).previous.clearance.kind).toBe("merged-fix");
    expect(() => buildStartRunPins({ ...f.args, ...fix, fixCommit: "d".repeat(40) }, f.deps)).toThrow(/not on origin main/);
    expect(() => buildStartRunPins({ ...f.args, ...fix, reproduction: "tests/absent.test.ts" }, f.deps)).toThrow(/absent\.test\.ts/);
    expect(() => buildStartRunPins({ ...f.args, ...fix, fixCommit: undefined }, f.deps)).toThrow(/together/);
    expect(() => buildStartRunPins({ ...f.args, ...fix, observedCleared: "docs/x.md" }, f.deps)).toThrow(/not both/);
  });
  it("refuses a clearance with no named cause, instead of recording a cause called undefined", () => {
    const f = fixture();
    writeDayApproval(f.library, { pressedAt: NOW - 3_600_000 });
    writeStartPress(f.library, { card: "start-a", at: NOW - 600_000, receipt: {} }, 0);
    expect(() => buildStartRunPins({ ...f.args, observedCleared: "docs/x.md" }, f.deps)).toThrow(/both --previous-cause and --previous-evidence/);
    expect(() => buildStartRunPins({ ...f.args, previousCause: "origin-moved", observedCleared: "docs/x.md" }, f.deps)).toThrow(/both --previous-cause and --previous-evidence/);
    expect(() => buildStartRunPins({ ...f.args, previousEvidence: "docs/y.md", observedCleared: "docs/x.md" }, f.deps)).toThrow(/both --previous-cause and --previous-evidence/);
    expect(() => buildStartRunPins({ ...f.args, previousCause: "origin-moved", previousEvidence: "docs/y.md" }, f.deps)).toThrow(/how it was cleared/);
    expect(() => buildStartRunPins({ ...f.args, previousCause: "undefined", previousEvidence: "docs/y.md", observedCleared: "docs/x.md" }, f.deps)).toThrow(/stable slug/);
    expect(() => validateDayGrantPrevious({ ...named(pressKey("start-a"), "x", "no-session"), evidence: "undefined" })).toThrow(/evidence/);
  });
  it("refuses an answer other than option A, a draft Plan, a Plan that is not active, and the other chain", () => {
    const answered = fixture({ answer: '"B. Daily grant: START and retries only"' });
    writeDayApproval(answered.library, { pressedAt: NOW - 3_600_000 });
    expect(() => buildStartRunPins(answered.args, answered.deps)).toThrow(/option A/);
    expect(() => buildStartRunDayPins({ plan: DAY_PLAN, expiresHours: 12, repository: answered.repository }, answered.deps)).toThrow(/option A/);
    const draft = fixture({ planStatus: "draft" });
    expect(() => buildStartRunPins(draft.args, draft.deps)).toThrow(/active Plan/);
    const pointer = fixture({ pointer: "another-plan" });
    expect(() => buildStartRunPins(pointer.args, pointer.deps)).toThrow(/active Plan/);
    expect(() => buildStartRunDayPins({ plan: DAY_PLAN, expiresHours: 12, repository: pointer.repository }, pointer.deps)).toThrow(/active Plan/);
    const both = fixture();
    expect(() => buildStartRunPins({ ...both.args, delegatedFrom: `${DAY_CARD}/${DAY_RUN}` }, both.deps)).toThrow(/separate chains/);
  });
  it("reads the answer from the frontmatter, not a line in the Decision's body", () => {
    const f = fixture({ answer: '"B. Daily grant: START and retries only"', decisionBody: '\nanswer: "A. Daily grant: START and routine run operations"\n' });
    writeDayApproval(f.library, { pressedAt: NOW - 3_600_000 });
    expect(() => buildStartRunPins(f.args, f.deps)).toThrow(/option A/);
    expect(() => buildStartRunDayPins({ plan: DAY_PLAN, expiresHours: 12, repository: f.repository }, f.deps)).toThrow(/option A/);
  });
  it("prints a valid day-grant block for the operator to press, with nothing else", () => {
    const f = fixture();
    const data = buildStartRunDayPins({ plan: DAY_PLAN, expiresHours: 12, repository: f.repository }, f.deps);
    expect(data.dayGrant).toEqual({ schema: "arcadia-day-grant-v1", decision: "0173", executorSha256: sha("#!/bin/sh\n# day\n"), project: "arcadia", plan: DAY_PLAN, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130" });
    expect(data.expires_at).toBe("2026-11-11T00:00:00Z");
  });
});

/** A throwaway checkout holding the real day-grant executor and a card, with a fake `arcadia` first on PATH. */
function dayCard(options: { answer?: string | null; decisionBody?: string; projectBody?: string; planBody?: string; planStatus?: string; failFinalWrite?: boolean; pointer?: string; executorPin?: string; expiresAt?: string; press?: "none" | "delegated" | "scripted" | "stale" | "other-parent" | "other-card" } = {}) {
  const root = tempDir("arcadia-day-card-");
  const repo = path.join(root, "arcadia");
  const bin = path.join(root, "bin");
  const library = path.join(repo, "artifacts", "generated", "operator-scripts");
  const executor = readFileSync(path.join(repoRoot, "scripts", "day-grant.sh"), "utf8");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(library, { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(repo, "scripts", "day-grant.sh"), executor);
  chmodSync(path.join(repo, "scripts", "day-grant.sh"), 0o755);
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(repo, "node_modules"));
  if (options.answer !== null) writeFileSync(path.join(repo, "docs", "decisions", "0173-fixture.md"), `---\nstatus: approved\nanswer: ${options.answer ?? '"A. Daily grant: START and routine run operations"'}\n---\n${options.decisionBody ?? ""}`);
  writeFileSync(path.join(repo, "PROJECT.md"), `---\nactive_plan: ${options.pointer ?? DAY_PLAN}\n---\n${options.projectBody ?? ""}`);
  writeFileSync(path.join(repo, "docs", "plans", `${DAY_PLAN}.md`), `---\nstatus: ${options.planStatus ?? "active"}\n---\n${options.planBody ?? ""}`);
  const descriptor = {
    schema: "arcadia-operator-script-v1", id: DAY_CARD, kind: "grant", title: "Approve a day", script: `${DAY_CARD}.sh`, repeatable: false, expires_at: options.expiresAt ?? new Date(Date.now() + 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    dayGrant: dayGrantPins({ executorSha256: options.executorPin ?? sha(executor) })
  };
  const descriptorPath = path.join(library, `${DAY_CARD}.json`);
  const scriptPath = path.join(library, `${DAY_CARD}.sh`);
  writeFileSync(descriptorPath, JSON.stringify(descriptor));
  writeFileSync(scriptPath, dayGrantLauncher(DAY_CARD), { mode: 0o755 });
  writeFileSync(path.join(root, "state.json"), JSON.stringify({ workspace: root, repository: repo, plan: DAY_PLAN, production: { desiredState: "inactive", revision: 91, epoch: 50, liveAdmissions: 0, authority: null }, worker: { alive: false } }));
  writeFileSync(path.join(bin, "fake-arcadia.mjs"), readFileSync(path.join(fixtures, "fake-arcadia.mjs")));
  writeFileSync(path.join(bin, "mise"), `#!/usr/bin/env bash\nexec "${path.join(fixtures, "fake-mise")}" "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), '#!/usr/bin/env bash\nshift; exec "$@"\n', { mode: 0o755 });
  // A disk that stops taking writes once the one-shot marker exists: the final approved receipt cannot land.
  if (options.failFinalWrite) writeFileSync(path.join(bin, "mv"), `#!/usr/bin/env bash\nif [[ "\${@: -1}" == */receipt.json && -e "${path.join(library, `${DAY_CARD}.consumed.json`)}" ]]; then echo "mv: disk full" >&2; exit 1; fi\nexec /bin/mv "$@"\n`, { mode: 0o755 });
  const pressId = "20261104090000000-a-press";
  const pressDir = path.join(library, "runs", "operator", DAY_CARD, pressId);
  const startedAt = new Date(Date.now() - (options.press === "stale" ? 10 * 60_000 : 1000)).toISOString();
  const run = (mode: "run" | "preflight" = "run") => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_ROOT: root, FAKE_BIN: bin, FAKE_ARCADIA_ROOT: repoRoot };
    delete env.CODEX_SANDBOX; delete env.ARCADIA_WORKSPACE; delete env.VITEST;
    if (mode === "run") {
      env.ARCADIA_OPERATOR_SCRIPT_ID = DAY_CARD; env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR = descriptorPath;
      if (options.press !== "none") {
        mkdirSync(pressDir, { recursive: true });
        writeFileSync(path.join(pressDir, "descriptor.json"), JSON.stringify(descriptor));
        writeFileSync(path.join(pressDir, "run.json"), JSON.stringify({
          schema: "arcadia-operator-script-run-v1", runId: pressId, scriptId: options.press === "other-card" ? "another-card" : DAY_CARD, status: "running", pid: options.press === "other-parent" ? 1 : process.pid, startedAt,
          ...(options.press === "scripted" ? {} : { browserPress: true }),
          ...(options.press === "delegated" ? { press: { kind: "delegated", agent: "rowan", decision: "0173", originatingRun: "x/y" } } : {})
        }));
        env.ARCADIA_OPERATOR_SCRIPT_RUN_ID = pressId; env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY = pressDir; env.ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR = path.join(pressDir, "descriptor.json");
      }
    }
    const result = spawnSync(scriptPath, [mode], { env, encoding: "utf8", timeout: 60_000 });
    const runs = existsSync(path.join(library, "runs", DAY_CARD)) ? spawnSync("ls", [path.join(library, "runs", DAY_CARD)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean) : [];
    const receiptPath = runs.length ? path.join(library, "runs", DAY_CARD, runs.at(-1)!, "receipt.json") : null;
    return { status: result.status, stderr: result.stderr, receipt: receiptPath && existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, any> : null };
  };
  return { run, library, pressDir, startedAt, marker: path.join(library, `${DAY_CARD}.consumed.json`), calls: () => existsSync(path.join(root, "calls.log")) ? readFileSync(path.join(root, "calls.log"), "utf8") : "" };
}

describe("scripts/day-grant.sh", () => {
  it("opens exactly 24 hours from the press, consumes its marker and touches nothing else", () => {
    const card = dayCard();
    const result = card.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt).toMatchObject({ schema: "arcadia-day-grant-receipt-v1", outcome: "approved", allowanceConsumed: true, mode: "run" });
    const record = result.receipt!.record;
    expect(record.pressStartedAt).toBe(card.startedAt);
    expect(Date.parse(record.windowClosesAt) - Date.parse(card.startedAt)).toBe(24 * 3_600_000);
    expect(record).toMatchObject({ policyRevisionAtApproval: 91, policyEpochAtApproval: 50, plan: DAY_PLAN, provider: "claude-code-cli", spendDecision: "0130" });
    expect(record.authority).toContain("never renews itself");
    expect(JSON.parse(readFileSync(card.marker, "utf8"))).toMatchObject({ state: "CONSUMED", requestId: DAY_CARD });
    expect(readFileSync(path.join(card.pressDir, "day-grant.claimed"), "utf8").trim()).toBe(result.receipt!.runId);
    expect(card.calls()).not.toMatch(/production (activate|deactivate)|go-broker|worker/);
    // The receipt the chain then accepts: run.json finishes, as the runner leaves it, and the pair verifies.
    const press = JSON.parse(readFileSync(path.join(card.pressDir, "run.json"), "utf8"));
    writeFileSync(path.join(card.pressDir, "run.json"), JSON.stringify({ ...press, status: "succeeded" }));
    expect(inspectDayGrantChain({ library: card.library, approvalCard: DAY_CARD, approvalRun: result.receipt!.runId, approvalReceiptSha256: null, approvalPressSha256: null, now: new Date(), evidence: { transitions: [], activations: [] }, policyRevision: 91, excludePress: null, scope: SCOPE, previous: null, attempt: 1 }).window.closesAt).toBe(new Date(Date.parse(card.startedAt) + 24 * 3_600_000).toISOString());
  });
  it("fails loudly when the approved receipt cannot be written: consumed, no day open, and it says how to recover", () => {
    const card = dayCard({ failFinalWrite: true });
    const result = card.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NO day was approved");
    expect(result.stderr).toContain("press a new day-grant card");
    expect(existsSync(card.marker)).toBe(true);
    expect(result.receipt?.outcome).not.toBe("approved");
    const run = JSON.parse(readFileSync(card.marker, "utf8")).runId as string;
    expect(code(() => inspectDayGrantChain({ library: card.library, approvalCard: DAY_CARD, approvalRun: run, approvalReceiptSha256: null, approvalPressSha256: null, now: new Date(), evidence: { transitions: [], activations: [] }, policyRevision: 91, excludePress: null, scope: SCOPE, previous: null, attempt: 1 }))).toBe("APPROVAL_NOT_PRESSED");
  });
  it("refuses a second press of the same card: a new day needs a new card and a new press", () => {
    const card = dayCard();
    expect(card.run().status).toBe(0);
    writeFileSync(path.join(card.pressDir, "day-grant.claimed"), ""); rmSync(path.join(card.pressDir, "day-grant.claimed"));
    const second = card.run();
    expect(second.status).not.toBe(0);
    expect(second.receipt).toMatchObject({ outcome: "refused", allowanceConsumed: false });
    expect(second.receipt!.reason).toMatch(/consumed/);
  });
  it.each<[string, Parameters<typeof dayCard>[0], RegExp]>([
    ["a delegated press, which never counts as the approval", { press: "delegated" }, /delegated press never counts/],
    ["a scripted press with no browser record", { press: "scripted" }, /in a browser/],
    ["no press record", { press: "none" }, /no operator press record/],
    ["a stale press record", { press: "stale" }, /not fresh/],
    ["a press record parented by another process", { press: "other-parent" }, /not parented/],
    ["a press record for another card", { press: "other-card" }, /another card/],
    ["a Decision 0173 answered another way", { answer: '"B. Daily grant: START and retries only"' }, /option A/],
    ["a missing Decision 0173", { answer: null }, /not in this checkout/],
    ["a Decision 0173 whose body quotes option A under another answer", { answer: '"B. Daily grant: START and retries only"', decisionBody: '\nanswer: "A. Daily grant: START and routine run operations"\n' }, /option A/],
    ["a PROJECT.md whose body names the Plan under another pointer", { pointer: "another-plan", projectBody: `\nactive_plan: ${DAY_PLAN}\n` }, /not the Project's active Plan/],
    ["a Plan whose body says active under another status", { planStatus: "draft", planBody: "\nstatus: active\n" }, /not active/],
    ["a Plan that is not the active Plan", { pointer: "another-plan" }, /not the Project's active Plan/],
    ["another executor than the card pins", { executorPin: "e".repeat(64) }, /not the one the card pins/],
    ["an expired card", { expiresAt: "2020-01-01T00:00:00Z" }, /expired unpressed/]
  ])("refuses %s and opens no day", (_label, options, reason) => {
    const card = dayCard(options);
    const result = card.run();
    expect(result.status).not.toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "refused", allowanceConsumed: false });
    expect(result.receipt!.reason).toMatch(reason);
    expect(existsSync(card.marker)).toBe(false);
  });
  it("preflights with no press record, approving and consuming nothing", () => {
    const card = dayCard();
    const result = card.run("preflight");
    expect(result.status, result.stderr).toBe(0);
    expect(result.receipt).toMatchObject({ outcome: "preflight_ok", allowanceConsumed: false });
    expect(existsSync(card.marker)).toBe(false);
  });
});
