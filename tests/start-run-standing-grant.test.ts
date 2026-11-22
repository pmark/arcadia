import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStartRunStandingPins, runStartRunGrantStatusCommand, type StartRunPinsDeps } from "../src/commands/startRun.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { assertProjectLibraryEntry, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import {
  assertStandingDecision, dayGrantLauncher, inspectDayGrantChain, isOperatorBrowserPress, standingGrantLauncher, standingGrantStatus, STANDING_SLUG, validateStandingGrantPins, type StandingDecisionSource
} from "../src/operatorActions/startRunDayGrant.js";
import { StartRunDelegationError } from "../src/operatorActions/startRunDelegation.js";
import { DAY_PLAN, DAY_RUN, dayScenarios, evidenceOf, pressKey, standingGrantPins, STOP_ID, TAILNET_PRESS_HEADERS, writeDayScenario, writeStopPress, type DayScenario } from "./helpers/dayGrantFixture.js";

/**
 * Decision 0241: the standing grant beside the day grant. It has no 24-hour window, refuses unless the Decision found by its
 * slug is answered A, B or E on the pinned main, needs the same /actions browser press, ends on an operator STOP, an
 * operator-issued Off or the revoke card (never Rowan's own Off), and leaves the failed-batch and re-press rules of Decisions
 * 0173, 0181 and 0187 as they are: the existing day-grant scenario table runs here against a standing receipt.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };
const NOW = Date.parse("2026-11-10T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SCOPE = { project: "arcadia", plan: DAY_PLAN, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130", offId: STOP_ID };
const STANDING_ID = "0241";
const code = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof StartRunDelegationError ? error.code : String(error); } return "none"; };
const decisionDoc = (answer: string | null, extra = "") => `---\nid: "${STANDING_ID}"\nstatus: ${answer === null ? "proposed" : "approved"}\n${answer === null ? "" : `answer: ${answer}\n`}---\n${extra}`;
const source = (content: string, id = STANDING_ID): StandingDecisionSource => ({ paths: [`docs/decisions/${id}-${STANDING_SLUG}.md`], read: () => content });
const ANSWERED = source(decisionDoc("E. Standing grant over your approved work queue"));

/** One standing-grant chain check over the shared fixture files. */
function standingChain(scenario: DayScenario, decision: StandingDecisionSource | null = ANSWERED, scope: Partial<typeof SCOPE> = {}, now = NOW) {
  const library = tempDir("arcadia-standing-");
  const written = writeDayScenario(library, { ...scenario, approval: { standing: true, ...scenario.approval } }, now);
  return {
    library, written,
    run: () => inspectDayGrantChain({
      library, approvalCard: written.approval.card, approvalRun: written.approval.run, approvalReceiptSha256: written.approval.receiptSha256, approvalPressSha256: written.approval.pressSha256,
      now: new Date(now), evidence: written.evidence, policyRevision: written.policyRevision, excludePress: null, scope: { ...SCOPE, ...scope }, previous: scenario.previous ?? null, attempt: scenario.attempt,
      grant: "standing", standingDecision: decision ?? undefined
    })
  };
}
/** `decision` null means no source was given at all, which is not the same as the default answered one. */
const standingCode = (scenario: DayScenario, decision: StandingDecisionSource | null = ANSWERED, scope: Partial<typeof SCOPE> = {}) => code(standingChain(scenario, decision, scope).run);

