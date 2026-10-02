import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { containerAuditGrantAnswer, containerAuditResponsePath, processContainerAuditRequest, CONTAINER_AUDIT_REQUEST, type HostAuditGrant } from "../src/sessions/containerAuditTransport.js";
import { containerAuditExecutorHash, runContainerBrowserAudit, type ContainerAuditAuthority } from "../src/sessions/containerBrowserAudit.js";
import { snapshotAuditSite } from "../src/sessions/hostBrowserAudit.js";

if (process.argv.length !== 2 || process.env.CODEX_SANDBOX) throw new Error("Fixture proof requires host execution with no arguments");
const image = JSON.parse(readFileSync(new URL("./browser-audit-image/identity.json", import.meta.url), "utf8")).image as string;
const root = mkdtempSync("/private/tmp/arcadia-container-proof-");
const source = path.join(root, "source");
mkdirSync(source);
writeFileSync(path.join(source, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Synthetic bounded browser fixture"><title>Bounded audit fixture</title></head><body><main><h1>Bounded audit fixture</h1><p>Static synthetic fixture served only inside the container.</p></main><script type="module" src="/ready.mjs"></script></body></html>');
writeFileSync(path.join(source, "ready.mjs"), 'const r=await fetch("/fixture.json");if(r.headers.get("content-type")==="application/json"&&(await r.json()).ready)document.body.dataset.moduleReady="true";');
writeFileSync(path.join(source, "fixture.json"), '{"ready":true}');
const snapshotHash = snapshotAuditSite(source, path.join(root, "baseline"));
const authority: ContainerAuditAuthority = { schema: "arcadia-container-audit-authority-v1", project: "browser-audit-fixture", revision: "001ee17263b27d5c8c8698c20a6e6d2dc2eb4f03", image, executorHash: containerAuditExecutorHash(), snapshotHash, routes: ["/"], viewports: [{ width: 390, height: 844 }, { width: 1440, height: 900 }], expiresAt: new Date(Date.now() + 600000).toISOString() };
const normal = await runContainerBrowserAudit({ authority, source, receiptDirectory: path.join(root, "normal"), proof: "normal" });
const stalled = await runContainerBrowserAudit({ authority, source, receiptDirectory: path.join(root, "stall"), proof: "stall" });
const stall = JSON.parse(readFileSync(stalled.receipt, "utf8"));
const sourceUnchanged = snapshotAuditSite(source, path.join(root, "after")) === snapshotHash;
const processRows = stall.processes.split("\n").map((line: string) => line.trim().split(/\s+/));
const worker = processRows.find((row: string[]) => row.slice(3).join(" ").includes("node /audit/worker.mjs"));
const detached = processRows.find((row: string[]) => row.slice(3).join(" ").includes("sleep 300"));
const detachedGroupProven = Boolean(worker && detached && worker[2] !== detached[2]);
const timeoutProven = stall.timedOut && stall.removed && stall.stage === "browser.stall" && stall.result?.detachedChild && detachedGroupProven;
const ready = normal.ready && Boolean(timeoutProven) && sourceUnchanged;
// A separate synthetic Project tests the actual nonce-only host consumer.
// This temp fixture is not an operator Decision or an installed activation.
const repository = path.join(root, "broker-fixture");
const workspace = path.join(root, "workspace-fixture");
for (const p of [repository, workspace]) mkdirSync(path.join(p, ".arcadia"), {recursive: true});
writeFileSync(path.join(repository, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: browser-audit-fixture\nstatus: active\nupdated: 2026-10-02\ngoal: Prove the synthetic broker boundary\n---\n# Synthetic broker fixture\n");
const git = (args: string[]) => { const result = spawnSync("/usr/bin/git", args, {cwd: repository, encoding: "utf8", env: {PATH: "/usr/bin:/bin", GIT_AUTHOR_NAME: "Cody Atlas", GIT_AUTHOR_EMAIL: "cody.atlas@agents.arcadia.local", GIT_COMMITTER_NAME: "Cody Atlas", GIT_COMMITTER_EMAIL: "cody.atlas@agents.arcadia.local"}}); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); };
git(["init"]); git(["add", "PROJECT.md"]); git(["commit", "-m", "Synthetic broker proof fixture"]);
const grant: HostAuditGrant = {schema: "arcadia-container-audit-grant-v1", repository, source, decisionPath: path.join(root, "synthetic-decision.md"), authority: {...authority, revision: git(["rev-parse", "HEAD"])} };
const answer = containerAuditGrantAnswer(grant);
writeFileSync(grant.decisionPath, `---\narcadia: v1\ntype: decision\nid: "0001"\nslug: synthetic-proof\nproject: browser-audit-fixture\nstatus: approved\nquestion: Synthetic fixture only\ngap_type: missing-decision\nupdated: 2026-10-02\nanswer: ${JSON.stringify(answer)}\n---\n# Synthetic fixture only\n`);
writeFileSync(path.join(workspace, ".arcadia/container-audit-grant.json"), JSON.stringify(grant), {mode: 0o600});
const nonce = "12345678-1234-1234-1234-123456789abc";
writeFileSync(path.join(repository, CONTAINER_AUDIT_REQUEST), JSON.stringify({nonce}));
processContainerAuditRequest(workspace, repository, {workerEntrypoint: fileURLToPath(new URL("./container-audit-host-worker.js", import.meta.url))});
let broker: {ok?: boolean; receipt?: string; error?: string} = {};
for (let i=0; i<430; i++) { try { broker = JSON.parse(readFileSync(containerAuditResponsePath(workspace, nonce), "utf8")); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
if (typeof broker.ok !== "boolean") {
  const summary = {schema: "arcadia-container-browser-proof-v1", root, ready: false, normal, stalled, broker: {ok: false, error: "Host broker response unavailable after bounded wait"}, timeoutProven: Boolean(timeoutProven), detachedGroupProven, sourceUnchanged, authority};
  writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 2;
} else {
const authorityDenials: Record<string, boolean> = {};
for (const [field, change] of Object.entries({project: "different-project", revision: "a".repeat(40), image: `sha256:${"a".repeat(64)}`, executorHash: "a".repeat(64), snapshotHash: "a".repeat(64), routes: ["/other/"], viewports: [{width: 400, height: 850}], expiresAt: new Date(Date.now()+300000).toISOString()})) {
  const altered = {...grant, authority: {...grant.authority, [field]: change}};
  const driftNonce = randomUUID();
  writeFileSync(path.join(workspace, ".arcadia/container-audit-grant.json"), JSON.stringify(altered));
  writeFileSync(path.join(repository, CONTAINER_AUDIT_REQUEST), JSON.stringify({nonce: driftNonce}));
  processContainerAuditRequest(workspace, repository);
  const response = JSON.parse(readFileSync(containerAuditResponsePath(workspace, driftNonce), "utf8"));
  authorityDenials[field] = response.ok === false && /audit\.(?:grant|authority)/.test(response.error);
}
const brokerModuleRendered = Boolean(broker.receipt && JSON.parse(readFileSync(broker.receipt, "utf8")).result?.renders.every((r: {moduleMarker?: string}) => r.moduleMarker === "true"));
const summary = { schema: "arcadia-container-browser-proof-v1", root, ready: ready && broker.ok === true && brokerModuleRendered && Object.values(authorityDenials).every(Boolean), normal, stalled, broker, brokerModuleRendered, authorityDenials, timeoutProven: Boolean(timeoutProven), detachedGroupProven, sourceUnchanged, authority };
writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.ready ? 0 : 2;
}
