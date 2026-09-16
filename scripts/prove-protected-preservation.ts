import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fixtureGit, manualPreservationFixture, preservationFixture } from "./preservation-fixture.js";
import { renderGoBrokerLauncher } from "../src/commands/goBrokerInstall.js";
import { preservationTransportReady } from "../src/sessions/preservationTransport.js";

// Run from an authorized macOS host after tsc, never nested inside an agent
// sandbox. Uses the REAL installed Codex profile, no model, no remote effects.
//
// Two disposable scenarios prove the same boundary for both preservation paths:
//   session — the registered managed Session lease (prepareSession).
//   manual  — the real `arcadia go` handoff shape: an active worktree
//             reservation and no Session, packet or production grant.
const implementation = process.cwd();
const hostParent = path.join(homedir(), ".local/share/arcadia");
mkdirSync(hostParent, { recursive: true });

const runtimeHashFiles = [
  "scripts/arcadia-go-broker.js",
  "src/sessions/preservationTransport.js",
  "src/sessions/preservationValidation.js",
  "src/sessions/manualPreservation.js",
  "src/sessions/candidateSnapshot.js",
  "src/sessions/candidatePreservation.js",
  "src/commands/preserve.js"
];

function buildRuntime(protectedRoot: string) {
  const runtime = path.join(protectedRoot, "runtime");
  mkdirSync(path.join(runtime, "dist"), { recursive: true });
  cpSync(path.join(implementation, "dist/src"), path.join(runtime, "dist/src"), { recursive: true });
  cpSync(path.join(implementation, "dist/scripts"), path.join(runtime, "dist/scripts"), { recursive: true });
  cpSync(path.join(implementation, "database"), path.join(runtime, "database"), { recursive: true });
  writeFileSync(path.join(runtime, "package.json"), '{"type":"module"}');
  symlinkSync(realpathSync(path.join(implementation, "node_modules")), path.join(runtime, "node_modules"));
  const hash = createHash("sha256");
  for (const name of runtimeHashFiles) hash.update(name).update(readFileSync(path.join(runtime, "dist", name)));
  return { runtime, runtimeSha256: hash.digest("hex") };
}

/** Validations the host persisted for this fixture, wherever the host filed them. */
function readValidations(workspace: string) {
  const evidenceRoot = path.join(workspace, "artifacts", "preservation");
  return readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(path.join(evidenceRoot, entry.name))
      .filter((name) => name.startsWith("check-"))
      .map((name) => JSON.parse(readFileSync(path.join(evidenceRoot, entry.name, name, "validation.json"), "utf8")) as {
        tree: string; results: Array<{ exitStatus: number | null }>;
      }));
}

