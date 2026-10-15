import { describe, expect, it } from "vitest";
import { parseWorkspaceScope, workspaceActionId, workspaceHref } from "./workspace-scope";

describe("workspace context addresses", () => {
  it("selects exactly one hierarchy and preserves identifiers in deep links", () => {
    const scope = { project: "garden & light", plan: "first-website", action: "review/phone" };
    const href = workspaceHref(scope);
    expect(href).toBe("/workspace/projects/garden%20%26%20light/plans/first-website/actions/review%2Fphone");
    expect(parseWorkspaceScope(href.slice("/workspace/".length).split("/").map(decodeURIComponent))).toEqual(scope);
    expect(parseWorkspaceScope()).toEqual({});
    expect(parseWorkspaceScope(["projects", "garden"])).toEqual({ project: "garden" });
    expect(parseWorkspaceScope(["projects", "garden", "plans", "first"])).toEqual({ project: "garden", plan: "first" });
  });
  it.each([
    ["projects"], ["projects", ""], ["plans", "first"],
    ["projects", "garden", "actions", "review"],
    ["projects", "garden", "plans", "first", "actions"],
    ["projects", "garden", "plans", "first", "actions", "review", "extra"]
  ])("rejects malformed hierarchy %j", (...parts) => expect(parseWorkspaceScope(parts)).toBeNull());
  it("retains a complete Action id after its CLI Project prefix", () => {
    expect(workspaceActionId("garden/review/phone")).toBe("review/phone");
    expect(workspaceActionId("review-phone")).toBe("review-phone");
  });
});
