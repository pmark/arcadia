import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStartRunDeriveCommand } from "../src/commands/startRunDerive.js";
import { START_RUN_DEFAULTS, type StartRunPinsDeps } from "../src/commands/startRun.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { STANDING_SLUG } from "../src/operatorActions/startRunDayGrant.js";
import { START_RUN_KEYS, validateStartRunPins, startRunLauncher } from "../src/operatorActions/startRunPins.js";
import {
  DERIVED_CARD_ID_PREFIX, DERIVED_CARD_LIFETIME_MS, DERIVED_CARD_MAX_ACTIONS, deriveStartCard, type DeriveInput, type DerivePlanAction
} from "../src/operatorActions/startRunDerive.js";
import { runCli } from "./cli-response-fixture.js";
import { DAY_PLAN, DAY_RUN, pressKey, STOP_ID, writeDayScenario, type DayScenario } from "./helpers/dayGrantFixture.js";

/** Decision 0241: `arcadia start-run derive` and the pure function behind it. */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const NOW = Date.parse("2026-11-10T12:00:30Z");
const MINUTE = 60_000;
const MAIN = "a".repeat(40);
const DECISION = `docs/decisions/0241-${STANDING_SLUG}.md`;
const EXECUTOR = "#!/usr/bin/env bash\n# the START executor\n";

const planDoc = (actions: Array<{ id: string; status: string; depends_on?: string[] }>, status = "active") =>
  `---\nslug: ${DAY_PLAN}\nproject: arcadia\nstatus: ${status}\nactions:\n${actions.map((a) => `  - id: ${a.id}\n    status: ${a.status}\n    depends_on: [${(a.depends_on ?? []).join(", ")}]\n    acceptance_criteria:\n      - "A criterion."\n`).join("")}---\n`;

interface World { repository: string; library: string; workspace: string; deps: StartRunPinsDeps; before: () => string[] }
function world(options: { scenario?: DayScenario; actions?: Array<{ id: string; status: string; depends_on?: string[] }>; queue?: string[]; now?: number; production?: Partial<{ desiredState: string; revision: number; epoch: number; liveAdmissions: number }> } = {}): World {
  const repository = tempDir("arcadia-derive-");
  const library = path.join(repository, "artifacts", "generated", "operator-scripts");
  mkdirSync(library, { recursive: true });
  const workspace = path.join(tempDir("arcadia-derive-ws-"), "workspace");
  initWorkspace(workspace);
  const now = options.now ?? NOW;
  const scenario = options.scenario ?? { label: "", code: "" };
  const written = writeDayScenario(library, { ...scenario, approval: { standing: true, ...scenario.approval } }, now);
  for (const card of [START_RUN_DEFAULTS.gateCardId, START_RUN_DEFAULTS.offId, STOP_ID]) writeFileSync(path.join(library, `${card}.json`), "{}");
  const actions = options.actions ?? [{ id: "one", status: "open" }, { id: "two", status: "open" }, { id: "three", status: "open", depends_on: ["two"] }];
  const files: Record<string, string> = {
    "scripts/start-run.sh": EXECUTOR, "src/sessions/tmuxLauncher.ts": "x", "src/production/workerMerge.ts": "y",
    "PROJECT.md": `---\nslug: arcadia\nactive_plan: ${DAY_PLAN}\n---\n`, [`docs/plans/${DAY_PLAN}.md`]: planDoc(actions),
    [DECISION]: `---\nid: "0241"\nstatus: approved\nanswer: E. Standing grant over your approved work queue\n---\n`
  };
  const deps: StartRunPinsDeps = {
    git: (_repo, args) => {
      if (args[0] === "ls-remote") return Buffer.from(`${MAIN}\trefs/heads/main\n`);
      if (args[0] === "ls-tree") return Buffer.from(`${DECISION}\n`);
      const spec = args[1].slice(args[1].indexOf(":") + 1);
      if (files[spec] === undefined) throw new Error(`missing ${spec}`);
      return Buffer.from(files[spec]);
    },
    now: () => new Date(now), launchctlList: () => "123\t0\tcom.arcadia.local.1.worker\n",
    production: () => ({ workspacePath: workspace, desiredState: "inactive", revision: written.policyRevision, epoch: 50, liveAdmissions: 0, ...options.production }),
    queue: () => ({ revision: 290, orderValid: true, unpositionedCount: 0, ordered: (options.queue ?? actions.map((a) => a.id)).map((id) => ({ orderKey: `arcadia/${id}` })) }),
    listFiles: (dir) => { try { return readdirSync(dir); } catch { return []; } },
    sha256File: (file) => sha(readFileSync(file)), dayEvidence: () => written.evidence
  };
  const snapshot = (target: string): string[] => !statSync(target).isDirectory()
    ? [`${target}:${sha(readFileSync(target))}`]
    : readdirSync(target).sort().filter((name) => !/-(wal|shm)$/.test(name)).flatMap((name) => snapshot(path.join(target, name)));
  return { repository, library, workspace, deps, before: () => [...snapshot(repository), ...snapshot(workspace)] };
}
const derive = (w: World) => runStartRunDeriveCommand({ repository: w.repository, workspace: w.workspace, library: w.library }, w.deps).data;

