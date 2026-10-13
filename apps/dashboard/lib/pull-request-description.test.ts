import { beforeEach, describe, expect, it, vi } from "vitest";
const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => {
  Object.defineProperty(exec, Symbol.for("nodejs.util.promisify.custom"), { value: (...args: unknown[]) => new Promise((resolve, reject) => {
    exec(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
  return { execFile: exec };
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});
describe("configured PR description access", () => {
  it("keeps scoped inventory coalesced and separate from source authorization", async () => {
    const { loadOutstandingPullRequests, loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { pullRequests: [], repositories: [{ repository: "outside/repo", repositoryPath: "/outside" }] } } }), ""));
    await Promise.all([loadOutstandingPullRequests({ workspace: "/other-workspace" }), loadOutstandingPullRequests({ workspace: "/other-workspace" })]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toContain("--lightweight");
    expect(exec.mock.calls[0][1]).toContain("/other-workspace");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { repositories: [] } } }), ""));
    await expect(loadPullRequestDescription("outside/repo", 2)).rejects.toMatchObject({ statusCode: 404 });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][1]).toContain("--repositories-only");
  });
  it("separates pending inventory scans across full identities within the same workspace", async () => {
    const { loadOutstandingPullRequests } = await import("./arcadia-cli");
    const callbacks: ((error: null, stdout: string, stderr: string) => void)[] = [];
    exec.mockImplementation((_command, _args, _options, callback) => callbacks.push(callback));
    const old = loadOutstandingPullRequests({ workspace: "/workspace", scopeIdentity: "config-db-A" });
    const current = loadOutstandingPullRequests({ workspace: "/workspace", scopeIdentity: "config-db-B" });
    const repeated = loadOutstandingPullRequests({ workspace: "/workspace", scopeIdentity: "config-db-B" });
    expect(exec).toHaveBeenCalledTimes(2);
    const oldSnapshot = { pullRequests: [{ repository: "old/repo", number: 1 }], repositories: [] };
    const newSnapshot = { pullRequests: [{ repository: "new/repo", number: 2 }], repositories: [] };
    callbacks[0](null, JSON.stringify({ ok: true, data: { snapshot: oldSnapshot } }), "");
    callbacks[1](null, JSON.stringify({ ok: true, data: { snapshot: newSnapshot } }), "");
    expect((await old).data.snapshot).toEqual(oldSnapshot);
    expect((await current).data.snapshot).toEqual(newSnapshot);
    expect((await repeated).data.snapshot).toEqual(newSnapshot);
  });
  it("reads merged PRs from configured repositories with zero open PRs", async () => {
    const { loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { pullRequests: [], repositories: [{ repository: "owner/repo", repositoryPath: "/configured/repo" }] } } }), ""));
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ title: "Closed PR", body: "Original body", url: "https://github.com/owner/repo/pull/2", state: "MERGED" }), ""));
    expect(await loadPullRequestDescription("OWNER/REPO", 2)).toMatchObject({ body: "Original body", repository: "owner/repo", state: "MERGED" });
    expect(exec.mock.calls[0][1]).toContain("--repositories-only");
    expect(exec.mock.calls[0][1]).not.toContain("--lightweight");
    expect(exec.mock.calls[1].slice(0, 3)).toMatchObject(["gh", ["pr", "view", "2", "--repo", "owner/repo", "--json", "title,body,url,state"], { cwd: "/configured/repo" }]);
  });
  it("refuses unconfigured repositories without making a GitHub read", async () => {
    const { loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { pullRequests: [], repositories: [] } } }), ""));
    await expect(loadPullRequestDescription("outside/repo", 2)).rejects.toMatchObject({ statusCode: 404 });
    expect(exec).toHaveBeenCalledTimes(1);
  });
  it("coalesces cold repository resolution and refreshes an expired map without a PR inventory scan", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementation((command, args, _options, callback) => {
      callback(null, JSON.stringify(command === "gh" ? { title: "PR", body: "Body", state: "OPEN" }
        : { ok: true, data: { snapshot: { repositories: [{ repository: "owner/repo", repositoryPath: "/configured/repo" }] } } }), "");
    });
    await Promise.all([loadPullRequestDescription("owner/repo", 2), loadPullRequestDescription("owner/repo", 3)]);
    expect(exec.mock.calls.filter(call => call[0] !== "gh")).toHaveLength(1);
    clock.mockReturnValue(301001);
    await loadPullRequestDescription("owner/repo", 2);
    const local = exec.mock.calls.filter(call => call[0] !== "gh");
    expect(local).toHaveLength(2);
    expect(local.every(call => call[1].includes("--repositories-only"))).toBe(true);
    expect(exec.mock.calls.filter(call => call[0] === "gh").every(call => call[1][0] === "pr" && call[1][1] === "view")).toBe(true);
    clock.mockRestore();
  });

  it("reads requested detail files once without requesting other PR bodies", async () => {
    const { loadPullRequestDetails } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { repositories: [{ repository: "owner/repo", repositoryPath: "/configured/repo" }] } } }), ""));
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ body: "PR description", files: [{ path: "src/fix.ts" }], url: "https://github.com/owner/repo/pull/2" }), ""));
    expect(await loadPullRequestDetails("owner/repo", 2)).toMatchObject({ body: "PR description", files: ["src/fix.ts"] });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][1]).toEqual(["pr", "view", "2", "--repo", "owner/repo", "--json", "body,files,url,headRefName,baseRefName,reviewDecision,mergeStateStatus"]);
  });

});
