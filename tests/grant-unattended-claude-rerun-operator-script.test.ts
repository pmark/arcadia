import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";

/**
 * The one-shot Grant for the first UNATTENDED Claude run on Arcadia's own
 * repository: three Actions plus a Decision 0058 integration grant with the
 * Decision 0097 worker pull-request merge opt-in. Every behavioral case runs the reviewed pair copied into a
 * throwaway checkout and library with a fake `mise` (standing in for the
 * Arcadia CLI and the sign-in probe), `timeout` and `sleep` on PATH, and a
 * throwaway workspace config. The fake preview and activate build their scope
 * with the real normalizeProductionScope and fingerprintProductionScope, so the
 * script's own derived fingerprint is judged against Arcadia's code. No case
 * reaches the live workspace, production policy, GitHub, a provider or a model.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const ID = "grant-production-unattended-claude-rerun-20261018";
const PLAN = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
const ACTIONS = ["arcadia/implement-a-hermetic-test-that-a", "arcadia/implement-a-hermetic-test-that-an-2", "arcadia/implement-docs-reports-first-supervised-claude"];
const INTENT = "First unattended production run on Arcadia's own repository on the claude-code provider: three tests/docs Actions, each merged through its PR by the worker after exact-head independent review, with operator touches limited to activation and authority-adjacent merges.";
const source = readFileSync(path.join(library, `${ID}.sh`), "utf8");
const descriptor = JSON.parse(readFileSync(path.join(library, `${ID}.json`), "utf8"));

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

type Reply = { stdout?: string; stderr?: string; status?: number; realPreview?: RealScope; realActivate?: { fingerprint?: string } };
type RealScope = { scopeInput?: Record<string, unknown>; orderedActions?: Array<{ actionKey: string; state: string }> };
type Replies = Record<string, Reply | Reply[]>;

// The fake answers from replies.json (an array is consumed in order, its last
// entry repeating) and logs every call. `realPreview`/`realActivate` build the
// scope from the call's own arguments with Arcadia's real scope code.
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path"), cp = require("child_process");
const root = process.env.FAKE_ROOT, args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls.log"), JSON.stringify(args) + "\\n");
const replies = JSON.parse(fs.readFileSync(path.join(root, "replies.json"), "utf8"));
const rest = args.slice(2);
let key;
if (rest[0] === "pnpm") key = rest.slice(3).filter((a) => !a.startsWith("--")).slice(0, 2).join(" ");
else if (rest[0] === "node" && rest.includes("tsx")) { fs.readFileSync(0, "utf8"); key = "probe sign-in"; }
else key = "unexpected " + rest.join(" ");
let reply = replies[key];
if (reply === undefined) { process.stderr.write("unexpected call: " + key + "\\n"); process.exit(97); }
if (Array.isArray(reply)) {
  const counter = path.join(root, "counter-" + Buffer.from(key).toString("hex"));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  reply = reply[Math.min(n, reply.length - 1)];
}
const get = (flag) => args[args.indexOf(flag) + 1];
function realScope(extra) {
  const input = {
    intent: get("--intent"), projects: [get("--project")], plans: [get("--plan")],
    actions: args.filter((_a, i) => args[i - 1] === "--action"), providers: [get("--provider")],
    maxConcurrentSessions: Number(get("--concurrency")), mechanicalTransitions: get("--transitions").split(","),
    remotePreservation: args.includes("--remote-preservation"), packetApprovalExpiresAt: get("--packet-approval-expires-at"),
    ...(args.includes("--integration-grant-decision") ? { integrationGrant: {
      decisionRef: get("--integration-grant-decision"), expiresAt: get("--integration-grant-expires-at"),
      actions: args.filter((_a, i) => args[i - 1] === "--integration-grant-action"),
      ...(args.includes("--integration-grant-merge-pull-request") ? { mergeThroughPullRequest: true } : {})
    } } : {}),
    ...extra
  };
  // A null in a reply (JSON cannot carry undefined) removes that field from the real scope.
  for (const key of Object.keys(input)) if (input[key] === null) delete input[key];
  const program = 'import { normalizeProductionScope, fingerprintProductionScope } from ' + JSON.stringify(path.join(process.env.FAKE_ARCADIA_ROOT, "src", "production", "policy.ts")) + ';'
    + 'const scope = normalizeProductionScope(JSON.parse(process.argv[1])); process.stdout.write(JSON.stringify({ scope, fingerprint: fingerprintProductionScope(scope) }));';
  const env = { ...process.env }; delete env.VITEST;
  const run = cp.spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program, JSON.stringify(input)], { cwd: process.env.FAKE_ARCADIA_ROOT, env, encoding: "utf8", timeout: 60000 });
  if (run.status !== 0) { process.stderr.write(run.stderr); process.exit(96); }
  return JSON.parse(run.stdout);
}
if (reply.realPreview) {
  const { scope, fingerprint } = realScope(reply.realPreview.scopeInput || {});
  const orderedActions = reply.realPreview.orderedActions || scope.actions.map((actionKey) => ({ actionKey, state: "ready" }));
  reply = { stdout: JSON.stringify({ ok: true, data: { preview: { expectedRevision: 5, scope, scopeFingerprint: fingerprint, orderedActions, unmatched: { projects: [], plans: [] } } } }) };
} else if (reply.realActivate) {
  const { fingerprint } = realScope({});
  reply = { stdout: JSON.stringify({ ok: true, data: { result: { policy: { desiredState: "active", revision: 6, authority: { requestId: get("--request-id"), scopeFingerprint: reply.realActivate.fingerprint || fingerprint } } } } }) };
}
if (reply.stdout) process.stdout.write(reply.stdout);
if (reply.stderr) process.stderr.write(reply.stderr);
process.exitCode = reply.status ?? 0;
`;

function git(cwd: string, args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
const status = (desiredState: "active" | "inactive", requestId = "some-other-grant", liveAdmissions = 0) => ok({
  read: { status: "ok", policy: { desiredState, revision: 5, epoch: 3, authority: desiredState === "active" ? { requestId } : null } }, liveAdmissions
});
const capacity = (provider: Record<string, unknown>) => ok({ observation: { providers: [
  { providerId: "codex-cli", admitted: false, code: "capacity_unknown", reason: "no reading", receipt: { source: "none" } },
  { providerId: "claude-code-cli", admitted: true, code: null, reason: "5-hour 20%, 7-day 30%", receipt: { source: "claude_status_line" }, ...provider }
] } });

interface BoxOptions {
  /** Expiry belongs to the disposable copied pair, never the published card. */
  cardExpiresAt?: string;
  /** Fixture authority is independent of the current repository Plan status. */
  planStatus?: "active" | "draft";
  config?: unknown;
  decisions?: Partial<Record<"0130" | "0058" | "0097", string | null>>;
  tmuxLauncher?: boolean;
  workerMerge?: boolean;
  replies?: Replies;
  /** Pinned Actions already done in the fixture Plan. */
  done?: string[];
}

