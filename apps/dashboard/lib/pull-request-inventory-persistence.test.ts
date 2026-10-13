import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, appendFile, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInventoryPersistence, inventoryPersistenceScope } from "./pull-request-inventory-persistence";
import { createPullRequestInventoryCache, type PullRequestInventoryState } from "./pull-request-inventory-cache";

const roots: string[] = [];
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "pr-cache-"))); roots.push(root);
  const directory = path.join(root, "cache");
  const store = createInventoryPersistence({ directory, identity: "test" });
  const date = new Date(Date.now() - 1000).toISOString();
  const saved: PullRequestInventoryState = { checkedAt: date, stale: false, refreshing: false, refreshError: null, incomplete: false, retainedProjectIds: [], snapshot: {
    generatedAt: date, projectsScanned: 1, repositories: [{ projectId: "p", projectName: "P", repositoryPath: "/repo", repository: "owner/repo" }], errors: [],
    counts: { total: 1, ready: 0, mergeReady: 0, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, unknown: 1 },
    pullRequests: [{ projectId: "p", projectName: "P", repositoryPath: "/repo", repository: "owner/repo", number: 1, title: "PR", url: "https://github.com/owner/repo/pull/1", state: "OPEN", isDraft: false, createdAt: date, updatedAt: date, headBranch: "unknown", baseBranch: "main", author: null, reviewDecision: null, mergeStateStatus: null, checks: [], readiness: "unknown", readinessLabel: "Details not loaded", summary: "No checks", briefing: null, detailsLoaded: false }]
  } };
  return { root, directory, store, saved, file: path.join(directory, "test.json") };
}
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("durable lightweight display inventory", () => {
  it("survives cache recreation, immediately returns recently saved cards and coalesces a stalled refresh", async () => {
    const { store, saved, file } = await fixture();
    const first = createPullRequestInventoryCache({ load: async () => saved.snapshot, persistence: store });
    const written = await first.read();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).not.toContain('"body"');
    vi.useFakeTimers();
    const load = vi.fn(() => new Promise<never>(() => undefined));
    const restarted = createPullRequestInventoryCache({ load, persistence: store, refreshTimeoutMs: 100 });
    const [a, b] = await Promise.all([restarted.read(), restarted.read()]);
    expect(a).toMatchObject({ checkedAt: written.checkedAt, stale: true, refreshing: true, snapshot: { pullRequests: [{ number: 1 }] } });
    expect(b.checkedAt).toBe(written.checkedAt); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    expect(await restarted.read()).toMatchObject({ refreshing: false, stale: true, refreshError: expect.stringContaining("deadline"), snapshot: { counts: { total: 1 } } });
  });
  it("retains failed refresh cards and removes closed cards on successful recovery", async () => {
    const { store, saved } = await fixture(); await store.write(saved);
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...saved.snapshot, pullRequests: [], counts: { ...saved.snapshot.counts, total: 0, unknown: 0 } });
    const cache = createPullRequestInventoryCache({ load, persistence: store });
    await cache.read();
    await vi.waitFor(async () => expect(await cache.read()).toMatchObject({ refreshError: "offline", snapshot: { counts: { total: 1 } } }));
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect(await cache.read()).toMatchObject({ refreshing: false, snapshot: { pullRequests: [], counts: { total: 0 } } }));
  });
  it.each(["json", "future", "null-card", "rich", "wrong-scope", "oversize"])("ignores %s records", async kind => {
    const { store, saved, file, directory } = await fixture(); await store.write(saved);
    const envelope = JSON.parse(await readFile(file, "utf8"));
    if (kind === "future") envelope.inventory.checkedAt = "2099-01-01T00:00:00Z";
    if (kind === "null-card") envelope.inventory.snapshot.pullRequests = [null];
    if (kind === "rich") envelope.inventory.snapshot.pullRequests[0].detailsLoaded = true;
    if (kind === "wrong-scope") envelope.scope = "other";
    await writeFile(file, kind === "json" ? "{" : kind === "oversize" ? " ".repeat(2 * 1024 * 1024 + 1) : JSON.stringify(envelope));
    expect(await store.read()).toBeNull();
    expect(await createInventoryPersistence({ directory, identity: "other" }).read()).toBeNull();
  });
  it("does not block on a named pipe or require usable persistence for live inventory", async () => {
    const { store, saved, file, directory } = await fixture(); await mkdir(directory);
    execFileSync("mkfifo", [file]); expect(await store.read()).toBeNull();
    const cache = createPullRequestInventoryCache({ load: async () => saved.snapshot, persistence: { read: async () => { throw Error("IO"); }, write: async () => { throw Error("IO"); } } });
    expect((await cache.read()).snapshot.pullRequests).toHaveLength(1);
  });
  it("keeps scope stable across DB writes, but isolates workspaces and checkout configuration", async () => {
    const { root } = await fixture(); const workspace = path.join(root, "workspace");
    await mkdir(path.join(workspace, "config"), { recursive: true }); await mkdir(path.join(workspace, "database"));
    await writeFile(path.join(workspace, "config", "arcadia.json"), "{}");
    const db = path.join(workspace, "database", "arcadia.sqlite3"); await writeFile(db, "fixture");
    vi.stubEnv("ARCADIA_WORKSPACE", workspace);
    const first = await inventoryPersistenceScope(root); await appendFile(db, "ordinary write");
    expect((await inventoryPersistenceScope(root)).identity).toBe(first.identity);
    const checkout = path.join(root, "other-checkout"); await mkdir(checkout);
    expect((await inventoryPersistenceScope(checkout)).identity).not.toBe(first.identity);
    await writeFile(path.join(workspace, "config", "arcadia.json"), '{"changed":true}');
    expect((await inventoryPersistenceScope(root)).identity).not.toBe(first.identity);
  });
});