describe("Decision 0241 standing grant: no window", () => {
  it("passes a card pinned from a standing receipt pressed 30 days earlier, while a day receipt older than 24 hours is still refused", () => {
    const pressedAt = NOW - 30 * DAY;
    expect(standingCode({ label: "", code: "", approval: { pressedAt } })).toBe("none");
    const library = tempDir("arcadia-day-");
    const { approval, evidence, policyRevision } = writeDayScenario(library, { label: "", code: "", approval: { pressedAt: NOW - 25 * HOUR } }, NOW);
    const day = () => inspectDayGrantChain({
      library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: approval.receiptSha256, approvalPressSha256: approval.pressSha256,
      now: new Date(NOW), evidence, policyRevision, excludePress: null, scope: SCOPE, previous: null
    });
    expect(code(day)).toBe("WINDOW_EXPIRED");
  });

  it("records no window end, reports none, and refuses a receipt that claims one", () => {
    const chain = standingChain({ label: "", code: "", approval: { pressedAt: NOW - 400 * DAY } }).run();
    expect(chain.window.closesAt).toBeNull();
    expect(chain.window.closesAtMs).toBe(Number.POSITIVE_INFINITY);
    expect(standingCode({ label: "", code: "", approval: { pressedAt: NOW - DAY, record: { windowClosesAt: new Date(NOW).toISOString() } } })).toBe("APPROVAL_CHANGED");
  });

  it("never reads a day receipt as a standing one, or the reverse", () => {
    expect(standingCode({ label: "", code: "", approval: { standing: false } })).toBe("APPROVAL_NOT_PRESSED");
    const library = tempDir("arcadia-day-");
    const { approval, evidence, policyRevision } = writeDayScenario(library, { label: "", code: "", approval: { standing: true } }, NOW);
    expect(code(() => inspectDayGrantChain({
      library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: null, approvalPressSha256: null, now: new Date(NOW), evidence, policyRevision, excludePress: null, scope: SCOPE, previous: null
    }))).toBe("APPROVAL_NOT_PRESSED");
  });

  it("is superseded by a later standing press, as the day grant is by a later day", () => {
    const scenario: DayScenario = {
      label: "", code: "", approval: { pressedAt: NOW - 3 * HOUR },
      after: (library, _approval, now) => { void writeDayScenario(library, { label: "", code: "", approval: { standing: true, card: "approve-standing-later", run: "20261110T110000Z-888", press: "20261110110000000-later", pressedAt: now - HOUR } }, now); }
    };
    expect(standingCode(scenario)).toBe("APPROVAL_SUPERSEDED");
  });
});

describe("Decision 0241 standing grant: the Decision found by its slug", () => {
  const answers: Array<[string, string | null, string]> = [
    ["unanswered", null, "DECISION_0241_NOT_ANSWERED"],
    ["answered C", "C. Weekly grant", "DECISION_0241_NOT_ANSWERED"],
    ["answered D", "D. Keep the daily grant, fix the defects only", "DECISION_0241_NOT_ANSWERED"],
    ["answered A", "A. Standing grant for each Plan you choose", "none"],
    ["answered B", "B. Standing grant across Plans", "none"],
    ["answered E", "E. Standing grant over your approved work queue", "none"]
  ];
  it.each(answers)("%s on the pinned main", (_label, answer, expected) => {
    expect(standingCode({ label: "", code: "", approval: { pressedAt: NOW - HOUR } }, source(decisionDoc(answer)))).toBe(expected);
  });

  it("names the Decision in the refusal code and message", () => {
    const refusal = (() => { try { assertStandingDecision(source(decisionDoc("C. Weekly grant"))); } catch (error) { return error as StartRunDelegationError; } return null; })();
    expect(refusal?.code).toContain(STANDING_ID);
    expect(refusal?.message).toContain(`Decision ${STANDING_ID}`);
  });

  it("reads the answer from the frontmatter, never a line in the body that quotes option E", () => {
    expect(standingCode({ label: "", code: "", approval: {} }, source(decisionDoc("C. Weekly grant", "\nanswer: E. Standing grant over your approved work queue\n")))).toBe("DECISION_0241_NOT_ANSWERED");
  });

  it("refuses a Decision whose frontmatter id is not the one in its file name", () => {
    expect(standingCode({ label: "", code: "", approval: {} }, source(decisionDoc("E. Standing grant over your approved work queue"), "0999"))).toBe("DECISION_0999_NOT_ANSWERED");
  });

  it("refuses when the Decision cannot be found, is duplicated, cannot be read, or no source was given", () => {
    const scenario: DayScenario = { label: "", code: "", approval: {} };
    expect(standingCode(scenario, { paths: ["docs/decisions/0241-something-else.md"], read: () => "" })).toBe("STANDING_DECISION_UNREADABLE");
    expect(standingCode(scenario, { paths: [`docs/decisions/0241-${STANDING_SLUG}.md`, `docs/decisions/0242-${STANDING_SLUG}.md`], read: () => decisionDoc("E. Standing grant over your approved work queue") })).toBe("STANDING_DECISION_UNREADABLE");
    expect(standingCode(scenario, { paths: [`docs/decisions/0241-${STANDING_SLUG}.md`], read: () => { throw new Error("gone"); } })).toBe("STANDING_DECISION_UNREADABLE");
    expect(standingCode(scenario, null)).toBe("STANDING_DECISION_UNREADABLE");
  });
});

