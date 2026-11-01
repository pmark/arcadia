import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_CLI_SELF_REFRESH_ARGS, CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS } from "../src/production/capacityPreAdmission.js";
import {
  findFreshBoundReceipt, runStartRunSignIn, signInDay, signInReceiptRefusal, staticSignInChecks, StartRunSignInRefusal,
  type StartRunSignInContext, type StartRunSignInDeps
} from "../src/production/startRunSignIn.js";
import { diagnosticGrantAnswer, diagnosticGrantPath, diagnosticResponsePath, type ClaudeDiagnosticGrant } from "../src/production/workerClaudeUsageDiagnostic.js";
import { slugify } from "../src/utils/slug.js";
import { assertStartCardPress } from "../src/commands/startRun.js";

/**
 * Hermetic cases for the Decision 0161 sign-in sequence a START card runs after its protected worker install. The
 * Claude CLI, the Arcadia CLI (Agent Ask, settlement, review), Git and the bound worker are all fakes; only temporary
 * directories are written. No case reaches the live workspace, a provider, GitHub or launchd.
 */
const RELEASE = "a".repeat(40);
const NONCE = "12345678-1234-4234-8234-123456789abc";
const OLD_NONCE = "87654321-4321-4321-8321-cba987654321";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

type WorkerScenario = { outcome?: string; httpStatus?: number; expiresInMs?: number; fiveHour?: number; silent?: boolean };
interface FixtureOptions {
  binding?: "bound" | "unbound" | "stale";
  dayUsed?: boolean;
  renewal?: { ok: boolean; detail: string } | "throw";
  worker?: WorkerScenario;
  /** Milliseconds the fake clock advances on each CLI call (slow canonical records). */
  cliDelayMs?: number;
  previousSlots?: "terminal" | "busy-request" | "none";
  receipts?: Array<Record<string, unknown>>;
  requestIgnored?: boolean;
  /** The identity the fake settlement and answer commits carry (default: the Arcadia Controller). */
  commitIdentity?: string;
  /** Advance the clock by a day right after the day claim is published (midnight between the claim and the renewal). */
  midnightAfterClaim?: boolean;
  /** The repositories the worker polls (default: the fixture repository). */
  polled?: (repository: string) => string[];
}