/** The real Plan document with the named Actions marked done. */
function planDocument(done: string[], planStatus: "active" | "draft" = "active"): string {
  let text = readFileSync(path.join(repoRoot, "docs", "plans", `${PLAN}.md`), "utf8")
    .replace(/^status: \w+$/m, `status: ${planStatus}`);
  for (const key of ACTIONS) {
    const id = key.slice(key.indexOf("/") + 1);
    text = text.replace(new RegExp(`(  - id: ${id}\\n(?:    .*\\n)*?    status: )\\w+`), `$1${done.includes(key) ? "done" : "open"}`);
  }
  return text;
}

const approved = (id: string, answer: string) => `---\nid: "${id}"\nstatus: approved\nanswer: ${answer}\n---\n`;
const DECISION_FILES: Record<"0130" | "0058" | "0097", [string, string]> = {
  "0130": ["0130-decide-whether-the-production-worker-may-read-claude-usage.md", approved("0130", "Allow read-only usage checks; cap unattended use at 80% of each Claude window")],
  "0058": ["0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md", approved("0058", "Delegate bounded candidate integration under a named, expiring grant")],
  "0097": ["0097-decide-how-an-autonomous-chain-hands-off-from-one-action-to-the-next.md", approved("0097", "\"Merge-then-next: each Action merges to main before the next launches\"")]
};