describe("Decision 0241 standing grant: the same operator press the day grant requires", () => {
  it.each<[string, DayScenario["approval"], string]>([
    ["a browser press from /actions, no delegated marker", {}, "none"],
    ["a press that did not come from a browser", { browser: false }, "APPROVAL_NOT_OPERATOR"],
    ["a delegated press", { delegated: true }, "APPROVAL_NOT_OPERATOR"],
    ["no press record at all", { noPressRecord: true }, "APPROVAL_NOT_OPERATOR"],
    ["a press record its executor run never claimed", { noClaim: true }, "APPROVAL_NOT_OPERATOR"],
    ["no one-shot marker", { noConsumedMarker: true }, "APPROVAL_NOT_PRESSED"]
  ])("%s", (_label, approval, expected) => {
    expect(standingCode({ label: "", code: "", approval })).toBe(expected);
  });

  it("takes only a browser at a non-loopback address, the check the /actions runner applies to a standing card too", () => {
    expect(isOperatorBrowserPress(TAILNET_PRESS_HEADERS)).toBe(true);
    expect(isOperatorBrowserPress({ origin: "http://127.0.0.1:3020", host: "127.0.0.1:3020" })).toBe(false);
    expect(isOperatorBrowserPress({ origin: null, host: TAILNET_PRESS_HEADERS.host })).toBe(false);
    const route = readFileSync(path.resolve(import.meta.dirname, "..", "apps/dashboard/app/api/operator-script/route.ts"), "utf8");
    expect(route).toMatch(/descriptor\.standingGrant !== undefined/);
  });
});

describe("Decision 0241 standing grant: what ends it", () => {
  const press = (card: string) => (library: string, _approval: unknown, now: number) => writeStopPress(library, now - 10 * 60_000, { card });
  it.each<[string, DayScenario, string]>([
    ["an operator STOP card press", { label: "", code: "", after: press(STOP_ID) }, "GRANT_ENDED_BY_STOP"],
    ["a STOP card of the family", { label: "", code: "", after: press("restore-off-production-other-plan") }, "GRANT_ENDED_BY_STOP"],
    ["a press of the revoke card", { label: "", code: "", after: press("revoke-standing-grant-fixture") }, "GRANT_REVOKED"],
    ["an operator-issued Off", { label: "", code: "", steps: [{ off: "dashboard-toggle-20261110" }] }, "GRANT_ENDED_BY_OFF"],
    ["an Off with an id nobody composed", { label: "", code: "", steps: [{ off: ".-plan3-pins-13-15-complete-20261115" }] }, "GRANT_ENDED_BY_OFF"],
    ["Rowan's own Off, whose request id matches rowan-off", { label: "", code: "", steps: [{ off: "rowan-off-plan3-pins-13-15-complete-20261115" }] }, "none"],
    ["a STOP card pressed before the approval", { label: "", code: "", approval: { pressedAt: NOW - HOUR }, after: (library) => writeStopPress(library, NOW - 2 * HOUR) }, "none"],
    ["a revoke card pressed before the approval", { label: "", code: "", approval: { pressedAt: NOW - HOUR }, after: (library) => writeStopPress(library, NOW - 2 * HOUR, { card: "revoke-standing-grant-fixture" }) }, "none"]
  ])("%s", (_label, scenario, expected) => {
    expect(standingCode(scenario)).toBe(expected);
  });

  it("does not let the day grant's STOP rule or the revoke card touch a day grant's code", () => {
    const library = tempDir("arcadia-day-");
    const { approval, evidence, policyRevision } = writeDayScenario(library, { label: "", code: "", after: (dir, _a, now) => writeStopPress(dir, now - 10 * 60_000) }, NOW);
    expect(code(() => inspectDayGrantChain({
      library, approvalCard: approval.card, approvalRun: approval.run, approvalReceiptSha256: null, approvalPressSha256: null, now: new Date(NOW), evidence, policyRevision, excludePress: null, scope: SCOPE, previous: null
    }))).toBe("DAY_ENDED_BY_OPERATOR");
  });
});

