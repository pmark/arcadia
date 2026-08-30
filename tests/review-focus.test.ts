import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReviewFocus, saveReviewFocus } from "../src/dashboard/reviewFocus.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("Review focus", () => {
  it("persists priority order and parked Projects in workspace configuration", () => {
    const workspace = initializedWorkspace();
    const focus = saveReviewFocus(workspace, {
      projectOrder: ["Private Practice Now", "Arcadia"],
      excludedProjects: ["Rebuster"],
      maxItems: 5
    }, ["Private Practice Now", "Arcadia", "Rebuster"]);

    expect(readReviewFocus(workspace)).toEqual(focus);
  });

  it("refuses unknown or simultaneously prioritized and parked Projects", () => {
    const workspace = initializedWorkspace();
    expect(() => saveReviewFocus(workspace, {
      projectOrder: ["Unknown"],
      excludedProjects: [],
      maxItems: 5
    }, ["Arcadia"])).toThrow(/unknown project/i);
    expect(() => saveReviewFocus(workspace, {
      projectOrder: ["Arcadia"],
      excludedProjects: ["Arcadia"],
      maxItems: 5
    }, ["Arcadia"])).toThrow(/cannot also be parked/i);
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-review-focus-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
