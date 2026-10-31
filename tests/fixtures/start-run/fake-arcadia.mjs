// A scripted stand-in for `arcadia` used by tests/start-run-executor.test.ts. It answers from
// $FAKE_ROOT/state.json, logs every call, and mutates the state only the way the real command would.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
  case "go-broker ensure":
    if (state.ensure.fail) { process.stderr.write("ensure: install failed\n"); process.exit(1); }
    state.broker.revision = git("rev-parse", "HEAD");
    state.broker.installed = true;
    save();
    ok({ action: "installed", revision: state.broker.revision });
    break;
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