describe("Decision 0241 standing grant: scope", () => {
  it("refuses a card whose Plan differs from the Plan recorded as the operator's choice", () => {
    expect(standingCode({ label: "", code: "" }, ANSWERED, { plan: "some-other-plan" })).toBe("SCOPE_NOT_APPROVED");
    expect(standingCode({ label: "", code: "" }, ANSWERED, { plan: DAY_PLAN })).toBe("none");
  });
  it("refuses a card with concurrency other than 1, and a provider or spend Decision the operator did not approve", () => {
    expect(standingCode({ label: "", code: "" }, ANSWERED, { concurrency: 2 })).toBe("SCOPE_NOT_APPROVED");
    expect(standingCode({ label: "", code: "" }, ANSWERED, { provider: "codex-cli" })).toBe("SCOPE_NOT_APPROVED");
    expect(standingCode({ label: "", code: "" }, ANSWERED, { spendDecision: "0999" })).toBe("SCOPE_NOT_APPROVED");
  });
  it("pins exactly one Plan at concurrency one", () => {
    expect(validateStandingGrantPins(standingGrantPins()).concurrency).toBe(1);
    for (const bad of [{ concurrency: 2 }, { provider: "codex-cli" }, { decision: "0173" }, { schema: "arcadia-day-grant-v1" }, { extra: 1 }, { plan: "Bad Plan" }]) expect(() => validateStandingGrantPins(standingGrantPins(bad))).toThrow();
  });
});

describe("Decision 0241 standing grant: failed-batch rules and the re-press limit apply unchanged", () => {
  // The whole day-grant scenario table (Decisions 0173, 0181 and 0187), run against a standing receipt: each row keeps its refusal
  // code. Only what the 24-hour window and the day's own codes decide differs: an expired window is no refusal here, an ending
  // is GRANT_ENDED_BY_STOP or GRANT_ENDED_BY_OFF, and a later *day* approval supersedes nothing (a later standing press is tested above).
  const rows = dayScenarios(NOW).filter((scenario) => scenario.code !== "APPROVAL_SUPERSEDED");
  const expectedCode = (scenario: DayScenario) => scenario.code === "WINDOW_EXPIRED" ? "none" : scenario.code;
  it("runs the whole table", () => { expect(rows.length).toBeGreaterThan(60); });
  it.each(rows.map((scenario) => [scenario.label, scenario] as const))("%s", (_label, scenario) => {
    const library = tempDir("arcadia-standing-");
    const written = writeDayScenario(library, { ...scenario, approval: { ...scenario.approval, standing: true } }, NOW);
    const result = code(() => inspectDayGrantChain({
      library, approvalCard: written.approval.card, approvalRun: written.approval.run, approvalReceiptSha256: written.approval.receiptSha256, approvalPressSha256: written.approval.pressSha256,
      now: new Date(NOW), evidence: written.evidence, policyRevision: written.policyRevision, excludePress: null,
      scope: { ...SCOPE, ...(scenario.plan ? { plan: scenario.plan } : {}), ...(scenario.offId ? { offId: scenario.offId } : {}) }, previous: scenario.previous ?? null, attempt: scenario.attempt,
      grant: "standing", standingDecision: ANSWERED
    }));
    if (scenario.code === "DAY_ENDED_BY_OPERATOR") expect(["GRANT_ENDED_BY_STOP", "GRANT_ENDED_BY_OFF"]).toContain(result);
    else expect(result).toBe(expectedCode(scenario));
  });

  it("stops at one failed batch under a standing grant, and a clean batch leaves it open", () => {
    const failed = standingChain({
      label: "", code: "", approval: { pressedAt: NOW - 3 * HOUR }, presses: [{ card: "start-a", at: NOW - 2 * HOUR, status: "succeeded", receipt: { outcome: "succeeded", reason: "", allowanceConsumed: true } }],
      steps: [{ activate: "start-a" }, { off: "rowan-off-x" }]
    });
    expect(code(failed.run)).toBe("FAILED_BATCH");
    const clean = standingChain({
      label: "", code: "", approval: { pressedAt: NOW - 3 * HOUR }, presses: [{ card: "start-a", at: NOW - 2 * HOUR, status: "succeeded", receipt: { outcome: "succeeded", reason: "", allowanceConsumed: true } }],
      steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-x" }],
      previous: { press: pressKey("start-a"), kind: "clean-batch", cause: "scope-complete", evidence: "https://github.com/pmark/arcadia/issues/1", clearance: { kind: "observed-cleared", observation: "https://github.com/pmark/arcadia/issues/1#issuecomment-1" } }
    });
    expect(clean.run()).toMatchObject({ failedBatchesToday: 0, latest: { kind: "clean-batch" } });
  });
});