async function proveScenario(mode: "session" | "manual") {
  const protectedRoot = realpathSync(mkdtempSync(path.join(hostParent, `preservation-proof-${mode}-`)));
  const f = mode === "manual" ? manualPreservationFixture(protectedRoot) : preservationFixture(protectedRoot);
  const { runtime, runtimeSha256 } = buildRuntime(protectedRoot);
  const launcher = path.join(protectedRoot, "arcadia-preserve-broker-codex");
  writeFileSync(launcher, renderGoBrokerLauncher(path.join(runtime, "dist/scripts/arcadia-go-broker.js"), "codex", "preserve"), { mode: 0o555 });
  const env: NodeJS.ProcessEnv = { ...process.env, ARCADIA_WORKSPACE: f.workspace, ARCADIA_SURFACE: "claude" };
  // The runner itself is host-authorized. Only its children below enter Codex.
  delete env.CODEX_SANDBOX;
  const commands: Array<{ argv: string[]; status: number | null; stdout: string; stderr: string }> = [];
  async function sandbox(args: string[]) {
    const argv = ["sandbox", "-P", "arcadia-unattended", "-C", f.candidate, "--", ...args];
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
      const child = spawn("codex", argv, { env, timeout: 30_000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", b => stdout += b); child.stderr.on("data", b => stderr += b);
      child.on("exit", status => resolve({ status, stdout, stderr }));
    });
    commands.push({ argv, ...result }); return result;
  }
  let worker: ReturnType<typeof spawn> | undefined;
  let workerOutput = "";
  // A launched Session owns a live tmux session. The fixture registers a
  // `prepared` Session, so the proof must give it that live transport: without
  // it the worker's managed-production iteration reconciles the Session as an
  // exited candidate before preservation is ever requested (issue #275). The
  // manual handoff has no Session, so it needs no tmux transport.
  let tmuxSessionName: string | undefined;
  // Exact-match probe: a bare `-t name` prefix-matches, which could target an
  // unrelated Session that merely starts with the fixture's name.
  const tmuxHas = (name: string) => {
    try { execFileSync("tmux", ["has-session", "-t", `=${name}`], { stdio: "ignore" }); return true; } catch { return false; }
  };
  try {
    if (f.lease) {
      tmuxSessionName = f.lease.tmux_session_name;
      execFileSync("tmux", ["new-session", "-d", "-s", tmuxSessionName, "-c", f.candidate], { stdio: "ignore" });
    }
    const check = await sandbox([process.execPath, "--input-type=module", "-e", `
import fs from 'node:fs';
fs.writeFileSync('marker.txt','ready\\n');
const paths=${JSON.stringify([path.join(f.repo, ".git/proof-write-must-fail"), path.join(f.workspace, "forged-evidence.json"), launcher])};
for(const p of paths){ let denied=false;try{fs.appendFileSync(p,'forged')}catch{denied=true}if(!denied)throw Error('Protected path writable: '+p);}
console.log('candidate edits allowed; common Git, host evidence and launcher writes denied');`]);
    assert.equal(check.status, 0, check.stderr);
    worker = spawn(process.execPath, [path.join(runtime, "dist/src/cli.js"), "worker", "start", "--workspace", f.workspace], { env, stdio: ["ignore", "pipe", "pipe"] });
    worker.stdout!.on("data", b => workerOutput += b); worker.stderr!.on("data", b => workerOutput += b);
    for (let i = 0; i < 80 && !preservationTransportReady(f.workspace); i++) await new Promise(r => setTimeout(r, 250));
    assert.ok(preservationTransportReady(f.workspace), workerOutput);
    const heartbeat = JSON.parse(readFileSync(path.join(f.workspace, ".arcadia/preservation.heartbeat"), "utf8"));
    if (mode === "manual") {
      // The host advertises the reservation as a handoff route, not a Session.
      assert.equal(heartbeat.sessions.length, 0);
      assert.deepEqual(heartbeat.handoffs.map((h: { worktree: string }) => h.worktree), [f.candidate]);
    } else {
      assert.deepEqual(heartbeat.sessions.map((s: { worktree: string }) => s.worktree), [f.candidate]);
      assert.equal(heartbeat.handoffs.length, 0);
    }
    const extra = await sandbox([launcher, "--passed=true"]);
    assert.notEqual(extra.status, 0, "Launcher accepted caller authority");
    const forge = await sandbox([process.execPath, "--input-type=module", "-e", "import fs from 'node:fs';fs.writeFileSync('marker.txt','wrong\\n');fs.writeFileSync('evidence.json',JSON.stringify({passed:true}));"]);
    assert.equal(forge.status, 0, forge.stderr);
    const refused = await sandbox([launcher]);
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /validation failed/);
    assert.equal(fixtureGit(f.candidate, ["rev-parse", "HEAD"]), f.base);
    const fix = await sandbox([process.execPath, "--input-type=module", "-e", "import fs from 'node:fs';fs.writeFileSync('marker.txt','ready\\n');fs.unlinkSync('evidence.json');"]);
    assert.equal(fix.status, 0, fix.stderr);
    const preserved = await sandbox([launcher]);
    assert.equal(preserved.status, 0, preserved.stderr);
    const receipt = JSON.parse(preserved.stdout).data.receipt;
    assert.equal(receipt.preservationState, "LOCAL ONLY");
    assert.equal(fixtureGit(f.candidate, ["rev-parse", "HEAD^{tree}"]), receipt.candidateFingerprint);
    if (mode === "manual") {
      assert.equal(receipt.authorityKind, "manual_handoff");
      assert.equal(receipt.policyEpoch, 0);
      assert.equal(receipt.policyRevision, 0);
    } else {
      assert.equal(receipt.authorityKind, undefined);
    }
    const replay = await sandbox([launcher]);
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).data.receipt.commitSha, receipt.commitSha);
    assert.equal(fixtureGit(f.candidate, ["rev-list", "--count", "main..HEAD"]), "1");
    const validations = readValidations(f.workspace);
    assert.ok(validations.some(v => v.tree === receipt.candidateFingerprint && v.results.every(r => r.exitStatus === 0)));
    assert.match(readFileSync(path.join(f.repo, "PROJECT.md"), "utf8"), /current_action: write-marker/);
    assert.match(readFileSync(path.join(f.repo, "docs/plans/proof.md"), "utf8"), /status: open/);
    return {
      mode: `${mode} preservation`,
      kind: mode === "manual" ? "manual handoff" : "managed Session",
      candidate: f.candidate,
      workerCommand: [process.execPath, path.join(runtime, "dist/src/cli.js"), "worker", "start", "--workspace", f.workspace],
      runtimeSha256,
      heartbeat: { sessions: heartbeat.sessions, handoffs: heartbeat.handoffs },
      commands,
      receipt,
      validations,
      workerOutput
    };
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise(r => worker!.once("exit", r));
    }
    if (tmuxSessionName && tmuxHas(tmuxSessionName)) { execFileSync("tmux", ["kill-session", "-t", `=${tmuxSessionName}`], { stdio: "ignore" }); }
    // Only the fixture's own temporary repositories and runtime are retired.
    rmSync(f.candidate, { recursive: true, force: true }); rmSync(protectedRoot, { recursive: true, force: true });
  }
}

const session = await proveScenario("session");
const handoff = await proveScenario("manual");
const output = path.resolve("docs/reports/protected-preservation-fixture.json");
// Top-level fields stay the managed-Session scenario for continuity with the
// prior Artifact; `scenarios` carries both boundaries side by side.
writeFileSync(output, JSON.stringify({
  kind: "disposable OS-boundary proof; no coding model or real production activation",
  sourceRevision: fixtureGit(implementation, ["rev-parse", "HEAD"]),
  runtimeSha256: session.runtimeSha256,
  host: process.platform, profile: "arcadia-unattended",
  sandboxApprovalPrompts: 0, hiddenInterventions: 0, unattendedProductionClaim: false,
  operatorSteps: [
    "Run this proof once from the host; it starts the existing worker with synthetic fixture authority and invokes the installed Codex sandbox command.",
    "It runs two scenarios: a registered managed Session and a manual go handoff with no Session."
  ],
  candidate: session.candidate,
  workerCommand: session.workerCommand,
  heartbeat: session.heartbeat,
  commands: session.commands,
  receipt: session.receipt,
  validations: session.validations,
  workerOutput: session.workerOutput,
  scenarios: { session, handoff }
}, null, 2));
console.log(`Protected boundary proof passed: ${output}`);