function box(options: BoxOptions = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-claude-unattended-grant-"));
  directories.push(root);
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const workspace = path.join(root, "martianrover");
  for (const dir of [scripts, bin, path.join(checkout, "docs", "decisions"), path.join(checkout, "docs", "plans"), path.join(workspace, "config")]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\ndist\n");
  // The re-run scope is read with the real discoverDocs from the checkout's build.
  symlinkSync(path.join(repoRoot, "dist"), path.join(checkout, "dist"));
  for (const [id, [file, body]] of Object.entries(DECISION_FILES)) {
    const content = options.decisions?.[id as keyof typeof DECISION_FILES];
    if (content === null) continue;
    writeFileSync(path.join(checkout, "docs", "decisions", file), content ?? body);
  }
  writeFileSync(path.join(checkout, "PROJECT.md"), `---\nactive_plan: ${PLAN}\ncurrent_action: first-unattended-run\n---\n`);
  if (options.tmuxLauncher !== false) {
    mkdirSync(path.join(checkout, "src", "sessions"), { recursive: true });
    writeFileSync(path.join(checkout, "src", "sessions", "tmuxLauncher.ts"), "export {};\n");
  }
  if (options.workerMerge !== false) {
    mkdirSync(path.join(checkout, "src", "production"), { recursive: true });
    writeFileSync(path.join(checkout, "src", "production", "workerMerge.ts"), "export {};\n");
  }
  writeFileSync(path.join(checkout, "docs", "plans", `${PLAN}.md`), planDocument(options.done ?? [], options.planStatus));
  // Behavioral fixtures remain fresh without renewing the historical library card.
  const cardExpiresAt = options.cardExpiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const expiryAssignment = /^CARD_EXPIRES_AT="[^"]+"$/m;
  if (!expiryAssignment.test(source)) throw new Error("Missing fixture card expiry assignment");
  const fixtureSource = source.replace(expiryAssignment, `CARD_EXPIRES_AT="${cardExpiresAt}"`);
  const fixtureDescriptor = { ...descriptor, expires_at: cardExpiresAt };
  validateOperatorScriptContract(fixtureDescriptor, ID, fixtureSource);
  writeFileSync(path.join(scripts, `${ID}.sh`), fixtureSource, { mode: 0o755 });
  writeFileSync(path.join(scripts, `${ID}.json`), JSON.stringify(fixtureDescriptor));
  git(checkout, ["init", "-q", "-b", "main"]);
  git(checkout, ["add", "-A"]);
  git(checkout, ["add", "-f", `artifacts/generated/operator-scripts/${ID}.sh`, `artifacts/generated/operator-scripts/${ID}.json`]);
  git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", "init"]);
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
  git(checkout, ["push", "-q", "-u", "origin", "main"]);
  const head = git(checkout, ["rev-parse", "HEAD"]);
  if (options.config !== undefined) writeFileSync(path.join(workspace, "config", "arcadia.json"), JSON.stringify(options.config, null, 2) + "\n");
  writeFileSync(path.join(bin, "mise"), FAKE, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const replies: Replies = {
    "workspace resolve": ok({ source: "user config", workspacePath: workspace }),
    "go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
    "probe sign-in": { stdout: JSON.stringify({ verdict: "signed_in" }) },
    "production capacity": capacity({}),
    "production status": status("inactive"),
    "production preview": { realPreview: {} },
    "production activate": { realActivate: {} },
    "production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
    ...options.replies
  };
  writeFileSync(path.join(root, "replies.json"), JSON.stringify(replies));
  writeFileSync(path.join(root, "calls.log"), "");
  const launch = { ARCADIA_OPERATOR_SCRIPT_ID: ID, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(scripts, `${ID}.json`) };
  const run = (env: Record<string, string | undefined> = launch, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: path.join(root, "home"), FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, ...env
    };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_WORKSPACE"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${ID}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 120_000 });
  };
  const receipt = () => {
    const runs = path.join(scripts, "runs");
    const [dir] = existsSync(runs) ? readdirSync(runs).map((d) => path.join(runs, d)) : [];
    if (!dir) throw new Error("no run directory");
    return { dir, json: JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8")) };
  };
  const calls = () => readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  const arcadiaCalls = (noun: string, verb: string) => calls().filter((c) => c[2] === "pnpm" && c[5] === noun && c[6] === verb);
  return { root, workspace, head, run, receipt, calls, arcadiaCalls, launch, fixtureDescriptor };
}

const gateOn = { codingAgent: { defaultProvider: "claude-code-cli" } };
const gateOff = { codingAgent: { defaultProvider: "claude-code-cli", capacityGateEnabled: false } };

describe("first unattended Claude run Grant: contract and static safety", () => {
  it("is a valid REPEATABLE grant pair with the exact title, executable and accepted by the library contract", () => {
    const validated = validateOperatorScriptContract(descriptor, ID, source);
    expect(validated).toMatchObject({ kind: "grant", repeatable: true, script: `${ID}.sh` });
    expect(validated.title).toBe("RE-RUN production: unattended Claude run on Arcadia (Claude only, the 3 pinned Actions still open, worker merges non-authority PRs after exact-head review; grant expires 24h after each press; card valid until 2026-10-25)");
    expect(source).toContain('CARD_EXPIRES_AT="2026-10-25T00:00:00Z"');
    expect(descriptor.expires_at).toBe("2026-10-25T00:00:00Z");
    expect(source).toContain('refuse "this re-run card expired at $CARD_EXPIRES_AT; ask for a fresh card"');
    accessSync(path.join(library, `${ID}.sh`), constants.X_OK);
    const checked = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "scripts", "check-operator-scripts.ts")], { cwd: repoRoot, encoding: "utf8" });
    expect(checked.status, checked.stderr).toBe(0);
    expect(JSON.parse(checked.stdout.trim().split("\n").pop()!)).toMatchObject({ failures: 0 });
  });

  it("pins the scope and the integration grant, previews twice, activates once, and never merges itself, refreshes usage or edits config", () => {
    expect(source).toContain(`SCRIPT_ID="${ID}"`);
    expect(source).toContain(`PLAN="${PLAN}"`);
    expect(source).toMatch(/ACTIONS=\(\n {2}implement-a-hermetic-test-that-a\n {2}implement-a-hermetic-test-that-an-2\n {2}implement-docs-reports-first-supervised-claude\n\)/);
    expect(source).toContain('INTEGRATION_DECISION="0058"');
    expect(source).toContain('HANDOFF_DECISION="0097"');
    expect(source).toContain('ARGS+=(--integration-grant-decision "$INTEGRATION_DECISION" --integration-grant-expires-at "$EXPIRES" --integration-grant-merge-pull-request)');
    // The grant covers the scope's own Actions: no ARGS line names --integration-grant-action.
    expect(source.split("\n").filter((line) => line.startsWith("ARGS")).join("\n")).not.toMatch(/--integration-grant-action/);
    expect(source).toContain('PROVIDER="claude-code-cli"');
    expect(source).toContain('SPEND_DECISION="0130"');
    expect(source).toContain('TRANSITIONS="validation,acceptance,pointer,packet_approval"');
    expect(source).toContain("PACKET_APPROVAL_HOURS=24");
    expect(source).toContain(`INTENT="${INTENT}"`);
    expect(source.split("\n").filter((line) => /arcadia production activate/.test(line))).toHaveLength(1);
    expect(source.split("arcadia production preview").length).toBe(3);
    for (const pattern of [/gh pr (merge|ready|edit|close)/, /gh api/, /git\b.*\bpush\b/, /capacity --refresh|--refresh/, /production reactivate/, /> "\$CONFIG_FILE"/, /workspace-config-edit/, /agent[-_]ask/, /export ARCADIA_WORKSPACE/]) {
      expect(source, String(pattern)).not.toMatch(pattern);
    }
  });

  it("derives the expected fingerprint in the canonical form fingerprintProductionScope uses", () => {
    const program = source.split("EXPECTED_FINGERPRINT=\"$(node -e '")[1].split("\n' \"$INTENT\"")[0];
    const expiresAt = "2026-10-18T20:15:30.123Z";
    const derived = spawnSync(process.execPath, ["-e", program, INTENT, "arcadia", `arcadia/${PLAN}`, JSON.stringify(ACTIONS), "claude-code-cli", "validation,acceptance,pointer,packet_approval", expiresAt, "0058"], { encoding: "utf8" });
    expect(derived.status, derived.stderr).toBe(0);
    const base = {
      intent: INTENT, projects: ["arcadia"], plans: [`arcadia/${PLAN}`], actions: ACTIONS, providers: ["claude-code-cli"], maxConcurrentSessions: 1,
      mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"] as Array<"validation" | "acceptance" | "pointer" | "packet_approval">,
      remotePreservation: true, packetApprovalExpiresAt: expiresAt
    };
    const scope = normalizeProductionScope({ ...base, integrationGrant: { decisionRef: "0058", expiresAt, actions: [], mergeThroughPullRequest: true } });
    expect(derived.stdout).toBe(fingerprintProductionScope(scope));
    // The opt-in and the grant are each load-bearing: without either the fingerprint differs.
    const noMerge = normalizeProductionScope({ ...base, integrationGrant: { decisionRef: "0058", expiresAt, actions: [] } });
    expect(derived.stdout).not.toBe(fingerprintProductionScope(noMerge));
    expect(derived.stdout).not.toBe(fingerprintProductionScope(normalizeProductionScope(base)));
  });
});

