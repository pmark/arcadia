import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTick, pollWorkerClaudeUsageDiagnostics } from "../src/commands/worker.js";
import { readProviderUsage, type ProviderUsageDependencies } from "../src/codingAgents/providerUsage.js";
import { captureDiagnosticWorkerBinding, CLAUDE_DIAGNOSTIC_ENDPOINT, CLAUDE_DIAGNOSTIC_REQUEST, diagnosticGrantAnswer, diagnosticGrantPath, diagnosticResponsePath, processWorkerClaudeUsageRequest, type ClaudeDiagnosticGrant, type DiagnosticPolicy } from "../src/production/workerClaudeUsageDiagnostic.js";
const roots: string[] = [];
const now = new Date("2026-10-24T21:00:00Z");
const secret = "diagnostic-secret-sentinel";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-worker-diag-")));
  roots.push(root);
  const repository = path.join(root, "repo"), workspace = path.join(root, "workspace");
  mkdirSync(path.join(repository, ".arcadia"), { recursive: true });
  mkdirSync(path.join(repository, "docs/decisions"), { recursive: true });
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  const nonce = "11111111-1111-1111-1111-111111111111";
  const binding = { pid: process.pid, instance: "fixed-test-boot", repository, release: "a".repeat(40), handlerHash: "b".repeat(64) };
  const policy: DiagnosticPolicy = { state: "inactive", revision: 79, epoch: 44, liveAdmissions: 0, ownsWorker: true };
  const grant: ClaudeDiagnosticGrant = { schema: "arcadia-worker-claude-usage-grant-v1", nonce, repository, workspace, release: binding.release, handlerHash: binding.handlerHash, decision: "diagnostic-approval", provider: "claude", source: "auto", endpoint: CLAUDE_DIAGNOSTIC_ENDPOINT, policyRevision: 79, policyEpoch: 44, expiresAt: "2026-10-24T21:01:00Z", deadlineMs: 1000 };
  const deps: ProviderUsageDependencies = {
    loadClaude: vi.fn(async () => ({ accessToken: secret, source: "keychain" as const, expiresAt: "2026-10-25T00:00:00Z" })),
    requestClaude: vi.fn(async () => ({ status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-10-24T23:00:00Z" }, seven_day: { utilization: 2, resets_at: "2026-10-30T23:00:00Z" } } })),
    readCodex: vi.fn(() => {
      throw new Error("Codex must not run");
    }),
    readClaudeCache: vi.fn(() => {
      throw new Error("cache must not run");
    })
  };
  const saveGrant = () => {
    writeFileSync(diagnosticGrantPath(workspace), JSON.stringify(grant), { mode: 0o600 });
    writeFileSync(path.join(repository, "docs/decisions/diagnostic-approval.md"), `---\narcadia: v1\ntype: decision\nid: "0001"\nslug: diagnostic-approval\nproject: fixture\nstatus: approved\nquestion: Synthetic fixture only\ngap_type: missing-decision\nupdated: 2026-10-24\nanswer: ${JSON.stringify(diagnosticGrantAnswer(grant))}\n---\n# Fixture\n`);
  };
  const request = (value: unknown = { nonce }) => writeFileSync(path.join(repository, CLAUDE_DIAGNOSTIC_REQUEST), JSON.stringify(value));
  saveGrant();
  request();
  const run = (signal?: AbortSignal) => processWorkerClaudeUsageRequest(workspace, repository, binding, () => policy, { now: () => now, usage: deps, signal });
  return { root, repository, workspace, nonce, binding, policy, grant, deps, saveGrant, request, run };
}
describe("fixed actual-worker Claude diagnostic (fakes only)", () => {
  it("runs once in-process, replays concurrently and sequentially, and sanitizes the terminal receipt", async () => {
    const f = fixture();
    const before = readFileSync(diagnosticGrantPath(f.workspace), "utf8");
    const [a, b] = await Promise.all([f.run(), f.run()]);
    expect(a).toEqual(b);
    expect(await f.run()).toEqual(a);
    expect(a).toMatchObject({ pid: process.pid, release: f.binding.release, handlerHash: f.binding.handlerHash, source: "worker_live_request", requestAttempted: true, httpStatus: 200, success: true, credentialSource: "keychain", startedAt: now.toISOString(), finishedAt: now.toISOString() });
    expect((a as {
      windows: unknown[];
    }).windows).toHaveLength(2);
    expect(f.deps.loadClaude).toHaveBeenCalledExactlyOnceWith("auto");
    expect(f.deps.requestClaude).toHaveBeenCalledTimes(1);
    expect(f.deps.readCodex).not.toHaveBeenCalled();
    expect(f.deps.readClaudeCache).not.toHaveBeenCalled();
    const bytes = readFileSync(diagnosticResponsePath(f.workspace, f.nonce), "utf8");
    expect(bytes).not.toContain(secret);
    expect(bytes).not.toContain(createHash("sha256").update(secret).digest("hex"));
    expect(readFileSync(diagnosticGrantPath(f.workspace), "utf8")).toBe(before);
    expect(existsSync(diagnosticResponsePath(f.workspace, f.nonce) + ".attempt")).toBe(true);
    expect(existsSync(path.join(f.workspace, "telemetry"))).toBe(false);
  });
  it.each(["missing", "wrong-answer", "expired", "repository", "workspace", "release", "handlerHash", "policyRevision", "policyEpoch", "source", "endpoint", "provider", "extra", "active", "unknown", "admissions"])("refuses %s before credentials", async (kind) => {
    const f = fixture();
    if (kind === "missing")
      rmSync(diagnosticGrantPath(f.workspace));
    else if (kind === "wrong-answer")
      writeFileSync(path.join(f.repository, "docs/decisions/diagnostic-approval.md"), "wrong");
    else if (kind === "active" || kind === "unknown")
      f.policy.state = kind;
    else if (kind === "admissions")
      f.policy.liveAdmissions = 1;
    else {
      const g = f.grant as unknown as Record<string, unknown>;
      if (kind === "expired")
        g.expiresAt = "2026-10-23T00:00:00Z";
      else if (kind === "extra")
        g.command = "arbitrary";
      else if (kind === "policyRevision" || kind === "policyEpoch")
        g[kind] = 0;
      else
        g[kind] = "wrong";
      f.saveGrant();
    }
    expect(await f.run()).toMatchObject({ success: false, outcome: "refused", requestAttempted: false });
    expect(f.deps.loadClaude).not.toHaveBeenCalled();
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it.each(["source", "command", "environment", "path", "endpoint"])("refuses extra request %s", async (key) => {
    const f = fixture();
    f.request({ nonce: f.nonce, [key]: "forbidden" });
    expect(await f.run()).toBeNull();
    expect(f.deps.loadClaude).not.toHaveBeenCalled();
  });
  it.each(["missing", "expired"])("returns no request for %s credentials", async (kind) => {
    const f = fixture();
    f.deps.loadClaude = vi.fn(async () => kind === "missing" ? null : { accessToken: secret, expiresAt: "2026-10-20T00:00:00Z" });
    expect(await f.run()).toMatchObject({ requestAttempted: false, success: false, outcome: kind === "missing" ? "no_credentials" : "credential_expired", windows: [] });
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it.each([401, 403, "transport", "parse"])("keeps %s distinct and discards windows", async (outcome) => {
    const f = fixture();
    f.deps.requestClaude = vi.fn(async () => typeof outcome === "number" ? { status: outcome, body: null } : { status: outcome === "parse" ? 200 : 0, body: null, failure: outcome as "parse" | "transport" });
    expect(await f.run()).toMatchObject({ success: false, requestAttempted: true, httpStatus: typeof outcome === "number" ? outcome : outcome === "parse" ? 200 : null, outcome: typeof outcome === "number" ? "http_error" : outcome, windows: [] });
    expect(f.deps.loadClaude).toHaveBeenCalledTimes(1);
    expect(f.deps.requestClaude).toHaveBeenCalledTimes(1);
  });
  it("requires both valid future reset windows", async () => {
    const f = fixture();
    f.deps.requestClaude = vi.fn(async () => ({ status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-10-23T00:00:00Z" }, seven_day: { utilization: 2, resets_at: "invalid" } } }));
    expect(await f.run()).toMatchObject({ success: false, windows: [] });
  });
  it("fences late credentials after timeout and retains consumed evidence", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (v: {
      accessToken: string;
    }) => void;
    f.deps.loadClaude = vi.fn(() => new Promise(r => {
      resolve = r;
    }));
    const pending = f.run();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ outcome: "interrupted_or_timeout", requestAttempted: false });
    resolve({ accessToken: secret });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
    expect(await f.run()).toMatchObject({ outcome: "interrupted_or_timeout" });
    expect(f.deps.loadClaude).toHaveBeenCalledTimes(1);
  });
  it("normalizes parseable metadata timestamps before publishing", async () => {
    const f = fixture();
    f.deps.loadClaude = vi.fn(async () => ({ accessToken: secret, source: "keychain", expiresAt: "Sun, 25 Oct 2026 00:00:00 GMT (diagnostic-secret-sentinel)" }));
    f.deps.requestClaude = vi.fn(async () => ({ status: 200, body: { five_hour: { utilization: 1, resets_at: "Sun, 25 Oct 2026 00:00:00 GMT (diagnostic-secret-sentinel)" }, seven_day: { utilization: 2, resets_at: "Fri, 30 Oct 2026 00:00:00 GMT (diagnostic-secret-sentinel)" } } }));
    const result = await f.run();
    expect(result).toMatchObject({ success: true, credentialExpiresAt: "2026-10-25T00:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("fences replaced worker ownership before HTTP", async () => {
    const f = fixture();
    f.deps.loadClaude = vi.fn(async () => {
      f.policy.ownsWorker = false;
      return { accessToken: secret };
    });
    expect(await f.run()).toMatchObject({ outcome: "authority_drift", requestAttempted: false });
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it("fences policy drift after asynchronous credential load", async () => {
    const f = fixture();
    f.deps.loadClaude = vi.fn(async () => {
      f.policy.state = "active";
      return { accessToken: secret };
    });
    expect(await f.run()).toMatchObject({ outcome: "authority_drift", requestAttempted: false });
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it("interrupts once with no automatic retry or late overwrite", async () => {
    const f = fixture();
    const c = new AbortController();
    f.deps.loadClaude = vi.fn(async () => {
      c.abort();
      return { accessToken: secret };
    });
    expect(await f.run(c.signal)).toMatchObject({ requestAttempted: false });
    expect(await f.run()).toMatchObject({ success: false });
    expect(f.deps.loadClaude).toHaveBeenCalledTimes(1);
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it("runs the diagnostic inside the serial worker envelope and rechecks ownership after await", async () => {
    const f = fixture();
    vi.stubEnv("CODEX_SANDBOX", "");
    let owns = true;
    let finish!: () => void;
    const diagnostic = vi.fn(async () => {
      await pollWorkerClaudeUsageDiagnostics(f.workspace, () => owns, {binding: f.binding, repositories: [f.repository], policy: () => f.policy, dependencies: {now: () => now, usage: f.deps}});
      await new Promise<void>(resolve => {
        finish = resolve;
      });
    });
    const preAdmission = vi.fn(async () => {
    });
    const openDb = vi.fn(() => {
      throw new Error("must not open after ownership lost");
    });
    const lost = vi.fn();
    const tick = createWorkerTick({ workspacePath: f.workspace, pid: process.pid, logfile: path.join(f.root, "worker.log"), diagnostic, preAdmission, openDb, ownsWorker: () => owns, onOwnershipLost: lost });
    tick();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    owns = false;
    finish();
    await vi.waitFor(() => expect(lost).toHaveBeenCalled());
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(preAdmission).not.toHaveBeenCalled();
    expect(openDb).not.toHaveBeenCalled();
    expect(f.deps.requestClaude).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
  it("retains interrupted consume after caller restart without a new helper call", async () => {
    const f = fixture();
    const result = diagnosticResponsePath(f.workspace, f.nonce);
    mkdirSync(path.dirname(result), { recursive: true });
    writeFileSync(result + ".attempt", JSON.stringify({ pid: process.pid, instance: f.binding.instance, startedAt: now.toISOString() }), { mode: 0o600 });
    expect(await f.run()).toMatchObject({ outcome: "interrupted", requestAttempted: null, windows: [] });
    expect(f.deps.loadClaude).not.toHaveBeenCalled();
    expect(await f.run()).toMatchObject({ outcome: "interrupted" });
  });
  it("cannot reuse one grant through a different concurrent nonce", async () => {
    const f = fixture();
    let resolve!: (v: {
      accessToken: string;
    }) => void;
    f.deps.loadClaude = vi.fn(() => new Promise(r => {
      resolve = r;
    }));
    const first = f.run();
    f.request({ nonce: "22222222-2222-2222-2222-222222222222" });
    expect(await f.run()).toMatchObject({ outcome: "refused" });
    resolve({ accessToken: secret });
    await first;
    expect(f.deps.loadClaude).toHaveBeenCalledTimes(1);
    expect(f.deps.requestClaude).toHaveBeenCalledTimes(1);
  });
  it("refuses replay from another registered repository", async () => {
    const f = fixture();
    await f.run();
    const binding = { ...f.binding, release: "c".repeat(40) };
    expect(await processWorkerClaudeUsageRequest(f.workspace, f.repository, binding, () => f.policy, { now: () => now, usage: f.deps })).toBeNull();
    expect(f.deps.loadClaude).toHaveBeenCalledTimes(1);
  });
  it("captures the fixed registered release at boot and rejects registration drift using fixtures", () => {
    const f = fixture();
    const home = path.join(f.root, "home");
    const revision = "d".repeat(40);
    const root = path.join(home, ".local/share/arcadia/go-broker/releases", revision);
    const module = path.join(root, "dist/src/production/workerClaudeUsageDiagnostic.js");
    const worker = path.join(root, "dist/src/commands/worker.js");
    const registry = path.join(root, "dist/config/defaults/agent-roles.json");
    for (const file of [module, worker, registry, path.join(root, "dist/src/codingAgents/providerUsage.js"), path.join(root, "dist/src/codingAgents/availability.js")]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "fixed fixture bytes");
    }
    const manifest = { schema: "arcadia-go-broker-install-v1", revision, sourceRepository: f.repository, runtimeExecutable: process.execPath, roleRegistrySha256: createHash("sha256").update(readFileSync(registry)).digest("hex"), brokerEntrypoint: path.join(root, "dist/scripts/arcadia-go-broker.js") };
    const file = path.join(root, "broker-manifest.json");
    const save = () => {
      if (existsSync(file))
        chmodSync(file, 0o600);
      writeFileSync(file, JSON.stringify(manifest));
      chmodSync(file, 0o444);
    };
    save();
    const context = { home, moduleUrl: pathToFileURL(module).href };
    const before = captureDiagnosticWorkerBinding(pathToFileURL(worker).href, context);
    expect(before).toMatchObject({ pid: process.pid, release: revision, repository: f.repository });
    expect(before?.handlerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(captureDiagnosticWorkerBinding(pathToFileURL(worker).href, { ...context, home: f.root })).toBeNull();
    chmodSync(file, 0o600);
    expect(captureDiagnosticWorkerBinding(pathToFileURL(worker).href, context)).toBeNull();
    manifest.runtimeExecutable = "wrong";
    save();
    expect(captureDiagnosticWorkerBinding(pathToFileURL(worker).href, context)).toBeNull();
    manifest.runtimeExecutable = process.execPath;
    manifest.roleRegistrySha256 = "wrong";
    save();
    expect(captureDiagnosticWorkerBinding(pathToFileURL(worker).href, context)).toBeNull();
    manifest.roleRegistrySha256 = createHash("sha256").update(readFileSync(registry)).digest("hex");
    save();
    writeFileSync(module, "changed handler fixture");
    const after = captureDiagnosticWorkerBinding(pathToFileURL(worker).href, context);
    expect(after?.handlerHash).not.toBe(before?.handlerHash);
    expect(before?.handlerHash).not.toBe(after?.handlerHash);
  });
  it("refuses source checkout as loaded release attestation", () => {
    expect(captureDiagnosticWorkerBinding(import.meta.url)).toBeNull();
  });
  it("checks credential expiry against the clock after asynchronous loading", async () => {
    const f = fixture(); let clock = now;
    f.deps.clock = () => clock;
    f.deps.loadClaude = vi.fn(async () => { clock = new Date(now.getTime() + 2000); return {accessToken: secret, expiresAt: new Date(now.getTime() + 1000).toISOString()}; });
    expect((await readProviderUsage({refresh:true,claudeOnly:true}, f.deps)).providers[0]).toMatchObject({outcome:"credential_expired",requestAttempted:false});
    expect(f.deps.requestClaude).not.toHaveBeenCalled();
  });
  it("shared Claude-only helper invokes no Codex, cache or inference", async () => {
    const f = fixture();
    const r = await readProviderUsage({ refresh: true, claudeOnly: true, now }, f.deps);
    expect(r.providers.map(p => p.provider)).toEqual(["claude"]);
    expect(f.deps.readCodex).not.toHaveBeenCalled();
    expect(f.deps.readClaudeCache).not.toHaveBeenCalled();
    expect(f.deps.requestClaude).toHaveBeenCalledTimes(1);
  });
});