function fixture(options: FixtureOptions = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-sign-in-")));
  directories.push(root);
  const repository = path.join(root, "arcadia");
  const workspace = path.join(root, "martianrover");
  const runDirectory = path.join(repository, "artifacts", "generated", "operator-scripts", "runs", "card", "run-1");
  for (const dir of [path.join(repository, "docs", "decisions"), path.join(repository, ".arcadia"), path.join(workspace, ".arcadia"), path.join(workspace, "artifacts", "worker-claude-usage")]) mkdirSync(dir, { recursive: true });
  chmodSync(path.join(workspace, "artifacts", "worker-claude-usage"), 0o700);
  writeFileSync(path.join(repository, "docs", "decisions", "0099-renumbered-earlier.md"), [
    "---", "arcadia: v1", "type: decision", 'id: "0160"', "slug: renumbered-earlier", "project: arcadia", "status: approved", "question: Earlier?",
    "gap_type: missing-decision", "gate_question: approval_boundary", "confidence: high", "plan: fixture-plan", "updated: 2026-10-31", "answer: Yes", "decided: 2026-10-31", "---", "", "# Decision 0160: Earlier?", ""
  ].join("\n"));
  let clock = Date.parse("2026-11-01T17:00:00.000Z");
  const binding = { pid: 4242, instance: "instance-4242", release: RELEASE, handlerHash: "h".repeat(64), repository };
  const heartbeat = () => writeFileSync(path.join(workspace, ".arcadia", "worker-claude-usage-heartbeat.json"), JSON.stringify({
    at: clock - (options.binding === "stale" ? 60_000 : 0), binding: options.binding === "unbound" ? null : binding
  }));
  heartbeat();
  const date = signInDay(new Date(clock));
  if (options.dayUsed) { mkdirSync(path.join(workspace, ".arcadia", "claude-renewal-days"), { recursive: true }); writeFileSync(path.join(workspace, ".arcadia", "claude-renewal-days", `${date}.json`), "{}"); }
  const slots = options.previousSlots ?? "terminal";
  if (slots !== "none") {
    writeFileSync(diagnosticGrantPath(workspace), JSON.stringify({ nonce: OLD_NONCE }), { mode: 0o600 });
    writeFileSync(path.join(repository, ".arcadia", "worker-claude-usage.request"), JSON.stringify({ nonce: slots === "busy-request" ? NONCE.replace("1234-4234", "9999-4999") : OLD_NONCE }), { mode: 0o600 });
    writeFileSync(diagnosticResponsePath(workspace, OLD_NONCE), JSON.stringify({ nonce: OLD_NONCE, success: true }), { mode: 0o600 });
  }
  for (const receipt of options.receipts ?? []) writeFileSync(diagnosticResponsePath(workspace, String(receipt.nonce)), JSON.stringify(receipt), { mode: 0o600 });

  // Git: a tiny model of the main checkout and origin main.
  const git = { head: "c".repeat(40), remote: "c".repeat(40), log: [] as Array<{ sha: string; parent: string; file: string; identity: string }>, pushes: 0 };
  const controller = "Arcadia Controller\tcontroller@arcadia.local";
  const commit = (file: string) => { const next = sha(git.head + file + git.log.length).slice(0, 40); git.log.push({ sha: next, parent: git.head, file, identity: options.commitIdentity ?? `${controller}\t${controller}` }); git.head = next; };
  const between = (from: string, to: string) => { const out: Array<{ file: string; identity: string }> = []; let at = to; while (at !== from) { const c = git.log.find((entry) => entry.sha === at); if (!c) throw new Error("not an ancestor"); out.push(c); at = c.parent; } return out; };
  const calls = { claude: [] as Array<{ args: readonly string[]; timeout: number }>, cli: [] as string[][], cliTimeouts: [] as number[], git: [] as string[][] };
  let decisionFile = "", answer = "", slug = "", question = "";
  const decisionDoc = (status: string, withAnswer: boolean) => [
    "---", "arcadia: v1", "type: decision", `id: "${path.basename(decisionFile).slice(0, 4)}"`, `slug: ${slug}`, "project: arcadia", `status: ${status}`,
    `question: ${question}`, "gap_type: missing-decision", "gate_question: approval_boundary", `recommendation: ${answer}`, "options:",
    `  - label: ${answer}`, "    consequence: One check.", "    recommended: true", "  - label: Do not authorize the check", "    consequence: None.", "    recommended: false",
    "confidence: high", "plan: fixture-plan", "updated: 2026-11-01", ...(withAnswer ? [`answer: ${answer}`, "decided: 2026-11-01"] : []), "---", "", `# Decision: ${question}`, ""
  ].join("\n");

  let jumped = false;
  const deps: StartRunSignInDeps = {
    now: () => {
      if (options.midnightAfterClaim && !jumped && existsSync(path.join(workspace, ".arcadia", "claude-renewal-days", `${date}.json`))) { clock += 24 * 3_600_000; jumped = true; }
      return new Date(clock);
    },
    randomUUID: () => NONCE,
    sleep: async (ms) => {
      clock += ms;
      heartbeat();
      // The bound worker: polls the request, answers once under the published grant.
      const request = path.join(repository, ".arcadia", "worker-claude-usage.request");
      if (!existsSync(request) || options.worker?.silent) return;
      const { nonce } = JSON.parse(readFileSync(request, "utf8")) as { nonce: string };
      const response = diagnosticResponsePath(workspace, nonce);
      if (existsSync(response)) return;
      const grant = JSON.parse(readFileSync(diagnosticGrantPath(workspace), "utf8")) as ClaudeDiagnosticGrant;
      const w = options.worker ?? {};
      const outcome = w.outcome ?? "ok";
      writeFileSync(response, JSON.stringify({
        schema: "arcadia-worker-claude-usage-receipt-v1", nonce, repository, workspace, pid: binding.pid, release: binding.release, handlerHash: binding.handlerHash,
        approval: { decision: grant.decision, digest: diagnosticGrantAnswer(grant).split(" ").at(-1), policyRevision: grant.policyRevision, policyEpoch: grant.policyEpoch, provider: "claude", source: "auto", endpoint: grant.endpoint },
        startedAt: new Date(clock - 500).toISOString(), finishedAt: new Date(clock).toISOString(), credentialSource: "keychain",
        credentialExpiresAt: new Date(clock + (w.expiresInMs ?? 3 * 3_600_000)).toISOString(), requestAttempted: true, httpStatus: w.httpStatus ?? 200, outcome,
        windows: outcome === "ok" ? [{ label: "5h", usedPercentage: w.fiveHour ?? 20, resetsAt: new Date(clock + 3_600_000).toISOString() }, { label: "7d", usedPercentage: 40, resetsAt: new Date(clock + 86_400_000).toISOString() }] : [],
        source: "worker_live_request", success: outcome === "ok" && (w.httpStatus ?? 200) === 200
      }), { mode: 0o600 });
    },
    polledRepositories: () => (options.polled ?? ((repo) => [repo]))(repository),
    runClaude: async (args, timeout) => {
      calls.claude.push({ args, timeout });
      if (options.renewal === "throw") throw new Error("spawn EACCES");
      return options.renewal ?? { ok: true, detail: "exit 0" };
    },
    cli: (args, timeoutMs) => {
      calls.cli.push(args);
      calls.cliTimeouts.push(timeoutMs);
      clock += options.cliDelayMs ?? 1000;
      const key = args.slice(0, 2).join(" ");
      if (key === "agent-ask preview") {
        const ask = JSON.parse(readFileSync(args[args.indexOf("--file") + 1], "utf8"));
        question = ask.desired_result; answer = ask.options[0].label; slug = slugify(question);
        decisionFile = path.join(repository, "docs", "decisions", `0161-${slug}.md`);
        expect(args).toEqual(expect.arrayContaining(["--dir", repository]));
        return { ok: true, data: { proposal: { id: "agentask_1" } } };
      }
      if (key === "agent-ask settle" && !args.includes("--apply")) {
        return { ok: true, data: { receipt: { previewFingerprint: "f".repeat(64), review: { documents: [{ path: path.relative(repository, decisionFile), before: null, after: decisionDoc("open", false) }] } } } };
      }
      if (key === "agent-ask settle") { writeFileSync(decisionFile, decisionDoc("open", false)); commit(path.relative(repository, decisionFile)); return { ok: true, data: { receipt: { applied: true, documentsCommit: git.head } } }; }
      if (key === "review --workspace") return { ok: true, data: { items: [{ id: "review_1", docRef: `decision/${slug}`, status: "open", answerMenu: { answerable: true, options: [{ letter: "A", label: answer }, { letter: "B", label: "Do not authorize the check" }] } }] } };
      if (key === "review answer") { writeFileSync(decisionFile, decisionDoc("approved", true)); commit(path.relative(repository, decisionFile)); return { ok: true, data: {} }; }
      throw new Error(`unexpected cli ${args.join(" ")}`);
    },
    git: (args) => {
      calls.git.push(args);
      switch (args[0]) {
        case "check-ignore": if (options.requestIgnored === false) throw new Error("exit 1"); return "";
        case "branch": return "main";
        case "status": return "";
        case "rev-parse": return git.head;
        case "ls-remote": return `${git.remote}\trefs/heads/main`;
        case "diff": return [...new Set(between(args[2], args[3]).map((c) => c.file))].join("\n");
        case "rev-list": { const [from, to] = args[2].split(".."); return String(between(from, to).length); }
        case "log": { const [from, to] = args[2].split(".."); return between(from, to).map((c) => c.identity).join("\n"); }
        case "push": git.pushes += 1; git.remote = git.head; return "";
        default: throw new Error(`unexpected git ${args.join(" ")}`);
      }
    }
  };
  const context: StartRunSignInContext = { workspace, repository, project: "arcadia", cardId: "start-card", runId: "run-1", runDirectory, release: RELEASE, policyRevision: 83, policyEpoch: 46 };
  const ledger = path.join(workspace, ".arcadia", "claude-renewal-days");
  return { root, repository, workspace, runDirectory, context, deps, calls, git, binding, date, ledger, now: () => clock };
}
type Fixture = ReturnType<typeof fixture>;