describe("arcadia start-run derive: no typed field", () => {
  it.each(["--plan", "--actions", "--action-count", "--provider", "--concurrency", "--expires-hours", "--cause", "--decision", "--card-id"])("refuses %s by name before reading anything", (flag) => {
    expect(() => runStartRunDeriveCommand({ unknownArguments: [flag, "x"] })).toThrow(/DERIVE_OPTION_REFUSED.*--/);
  });

  it("exits non-zero with the named refusal from the real command when an option is passed", () => {
    for (const flag of ["--plan", "--actions", "--provider", "--expires-hours", "--card-id"]) {
      const result = runCli(["start-run", "derive", "--json", flag, "x"]);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("DERIVE_OPTION_REFUSED");
      expect(result.stdout + result.stderr).toContain(flag);
    }
  }, 60_000);
});

describe("arcadia start-run derive: derivation", () => {
  it("derives the receipt's Plan and the ready Actions at the top of the queue, stopping before the first that is not ready", () => {
    const data = derive(world());
    expect(data).toMatchObject({ derived: true, reason: null });
    // `three` depends on `two`, which is not done: it is not ready, and nothing after it is taken.
    expect(data.card).toMatchObject({ plan: DAY_PLAN, actions: ["one", "two"] });
    expect(data.card!.descriptor.startRun).toMatchObject({ plan: DAY_PLAN, actions: ["one", "two"], concurrency: 1, provider: "claude-code-cli" });
    // The governed queue holds unfinished Actions only, so the finished `one` is not in it.
    expect(derive(world({ actions: [{ id: "one", status: "done" }, { id: "two", status: "open" }, { id: "three", status: "open", depends_on: ["one"] }], queue: ["two", "three"] })).card!.actions).toEqual(["two", "three"]);
    // Queue order, not Plan order, and a Plan Action below an unready one is left out.
    expect(derive(world({ queue: ["two", "one", "three"] })).card!.actions).toEqual(["two", "one"]);
    expect(derive(world({ queue: ["one", "other-plan-action", "two"] })).card!.actions).toEqual(["one"]);
  });

  it("caps a card at 12 Actions", () => {
    const actions = Array.from({ length: 15 }, (_, index) => ({ id: `action-${index}`, status: "open" }));
    expect(derive(world({ actions })).card!.actions).toEqual(actions.slice(0, DERIVED_CARD_MAX_ACTIONS).map((a) => a.id));
  });

  it("is byte-identical for the same inputs and clock minute, and the card id is a function of them", () => {
    const w = world();
    const at = (ms: number, production?: StartRunPinsDeps["production"]): World => ({ ...w, deps: { ...w.deps, now: () => new Date(ms), ...(production ? { production } : {}) } });
    const a = derive(w), b = derive(at(NOW + 20_000));
    expect(b.card!.descriptorBytes).toBe(a.card!.descriptorBytes);
    expect(b.card!.manifestBytes).toBe(a.card!.manifestBytes);
    expect(b.card!.id).toBe(a.card!.id);
    expect(a.card!.id.startsWith(DERIVED_CARD_ID_PREFIX)).toBe(true);
    expect(derive(at(NOW + MINUTE)).card!.id).not.toBe(a.card!.id);
    const production = w.deps.production("");
    expect(derive(at(NOW, () => ({ ...production, epoch: production.epoch + 1 }))).card!.id).not.toBe(a.card!.id);
  });

  it("gives the card a single 40 minute lifetime and reads the previous press from the production record", () => {
    expect(DERIVED_CARD_LIFETIME_MS).toBe(40 * MINUTE);
    const data = derive(world());
    expect(data.card!.expiresAt).toBe("2026-11-10T12:40:00Z");
    expect((data.card!.descriptor.startRun as { delegation: { previous: unknown; attempt: number } }).delegation).toMatchObject({ previous: null, attempt: 1 });
    const m = (minutes: number) => NOW - minutes * MINUTE;
    const clean: DayScenario = {
      label: "", code: "", presses: [{ card: "start-a", at: m(40), status: "succeeded", receipt: { outcome: "succeeded", reason: "", productionActivated: true, allowanceConsumed: true } }],
      steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }]
    };
    const afterClean = derive(world({ scenario: clean }));
    expect(afterClean.card!.descriptor.startRun).toMatchObject({ delegation: { attempt: 2, previous: { press: pressKey("start-a"), kind: "clean-batch", cause: "clean-batch" } } });
    const refused: DayScenario = { label: "", code: "", presses: [{ card: "start-a", at: m(40), receipt: {} }] };
    expect(derive(world({ scenario: refused })).card!.descriptor.startRun).toMatchObject({ delegation: { previous: { kind: "no-session", cause: "no-session" } } });
    const failed: DayScenario = { label: "", code: "", presses: [{ card: "start-a", at: m(40), status: "succeeded", receipt: { outcome: "succeeded", reason: "", productionActivated: true, allowanceConsumed: true } }], steps: [{ activate: "start-a" }, { off: "rowan-off-a" }] };
    expect(derive(world({ scenario: failed }))).toMatchObject({ derived: false });
  });

  it("holds the sha256 of the launcher, descriptor and executor, and passes validateStartRunPins and the descriptor contract unchanged", () => {
    const { card } = derive(world());
    const manifest = JSON.parse(card!.manifestBytes) as Record<string, string>;
    expect(manifest).toEqual({ sh: sha(card!.launcher), json: sha(card!.descriptorBytes), executor: sha(EXECUTOR) });
    expect(card!.launcher).toBe(startRunLauncher(card!.id));
    const descriptor = JSON.parse(card!.descriptorBytes) as { startRun: unknown };
    expect(validateStartRunPins(descriptor.startRun)).toEqual(descriptor.startRun);
    expect(validateOperatorScriptContract(descriptor, card!.id, card!.launcher).id).toBe(card!.id);
    expect((descriptor.startRun as { executorSha256: string }).executorSha256).toBe(manifest.executor);
  });

  it.each([
    ["no standing grant is open", { scenario: { label: "", code: "", after: (library: string) => rmSync(path.join(library, "runs"), { recursive: true, force: true }) } }, "GRANT_NOT_OPEN"],
    ["production is Active", { production: { desiredState: "active" } }, "PRODUCTION_NOT_INACTIVE"],
    ["nothing at the top of the queue is ready", { queue: ["three", "one"] }, "NO_READY_ACTIONS"]
  ])("derives nothing and names one reason when %s", (_label, options, reason) => {
    expect(derive(world(options as never))).toMatchObject({ derived: false, reason, card: null });
  });

  it("mutates nothing: the library, the workspace database and the checkout are byte-identical afterwards", () => {
    const w = world();
    const before = w.before();
    expect(derive(w).derived).toBe(true);
    expect(w.before()).toEqual(before);
  });
});

