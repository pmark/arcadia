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
  it("reads merged PRs from configured repositories with zero open PRs", async () => {
    const { loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { pullRequests: [], repositories: [{ repository: "owner/repo", repositoryPath: "/configured/repo" }] } } }), ""));
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ title: "Closed PR", body: "Original body", url: "https://github.com/owner/repo/pull/2", state: "MERGED" }), ""));
    expect(await loadPullRequestDescription("OWNER/REPO", 2)).toMatchObject({ body: "Original body", repository: "owner/repo", state: "MERGED" });
    expect(exec.mock.calls[1].slice(0, 3)).toMatchObject(["gh", ["pr", "view", "2", "--repo", "owner/repo", "--json", "title,body,url,state"], { cwd: "/configured/repo" }]);
  });
  it("refuses unconfigured repositories without making a GitHub read", async () => {
    const { loadPullRequestDescription } = await import("./arcadia-cli");
    exec.mockImplementationOnce((_command, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, data: { snapshot: { pullRequests: [], repositories: [] } } }), ""));
    await expect(loadPullRequestDescription("outside/repo", 2)).rejects.toMatchObject({ statusCode: 404 });
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