async function refusal(f: Fixture): Promise<StartRunSignInRefusal> {
  try { await runStartRunSignIn(f.context, f.deps); } catch (error) { if (error instanceof StartRunSignInRefusal) return error; throw error; }
  throw new Error("expected a refusal");
}
const journal = (f: Fixture) => JSON.parse(readFileSync(path.join(f.runDirectory, "sign-in.json"), "utf8")) as Record<string, any>;
const goodReceipt = (f: Fixture, overrides: Record<string, unknown> = {}) => ({
  schema: "arcadia-worker-claude-usage-receipt-v1", nonce: "abcdef01-2345-4678-8abc-def012345678", repository: f.repository, workspace: f.workspace, pid: 1,
  release: RELEASE, handlerHash: "h".repeat(64), approval: { decision: "0150-x", digest: "d".repeat(64) }, startedAt: new Date(f.now() - 60_000).toISOString(),
  finishedAt: new Date(f.now() - 30_000).toISOString(), credentialExpiresAt: new Date(f.now() + 3_600_000).toISOString(), requestAttempted: true, httpStatus: 200,
  outcome: "ok", success: true, windows: [{ label: "5h", usedPercentage: 10 }, { label: "7d", usedPercentage: 20 }], ...overrides
});

describe("start-run sign-in: refusals before the day is claimed", () => {
  it("refuses when today's Decision 0141 sequence is already used, before any renewal", async () => {
    const f = fixture({ dayUsed: true });
    const error = await refusal(f);
    expect(error).toMatchObject({ code: "DAY_USED", dayClaimed: false });
    expect(f.calls.claude).toEqual([]);
    expect(readdirSync(f.ledger)).toEqual([`${f.date}.json`]);
  });
  it.each<[string, FixtureOptions["binding"]]>([["unbound (source-run)", "unbound"], ["stale", "stale"]])("refuses a %s worker heartbeat without claiming", async (_label, binding) => {
    const f = fixture({ binding });
    expect(await refusal(f)).toMatchObject({ code: "WORKER_UNBOUND", dayClaimed: false });
    expect(existsSync(f.ledger)).toBe(false);
    expect(f.calls.claude).toEqual([]);
  });
  it("refuses a non-terminal request slot and a request path Git does not ignore, without claiming", async () => {
    for (const options of [{ previousSlots: "busy-request" as const }, { requestIgnored: false }]) {
      const f = fixture(options);
      const error = await refusal(f);
      expect(error.dayClaimed).toBe(false);
      expect(["REQUEST_SLOT_BUSY", "REQUEST_NOT_IGNORED"]).toContain(error.code);
      expect(existsSync(f.ledger)).toBe(false);
    }
  });
  it("refuses, without claiming, a repository the worker does not poll (no active Project has it as repo_path)", async () => {
    const f = fixture({ polled: () => ["/somewhere/else"] });
    expect(await refusal(f)).toMatchObject({ code: "REPOSITORY_NOT_POLLED", dayClaimed: false });
    expect(existsSync(f.ledger)).toBe(false);
    expect(f.calls.claude).toEqual([]);
  });
  it("staticSignInChecks is read-only and reports the terminal slots it will archive", () => {
    const f = fixture();
    const state = staticSignInChecks(f.context, f.deps);
    expect(state).toMatchObject({ date: f.date, grantSlot: { nonce: OLD_NONCE, terminal: true }, requestSlot: { nonce: OLD_NONCE, terminal: true } });
    expect(existsSync(f.ledger)).toBe(false);
  });
});