describe("arcadia start-run grant-status", () => {
  const stat = (target: string): string[] => {
    if (!statSync(target).isDirectory()) return [`${target}:${createHash("sha256").update(readFileSync(target)).digest("hex")}`];
    return readdirSync(target).sort().filter((name) => !/-(wal|shm)$/.test(name)).flatMap((name) => stat(path.join(target, name)));
  };
  function fixture(scenario: DayScenario, decision: string | null = "E. Standing grant over your approved work queue") {
    const repository = tempDir("arcadia-grant-status-");
    const library = path.join(repository, "artifacts", "generated", "operator-scripts");
    mkdirSync(library, { recursive: true });
    const workspace = path.join(tempDir("arcadia-grant-status-ws-"), "workspace");
    initWorkspace(workspace);
    const written = writeDayScenario(library, { ...scenario, approval: { standing: true, ...scenario.approval } }, NOW);
    const decisionFile = `docs/decisions/${STANDING_ID}-${STANDING_SLUG}.md`;
    const deps: StartRunPinsDeps = {
      git: (_repo, args) => {
        if (args[0] === "ls-remote") return Buffer.from(`${"a".repeat(40)}\trefs/heads/main\n`);
        if (args[0] === "ls-tree") return Buffer.from(`${decisionFile}\n`);
        if (args[0] === "show") return Buffer.from(decisionDoc(decision));
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      now: () => new Date(NOW), launchctlList: () => "", production: () => { throw new Error("unused"); }, queue: () => { throw new Error("unused"); }, listFiles: () => [], sha256File: () => "",
      dayEvidence: () => written.evidence
    };
    return { repository, library, workspace, deps };
  }

  it("reports open, plan, approvalRun and endedBy for an open grant, and mutates nothing", () => {
    const { repository, library, workspace, deps } = fixture({ label: "", code: "", approval: { pressedAt: NOW - 30 * DAY } });
    const before = [...stat(library), ...stat(workspace)];
    const { data } = runStartRunGrantStatusCommand({ repository, workspace, library }, deps);
    expect(data).toMatchObject({ open: true, plan: DAY_PLAN, approvalRun: DAY_RUN, endedBy: null, reason: null });
    expect(Object.keys(data)).toEqual(expect.arrayContaining(["open", "plan", "approvalRun", "endedBy"]));
    expect([...stat(library), ...stat(workspace)]).toEqual(before);
  });

  it("fetches origin main once before reading the Decision, so a commit missing locally is not 'not a tree object' (#2969)", () => {
    const { repository, library, workspace, deps } = fixture({ label: "", code: "", approval: { pressedAt: NOW - 30 * DAY } });
    let fetched = false;
    const fetches: string[] = [];
    const unfetched: StartRunPinsDeps = {
      ...deps,
      git: (repo, args) => { if (!fetched && (args[0] === "ls-tree" || args[0] === "show")) throw new Error("fatal: not a tree object"); return deps.git(repo, args); },
      fetchOriginMain: (repo) => { fetches.push(repo); fetched = true; }
    };
    expect(runStartRunGrantStatusCommand({ repository, workspace, library }, unfetched).data).toMatchObject({ open: true, plan: DAY_PLAN });
    expect(fetches).toHaveLength(1);
  });

  it.each<[string, DayScenario, string | null, string | null]>([
    ["an operator STOP card", { label: "", code: "", after: (library, _a, now) => writeStopPress(library, now - 600_000) }, "stop-card", null],
    ["the revoke card", { label: "", code: "", after: (library, _a, now) => writeStopPress(library, now - 600_000, { card: "revoke-standing-grant-fixture" }) }, "revoke-card", null],
    ["an operator-issued Off", { label: "", code: "", steps: [{ off: "dashboard-toggle-1" }] }, "operator-off", null],
    ["Rowan's own Off", { label: "", code: "", steps: [{ off: "rowan-off-plan-complete" }] }, null, null]
  ])("names what ended it: %s", (_label, scenario, endedBy) => {
    const { repository, library, workspace, deps } = fixture(scenario);
    const { data } = runStartRunGrantStatusCommand({ repository, workspace, library }, deps);
    expect(data.endedBy).toBe(endedBy);
    expect(data.open).toBe(endedBy === null);
    expect(data.approvalRun).toBe(DAY_RUN);
  });

  it("is closed, with the Decision named, while Decision 0241 is not answered A, B or E", () => {
    const { repository, library, workspace, deps } = fixture({ label: "", code: "" }, "C. Weekly grant");
    const { data } = runStartRunGrantStatusCommand({ repository, workspace, library }, deps);
    expect(data).toMatchObject({ open: false, endedBy: null, reason: { code: "DECISION_0241_NOT_ANSWERED" } });
  });

  it("is closed with no card pressed", () => {
    const evidence = evidenceOf(83, NOW, []).evidence;
    expect(standingGrantStatus({ library: tempDir("arcadia-empty-"), now: new Date(NOW), evidence, offId: STOP_ID, standingDecision: ANSWERED }))
      .toEqual({ open: false, plan: null, approvalCard: null, approvalRun: null, endedBy: null, reason: { code: "NO_STANDING_GRANT", message: expect.any(String) } });
  });

  it("is closed for a day-grant approval, which is not a standing one", () => {
    const library = tempDir("arcadia-day-only-");
    const { evidence } = writeDayScenario(library, { label: "", code: "" }, NOW);
    expect(standingGrantStatus({ library, now: new Date(NOW), evidence, offId: STOP_ID, standingDecision: ANSWERED }).open).toBe(false);
  });
});

describe("Decision 0241 standing-grant card and pins", () => {
  const descriptor = (overrides: Partial<OperatorScriptDescriptor> = {}, id = "approve-standing"): OperatorScriptDescriptor => ({
    schema: "arcadia-operator-script-v1", id, kind: "grant", title: "Approve the standing grant", script: `${id}.sh`, repeatable: false, expires_at: "2026-11-11T00:00:00Z",
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    standingGrant: standingGrantPins() as never, ...overrides
  });
  it("accepts the exact standing launcher and one-shot grant, and nothing else", () => {
    expect(validateOperatorScriptContract(descriptor(), "approve-standing", standingGrantLauncher("approve-standing")).standingGrant).toBeDefined();
    expect(standingGrantLauncher("approve-standing")).toContain("scripts/standing-grant.sh");
    expect(() => validateOperatorScriptContract(descriptor(), "approve-standing", dayGrantLauncher("approve-standing"))).toThrow(/shared standing-grant launcher/);
    expect(() => validateOperatorScriptContract(descriptor({ repeatable: true }), "approve-standing", standingGrantLauncher("approve-standing"))).toThrow(/one-shot/);
    expect(() => validateOperatorScriptContract(descriptor({ standingGrant: undefined }), "approve-standing", standingGrantLauncher("approve-standing"))).toThrow(/pinned standingGrant/);
    expect(() => assertProjectLibraryEntry({ ...descriptor(), project: "other" }, "other")).toThrow(/standingGrant/);
  });

  it("refuses to pin a card unless the Decision is answered A, B or E on origin main", () => {
    const repository = tempDir("arcadia-standing-pins-");
    const files: Record<string, string> = {
      "scripts/standing-grant.sh": "#!/bin/sh\n", "PROJECT.md": `---\nslug: arcadia\nactive_plan: ${DAY_PLAN}\n---\n`,
      [`docs/plans/${DAY_PLAN}.md`]: `---\nslug: ${DAY_PLAN}\nproject: arcadia\nstatus: active\n---\n`
    };
    const pins = (answer: string | null) => buildStartRunStandingPins({ plan: DAY_PLAN, expiresHours: 12, repository }, {
      git: (_repo, args) => {
        if (args[0] === "ls-remote") return Buffer.from(`${"a".repeat(40)}\trefs/heads/main\n`);
        if (args[0] === "ls-tree") return Buffer.from(`docs/decisions/${STANDING_ID}-${STANDING_SLUG}.md\n`);
        const spec = args[1].slice(args[1].indexOf(":") + 1);
        if (spec.startsWith("docs/decisions/")) return Buffer.from(decisionDoc(answer));
        if (files[spec] === undefined) throw new Error("missing");
        return Buffer.from(files[spec]);
      },
      now: () => new Date(NOW), launchctlList: () => "", production: () => { throw new Error("unused"); }, queue: () => { throw new Error("unused"); }, listFiles: () => [], sha256File: () => ""
    });
    expect(() => pins("D. Keep the daily grant, fix the defects only")).toThrow(/Decision 0241/);
    expect(() => pins(null)).toThrow(/Decision 0241/);
    const built = pins("B. Standing grant across Plans");
    expect(built.standingGrant).toMatchObject({ schema: "arcadia-standing-grant-v1", decision: "0241", plan: DAY_PLAN, concurrency: 1, provider: "claude-code-cli" });
    expect(Object.keys(built)).not.toContain("dayGrant");
  });
});
