import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertProjectLibraryEntry, startRunLauncher, validateOperatorScriptContract, planAmendmentLauncher, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { START_RUN_KEYS, validateStartRunPins, type StartRunPins } from "../src/operatorActions/startRunPins.js";
import { buildStartRunPins, type StartRunPinsDeps, type StartRunPinsOptions } from "../src/commands/startRun.js";

const root = path.resolve(import.meta.dirname, "..");
const PIN = "a".repeat(40);
const ID = "start-run-fixture-20261101";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

export function validPins(overrides: Partial<StartRunPins> = {}): StartRunPins {
  return {
    schema: "arcadia-start-run-v1",
    reviewedRevision: PIN,
    executorSha256: "b".repeat(64),
    workspace: "martianrover",
    project: "arcadia",
    plan: "fixture-plan",
    actions: ["first-action", "second-action", "third-action"],
    provider: "claude-code-cli",
    transitions: ["validation", "acceptance", "pointer", "packet_approval"],
    concurrency: 1,
    packetApprovalHours: 24,
    intent: "A fixture run.",
    spendDecision: "0130",
    integrationDecision: "0058",
    requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0161"],
    requiredFiles: ["scripts/start-run.sh", "src/sessions/tmuxLauncher.ts"],
    production: { revision: 83, epoch: 46 },
    queueRevision: 290,
    workerLabel: "com.arcadia.local.1.worker",
    gateCardId: "enable-capacity-gate-20261017",
    offId: "restore-off-production",
    grantedBy: "P. Mark Anderson, by pressing this per-run START card from /actions under Decisions 0156 and 0157",
    consumedHistory: [{ path: "/abs/one.consumed.json", sha256: "c".repeat(64) }],
    ...overrides
  };
}

const segmentActions = (e: { project: string; queueSegment: string[] }) => e.queueSegment.slice(0, 2).map((key) => key.slice(e.project.length + 1));
function activationInput() {
  const d = JSON.parse(readFileSync(path.join(root, "artifacts/generated/operator-scripts/activate-production-claude-plan-20261017.json"), "utf8")) as OperatorScriptDescriptor;
  return structuredClone(d.planActivation!);
}
function cardDescriptor(extra: Partial<OperatorScriptDescriptor> = {}, pins: Partial<StartRunPins> = {}): OperatorScriptDescriptor {
  return {
    schema: "arcadia-operator-script-v1", id: ID, kind: "grant", title: "START: fixture", script: `${ID}.sh`, repeatable: false,
    problem: "p", desired_effect: "e", authority: { does: ["d"], never_does: ["n"] }, success: { effect: "s", next: "n" }, failure: { effect: "f", next: "n" },
    expires_at: "2026-11-02T00:00:00Z", startRun: validPins(pins), ...extra
  };
}

describe("startRun pins validator", () => {
  it("accepts the exact field set", () => {
    const pins = validPins();
    expect(Object.keys(pins).sort()).toEqual([...START_RUN_KEYS].sort());
    expect(validateStartRunPins(pins)).toBe(pins);
  });
  it.each<[string, (p: Record<string, unknown>) => void]>([
    ["an extra field", (p) => { p.extra = 1; }],
    ["a missing field", (p) => { delete p.queueRevision; }],
    ["a short revision", (p) => { p.reviewedRevision = "abc123"; }],
    ["an uppercase revision", (p) => { p.reviewedRevision = "A".repeat(40); }],
    ["a bad executor hash", (p) => { p.executorSha256 = "z".repeat(64); }],
    ["another provider", (p) => { p.provider = "codex-cli"; }],
    ["transitions without packet_approval", (p) => { p.transitions = ["validation"]; }],
    ["an unknown transition", (p) => { p.transitions = ["packet_approval", "merge"]; }],
    ["concurrency 2", (p) => { p.concurrency = 2; }],
    ["25 hours", (p) => { p.packetApprovalHours = 25; }],
    ["zero hours", (p) => { p.packetApprovalHours = 0; }],
    ["duplicate actions", (p) => { p.actions = ["a", "a"]; }],
    ["no actions", (p) => { p.actions = []; }],
    ["decisions without 0156", (p) => { p.requiredDecisions = ["0130", "0058"]; }],
    ["a non-numeric decision", (p) => { p.requiredDecisions = ["0130", "0058", "0156", "abcd"]; }],
    ["files without the executor", (p) => { p.requiredFiles = ["src/a.ts"]; }],
    ["an escaping file", (p) => { p.requiredFiles = ["scripts/start-run.sh", "../x"]; }],
    ["a non-label worker", (p) => { p.workerLabel = "com.example.worker"; }],
    ["a relative history path", (p) => { p.consumedHistory = [{ path: "one.json", sha256: "c".repeat(64) }]; }],
    ["a history entry with an extra key", (p) => { p.consumedHistory = [{ path: "/a", sha256: "c".repeat(64), extra: 1 }]; }],
    ["a fractional revision", (p) => { p.production = { revision: 1.5, epoch: 1 }; }],
    ["a multi-line intent", (p) => { p.intent = "a\nb"; }],
    ["a leftover delegation receipt", (p) => { (p as any).delegationReceipt = { path: "/abs/d.json", sha256: "d".repeat(64) }; }],
    ["Decision 0157 not required", (p) => { p.requiredDecisions = p.requiredDecisions.filter((d: string) => d !== "0157"); }],
    ["Decision 0161 not required", (p) => { p.requiredDecisions = p.requiredDecisions.filter((d: string) => d !== "0161"); }],
    // Decision 0161 replaced the retained pre-press sign-in receipt: the old pin is now an unknown field.
    ["the retired sign-in evidence pin", (p) => { p.signInEvidence = { path: "/abs/signin.json", sha256: "e".repeat(64) }; }],
    ["an empty authority list", (p) => { p.consumedHistory = []; }]
  ])("refuses %s", (_label, mutate) => {
    const pins = structuredClone(validPins()) as unknown as Record<string, unknown>;
    mutate(pins);
    expect(() => validateStartRunPins(pins)).toThrow();
  });
});