describe("start-run sign-in: reuse", () => {
  it("reuses a fresh receipt of this bound worker: no claim, no renewal, no records", async () => {
    const f = fixture();
    const kept = goodReceipt(f);
    writeFileSync(diagnosticResponsePath(f.workspace, String(kept.nonce)), JSON.stringify(kept), { mode: 0o600 });
    const result = await runStartRunSignIn(f.context, f.deps);
    expect(result).toMatchObject({ outcome: "reused", dayClaimed: false, receipt: { path: diagnosticResponsePath(f.workspace, String(kept.nonce)) } });
    expect(f.calls.claude).toEqual([]);
    expect(f.calls.cli).toEqual([]);
    expect(existsSync(f.ledger)).toBe(false);
  });
  it.each<[string, Record<string, unknown>]>([
    ["the previous unbound worker", { release: null, handlerHash: null }],
    ["another release", { release: "b".repeat(40) }],
    ["an old receipt", { finishedAt: new Date(Date.parse("2026-11-01T15:00:00Z")).toISOString() }],
    ["a failed check", { success: false, outcome: "http_error", httpStatus: 401 }]
  ])("never reuses a receipt from %s", (_label, overrides) => {
    const f = fixture();
    const kept = goodReceipt(f, overrides);
    writeFileSync(diagnosticResponsePath(f.workspace, String(kept.nonce)), JSON.stringify(kept), { mode: 0o600 });
    expect(findFreshBoundReceipt(f.workspace, f.binding, new Date(f.now()))).toBeNull();
  });
});

