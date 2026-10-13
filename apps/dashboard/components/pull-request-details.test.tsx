import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ initial: [] as unknown[], effects: [] as Array<() => unknown> }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(hooks.initial.length ? hooks.initial.shift() : initial), useEffect: (effect: () => unknown) => { hooks.effects.push(effect); } };
});
import { PullRequestDetailsPanel } from "./pull-request-details";
afterEach(() => { hooks.initial.length = 0; hooks.effects.length = 0; vi.restoreAllMocks(); });

describe("explicit PR details", () => {
  it("offers details without reading any source on card mount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const html = renderToStaticMarkup(<PullRequestDetailsPanel repository="owner/repo" number={1} />);
    hooks.effects.forEach(effect => effect());
    expect(html).toContain("Load PR details");
    expect(html).not.toContain("PR details</section>");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("shows current description, paths, checked time and GitHub QA evidence when opened", () => {
    hooks.initial.push({ body: "A requested description", files: ["src/fix.ts"], url: "https://github.com/owner/repo/pull/1", headBranch: "fix", baseBranch: "main", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN" }, false, null, true, new Date("2026-10-13T12:00:00Z"));
    const html = renderToStaticMarkup(<PullRequestDetailsPanel repository="owner/repo" number={1} />);
    expect(html).toContain("A requested description");
    expect(html).toContain("src/fix.ts");
    expect(html).toContain("Details checked");
    expect(html).toContain('href="https://github.com/owner/repo/pull/1/checks"');
  });
});