describe("startRun descriptor contract", () => {
  it("matches the golden three-line launcher", () => {
    expect(startRunLauncher(ID)).toBe([
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `exec "$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd -P)/scripts/start-run.sh" "\${1:-run}" "$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)/${ID}.json"`,
      ""
    ].join("\n"));
    expect(startRunLauncher(ID).trimEnd().split("\n")).toHaveLength(3);
  });
  it("accepts a START card with the exact launcher, with or without the embedded Plan activation", () => {
    const d = cardDescriptor();
    expect(validateOperatorScriptContract(d, ID, startRunLauncher(ID))).toBe(d);
    const e = activationInput().envelope;
    const withActivation = cardDescriptor({ planActivation: activationInput() }, { project: e.project, plan: e.plan, actions: segmentActions(e), requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0161"] });
    expect(validateOperatorScriptContract(withActivation, ID, startRunLauncher(ID))).toBe(withActivation);
  });
  it.each<[string, (d: OperatorScriptDescriptor) => void, string]>([
    ["no grant kind", (d) => { delete d.kind; }, "one-shot kind"],
    ["repeatable", (d) => { d.repeatable = true; }, "one-shot kind"],
    ["no expiry", (d) => { delete d.expires_at; }, "expires_at"],
    ["a settlement beside it", (d) => { d.agentAsk = { proposal: "x", intent: "plan", targetRef: null }; }, "one-shot kind"],
    ["a next_after hint", (d) => { d.next_after = { id: "other", within_minutes: 5 }; }, "one-shot kind"],
    ["invalid pins", (d) => { (d.startRun as unknown as Record<string, unknown>).concurrency = 3; }, "concurrency"],
    ["a foreign project", (d) => { d.project = "other"; }, "project"]
  ])("refuses %s", (_label, mutate, message) => {
    const d = cardDescriptor();
    mutate(d);
    expect(() => validateOperatorScriptContract(d, ID, startRunLauncher(ID))).toThrow(message);
  });
  it("refuses a planActivation whose queue segment does not begin with the pinned Actions", () => {
    const e = activationInput().envelope;
    const input = activationInput();
    input.envelope.queueSegment = [...e.queueSegment.slice(1), e.queueSegment[0]];
    expect(() => validateOperatorScriptContract(cardDescriptor({ planActivation: input }, { project: e.project, plan: e.plan, actions: segmentActions(e), requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0161"] }), ID, startRunLauncher(ID))).toThrow();
  });
  it("refuses a planActivation for another Plan, a different first Action, or without Decision 0157", () => {
    const e = activationInput().envelope;
    const base = { project: e.project, plan: e.plan, actions: segmentActions(e), requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0161"] };
    expect(() => validateOperatorScriptContract(cardDescriptor({ planActivation: activationInput() }, { ...base, plan: "another-plan" }), ID, startRunLauncher(ID))).toThrow("must activate startRun.plan");
    expect(() => validateOperatorScriptContract(cardDescriptor({ planActivation: activationInput() }, { ...base, actions: segmentActions(e).reverse() }), ID, startRunLauncher(ID))).toThrow("first pinned Action");
    expect(() => validateOperatorScriptContract(cardDescriptor({ planActivation: activationInput() }, { ...base, requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0161"] }), ID, startRunLauncher(ID))).toThrow("Decision 0157");
  });
  it.each([
    ["a bespoke script", "#!/usr/bin/env bash\nexit 0\n"],
    ["an appended command", startRunLauncher(ID) + "echo extra\n"],
    ["another card's launcher", startRunLauncher("another-card")],
    ["the Plan-amendment launcher", planAmendmentLauncher(ID)]
  ])("refuses %s as the START script", (_label, script) => {
    expect(() => validateOperatorScriptContract(cardDescriptor(), ID, script)).toThrow("shared start-run launcher");
  });
  it("refuses the START launcher without a startRun block, and a Plan activation alone with it", () => {
    const d = cardDescriptor();
    delete d.startRun;
    expect(() => validateOperatorScriptContract(d, ID, startRunLauncher(ID))).toThrow("requires a pinned startRun");
    const e = activationInput().envelope;
    const activationOnly = cardDescriptor({ planActivation: activationInput() }, { project: e.project, plan: e.plan, actions: [e.action] });
    delete activationOnly.startRun;
    expect(() => validateOperatorScriptContract(activationOnly, ID, startRunLauncher(ID))).toThrow();
  });
  it("is not available to a Project library entry", () => {
    expect(() => assertProjectLibraryEntry({ ...cardDescriptor(), project: "arcadia" }, "arcadia")).toThrow("startRun");
  });
});

describe("arcadia start-run pins", () => {
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  const EXECUTOR = "#!/usr/bin/env bash\n# fixture executor\n";
  const planDoc = (status: string, doneAction = "") => `---\nslug: fixture-plan\nproject: arcadia\nstatus: ${status}\nactions:\n  - id: first-action\n    status: ${doneAction === "first-action" ? "done" : "open"}\n  - id: second-action\n    status: open\n---\nbody\n`;
  const decision = (status = "approved", answer = "Yes") => `---\nstatus: ${status}\n${answer ? `answer: ${answer}\n` : ""}---\n`;

  function fixture(options: { planStatus?: string; origin?: string; decisions?: Record<string, string>; files?: Record<string, string>; production?: Partial<ReturnType<StartRunPinsDeps["production"]>>; queueTop?: string[]; workers?: string; done?: string; cards?: string[]; } = {}) {
    const repository = mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-pins-"));
    directories.push(repository);
    const library = path.join(repository, "artifacts", "generated", "operator-scripts");
    mkdirSync(path.join(library, "runs", "markers"), { recursive: true });
    writeFileSync(path.join(library, "earlier.consumed.json"), "{}\n");
    writeFileSync(path.join(library, "runs", "markers", "adopt.consumed"), "marker\n");
    const origin = options.origin ?? PIN;
    const decisions: Record<string, string> = options.decisions ?? { "0130": decision(), "0058": decision(), "0097": decision(), "0134": decision(), "0156": decision(), "0157": decision(), "0141": decision(), "0143": decision(), "0161": decision() };
    const files: Record<string, string> = options.files ?? {
      "scripts/start-run.sh": EXECUTOR, "src/sessions/tmuxLauncher.ts": "x", "src/production/workerMerge.ts": "x",
      "docs/plans/fixture-plan.md": planDoc(options.planStatus ?? "active", options.done)
    };
    const calls: string[][] = [];
    const deps: StartRunPinsDeps = {
      git: (_repo, args) => {
        calls.push(args);
        if (args[0] === "ls-remote") return Buffer.from(`${origin}\trefs/heads/main\n`);
        if (args[0] === "rev-parse" && args.includes("--git-common-dir")) return Buffer.from(path.join(repository, ".git") + "\n");
        if (args[0] === "ls-tree") return Buffer.from(Object.keys(decisions).map((id) => `docs/decisions/${id}-fixture.md`).join("\n") + "\n");
        if (args[0] === "show") {
          const spec = args[1].slice(args[1].indexOf(":") + 1);
          const decisionId = /^docs\/decisions\/(\d{4})-/.exec(spec)?.[1];
          const content = decisionId ? decisions[decisionId] : files[spec];
          if (content === undefined) throw new Error("missing");
          return Buffer.from(content);
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      now: () => new Date("2026-11-01T00:00:00.000Z"),
      launchctlList: () => options.workers ?? "PID\tStatus\tLabel\n123\t0\tcom.arcadia.local.742852621.worker\n-\t0\tcom.apple.other\n",
      production: () => ({ workspacePath: "/w/martianrover", desiredState: "inactive", revision: 83, epoch: 46, liveAdmissions: 0, ...options.production }),
      queue: () => ({ revision: 290, orderValid: true, unpositionedCount: 0, ordered: (options.queueTop ?? ["arcadia/first-action", "arcadia/second-action"]).map((orderKey) => ({ orderKey })) }),
      listFiles: (directory) => directory === library ? ["earlier.consumed.json", "ignored.txt", ...(options.cards ?? ["enable-capacity-gate-20261017.json", "restore-off-production-bug-plan-first-supervised-run-2026-10-11.json"])] : directory === path.join(library, "runs", "markers") ? ["adopt.consumed"] : [],
      sha256File: (file) => sha(path.basename(file))
    };
    const args: StartRunPinsOptions = { plan: "fixture-plan", actions: "first-action,second-action", provider: "claude-code-cli", expiresHours: 12, repository };
    return { deps, args, repository, library, calls };
  }

  it("computes valid pins from live read-only state and writes nothing", () => {
    const f = fixture();
    const result = buildStartRunPins(f.args, f.deps);
    expect(validateStartRunPins(result.startRun)).toBe(result.startRun);
    expect(result.startRun).toMatchObject({
      reviewedRevision: PIN, executorSha256: sha(EXECUTOR), workspace: "martianrover", project: "arcadia", plan: "fixture-plan",
      actions: ["first-action", "second-action"], production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: "com.arcadia.local.742852621.worker"
    });
    expect(result.expires_at).toBe("2026-11-01T12:00:00Z");
    expect(result.startRun.requiredDecisions).toEqual(expect.arrayContaining(["0157", "0141", "0143", "0161"]));
    // Decision 0161: no retained sign-in receipt is discovered or pinned any more.
    expect(Object.keys(result.startRun)).not.toContain("signInEvidence");
    expect(result.startRun.consumedHistory.map((entry) => entry.path)).toEqual([
      path.join(f.library, "earlier.consumed.json"), path.join(f.library, "runs", "markers", "adopt.consumed")
    ].sort());
    // Only read-only git verbs.
    expect(f.calls.every(([verb]) => ["ls-remote", "rev-parse", "ls-tree", "show"].includes(verb))).toBe(true);
  });
  it("requires Decision 0157 and notes the activation for a draft Plan", () => {
    const f = fixture({ planStatus: "draft", queueTop: ["arcadia/other"] });
    const result = buildStartRunPins(f.args, f.deps);
    expect(result.startRun.requiredDecisions).toContain("0157");
    expect(result.observations.notes.join(" ")).toContain("planActivation");
  });
  it.each<[string, Parameters<typeof fixture>[0], Partial<StartRunPinsOptions>, string]>([
    ["origin main that is not a commit id", { origin: "nothing" }, {}, "commit id"],
    ["an expiry above 24 hours", {}, { expiresHours: 25 }, "at most 24"],
    ["another provider", {}, { provider: "codex-cli" }, "claude-code-cli"],
    ["an Action not in the Plan", {}, { actions: "first-action,missing-action" }, "not in Plan"],
    ["a done Action", { done: "first-action" }, {}, "already done"],
    ["an executor not on origin main", { files: { "docs/plans/fixture-plan.md": planDoc("active") } }, {}, "scripts/start-run.sh"],
    ["an unapproved Decision", { decisions: { "0130": decision(), "0058": decision(), "0097": decision(), "0134": decision(), "0156": decision("proposed", "") } }, {}, "Decision 0156"],
    ["active production", { production: { desiredState: "active" } }, {}, "Inactive"],
    ["a live admission", { production: { liveAdmissions: 1 } }, {}, "zero live admissions"],
    ["a queue that does not start with the pinned Actions", { queueTop: ["arcadia/second-action", "arcadia/first-action"] }, {}, "queue entries"],
    ["no worker job", { workers: "PID\tStatus\tLabel\n" }, {}, "exactly one"],
    ["two worker jobs", { workers: "1\t0\tcom.arcadia.local.1.worker\n2\t0\tcom.arcadia.local.2.worker\n" }, {}, "exactly one"],
    ["a retired Plan", { planStatus: "done" }, {}, "active Plan or a draft"],
    ["a missing gate card", { cards: ["restore-off-production-bug-plan-first-supervised-run-2026-10-11.json"] }, {}, "enable-capacity-gate-20261017"],
    ["a missing STOP card", { cards: ["enable-capacity-gate-20261017.json"] }, {}, "restore-off-production"],
    ["Decision 0161 not approved", { decisions: { "0130": decision(), "0058": decision(), "0097": decision(), "0134": decision(), "0156": decision(), "0157": decision(), "0141": decision(), "0143": decision(), "0161": decision("open", "") } }, {}, "Decision 0161"]
  ])("refuses %s", (_label, fixtureOptions, argOverrides, message) => {
    const f = fixture(fixtureOptions);
    expect(() => buildStartRunPins({ ...f.args, ...argOverrides }, f.deps)).toThrow(message);
  });
});
