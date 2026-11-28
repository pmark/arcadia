import { describe, expect, it } from "vitest";
import { toWorkspaceRelativePath } from "../src/workspace/paths.js";

describe("toWorkspaceRelativePath", () => {
  it("returns a forward-slash path under the workspace root", () => {
    expect(toWorkspaceRelativePath("/ws/root", "/ws/root/mission_logs/a.md")).toBe("mission_logs/a.md");
  });

  it("ignores a trailing slash on the workspace root", () => {
    expect(toWorkspaceRelativePath("/ws/root/", "/ws/root/projects/x/y.md")).toBe("projects/x/y.md");
  });

  it("climbs out with .. for a path outside the workspace root", () => {
    expect(toWorkspaceRelativePath("/ws/root", "/ws/other/z.md")).toBe("../other/z.md");
  });

  it("returns an empty string for the workspace root itself", () => {
    expect(toWorkspaceRelativePath("/ws/root", "/ws/root")).toBe("");
  });
});