describe("arcadia start-run derive --verify-card: the press-time CARD_NOT_DERIVED check (Decision 0241)", () => {
  /** Writes the derived card's three files into the library, as a press would find them. */
  const writeCard = (w: World, edit: (files: { descriptor: Record<string, any>; launcher: string; manifest: string }) => void = () => undefined) => {
    const card = derive(w).card!;
    const files = { descriptor: JSON.parse(card.descriptorBytes) as Record<string, any>, launcher: card.launcher, manifest: card.manifestBytes };
    edit(files);
    mkdirSync(path.join(w.library, "reviewed"), { recursive: true });
    writeFileSync(path.join(w.library, `${card.id}.json`), `${JSON.stringify(files.descriptor, null, 2)}\n`);
    writeFileSync(path.join(w.library, `${card.id}.sh`), files.launcher);
    writeFileSync(path.join(w.library, "reviewed", `${card.id}.json`), files.manifest);
    return { card, descriptorPath: path.join(w.library, `${card.id}.json`) };
  };
  const verify = (w: World, descriptorPath: string, deps: StartRunPinsDeps = w.deps) =>
    runStartRunDeriveCommand({ repository: w.repository, workspace: w.workspace, library: w.library, verifyCard: descriptorPath }, deps).data.verification!;

  it("verifies an untouched derived card", () => {
    const w = world();
    const { card, descriptorPath } = writeCard(w);
    expect(verify(w, descriptorPath)).toEqual({ verified: true, code: null, differs: [], derivedCardId: card.id });
  });

  it("verifies a card pressed minutes after its derivation, at the card's own minute", () => {
    const w = world();
    const { descriptorPath } = writeCard(w);
    expect(verify(w, descriptorPath, { ...w.deps, now: () => new Date(NOW + 8 * MINUTE) }).verified).toBe(true);
  });

  const MUTATIONS: Array<[string, (files: { descriptor: Record<string, any>; launcher: string; manifest: string }) => void, string]> = [
    ...START_RUN_KEYS.map((key): [string, (files: { descriptor: Record<string, any> }) => void, string] => [`startRun.${key}`, ({ descriptor }) => { descriptor.startRun[key] = { mutated: key }; }, `startRun.${key}`]),
    ["startRun.delegation", ({ descriptor }) => { descriptor.startRun.delegation = { ...descriptor.startRun.delegation, attempt: 99 }; }, "startRun.delegation"],
    ["expires_at", ({ descriptor }) => { descriptor.expires_at = "2099-01-01T00:00:00Z"; }, "expires_at"],
    ["title", ({ descriptor }) => { descriptor.title = "Start everything"; }, "title"],
    ["launcher", (files) => { files.launcher += "\ncurl evil\n"; }, "launcher"],
    ["manifest", (files) => { files.manifest = files.manifest.replace(/[0-9a-f]/, (c) => (c === "0" ? "1" : "0")); }, "manifest"],
    ["an extra startRun key", ({ descriptor }) => { descriptor.startRun.planActivation = { slug: "x" }; }, "startRun.planActivation"],
    ["an extra descriptor key", ({ descriptor }) => { descriptor.standingGrant = {}; }, "standingGrant"],
    ["a narrower Action list", ({ descriptor }) => { descriptor.startRun.actions = descriptor.startRun.actions.slice(0, 1); }, "startRun.actions"],
    ["the id", ({ descriptor }) => { descriptor.id = `${descriptor.id}-b`; }, "id"]
  ];
  it.each(MUTATIONS)("refuses with CARD_NOT_DERIVED, naming the field, when %s is changed on an otherwise derived card", (_label, edit, field) => {
    const w = world();
    const { card, descriptorPath } = writeCard(w, edit);
    const before = w.before();
    const result = verify(w, descriptorPath);
    expect(result).toMatchObject({ verified: false, code: "CARD_NOT_DERIVED", derivedCardId: card.id });
    expect(result.differs).toContain(field);
    expect(w.before()).toEqual(before);
  });

  it("refuses a hand-written manifest that names the standing grant in its delegation block but was never derived", () => {
    const w = world();
    const { descriptorPath } = writeCard(w, ({ descriptor }) => { descriptor.startRun.delegation.approvalRun = "20260101T000000Z-1"; });
    expect(verify(w, descriptorPath)).toMatchObject({ verified: false, code: "CARD_NOT_DERIVED", differs: expect.arrayContaining(["startRun.delegation"]) });
  });

  it("refuses a card whose file bytes differ only in formatting", () => {
    const w = world();
    const { card, descriptorPath } = writeCard(w);
    writeFileSync(descriptorPath, JSON.stringify(JSON.parse(card.descriptorBytes)));
    expect(verify(w, descriptorPath)).toMatchObject({ verified: false, differs: ["descriptor.bytes"] });
  });

  it("refuses a missing card file and an unreadable descriptor", () => {
    const w = world();
    const { card, descriptorPath } = writeCard(w);
    rmSync(path.join(w.library, "reviewed", `${card.id}.json`));
    expect(verify(w, descriptorPath).differs).toEqual(["manifest"]);
    writeFileSync(descriptorPath, "not json");
    expect(verify(w, descriptorPath).differs).toContain("descriptor");
  });

  const rederived: Array<[string, (w: World) => StartRunPinsDeps | void, string]> = [
    ["origin main moves", (w) => ({ ...w.deps, git: (repo, args) => (args[0] === "ls-remote" ? Buffer.from(`${"b".repeat(40)}\trefs/heads/main\n`) : w.deps.git(repo, args)) }), "startRun.reviewedRevision"],
    ["the queue revision changes", (w) => ({ ...w.deps, queue: (workspace) => ({ ...w.deps.queue(workspace), revision: 291 }) }), "startRun.queueRevision"],
    ["the production revision changes", (w) => ({ ...w.deps, production: (workspace) => ({ ...w.deps.production(workspace), revision: w.deps.production(workspace).revision + 1 }) }), "startRun.production|derivation"],
    ["the receipt set changes", (w) => { writeFileSync(path.join(w.library, "another-card.consumed.json"), "{}"); }, "startRun.consumedHistory"]
  ];
  it.each(rederived)("refuses a derived card after %s between derivation and press, and consumes no allowance", (_label, change, field) => {
    const w = world();
    const { card, descriptorPath } = writeCard(w);
    const deps = change(w) ?? w.deps;
    const result = verify(w, descriptorPath, deps);
    expect(result).toMatchObject({ verified: false, code: "CARD_NOT_DERIVED" });
    expect(result.differs.join("|")).toMatch(new RegExp(field));
    expect(readdirSync(w.library)).not.toContain(`${card.id}.consumed.json`);
  });

  it("refuses when nothing can be derived any more, naming the derivation refusal", () => {
    const w = world();
    const { descriptorPath } = writeCard(w);
    const noReady = { ...w.deps, queue: (workspace: string) => ({ ...w.deps.queue(workspace), ordered: [] }) };
    expect(verify(w, descriptorPath, noReady)).toMatchObject({ verified: false, code: "CARD_NOT_DERIVED", derivedCardId: null, differs: [expect.stringContaining("NO_READY_ACTIONS")] });
  });

  it("is a real command option, and still derives nothing typed", () => {
    expect(() => runStartRunDeriveCommand({ verifyCard: "x.json", unknownArguments: ["--plan", "x"] })).toThrow(/DERIVE_OPTION_REFUSED/);
  });
});