describe("first unattended Claude run Grant: refusals before any change", () => {
  it("--describe prints the descriptor; outside the library launcher it refuses with no Arcadia call", () => {
    const b = box({ config: gateOn });
    const described = b.run({}, ["--describe"]);
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(b.fixtureDescriptor);
    expect(b.run({}).status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ outcome: "refused", stage: "launch_context", activated: false, offCleanup: "not_attempted" });
    expect(b.calls()).toEqual([]);
  });

  it("refuses an expired copied card before any activation", () => {
    const expired = "2000-01-01T00:00:00Z";
    const b = box({ config: gateOn, cardExpiresAt: expired });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "parameters", activated: false, offCleanup: "not_attempted" });
    expect(json.reason).toContain(`this re-run card expired at ${expired}`);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
    expect(b.calls()).toEqual([]);
  });

  it("refuses a draft fixture Plan without activating production", () => {
    const b = box({ config: gateOn, planStatus: "draft" });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false });
    expect(json.reason).toContain(`the Plan ${PLAN} is not active`);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
  });

  it("refuses when ANTHROPIC_API_KEY is set, without recording its value", () => {
    const b = box({ config: gateOn });
    expect(b.run({ ...b.launch, ANTHROPIC_API_KEY: "sk-test-secret-value" }).status).not.toBe(0);
    const { dir, json } = b.receipt();
    expect(json.reason).toMatch(/ANTHROPIC_API_KEY is set/);
    expect(readFileSync(path.join(dir, "run.log"), "utf8") + JSON.stringify(json)).not.toContain("sk-test-secret-value");
    expect(b.calls()).toEqual([]);
  });

  it("refuses while the capacity gate is off in the workspace config, before reading production or previewing", () => {
    const b = box({ config: gateOff });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "capacity_gate", activated: false });
    expect(json.reason).toContain("press enable-capacity-gate-20261017 first");
    expect(b.arcadiaCalls("production", "status")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "preview")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
    // Observed, never changed.
    expect(JSON.parse(readFileSync(path.join(b.workspace, "config", "arcadia.json"), "utf8"))).toEqual(gateOff);
  });

  it("refuses when the workspace config is missing or the capacity read still reports Claude unmetered by configuration", () => {
    const missing = box({});
    expect(missing.run().status).not.toBe(0);
    expect(missing.receipt().json).toMatchObject({ stage: "capacity_gate" });
    const unmetered = box({ config: gateOn, replies: { "production capacity": capacity({ receipt: { source: "operator_config" } }) } });
    expect(unmetered.run().status).not.toBe(0);
    expect(unmetered.receipt().json).toMatchObject({ stage: "capacity", activated: false });
    expect(unmetered.receipt().json.reason).toContain("capacity gate is off");
    expect(unmetered.arcadiaCalls("production", "preview")).toHaveLength(0);
  });

  it("refuses an exhausted or reserve-margin Claude window but accepts a stale reading the worker refreshes", () => {
    const exhausted = box({ config: gateOn, replies: { "production capacity": capacity({ admitted: false, code: "capacity_reserve_margin", reason: "5-hour window at 85%" }) } });
    expect(exhausted.run().status).not.toBe(0);
    expect(exhausted.receipt().json).toMatchObject({ stage: "capacity", activated: false });
    expect(exhausted.arcadiaCalls("production", "activate")).toHaveLength(0);
    const stale = box({ config: gateOn, replies: { "production capacity": capacity({ admitted: false, code: "capacity_stale", reason: "reading is 40 minutes old" }) } });
    const result = stale.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(stale.receipt().json.capacityGate).toMatch(/^on: claude-code-cli stale/);
  });

  it("refuses a signed-out Claude Code worker", () => {
    const b = box({ config: gateOn, replies: { "probe sign-in": { stdout: JSON.stringify({ verdict: "signed_out" }) } } });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ stage: "claude_sign_in", claudeSignIn: "signed_out" });
    expect(b.arcadiaCalls("production", "capacity")).toHaveLength(0);
  });

  it("refuses Decision 0130 without an approval or a recorded answer", () => {
    const unanswered = box({ config: gateOn, decisions: { "0130": "---\nstatus: approved\n---\n" } });
    expect(unanswered.run().status).not.toBe(0);
    expect(unanswered.receipt().json.reason).toBe("Decision 0130 has no recorded answer");
    const open = box({ config: gateOn, decisions: { "0130": "---\nstatus: open\nanswer: x\n---\n" } });
    expect(open.run().status).not.toBe(0);
    expect(open.receipt().json.reason).toBe("Decision 0130 is not approved");
  });

  it("refuses while production is Active, never previewing or activating", () => {
    const b = box({ config: gateOn, replies: { "production status": status("active") } });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ outcome: "refused", stage: "production_state", activated: false, offCleanup: "not_attempted" });
    expect(b.arcadiaCalls("production", "preview")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "deactivate")).toHaveLength(0);
  });

  it.each([
    ["a fourth Action rides along", { scopeInput: { actions: [...ACTIONS, "arcadia/claude-worker-launch-replay"] } }],
    ["only two Actions are queued", { scopeInput: { actions: ACTIONS.slice(0, 2) } }],
    ["the queue orders the Actions differently", { scopeInput: { actions: [ACTIONS[1], ACTIONS[0], ACTIONS[2]] } }],
    ["the intent differs", { scopeInput: { intent: "Something else" } }],
    ["the integration grant is missing", { scopeInput: { integrationGrant: null } }],
    ["the worker merge opt-in is missing", { scopeInput: { integrationGrant: { decisionRef: "0058", expiresAt: "2026-10-19T00:00:00.000Z", actions: [] } } }],
    ["the integration grant names another Decision", { scopeInput: { integrationGrant: { decisionRef: "0130", expiresAt: "2026-10-19T00:00:00.000Z", actions: [], mergeThroughPullRequest: true } } }],
    ["the integration grant covers only one Action", { scopeInput: { integrationGrant: { decisionRef: "0058", expiresAt: "2026-10-19T00:00:00.000Z", actions: [ACTIONS[0]], mergeThroughPullRequest: true } } }],
    ["a Session limit appears", { scopeInput: { sessionTimeLimitMs: 60_000 } }],
    ["one Action is not ready", { orderedActions: [{ actionKey: ACTIONS[0], state: "ready" }, { actionKey: ACTIONS[1], state: "blocked" }, { actionKey: ACTIONS[2], state: "ready" }] }],
    ["no Action is queued", { scopeInput: { actions: [] as string[] }, orderedActions: [] }]
  ])("refuses scope drift when %s, never activating", (_label, realPreview) => {
    const b = box({ config: gateOn, replies: { "production preview": { realPreview } } });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ outcome: "refused", stage: "preview", activated: false, offCleanup: "not_attempted" });
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
  });
});