describe("start-run sign-in: the sequence", () => {
  it("claims the day, renews once with the reviewed call, publishes the exact Decision, then has the bound worker check once", async () => {
    const f = fixture();
    const result = await runStartRunSignIn(f.context, f.deps);
    expect(result).toMatchObject({ outcome: "checked", dayClaimed: true, date: f.date, nonce: NONCE });
    // Exactly one renewal, with the worker's reviewed arguments and 60-second bound.
    expect(f.calls.claude).toEqual([{ args: CLAUDE_CLI_SELF_REFRESH_ARGS, timeout: CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS }]);
    expect(CLAUDE_CLI_SELF_REFRESH_TIMEOUT_MS).toBe(60_000);
    // The day was claimed exclusively before the renewal and the result retained.
    const claim = JSON.parse(readFileSync(path.join(f.ledger, `${f.date}.json`), "utf8"));
    expect(claim).toMatchObject({ schema: "arcadia-daily-0141-claim-v1", date: f.date, timeZone: "America/Los_Angeles", decision: "0141", authority: "0161", status: "consumed-before-renewal", binding: f.binding });
    expect(JSON.parse(readFileSync(path.join(f.ledger, `${f.date}.renewal.json`), "utf8"))).toMatchObject({ ok: true, noRetry: true });
    expect(statSync(path.join(f.ledger, `${f.date}.json`)).mode & 0o077).toBe(0);
    // The grant: one nonce, at most 5 minutes, the bound worker's identity and the exact Decision.
    const grant = JSON.parse(readFileSync(diagnosticGrantPath(f.workspace), "utf8")) as ClaudeDiagnosticGrant;
    expect(Object.keys(grant)).toEqual(["schema", "nonce", "repository", "workspace", "release", "handlerHash", "decision", "provider", "source", "endpoint", "policyRevision", "policyEpoch", "expiresAt", "deadlineMs"]);
    expect(grant).toMatchObject({ nonce: NONCE, release: RELEASE, handlerHash: f.binding.handlerHash, policyRevision: 83, policyEpoch: 46, deadlineMs: 30_000, decision: result.decision });
    const prepared = journal(f);
    expect(Date.parse(grant.expiresAt) - Date.parse(prepared.preparedAt)).toBe(300_000);
    expect(statSync(diagnosticGrantPath(f.workspace)).mode & 0o077).toBe(0);
    expect(result.digest).toBe(diagnosticGrantAnswer(grant).split(" ").at(-1));
    // The Decision went through the supported Agent Ask route and a Decision-only, fast-forward publication.
    expect(f.calls.cli.map((args) => args.slice(0, 2).join(" ") + (args.includes("--apply") ? " --apply" : ""))).toEqual(["agent-ask preview", "agent-ask settle", "agent-ask settle --apply", "review --workspace", "review answer"]);
    expect(f.calls.cli[4].slice(2, 4)).toEqual(["review_1", "A"]);
    expect(f.git.pushes).toBe(1);
    expect(f.calls.git.find((args) => args[0] === "push")).toEqual(["push", "origin", "HEAD:refs/heads/main"]);
    expect(result.publicationHead).toBe(f.git.remote);
    // The previous terminal grant and request were archived, never overwritten; the new request carries only the nonce.
    expect(existsSync(`${diagnosticGrantPath(f.workspace)}.completed-${OLD_NONCE}`)).toBe(true);
    expect(journal(f).archived).toEqual([
      { from: diagnosticGrantPath(f.workspace), to: `${diagnosticGrantPath(f.workspace)}.completed-${OLD_NONCE}`, sha256: sha(JSON.stringify({ nonce: OLD_NONCE })) },
      { from: path.join(f.repository, ".arcadia", "worker-claude-usage.request"), to: path.join(f.runDirectory, `archived-worker-claude-usage-request-${OLD_NONCE}.json`), sha256: sha(JSON.stringify({ nonce: OLD_NONCE })) }
    ]);
    // The Decision id is settlement's: max frontmatter id (0160) + 1, not the filename prefix (0099).
    expect(result.decision).toMatch(/^0161-authorize-one-start-card-worker-claude-usage-diagnostic-/);
    // Read-only calls are bounded by the grant time above the reserve; the two committing calls get the whole window.
    for (const i of [2, 4]) { expect(f.calls.cliTimeouts[i]).toBeGreaterThan(60_000); expect(f.calls.cliTimeouts[i]).toBeLessThanOrEqual(300_000); }
    expect(Math.max(f.calls.cliTimeouts[0], f.calls.cliTimeouts[1], f.calls.cliTimeouts[3])).toBeLessThanOrEqual(60_000);
    expect(f.calls.git.find((args) => args[0] === "log")).toBeDefined();
    expect(existsSync(path.join(f.runDirectory, `archived-worker-claude-usage-request-${OLD_NONCE}.json`))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(f.repository, ".arcadia", "worker-claude-usage.request"), "utf8"))).toEqual({ nonce: NONCE });
    // Only the bound worker's own receipt for this nonce counts, and it allows START.
    expect(result.receipt.path).toBe(diagnosticResponsePath(f.workspace, NONCE));
    expect(result.receipt.sha256).toBe(sha(readFileSync(result.receipt.path)));
    expect(journal(f).stages).toEqual(["bound", "day-claimed", "renewed", "prepared", "records-published", "requested", "received", "checked"]);
  });

  it.each<[string, FixtureOptions["renewal"]]>([["fails", { ok: false, detail: "exit 1: stderr: not logged in" }], ["throws", "throw"]])("consumes the day and checks nothing when the renewal %s", async (_label, renewal) => {
    const f = fixture({ renewal });
    expect(await refusal(f)).toMatchObject({ code: "RENEWAL_FAILED", dayClaimed: true });
    expect(f.calls.claude).toHaveLength(1);
    expect(f.calls.cli).toEqual([]);
    expect(f.git.pushes).toBe(0);
    expect(JSON.parse(readFileSync(path.join(f.ledger, `${f.date}.renewal.json`), "utf8"))).toMatchObject({ ok: false });
    expect(JSON.parse(readFileSync(diagnosticGrantPath(f.workspace), "utf8"))).toEqual({ nonce: OLD_NONCE });
    // No retry: a second call refuses on the consumed day before any renewal.
    expect(await refusal(f)).toMatchObject({ code: "DAY_USED", dayClaimed: false });
    expect(f.calls.claude).toHaveLength(1);
  });

  it.each<[string, WorkerScenario, RegExp]>([
    ["the worker usage check fails", { outcome: "http_error", httpStatus: 401 }, /did not succeed/],
    ["the credential expires within 5 minutes", { expiresInMs: 120_000 }, /credential expiry/],
    ["a usage window is at 100%", { fiveHour: 100 }, /usage window 5h at 100%/]
  ])("consumes the day with no START when %s", async (_label, worker, reason) => {
    const f = fixture({ worker });
    const error = await refusal(f);
    expect(error).toMatchObject({ code: "CHECK_FAILED", dayClaimed: true });
    expect(error.message).toMatch(reason);
    expect(f.calls.claude).toHaveLength(1);
    expect(f.git.pushes).toBe(1);
    expect(journal(f).refusal).toMatchObject({ code: "CHECK_FAILED", dayClaimed: true });
  });

  it("refuses before the push when the Decision commits are not the Arcadia Controller's", async () => {
    const operator = "P. Mark Anderson\twayoutwest@example.test";
    const f = fixture({ commitIdentity: `${operator}\t${operator}` });
    expect(await refusal(f)).toMatchObject({ code: "RECORDS_IDENTITY", dayClaimed: true });
    expect(f.git.pushes).toBe(0);
    expect(f.calls.git.some((args) => args[0] === "push")).toBe(false);
    expect(JSON.parse(readFileSync(diagnosticGrantPath(f.workspace), "utf8"))).toEqual({ nonce: OLD_NONCE });
  });

  it("refuses before the Agent Ask when origin main moved after the claim", async () => {
    const f = fixture();
    const renew = f.deps.runClaude;
    f.deps.runClaude = async (args, timeout) => { f.git.remote = "e".repeat(40); return renew(args, timeout); };
    expect(await refusal(f)).toMatchObject({ code: "ORIGIN_MOVED", dayClaimed: true });
    expect(f.calls.cli).toEqual([]);
  });

  it("consumes the day when the bound worker never answers", async () => {
    const f = fixture({ worker: { silent: true } });
    expect(await refusal(f)).toMatchObject({ code: "CHECK_TIMEOUT", dayClaimed: true });
  });

  it("refuses without renewing when midnight passes after the claim, leaving that day consumed", async () => {
    const f = fixture({ midnightAfterClaim: true });
    expect(await refusal(f)).toMatchObject({ code: "DAY_CHANGED", dayClaimed: true });
    expect(f.calls.claude).toEqual([]);
    expect(existsSync(path.join(f.ledger, `${f.date}.json`))).toBe(true);
    expect(existsSync(path.join(f.ledger, `${f.date}.renewal.json`))).toBe(false);
  });

  it("publishes no grant when the canonical records leave under 60 seconds of the 5-minute window", async () => {
    const f = fixture({ cliDelayMs: 60_000 });
    const error = await refusal(f);
    expect(error).toMatchObject({ code: "GRANT_WINDOW", dayClaimed: true });
    // The answer was committed locally but never pushed: the refusal says so.
    expect(error.message).toContain("main may hold unpublished local Controller diagnostic commits, and START refuses until they are reconciled");
    expect(f.git.pushes).toBe(0);
    expect(JSON.parse(readFileSync(diagnosticGrantPath(f.workspace), "utf8"))).toEqual({ nonce: OLD_NONCE });
    expect(existsSync(diagnosticResponsePath(f.workspace, NONCE))).toBe(false);
  });
});

