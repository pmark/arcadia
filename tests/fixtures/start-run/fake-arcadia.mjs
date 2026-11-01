// A scripted stand-in for `arcadia` used by tests/start-run-executor.test.ts. It answers from
// $FAKE_ROOT/state.json, logs every call, and mutates the state only the way the real command would.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.FAKE_ROOT;
const args = process.argv.slice(2);
appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "arcadia", args, cwd: process.cwd() }) + "\n");
const statePath = path.join(root, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const ok = (data) => { process.stdout.write(JSON.stringify({ ok: true, data }) + "\n"); };
const key2 = args.slice(0, 2).join(" ");
const get = (flag) => args[args.indexOf(flag) + 1];
const git = (...a) => execFileSync("git", a, { cwd: process.cwd(), encoding: "utf8" }).trim();
const laDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** The CLI's JSON failure envelope and exit status. */
const fail = (code, message, dayClaimed) => {
  // Like the real CLI: tool noise, then the pretty-printed --json failure envelope on stderr.
  process.stderr.write("mise WARN  fixture noise\n" + JSON.stringify({ ok: false, command: "start-run.sign-in", error: { code: "VALIDATION_ERROR", message, details: { code, dayClaimed } } }, null, 2) + "\n");
  process.exit(2);
};

// A live worker beats continuously: refresh its heartbeat on every call unless the scenario freezes it.
const heartbeatFile = path.join(state.workspace, ".arcadia", "worker-claude-usage-heartbeat.json");
if (state.worker.alive && state.worker.heartbeat === "fresh" && existsSync(heartbeatFile)) {
  const beat = JSON.parse(readFileSync(heartbeatFile, "utf8"));
  beat.at = Date.now();
  writeFileSync(heartbeatFile, JSON.stringify(beat));
}

function realScope() {
  const input = {
    intent: get("--intent"), projects: [get("--project")], plans: [get("--plan")],
    actions: args.filter((_a, i) => args[i - 1] === "--action"), providers: [get("--provider")],
    maxConcurrentSessions: Number(get("--concurrency")), mechanicalTransitions: get("--transitions").split(","),
    remotePreservation: args.includes("--remote-preservation"), packetApprovalExpiresAt: get("--packet-approval-expires-at"),
    integrationGrant: {
      decisionRef: get("--integration-grant-decision"), expiresAt: get("--integration-grant-expires-at"),
      actions: args.filter((_a, i) => args[i - 1] === "--integration-grant-action"),
      ...(args.includes("--integration-grant-merge-pull-request") ? { mergeThroughPullRequest: true } : {})
    }
  };
  const program = 'import { normalizeProductionScope, fingerprintProductionScope } from ' + JSON.stringify(path.join(process.env.FAKE_ARCADIA_ROOT, "src", "production", "policy.ts")) + ';'
    + 'const scope = normalizeProductionScope(JSON.parse(process.argv[1])); process.stdout.write(JSON.stringify({ scope, fingerprint: fingerprintProductionScope(scope) }));';
  const env = { ...process.env }; delete env.VITEST;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program, JSON.stringify(input)], { cwd: process.env.FAKE_ARCADIA_ROOT, env, encoding: "utf8", timeout: 60000 });
  if (run.status !== 0) { process.stderr.write(run.stderr); process.exit(96); }
  return JSON.parse(run.stdout);
}