describe("arcadia start-run derive: origin main is fetched before its tree is read (#2969)", () => {
  /** A checkout whose object store lacks origin main until `fetchOriginMain` succeeds, as on the host timer's checkout. */
  const unfetched = (w: World, fetch: () => void = () => undefined) => {
    let fetched = false;
    const fetches: string[] = [];
    const deps: StartRunPinsDeps = {
      ...w.deps,
      git: (repo, args) => {
        if (!fetched && (args[0] === "ls-tree" || args[0] === "show")) throw new Error(`fatal: not a tree object: ${MAIN}`);
        return w.deps.git(repo, args);
      },
      fetchOriginMain: (repo) => { fetches.push(repo); fetch(); fetched = true; }
    };
    return { w: { ...w, deps }, fetches };
  };

  it("derives the same card once, after exactly one fetch, when the commit was missing locally", () => {
    const present = world();
    const { w, fetches } = unfetched(present);
    expect(derive(w).card).toEqual(derive(present).card);
    expect(fetches).toHaveLength(1);
  });

  it("names the failed fetch, not a bare 'not a tree object', when the fetch fails", () => {
    const { w, fetches } = unfetched(world(), () => { throw new Error("fatal: unable to access origin"); });
    expect(() => derive(w)).toThrow(/not readable at origin main a{40}.*fetch itself failed.*git fetch origin main.*unable to access origin/s);
    expect(fetches).toHaveLength(1);
  });

  it("keeps the unreadable-at-origin-main refusal when the fetch succeeds but the commit is still absent", () => {
    const w = world();
    const deps: StartRunPinsDeps = { ...w.deps, git: (repo, args) => { if (args[0] === "ls-tree") throw new Error("fatal: not a tree object"); return w.deps.git(repo, args); }, fetchOriginMain: () => undefined };
    expect(() => derive({ ...w, deps })).toThrow(/docs\/decisions\/ is not readable at origin main a{40}; fetch origin \(git fetch origin main\) or merge it first\.$/);
  });

  it("is identical to today when the commit is already present, with one fetch per command run", () => {
    const w = world();
    const fetches: string[] = [];
    const fetched = derive({ ...w, deps: { ...w.deps, fetchOriginMain: (repo) => { fetches.push(repo); } } });
    expect(fetched).toEqual(derive(w));
    expect(fetches).toHaveLength(1);
  });
});