describe("first unattended Claude run Grant: preconditions kept and added", () => {
  it("refuses when src/sessions/tmuxLauncher.ts is absent at HEAD, before any Arcadia production call", () => {
    const b = box({ config: gateOn, tmuxLauncher: false });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false, offCleanup: "not_attempted" });
    expect(json.reason).toContain("src/sessions/tmuxLauncher.ts");
    expect(b.arcadiaCalls("production", "status")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
  });

  it("refuses when src/production/workerMerge.ts is absent at HEAD, before any Arcadia production call", () => {
    const b = box({ config: gateOn, workerMerge: false });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false, offCleanup: "not_attempted" });
    expect(json.reason).toContain("src/production/workerMerge.ts");
    expect(b.arcadiaCalls("production", "status")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
  });

  it.each([
    ["Decision 0058 is missing", { "0058": null }, "Decision 0058 is not in docs/decisions/0058-*.md"],
    ["Decision 0058 is not approved", { "0058": "---\nstatus: open\nanswer: x\n---\n" }, "Decision 0058 is not approved"],
    ["Decision 0097 is missing", { "0097": null }, "Decision 0097 is not in docs/decisions/0097-*.md"],
    ["Decision 0097 has no answer", { "0097": "---\nstatus: approved\n---\n" }, "Decision 0097 has no recorded answer"]
  ] as const)("refuses when %s, before any Arcadia production call", (_label, decisions, reason) => {
    const b = box({ config: gateOn, decisions });
    expect(b.run().status).not.toBe(0);
    const { json } = b.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false, offCleanup: "not_attempted", reason });
    expect(b.arcadiaCalls("production", "status")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "preview")).toHaveLength(0);
  });

  it("no longer depends on the PROJECT.md current_action pointer, and records the code-path preconditions on success", () => {
    expect(source).not.toMatch(/current_action:/);
    const b = box({ config: gateOn });
    expect(b.run().status).toBe(0);
    expect(b.receipt().json).toMatchObject({
      tmuxLauncherAtHead: "src/sessions/tmuxLauncher.ts", workerMergeAtHead: "src/production/workerMerge.ts", integrationDecision: "0058", handoffDecision: "0097"
    });
  });
});