switch (key2) {
  case "workspace resolve":
    ok({ source: "user config", workspacePath: state.workspace });
    break;
  case "production status":
    ok({ read: { status: "ok", policy: { desiredState: state.production.desiredState, revision: state.production.revision, epoch: state.production.epoch, authority: state.production.authority ?? null } }, liveAdmissions: state.production.liveAdmissions });
    break;
  case "production capacity":
    ok(state.capacity);
    break;
  case "advance queue":
    ok(state.queue);
    break;
  case "production freeze-check":
    if (state.freeze === "refuse") { process.stderr.write("rehearsal freeze window: production is Active\n"); process.exit(1); }
    ok({ operation: args[2], state: "inactive", decision: "allowed", policyRevision: state.production.revision, policyEpoch: state.production.epoch });
    break;
  case "go-broker ensure": {
    if (state.ensure.fail) { process.stderr.write("ensure: install failed\n"); process.exit(1); }
    // Like the real install's host probe (Issue #1956): its git worktree, bridge and Next.js build print on stderr; a
    // scenario can also put that noise on stdout ahead of the envelope.
    const noise = "HEAD is now at 9b9711ad2\nBridged 4 dependency trees.\n   ▲ Next.js 15.5.19\n   Creating an optimized production build ...\n{ not json\n";
    process.stderr.write(noise);
    if (state.ensure.stdoutNoise) process.stdout.write(noise);
    state.broker.revision = git("rev-parse", "HEAD");
    state.broker.installed = true;
    // The registered compiled release the card then runs `worker install --replace-label` from.
    const release = path.join(process.env.HOME, ".local", "share", "arcadia", "go-broker", "releases", state.broker.revision);
    mkdirSync(path.join(release, "dist", "src"), { recursive: true });
    writeFileSync(path.join(release, "dist", "src", "cli.js"), "// fixture release CLI\n");
    writeFileSync(path.join(release, "broker-manifest.json"), JSON.stringify({ schema: "arcadia-go-broker-install-v1", revision: state.broker.revision, sourceRepository: state.repository, runtimeExecutable: path.join(process.env.FAKE_BIN, "fake-release-node") }));
    save();
    ok({ action: "installed", revision: state.broker.revision });
    break;
  }
  case "start-run sign-in": {
    // The real sequence is covered by tests/start-run-sign-in.test.ts; this answers the executor the way it would.
    const signin = state.signin ?? {};
    if (args.includes("--check-only")) {
      if (signin.check === "refuse") fail("REQUEST_SLOT_BUSY", "the worker diagnostic request is not a terminal request; preserve it", false);
      ok({ mode: "check-only", static: { date: laDate(), grantSlot: null, requestSlot: null } });
      break;
    }
    // The real press check runs against the press directory the dashboard runner and this executor actually made.
    if (state.tamperClaimed) writeFileSync(path.join(process.env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY, "start-run.claimed"), "another-run\n");
    const check = 'import { assertStartCardPress } from ' + JSON.stringify(path.join(process.env.FAKE_ARCADIA_ROOT, "src", "commands", "startRun.ts")) + ';'
      + 'try { assertStartCardPress(JSON.parse(process.argv[1])); } catch (e) { process.stdout.write(e.message); process.exit(3); }';
    const checkEnv = { ...process.env }; delete checkEnv.VITEST;
    const pressCheck = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", check, JSON.stringify({ card: get("--card"), runId: get("--run-id"), runDirectory: get("--run-directory") })], { cwd: process.env.FAKE_ARCADIA_ROOT, env: checkEnv, encoding: "utf8", timeout: 60000 });
    appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "press-check", args: [String(pressCheck.status)] }) + "\n");
    if (pressCheck.status !== 0) fail("NOT_A_CARD_PRESS", pressCheck.stdout || pressCheck.stderr, false);
    const workspace = get("--workspace");
    const date = laDate();
    const ledger = path.join(workspace, ".arcadia", "claude-renewal-days");
    const binding = JSON.parse(readFileSync(heartbeatFile, "utf8")).binding;
    const mode = signin.mode ?? "checked";
    if (mode !== "reused") {
      mkdirSync(ledger, { recursive: true });
      writeFileSync(path.join(ledger, `${date}.json`), JSON.stringify({ schema: "arcadia-daily-0141-claim-v1", date }));
      writeFileSync(path.join(ledger, `${date}.renewal.json`), JSON.stringify({ ok: mode !== "renewal_failed" }));
      if (mode === "renewal_failed") fail("RENEWAL_FAILED", "the Haiku sign-in renewal failed (exit 1); the day is consumed, no usage check runs and there is no retry", true);
    }
    const nonce = randomUUID();
    let decision = null, publicationHead = null;
    if (mode === "checked" || mode === "check_failed") {
      decision = `9999-authorize-one-start-card-worker-claude-usage-diagnostic-${date}-${nonce.slice(0, 8)}`;
      const file = path.join("docs", "decisions", `${decision}.md`);
      writeFileSync(path.join(state.repository, file), "---\nstatus: open\n---\n");
      git("add", "-A"); git("commit", "-m", "Settle the diagnostic Decision");
      writeFileSync(path.join(state.repository, file), "---\nstatus: approved\n---\n");
      git("add", "-A"); git("commit", "-m", "Answer the diagnostic Decision");
      git("push", "origin", "HEAD:refs/heads/main");
      publicationHead = git("rev-parse", "HEAD");
    }
    if (mode === "check_failed") fail("CHECK_FAILED", "the worker usage check does not allow START: the worker usage check did not succeed (outcome http_error, HTTP 401)", true);
    const receiptPath = path.join(workspace, "artifacts", "worker-claude-usage", `${nonce}.json`);
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    const now = Date.now();
    writeFileSync(receiptPath, JSON.stringify({
      schema: "arcadia-worker-claude-usage-receipt-v1", nonce, repository: state.repository, workspace, pid: binding.pid, release: binding.release, handlerHash: binding.handlerHash,
      approval: { decision, digest: "d".repeat(64) }, startedAt: new Date(now - 2000).toISOString(), finishedAt: new Date(now - 1000).toISOString(),
      credentialExpiresAt: new Date(now + (signin.expiresInMs ?? 3 * 3_600_000)).toISOString(), requestAttempted: true, httpStatus: 200, outcome: "ok", success: true,
      windows: [{ label: "5h", usedPercentage: signin.windowPercent ?? 20, resetsAt: new Date(now + 3_600_000).toISOString() }, { label: "7d", usedPercentage: 30, resetsAt: new Date(now + 86_400_000).toISOString() }]
    }), { mode: 0o600 });
    const sha256 = createHash("sha256").update(readFileSync(receiptPath)).digest("hex");
    ok({ mode: "run", outcome: mode === "reused" ? "reused" : "checked", date, dayClaimed: mode !== "reused", receipt: { path: receiptPath, sha256 }, binding, ...(decision ? { decision, digest: "d".repeat(64), nonce, publicationHead } : {}) });
    break;
  }
  case "go-broker status":
    ok({ ready: state.broker.ready, revision: state.broker.revision, preservationTransport: { ready: state.broker.transports }, agentGoTransport: { ready: state.broker.transports } });
    break;
  case "production runtime-check": {
    const head = git("rev-parse", "HEAD");
    const reasons = [];
    if (state.broker.revision !== head) {
      try { git("merge-base", "--is-ancestor", state.broker.revision, head); } catch { reasons.push("not an ancestor"); }
      const diff = git("diff", "--name-only", state.broker.revision, head, "--", ":(top)src", ":(top)scripts", ":(top)package.json");
      if (diff) reasons.push(`runtime paths differ: ${diff.split("\n").join(", ")}`);
    }
    if (state.runtimeStale) reasons.push("forced stale");
    const receipts = path.join(state.workspace, "artifacts", "worker-claude-usage");
    if (state.tamperReceiptsOnRuntimeCheck && existsSync(receipts)) for (const file of readdirSync(receipts)) appendFileSync(path.join(receipts, file), " ");
    ok({ current: reasons.length === 0, head, installedRevision: state.broker.revision, reasons });
    break;
  }
  case "production preview": {
    const { scope, fingerprint } = realScope();
    const mismatch = state.preview?.fingerprint ?? null;
    if (state.breakOnPreview === "owner") writeFileSync(path.join(state.workspace, ".arcadia", "worker.pid"), JSON.stringify({ pid: state.worker.pid, owner: "intruder" }));
    if (state.breakOnPreview === "handler") { const beat = JSON.parse(readFileSync(heartbeatFile, "utf8")); beat.binding.handlerHash = "swapped"; writeFileSync(heartbeatFile, JSON.stringify(beat)); }
    ok({ preview: { expectedRevision: state.production.revision, scope, scopeFingerprint: mismatch ?? fingerprint, orderedActions: scope.actions.map((actionKey) => ({ actionKey, state: "ready" })), unmatched: { projects: [], plans: [] } } });
    break;
  }
  case "production activate": {
    const { fingerprint } = realScope();
    if (!args.includes("--require-current-runtime")) { process.stderr.write("missing --require-current-runtime\n"); process.exit(95); }
    const mode = state.activate.mode;
    if (mode === "slow") { state.production = { ...state.production, desiredState: "active", revision: state.production.revision + 1, authority: { requestId: get("--request-id"), scopeFingerprint: fingerprint } }; save(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000); ok({ result: { policy: { desiredState: "active", revision: state.production.revision, authority: state.production.authority } } }); break; }
    if (mode === "crash") { process.stderr.write("activate crashed\n"); process.exit(1); }
    if (mode === "committed_then_crash" || mode === "ok" || mode === "wrong_fingerprint") {
      state.production = { ...state.production, desiredState: "active", revision: state.production.revision + 1, authority: { requestId: get("--request-id"), scopeFingerprint: mode === "wrong_fingerprint" ? "f".repeat(32) : fingerprint } };
      save();
      if (mode === "committed_then_crash") { process.stderr.write("activate timed out\n"); process.exit(1); }
      ok({ result: { policy: { desiredState: "active", revision: state.production.revision, authority: state.production.authority } } });
    } else {
      // "unconfirmed": prints a non-Active result and changes nothing.
      ok({ result: { policy: { desiredState: "inactive", revision: state.production.revision, authority: null } } });
    }
    break;
  }
  case "production deactivate":
    if (state.deactivate?.fail) { process.stderr.write("deactivate failed\n"); process.exit(1); }
    state.production = { ...state.production, desiredState: "inactive", authority: null };
    save();
    ok({ result: { policy: { desiredState: "inactive" } } });
    break;
  default:
    process.stderr.write(`unexpected arcadia call: ${args.join(" ")}\n`);
    process.exit(97);
}
