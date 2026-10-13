import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardOutstandingPullRequests } from "../../../lib/types";
const pageMocks = vi.hoisted(() => ({ inventory: null as DashboardOutstandingPullRequests | null, controls: [] as Array<{ kind: string; key: string | undefined }> }));
vi.mock("../../../hooks/use-pull-request-inventory", () => ({ usePullRequestInventory: () => ({ data: pageMocks.inventory, checkedAt: null, error: null, loading: false, refreshing: false, stale: false, incomplete: false, retainedProjectIds: [], refresh: vi.fn() }) }));
vi.mock("../../../components/chrome", () => ({ DashboardChrome: ({ children }: { children: import("react").ReactNode }) => children }));
vi.mock("../../../components/pull-request-link-audio", () => ({ PullRequestLinkAudio: () => null }));
vi.mock("../../../components/pull-request-details", () => ({ PullRequestDetailsPanel: function MockDetails() { return "PR details control"; } }));
vi.mock("../../../components/pull-request-audio", () => ({ PullRequestAudio: function MockAudio() { return "PR audio control"; } }));
vi.mock("react/jsx-runtime", async importOriginal => {
  const runtime = await importOriginal<typeof import("react/jsx-runtime")>();
  const record: typeof runtime.jsx = (type, props, key) => {
    if (typeof type === "function" && (type.name === "MockDetails" || type.name === "MockAudio")) pageMocks.controls.push({ kind: type.name, key: key == null ? undefined : String(key) });
    return runtime.jsx(type, props, key);
  };
  return { ...runtime, jsx: record, jsxs: record };
});
vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const runtime = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const record: typeof runtime.jsxDEV = (...args) => {
    const [type, , key] = args;
    if (typeof type === "function" && (type.name === "MockDetails" || type.name === "MockAudio")) pageMocks.controls.push({ kind: type.name, key: key == null ? undefined : String(key) });
    return runtime.jsxDEV(...args);
  };
  return { ...runtime, jsxDEV: record };
});
import AdminPullRequestsPage from "./page";
import { PullRequestInventorySkeleton } from "../../../components/pull-request-inventory-skeleton";
afterEach(() => { pageMocks.inventory = null; pageMocks.controls.length = 0; vi.restoreAllMocks(); });

describe("pull-request inventory rendering", () => {
  it("announces a stable card-shaped cold-load skeleton", () => {
    const html = renderToStaticMarkup(<PullRequestInventorySkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading pull-request inventory"');
    expect(html).toContain("Scanning configured repositories for pull requests");
    expect(html.match(/min-h-48 animate-pulse/g)).toHaveLength(3);
  });

  it("renders distinct details and audio identities, preserves them on unchanged data, and resets both on a PR update", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const updatedAt = "2026-10-13T12:00:00Z";
    pageMocks.inventory = {
      generatedAt: updatedAt, projectsScanned: 1, errors: [],
      counts: { total: 1, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 0, mergeReady: 0, unknown: 1 },
      pullRequests: [{ projectId: "project", projectName: "Project", repositoryPath: "/repo", repository: "owner/repo", number: 1, title: "PR", url: "https://github.com/owner/repo/pull/1", state: "OPEN", isDraft: false, headBranch: "fix", baseBranch: "main", author: null, mergeStateStatus: null, reviewDecision: null, createdAt: null, updatedAt, checks: [], readiness: "unknown", readinessLabel: "CI ONLY", summary: "CI only", briefing: null }]
    };
    const renderControls = () => {
      pageMocks.controls.length = 0;
      const html = renderToStaticMarkup(<AdminPullRequestsPage />);
      expect(html).toContain("PR details control"); expect(html).toContain("PR audio control");
      expect(pageMocks.controls).toHaveLength(2);
      const keys = pageMocks.controls.map(control => control.key);
      expect(keys.every(key => typeof key === "string" && key.length > 0)).toBe(true);
      expect(new Set(keys).size).toBe(2);
      return [...pageMocks.controls];
    };
    const initial = renderControls();
    expect(renderControls()).toEqual(initial);
    pageMocks.inventory.pullRequests[0].updatedAt = "2026-10-13T12:01:00Z";
    const changed = renderControls();
    for (let index = 0; index < 2; index++) {
      expect(changed[index].kind).toBe(initial[index].kind);
      expect(changed[index].key).not.toBe(initial[index].key);
    }
    expect(consoleError.mock.calls.some(call => /same key|unique.*key/i.test(call.map(String).join(" ")))).toBe(false);
  });
});