describe("first unattended Claude run Grant: activation", () => {
  it("previews the pinned scope twice and activates it once with the integration-grant flags, the derived fingerprint and a 24-hour expiry", () => {
    const b = box({ config: gateOn });
    const before = Date.now();
    const result = b.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("GRANTED");
    const previews = b.arcadiaCalls("production", "preview");
    const activations = b.arcadiaCalls("production", "activate");
    expect(previews).toHaveLength(2);
    expect(activations).toHaveLength(1);
    expect(b.arcadiaCalls("production", "deactivate")).toHaveLength(0);
    const args = activations[0].slice(7);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args.filter((_a, i) => args[i - 1] === "--action")).toEqual(ACTIONS);
    expect(value("--project")).toBe("arcadia");
    expect(value("--plan")).toBe(`arcadia/${PLAN}`);
    expect(value("--provider")).toBe("claude-code-cli");
    expect(value("--concurrency")).toBe("1");
    expect(value("--transitions")).toBe("validation,acceptance,pointer,packet_approval");
    expect(value("--intent")).toBe(INTENT);
    expect(value("--expected-revision")).toBe("5");
    expect(value("--request-id")).toMatch(new RegExp(`^${ID}-\\d{8}T\\d{6}Z-\\d+$`));
    expect(value("--decision")).toBe("0130");
    expect(args).toContain("--remote-preservation");
    expect(value("--integration-grant-decision")).toBe("0058");
    expect(value("--integration-grant-expires-at")).toBe(value("--packet-approval-expires-at"));
    expect(args.filter((a) => a === "--integration-grant-merge-pull-request")).toHaveLength(1);
    expect(args).not.toContain("--integration-grant-action");
    // The activation repeats the preview's exact arguments.
    expect(previews[0].slice(7).filter((a) => a !== "--json")).toEqual(args.slice(0, previews[0].slice(7).length - 1));
    const expiry = Date.parse(value("--packet-approval-expires-at"));
    expect(expiry - before).toBeGreaterThan(24 * 3600e3 - 300e3);
    expect(expiry - Date.now()).toBeLessThanOrEqual(24 * 3600e3);
    const { dir, json } = b.receipt();
    expect(json).toMatchObject({
      id: ID, outcome: "succeeded", activated: true, stage: "complete", provider: "claude-code-cli", plan: `arcadia/${PLAN}`, actionIds: ACTIONS.map((a) => a.slice("arcadia/".length)),
      spendDecision: "0130", claudeSignIn: "signed_in", capacityGateConfigField: "absent", policyRevisionBefore: 5, policyRevisionAfter: 6, arcadiaHead: b.head, installedRelease: b.head
    });
    expect(json.scopeFingerprint).toBe(json.expectedScopeFingerprint);
    expect(json.capacityGate).toMatch(/^on: claude-code-cli admitted/);
    expect(json.authorizes).toContain("Decision 0058 candidate-integration grant");
    expect(json.neverAuthorizes).toContain("Merging an authority-adjacent pull request");
    const markdown = readFileSync(path.join(dir, "receipt.md"), "utf8");
    expect(markdown).toContain("worker pull-request merge ON (Decision 0097)");
    expect(markdown).toContain("Claude Code Session");
  });

  it("re-runs only the pinned Actions still open in the Plan, in the pinned order", () => {
    const b = box({ config: gateOn, done: [ACTIONS[0]] });
    const result = b.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const [activation] = b.arcadiaCalls("production", "activate");
    const args = activation.slice(7);
    expect(args.filter((_a, i) => args[i - 1] === "--action")).toEqual(ACTIONS.slice(1));
  });

  it("refuses when every pinned Action is already done, before any Arcadia production call", () => {
    const b = box({ config: gateOn, done: [...ACTIONS] });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ outcome: "refused", activated: false });
    expect(b.receipt().json.reason).toContain("every pinned Action is already done");
    expect(b.arcadiaCalls("production", "preview")).toHaveLength(0);
    expect(b.arcadiaCalls("production", "activate")).toHaveLength(0);
  });

  it("returns only its own Grant to Off when the activated fingerprint differs from the preview", () => {
    const b = box({ config: gateOn, replies: {
      "production activate": { realActivate: { fingerprint: "f".repeat(32) } },
      "production status": [status("inactive"), status("active", `${ID}-20261018T170000Z-1`)]
    } });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ outcome: "refused", stage: "activate", activated: true, offCleanup: "returned_off" });
    const [off] = b.arcadiaCalls("production", "deactivate");
    expect(off[off.indexOf("--request-id") + 1]).toMatch(new RegExp(`^${ID}-.*-off$`));
  });

  it("reads status back after a failed activate and leaves another Grant untouched", () => {
    const b = box({ config: gateOn, replies: {
      "production activate": { status: 1, stderr: "lost connection" },
      "production status": [status("inactive"), status("active", "someone-else")]
    } });
    expect(b.run().status).not.toBe(0);
    expect(b.receipt().json).toMatchObject({ stage: "activate", activated: false, offCleanup: "other_grant_active" });
    expect(b.arcadiaCalls("production", "deactivate")).toHaveLength(0);
  });
});
