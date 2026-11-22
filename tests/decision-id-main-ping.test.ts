import { describe, expect, it } from "vitest";
import { duplicateDecisionIdPing, findDecisionIdClashes } from "../src/decisions/decisionIds.js";

describe("duplicate Decision id ping on main", () => {
  const clean = ["docs/decisions/0300-a.md", "docs/decisions/0301-b.md", "docs/decisions/0004-x.md", "docs/decisions/0004-y.md"];

  it("sends nothing for a clean main, grandfathered pairs aside", () => {
    expect(duplicateDecisionIdPing(findDecisionIdClashes(clean))).toBeNull();
  });

  it("names both files in one message whose episode key is stable across reruns", () => {
    const files = [...clean, "docs/decisions/0302-first.md", "docs/decisions/0302-second.md"];
    const ping = duplicateDecisionIdPing(findDecisionIdClashes(files));
    expect(ping?.message).toContain("docs/decisions/0302-first.md");
    expect(ping?.message).toContain("docs/decisions/0302-second.md");
    expect(ping?.message.startsWith(ping?.episodeKey ?? "?")).toBe(true);
    expect(duplicateDecisionIdPing(findDecisionIdClashes([...files, "docs/decisions/0303-c.md"]))?.episodeKey).toBe(ping?.episodeKey);
  });
});
