import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseDoc } from "../docs/parse.js";
import { validateContainerAuditAuthority, type ContainerAuditAuthority } from "./containerBrowserAudit.js";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { requireResolvedWorkspace } from "../workspace/resolve.js";

export const CONTAINER_AUDIT_REQUEST = ".arcadia/container-audit.request";
export const CONTAINER_AUDIT_TRANSPORT_HASH = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
export const containerAuditResponsePath = (workspace: string, nonce: string) => path.join(workspace, "artifacts", "container-audit-responses", `${nonce}.json`);
export interface HostAuditGrant {
  schema: "arcadia-container-audit-grant-v1";
  repository: string;
  source: string;
  decisionPath: string;
  authority: ContainerAuditAuthority;
}
export const containerAuditGrantAnswer = (grant: HostAuditGrant) => `Authorize one bounded container audit ${createHash("sha256").update(JSON.stringify({repository: grant.repository, source: grant.source, authority: grant.authority})).digest("hex")}`;
function boundedJson(file: string, maximum: number): unknown {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw new Error("audit.transport: invalid file");
    const bytes = Buffer.alloc(stat.size);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("audit.transport: incomplete file");
    return JSON.parse(bytes.toString("utf8"));
  } finally { closeSync(fd); }
}
export async function requestContainerAudit(source = process.cwd()): Promise<unknown> {
  const workspace = requireResolvedWorkspace({cwd: source});
  let nonce: string = randomUUID();
  const request = path.join(source, CONTAINER_AUDIT_REQUEST);
  if (existsSync(request)) {
    const existing = boundedJson(request, 128) as {nonce: string};
    if (Object.keys(existing).join() !== "nonce" || !/^[a-f0-9-]{36}$/.test(existing.nonce)) throw new Error("audit.transport: invalid pending request");
    nonce = existing.nonce;
  } else writeFileSync(request, JSON.stringify({nonce}), {mode: 0o600, flag: "wx"});
  for (let attempt = 0; attempt < 430; attempt++) {
    try { const response = boundedJson(containerAuditResponsePath(workspace, nonce), 8192) as {nonce: string}; if (response.nonce === nonce) return response; } catch { /* The host has not responded yet. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("audit.transport: host did not return a receipt; request remains preserved");
}
const inFlight = new Set<string>();
/** Called only by the existing host worker. No installation creates a Grant.
 * A protected workspace grant must match a canonical approved Decision and is
 * atomically consumed before launch. Agent requests contain only a nonce. */
export function processContainerAuditRequest(workspace: string, repository: string, proof?: { workerEntrypoint: string }): void {
  if (process.env.CODEX_SANDBOX) throw new Error("audit.transport: consumer is host-only");
  const request = path.join(repository, CONTAINER_AUDIT_REQUEST);
  if (!existsSync(request) || inFlight.has(repository)) return;
  let nonce: string;
  try {
    const value = boundedJson(request, 128) as {nonce: string};
    if (Object.keys(value).join() !== "nonce" || !/^[a-f0-9-]{36}$/.test(value.nonce)) return;
    nonce = value.nonce;
  } catch { return; }
  const response = containerAuditResponsePath(workspace, nonce);
  mkdirSync(path.dirname(response), {recursive: true, mode: 0o700});
  const respond = (value: object) => { const temporary = `${response}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify({nonce, ...value}), {mode: 0o600, flag: "wx"}); renameSync(temporary, response); };
  // Replay recovers the immutable host response; it never consumes another Grant.
  if (existsSync(response)) return;
  const grantFile = path.join(workspace, ".arcadia", "container-audit-grant.json");
  let grant: HostAuditGrant;
  let worker: string;
  try {
    grant = boundedJson(grantFile, 8192) as HostAuditGrant;
    if (Object.keys(grant).sort().join() !== "authority,decisionPath,repository,schema,source" || grant.schema !== "arcadia-container-audit-grant-v1" || grant.repository !== repository) throw new Error("audit.grant: no matching protected host Grant");
    validateContainerAuditAuthority(grant.authority);
    const decision = parseDoc(path.basename(grant.decisionPath), grant.decisionPath, readFileSync(grant.decisionPath, "utf8"));
    if (decision.errors.length || decision.doc?.type !== "decision" || decision.doc.status !== "approved" || decision.doc.answer !== containerAuditGrantAnswer(grant)) throw new Error("audit.grant: exact canonical Decision is not approved");
    worker = proof?.workerEntrypoint ?? path.join(path.dirname(realpathSync(path.join(homedir(), ".local", "bin", "arcadia-go-broker-codex"))), "dist", "scripts", "container-audit-host-worker.js");
    const executor = path.join(path.dirname(worker), "..", "src", "sessions", "containerBrowserAudit.js");
    if (!existsSync(worker) || createHash("sha256").update(readFileSync(executor)).digest("hex") !== grant.authority.executorHash) throw new Error("audit.grant: reviewed packaged host runtime is not installed");
    // One-shot: retries with this nonce recover its receipt, never re-execute.
    renameSync(grantFile, `${grantFile}.${nonce}.consumed`);
    renameSync(request, `${request}.${nonce}.consumed`);
  } catch (error) { respond({ok: false, error: String(error)}); return; }
  inFlight.add(repository);
  const receiptDirectory = path.join(workspace, "artifacts", "container-audits", nonce);
  let timer: NodeJS.Timeout | undefined;
  let finished = false;
  let delivering = false;
  const finish = (recoverable = true) => { finished = true; clearTimeout(timer); if (recoverable) inFlight.delete(repository); };
  const deliver = (value: object) => {
    if (finished || delivering) return;
    delivering = true;
    let retained = false;
    const recovery = path.join(receiptDirectory, "worker-result.json");
    try { writeFileSync(recovery, JSON.stringify({nonce, ...value}), {mode: 0o600, flag: "wx"}); retained = true; }
    catch (error) { process.stderr.write(`Container audit durable result unavailable: ${String(error)}\n`); }
    const attempt = (remaining: number) => {
      try { respond(value); finish(); }
      catch (error) {
        if (remaining > 0) { timer = setTimeout(() => attempt(remaining - 1), 1000); return; }
        process.stderr.write(`Container audit response unavailable: ${String(error)}; recovery ${retained ? recovery : "unavailable; inspect consumed Grant and container receipt"}\n`);
        finish(retained);
      }
    };
    clearTimeout(timer);
    attempt(5);
  };
  const fail = (error: unknown) => {
    if (finished || delivering) return;
    let receipt: string | undefined;
    try {
      mkdirSync(receiptDirectory, {recursive: true, mode: 0o700});
      const failure = path.join(receiptDirectory, "failure.json");
      writeFileSync(failure, JSON.stringify({nonce, authority: grant.authority, error: String(error), at: new Date().toISOString()}), {mode: 0o600});
      receipt = failure;
    } catch (writeError) { process.stderr.write(`Container audit failure receipt unavailable: ${String(writeError)}\n`); }
    deliver({ok: false, error: String(error), ...(receipt ? {receipt} : {receiptUnavailable: true})});
  };
  try {
    mkdirSync(receiptDirectory, {recursive: true, mode: 0o700});
    const child = fork(worker, [`${grantFile}.${nonce}.consumed`, receiptDirectory], {cwd: receiptDirectory, execArgv: [], env: {PATH: "/usr/local/bin:/usr/bin:/bin", HOME: receiptDirectory}, stdio: ["ignore", "ignore", "ignore", "ipc"]});
    timer = setTimeout(() => { child.kill("SIGTERM"); fail("audit.host: worker response timeout; retain consumed Grant and inspect its named container receipt"); }, 420000);
    child.once("message", result => { if (!finished) deliver(result as object); });
    child.once("error", fail);
    child.once("exit", code => { if (!finished) fail(`audit.host: worker exited without receipt (${code})`); });
  } catch (error) { fail(error); }
}
