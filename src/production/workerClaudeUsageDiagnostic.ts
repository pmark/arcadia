import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseDoc } from "../docs/parse.js";
import { readProviderUsage, type ProviderUsageDependencies, type ProviderUsageReading } from "../codingAgents/providerUsage.js";
export const CLAUDE_DIAGNOSTIC_REQUEST = ".arcadia/worker-claude-usage.request";
export const CLAUDE_DIAGNOSTIC_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const MAX_DEADLINE_MS = 30000;
const noncePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface DiagnosticWorkerBinding {
  pid: number;
  instance: string;
  release: string;
  handlerHash: string;
  repository: string;
}
export interface DiagnosticPolicy {
  state: "inactive" | "active" | "unknown";
  revision: number;
  epoch: number;
  liveAdmissions: number;
  ownsWorker: boolean;
}
export interface ClaudeDiagnosticGrant {
  schema: "arcadia-worker-claude-usage-grant-v1";
  nonce: string;
  repository: string;
  workspace: string;
  release: string;
  handlerHash: string;
  decision: string;
  provider: "claude";
  source: "auto";
  endpoint: typeof CLAUDE_DIAGNOSTIC_ENDPOINT;
  policyRevision: number;
  policyEpoch: number;
  expiresAt: string;
  deadlineMs: number;
}
export interface DiagnosticDependencies {
  now?: () => Date;
  usage?: ProviderUsageDependencies;
  signal?: AbortSignal;
}
const grantKeys = "deadlineMs,decision,endpoint,expiresAt,handlerHash,nonce,policyEpoch,policyRevision,provider,release,repository,schema,source,workspace";
export const diagnosticResponsePath = (workspace: string, nonce: string) => path.join(workspace, "artifacts", "worker-claude-usage", `${nonce}.json`);
export const diagnosticGrantPath = (workspace: string) => path.join(workspace, ".arcadia", "worker-claude-usage-grant.json");
export const diagnosticGrantAnswer = (grant: ClaudeDiagnosticGrant) => `Authorize one worker Claude usage diagnostic ${createHash("sha256").update(JSON.stringify(grant)).digest("hex")}`;
function boundedJson(file: string, protectedFile = false): unknown {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || (protectedFile && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())))
      throw new Error("invalid_file");
    const bytes = Buffer.alloc(stat.size);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length)
      throw new Error("incomplete_file");
    return JSON.parse(bytes.toString("utf8"));
  }
  finally {
    closeSync(fd);
  }
}
/** Capture actual module locations/bytes once at startup; never infer loaded code
* from a later Git HEAD. Only an existing registered protected release qualifies. */
export function captureDiagnosticWorkerBinding(workerModuleUrl: string, fixture?: {
  moduleUrl: string;
  home: string;
}): DiagnosticWorkerBinding | null {
  try {
    const module = fileURLToPath(fixture?.moduleUrl ?? import.meta.url);
    const root = realpathSync(path.resolve(path.dirname(module), "../../.."));
    const worker = realpathSync(fileURLToPath(workerModuleUrl));
    if (worker !== path.join(root, "dist/src/commands/worker.js") || realpathSync(module) !== path.join(root, "dist/src/production/workerClaudeUsageDiagnostic.js"))
      return null;
    const registeredRoot = path.join(fixture?.home ?? homedir(), ".local/share/arcadia/go-broker/releases", path.basename(root));
    if (root !== registeredRoot || realpathSync(root) !== registeredRoot || (lstatSync(root).mode & 0o022) !== 0)
      return null;
    const manifestPath = path.join(root, "broker-manifest.json");
    const stat = lstatSync(manifestPath);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o444 || stat.uid !== process.getuid?.())
      return null;
    const manifest = JSON.parse(readFileSync(path.join(root, "broker-manifest.json"), "utf8"));
    if (manifest.schema !== "arcadia-go-broker-install-v1" || !/^[a-f0-9]{40}$/.test(manifest.revision) || path.basename(root) !== manifest.revision || manifest.runtimeExecutable !== process.execPath)
      return null;
    if (Object.keys(manifest).sort().join() !== "brokerEntrypoint,revision,roleRegistrySha256,runtimeExecutable,schema,sourceRepository" || manifest.brokerEntrypoint !== path.join(root, "dist/scripts/arcadia-go-broker.js"))
      return null;
    const registry = path.join(root, "dist/config/defaults/agent-roles.json");
    if (realpathSync(registry) !== registry || createHash("sha256").update(readFileSync(registry)).digest("hex") !== manifest.roleRegistrySha256)
      return null;
    const files = [worker, module, path.join(root, "dist/src/codingAgents/providerUsage.js"), path.join(root, "dist/src/codingAgents/availability.js")];
    const handlerHash = createHash("sha256");
    for (const file of files) {
      if (realpathSync(file) !== file || !lstatSync(file).isFile())
        return null;
      handlerHash.update(readFileSync(file));
    }
    return Object.freeze({ pid: process.pid, instance: randomUUID(), release: manifest.revision, handlerHash: handlerHash.digest("hex"), repository: realpathSync(manifest.sourceRepository) });
  }
  catch {
    return null;
  }
}
interface DiagnosticAuthority {
  grant: ClaudeDiagnosticGrant;
  digest: string;
}
/** Read the same fixed authority at each asynchronous boundary. A nonce alone
* cannot bind a replay to a replacement grant or a revoked Decision. */
function readDiagnosticAuthority(workspace: string, repository: string, binding: DiagnosticWorkerBinding | null, nonce: string): DiagnosticAuthority {
  const grant = boundedJson(diagnosticGrantPath(workspace), true) as ClaudeDiagnosticGrant;
  if (!grant || !exactKeys(grant, grantKeys) || grant.schema !== "arcadia-worker-claude-usage-grant-v1" || grant.nonce !== nonce || grant.workspace !== realpathSync(workspace) || grant.repository !== realpathSync(repository) || repository !== realpathSync(repository)
    || grant.provider !== "claude" || grant.source !== "auto" || grant.endpoint !== CLAUDE_DIAGNOSTIC_ENDPOINT || grant.release !== binding?.release || grant.handlerHash !== binding?.handlerHash
    || !/^[a-z0-9][a-z0-9-]*$/.test(grant.decision) || !Number.isInteger(grant.policyRevision) || !Number.isInteger(grant.policyEpoch)
    || !canonicalTime(grant.expiresAt) || !Number.isInteger(grant.deadlineMs) || grant.deadlineMs < 1 || grant.deadlineMs > MAX_DEADLINE_MS)
    throw new Error("grant_refused");
  const decisionPath = path.join(repository, "docs/decisions", `${grant.decision}.md`);
  if (realpathSync(decisionPath) !== decisionPath || realpathSync(path.dirname(diagnosticGrantPath(workspace))) !== path.dirname(diagnosticGrantPath(workspace)))
    throw new Error("noncanonical_path");
  const answer = diagnosticGrantAnswer(grant);
  const decision = parseDoc(path.basename(decisionPath), decisionPath, readFileSync(decisionPath, "utf8"));
  if (decision.errors.length || decision.doc?.type !== "decision" || decision.doc.status !== "approved" || decision.doc.answer !== answer)
    throw new Error("decision_refused");
  return { grant, digest: answer.split(" ").at(-1) ?? "" };
}
const inFlight = new Map<string, {
  digest: string | null;
  operation: Promise<unknown>;
}>();
const exactKeys = (value: object, keys: string) => Object.keys(value).sort().join() === keys;
const canonicalTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
function safeReading(reading: ProviderUsageReading, now: Date) {
  const windows = reading.windows.filter(w => ["5h", "7d"].includes(w.label) && Number.isFinite(w.usedPercentage) && w.usedPercentage >= 0 && w.usedPercentage <= 100 && canonicalTime(w.resetsAt) && Date.parse(w.resetsAt!) > now.getTime())
    .map(w => ({ label: w.label, usedPercentage: w.usedPercentage, resetsAt: new Date(w.resetsAt!).toISOString() }));
  const source = ["environment", "file", "keychain", "auto"].includes(reading.credentialSource) ? reading.credentialSource : "unknown";
  const outcome = ["no_credentials", "credential_expired", "transport", "parse", "http_error", "not_reported", "ok"].includes(reading.outcome) ? reading.outcome : "unavailable";
  const success = reading.httpStatus === 200 && outcome === "ok" && windows.some(w => w.label === "5h") && windows.some(w => w.label === "7d");
  return { credentialSource: source, credentialExpiresAt: canonicalTime(reading.credentialExpiresAt) ? new Date(reading.credentialExpiresAt!).toISOString() : null,
    requestAttempted: reading.requestAttempted === true, httpStatus: Number.isInteger(reading.httpStatus) && reading.httpStatus! >= 100 && reading.httpStatus! <= 599 ? reading.httpStatus : null,
    outcome, windows: success ? windows : [], source: reading.requestAttempted ? "worker_live_request" : "worker_no_request", success };
}
/** Fixed in-process operation. Requests supply only nonce; all authority comes
* from the protected grant, canonical Decision and fresh worker policy snapshot. */
export function processWorkerClaudeUsageRequest(workspace: string, repository: string, binding: DiagnosticWorkerBinding | null, policy: () => DiagnosticPolicy, dependencies: DiagnosticDependencies = {}): Promise<unknown> {
  let nonce: string;
  try {
    const request = boundedJson(path.join(repository, CLAUDE_DIAGNOSTIC_REQUEST)) as {
      nonce: string;
    };
    if (!request || !exactKeys(request, "nonce") || !noncePattern.test(request.nonce))
      return Promise.resolve(null);
    nonce = request.nonce;
  }
  catch {
    return Promise.resolve(null);
  }
  let authority: DiagnosticAuthority | null = null;
  try {
    authority = readDiagnosticAuthority(workspace, repository, binding, nonce);
  }
  catch {
  }
  const key = `${workspace}\0${repository}\0${nonce}`;
  const running = inFlight.get(key);
  if (running)
    return authority && running.digest === authority.digest ? running.operation : Promise.resolve(null);
  const operation = processRequest(workspace, repository, binding, policy, dependencies, nonce, authority);
  const entry = { digest: authority?.digest ?? null, operation };
  inFlight.set(key, entry);
  void operation.finally(() => {
    if (inFlight.get(key) === entry)
      inFlight.delete(key);
  }).catch(() => {
  });
  return operation;
}
async function processRequest(workspace: string, repository: string, binding: DiagnosticWorkerBinding | null, policy: () => DiagnosticPolicy, dependencies: DiagnosticDependencies, nonce: string, authority: DiagnosticAuthority | null) {
  const response = diagnosticResponsePath(workspace, nonce);
  if (existsSync(response)) {
    const existing = boundedJson(response, true) as {
      repository: string;
      workspace: string;
      nonce: string;
      release: string;
      handlerHash: string;
      approval?: {
        digest: string;
      };
    };
    if (!authority || existing.repository !== repository || existing.workspace !== workspace || existing.nonce !== nonce || existing.release !== binding?.release || existing.handlerHash !== binding?.handlerHash || existing.approval?.digest !== authority.digest)
      return null;
    // Recovery is the original observation, never a renewed execution allowance.
    return (dependencies.now?.() ?? new Date()).getTime() >= Date.parse(authority.grant.expiresAt) ? { ...existing, historical: true } : existing;
  }
  mkdirSync(path.dirname(response), { recursive: true, mode: 0o700 });
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const identity = { pid: binding?.pid ?? process.pid, release: binding?.release ?? null, handlerHash: binding?.handlerHash ?? null };
  let approval: object | null = null;
  const receipt = (data: object) => {
    const value = { schema: "arcadia-worker-claude-usage-receipt-v1", nonce, repository, workspace, ...identity, approval, startedAt, finishedAt: now().toISOString(), ...data };
    try {
      writeFileSync(response, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      return value;
    }
    catch {
      return boundedJson(response, true);
    }
  };
  const failed = (outcome: string, requestAttempted = false) => receipt({ success: false, outcome, requestAttempted, httpStatus: null, windows: [], source: requestAttempted ? "worker_live_request" : "worker_no_request" });
  const attempt = `${response}.attempt`;
  if (existsSync(attempt)) {
    const owner = boundedJson(attempt, true) as {
      pid: number;
      instance: string;
      approval?: {
        digest: string;
      };
    };
    if (!authority || owner.approval?.digest !== authority.digest)
      return null;
    approval = owner.approval;
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    }
    catch (error) {
      alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive && owner.instance !== binding?.instance)
      return null;
    return receipt({ success: false, outcome: "interrupted", requestAttempted: null, httpStatus: null, windows: [], source: "worker_no_request" });
  }
  let grant: ClaudeDiagnosticGrant;
  const controller = new AbortController();
  const authorize = () => {
    controller.signal.throwIfAborted();
    dependencies.signal?.throwIfAborted();
    const currentAuthority = readDiagnosticAuthority(workspace, repository, binding, nonce);
    if (!authority || currentAuthority.digest !== authority.digest)
      throw new Error("authority_drift");
    const current = policy();
    if (!binding || binding.pid !== process.pid || binding.repository !== repository || !current.ownsWorker || current.state !== "inactive" || current.liveAdmissions !== 0 || current.revision !== grant.policyRevision || current.epoch !== grant.policyEpoch || (now().getTime() >= Date.parse(grant.expiresAt) || Date.parse(grant.expiresAt) - now().getTime() > 300000))
      throw new Error("authority_drift");
  };
  try {
    if (!authority || !binding)
      throw new Error("grant_refused");
    grant = authority.grant;
    authorize();
    approval = { decision: grant.decision, digest: authority.digest, policyRevision: grant.policyRevision, policyEpoch: grant.policyEpoch, provider: "claude", source: "auto", endpoint: CLAUDE_DIAGNOSTIC_ENDPOINT };
    // Exclusive durable consume, before even invoking the credential loader.
    let fd: number;
    try {
      fd = openSync(attempt, "wx", 0o600);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return null;
      throw error;
    }
    try {
      writeFileSync(fd, JSON.stringify({ nonce, pid: binding.pid, instance: binding.instance, startedAt, approval }));
      fsyncSync(fd);
    }
    finally {
      closeSync(fd);
    }
    const directory = openSync(path.dirname(attempt), "r");
    try {
      fsyncSync(directory);
    }
    finally {
      closeSync(directory);
    }
  }
  catch {
    return failed("refused");
  }
  let timer: NodeJS.Timeout | undefined;
  let attempted = false;
  const abort = () => controller.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  try {
    const usage = readProviderUsage({ refresh: true, claudeOnly: true, claudeSource: "auto", now: now(), signal: controller.signal, authorizeClaude: authorize }, {
      ...dependencies.usage,
      clock: dependencies.usage?.clock ?? now,
      requestClaude: async (token, signal) => {
        authorize();
        const { requestClaudeUsage } = await import("../codingAgents/availability.js");
        authorize();
        attempted = true;
        return (dependencies.usage?.requestClaude ?? requestClaudeUsage)(token, signal);
      }
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, grant.deadlineMs);
    });
    const result = await Promise.race([usage, timeout]);
    authorize();
    return receipt(safeReading(result.providers[0], now()));
  }
  catch {
    return failed(controller.signal.aborted ? "interrupted_or_timeout" : "authority_drift", attempted);
  }
  finally {
    clearTimeout(timer);
    dependencies.signal?.removeEventListener("abort", abort);
  }
}
