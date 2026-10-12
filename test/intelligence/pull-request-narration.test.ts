import { describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawnSync: vi.fn() }));
import { spawnSync } from "node:child_process";
import { fetchPullRequestBody } from "../../src/commands/narrate.js";
describe("PR narration source", () => {
  it("fetches only the body and removes Markdown while retaining body words", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({ body: "# Change\nRead **this** [description](https://example.com).", comments: [{ body: "NEVER READ" }] }), stderr: "" } as never);
    expect(fetchPullRequestBody("https://github.com/owner/repo/pull/12")).toBe("Change\nRead this description.");
    expect(spawnSync).toHaveBeenCalledWith("gh", ["pr", "view", "12", "--repo", "owner/repo", "--json", "body"], expect.objectContaining({ timeout: 30_000 }));
  });
  it("rejects an empty body and propagates GitHub failure", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '{"body":null}', stderr: "" } as never);
    expect(() => fetchPullRequestBody("12", "owner/repo")).toThrow("no body");
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: "", stderr: "unavailable" } as never);
    expect(() => fetchPullRequestBody("12", "owner/repo")).toThrow("unavailable");
  });
});