describe("deriveStartCard: property over generated Plans and queues", () => {
  let seed = 20261116;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const base = (overrides: Partial<DeriveInput>): DeriveInput => ({
    originMain: MAIN, now: new Date(NOW), executorSha256: sha(EXECUTOR), workspace: "martianrover", workerLabel: "com.arcadia.local.1.worker", gateCardId: "enable-capacity-gate-20261017", offId: STOP_ID,
    grant: { open: true, plan: DAY_PLAN, approvalCard: "approve-critical-path-day-fixture", approvalRun: DAY_RUN, reason: null },
    plan: { slug: DAY_PLAN, project: "arcadia", status: "active", isProjectActivePlan: true, actions: [] },
    production: { desiredState: "inactive", liveAdmissions: 0, revision: 90, epoch: 50 }, queue: { revision: 290, orderValid: true, unpositionedCount: 0, keys: [] },
    chain: { receiptSha256: "a".repeat(64), pressSha256: "b".repeat(64), attemptsSoFar: 0, latest: null },
    consumedHistory: [{ path: "/abs/one.consumed.json", sha256: "c".repeat(64) }], ...overrides
  });

  it("pins only open Actions of the receipt's Plan, in queue order, at concurrency 1 on claude-code-cli, or derives nothing with one named reason (250 fixtures)", () => {
    let derived = 0, refused = 0;
    for (let index = 0; index < 250; index += 1) {
      const count = 1 + Math.floor(random() * 18);
      const actions: DerivePlanAction[] = Array.from({ length: count }, (_, i) => ({
        id: `action-${i}`, status: pick(["open", "open", "open", "done", "blocked", "deferred"]), criteriaErrors: random() < 0.05 ? ["bad"] : [],
        dependsOn: i > 0 && random() < 0.3 ? [`action-${Math.floor(random() * i)}`] : []
      }));
      const keys = [...actions.map((a) => `arcadia/${a.id}`), "arcadia/foreign", "other/action-0"].sort(() => random() - 0.5).slice(0, 1 + Math.floor(random() * (count + 2)));
      const result = deriveStartCard(base({ plan: { slug: DAY_PLAN, project: "arcadia", status: "active", isProjectActivePlan: true, actions }, queue: { revision: 290, orderValid: true, unpositionedCount: 0, keys } }));
      if (!result.ok) { refused += 1; expect(result.reason).toMatch(/^[A-Z_]+$/); continue; }
      derived += 1;
      const startRun = (result.card.descriptor as { startRun: { plan: string; actions: string[]; concurrency: number; provider: string } }).startRun;
      expect(startRun).toMatchObject({ plan: DAY_PLAN, concurrency: 1, provider: "claude-code-cli" });
      expect(startRun.actions.length).toBeGreaterThanOrEqual(1);
      expect(startRun.actions.length).toBeLessThanOrEqual(12);
      const byId = new Map(actions.map((a) => [a.id, a]));
      startRun.actions.forEach((id, position) => {
        expect(keys[position]).toBe(`arcadia/${id}`);
        expect(byId.get(id)!.status).not.toBe("done");
        expect(byId.get(id)!.dependsOn.every((dependency) => byId.get(dependency)?.status === "done")).toBe(true);
      });
      expect(validateStartRunPins(startRun)).toBeDefined();
    }
    expect(derived).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(20);
  });
});