describe("start-run sign-in: the START gate on a receipt", () => {
  const binding = { release: RELEASE, handlerHash: "h".repeat(64) };
  const now = new Date("2026-11-01T17:00:00Z");
  const receipt = (overrides: Record<string, unknown> = {}) => ({
    schema: "arcadia-worker-claude-usage-receipt-v1", release: RELEASE, handlerHash: "h".repeat(64), approval: { digest: "d".repeat(64) }, success: true, outcome: "ok", httpStatus: 200,
    requestAttempted: true, credentialExpiresAt: "2026-11-01T18:00:00Z", windows: [{ label: "5h", usedPercentage: 99.9 }, { label: "7d", usedPercentage: 0 }], ...overrides
  });
  it("allows a successful bound check with a credential well ahead and both windows below 100%", () => {
    expect(signInReceiptRefusal(receipt(), binding, now)).toBeNull();
  });
  it.each<[string, Record<string, unknown>, RegExp]>([
    ["another handler", { handlerHash: "x".repeat(64) }, /bound worker/],
    ["no approval", { approval: null }, /approved grant/],
    ["a failed request", { success: false, outcome: "http_error", httpStatus: 401 }, /did not succeed/],
    ["a credential expiring in exactly 5 minutes", { credentialExpiresAt: "2026-11-01T17:05:00Z" }, /credential expiry/],
    ["a missing 7d window", { windows: [{ label: "5h", usedPercentage: 1 }] }, /7d unknown/],
    ["a 7d window at 100%", { windows: [{ label: "5h", usedPercentage: 1 }, { label: "7d", usedPercentage: 100 }] }, /7d at 100%/]
  ])("refuses %s", (_label, overrides, reason) => {
    expect(signInReceiptRefusal(receipt(overrides), binding, now)).toMatch(reason);
  });
});

