import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fixtureGit, preservationFixture } from "./preservation-fixture.js";
import { renderGoBrokerLauncher } from "../src/commands/goBrokerInstall.js";
import { preservationTransportReady } from "../src/sessions/preservationTransport.js";

// Run from an authorized macOS host after tsc, never nested inside an agent
// sandbox. Uses the REAL installed Codex profile, no model, no remote effects.
const implementation = process.cwd();
const hostParent = path.join(homedir(), ".local/share/arcadia");
mkdirSync(hostParent, { recursive: true });
const protectedRoot = realpathSync(mkdtempSync(path.join(hostParent, "preservation-proof-")));
const f = preservationFixture(protectedRoot);
const runtime = path.join(protectedRoot, "runtime");
mkdirSync(path.join(runtime, "dist"), { recursive: true });
cpSync(path.join(implementation, "dist/src"), path.join(runtime, "dist/src"), { recursive: true });
cpSync(path.join(implementation, "dist/scripts"), path.join(runtime, "dist/scripts"), { recursive: true });
cpSync(path.join(implementation, "database"), path.join(runtime, "database"), { recursive: true });
writeFileSync(path.join(runtime, "package.json"), '{"type":"module"}');
symlinkSync(realpathSync(path.join(implementation, "node_modules")), path.join(runtime, "node_modules"));
const launcher = path.join(protectedRoot, "arcadia-preserve-broker-codex");
writeFileSync(launcher, renderGoBrokerLauncher(path.join(runtime, "dist/scripts/arcadia-go-broker.js"), "codex", "preserve"), { mode: 0o555 });
const runtimeHash = createHash("sha256");
for (const name of ["scripts/arcadia-go-broker.js", "src/sessions/preservationTransport.js", "src/sessions/preservationValidation.js", "src/sessions/candidateSnapshot.js", "src/sessions/candidatePreservation.js", "src/commands/preserve.js"]) runtimeHash.update(name).update(readFileSync(path.join(runtime, "dist", name)));
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
try {
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
  const replay = await sandbox([launcher]);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).data.receipt.commitSha, receipt.commitSha);
  assert.equal(fixtureGit(f.candidate, ["rev-list", "--count", "main..HEAD"]), "1");
  const evidenceDirectory = path.join(f.workspace, "artifacts/preservation", f.lease.id);
  const validations = readdirSync(evidenceDirectory).filter(x => x.startsWith("check-")).map(x => JSON.parse(readFileSync(path.join(evidenceDirectory, x, "validation.json"), "utf8")));
  assert.ok(validations.some(v => v.tree === receipt.candidateFingerprint && v.results.every((r: { exitStatus: number }) => r.exitStatus === 0)));
  assert.match(readFileSync(path.join(f.repo, "PROJECT.md"), "utf8"), /current_action: write-marker/);
  assert.match(readFileSync(path.join(f.repo, "docs/plans/proof.md"), "utf8"), /status: open/);
  const output = path.resolve("docs/reports/protected-preservation-fixture.json");
  writeFileSync(output, JSON.stringify({ kind: "disposable OS-boundary proof; no coding model or real production activation", sourceRevision: fixtureGit(implementation, ["rev-parse", "HEAD"]), runtimeSha256: runtimeHash.digest("hex"), host: process.platform, profile: "arcadia-unattended", hostRoot: protectedRoot, candidate: f.candidate, workerCommand: [process.execPath, path.join(runtime, "dist/src/cli.js"), "worker", "start", "--workspace", f.workspace], operatorSteps: ["Run this proof once from the host; it starts the existing worker with synthetic fixture authority and invokes the installed Codex sandbox command."], sandboxApprovalPrompts: 0, hiddenInterventions: 0, unattendedProductionClaim: false, commands, receipt, validations, workerOutput }, null, 2));
  console.log(`Protected boundary proof passed: ${output}`);
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise(r => worker!.once("exit", r));
  }
  // Only the fixture's own temporary repositories and runtime are retired.
  rmSync(f.candidate, { recursive: true, force: true }); rmSync(protectedRoot, { recursive: true, force: true });
}