describe("start-run sign-in: only inside the card's own press", () => {
  function press(overrides: { scriptId?: string; status?: string; claimed?: string | null; marker?: Record<string, unknown> | null } = {}) {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-press-")));
    directories.push(root);
    const library = path.join(root, "operator-scripts");
    const runDirectory = path.join(library, "runs", "start-card", "run-1");
    const pressDirectory = path.join(library, "runs", "operator", "start-card", "press-1");
    mkdirSync(runDirectory, { recursive: true });
    mkdirSync(pressDirectory, { recursive: true });
    writeFileSync(path.join(pressDirectory, "run.json"), JSON.stringify({ scriptId: overrides.scriptId ?? "start-card", status: overrides.status ?? "running" }));
    if (overrides.claimed !== null) writeFileSync(path.join(pressDirectory, "start-run.claimed"), `${overrides.claimed ?? "run-1"}\n`);
    if (overrides.marker !== null) writeFileSync(path.join(library, "start-card.consumed.json"), JSON.stringify(overrides.marker ?? { state: "CONSUMED", requestId: "start-card", runId: "run-1" }));
    const env = { ARCADIA_OPERATOR_SCRIPT_ID: "start-card", ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY: pressDirectory };
    return { options: { card: "start-card", runId: "run-1", runDirectory }, env };
  }
  it("accepts this card's running, claimed, consumed press", () => {
    const p = press();
    expect(() => assertStartCardPress(p.options, p.env)).not.toThrow();
  });
  it.each<[string, Parameters<typeof press>[0], Record<string, string | undefined> | null, RegExp]>([
    ["no operator context", {}, {}, /does not name this card/],
    ["another card's press", { scriptId: "other-card" }, null, /not this card's running press/],
    ["a finished press", { status: "failed" }, null, /not this card's running press/],
    ["an unclaimed press", { claimed: null }, null, /start-run\.claimed marker is not this run/],
    ["a press claimed by another run", { claimed: "run-2" }, null, /start-run\.claimed marker is not this run/],
    ["an allowance not yet consumed", { marker: null }, null, /allowance is not consumed by this run/],
    ["an allowance consumed by another run", { marker: { state: "CONSUMED", requestId: "start-card", runId: "run-0" } }, null, /allowance is not consumed by this run/]
  ])("refuses %s before anything is claimed", (_label, overrides, env, reason) => {
    const p = press(overrides);
    expect(() => assertStartCardPress(p.options, env ?? p.env)).toThrow(reason);
  });
});
