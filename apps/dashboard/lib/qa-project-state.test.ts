import { describe, expect, it } from "vitest";
import { describeAge, refsAreStale, stripState } from "./qa-project-state";
import type { ProjectVerdict, QaProjectRow, RestartVerdict } from "./types";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

function row(overrides: Partial<QaProjectRow> = {}): QaProjectRow {
  return {
    project: "arcadia",
    freshness: "up to date with main",
    baseBranch: "main",
    branch: "main",
    onBaseBranch: true,
    head: "abc1234",
    behind: 0,
    ahead: 0,
    dirty: false,
    fetchedAt: minutesAgo(0),
    error: null,
    controllable: true,
    verdict: null,
    services: "all running",
    ...overrides
  };
}

function verdict(kind: RestartVerdict, headline = "Restart needed."): ProjectVerdict {
  return {
    project: "arcadia",
    range: "HEAD..origin/main",
    verdict: kind,
    headline,
    reasons: [],
    migrationsChanged: false,
    apps: [],
    changedPaths: ["a.ts"],
    truncated: false,
    error: null
  };
}

describe("stripState — blocked checkouts", () => {
  it("refuses a pull when HEAD is on another branch, and names it", () => {
    const state = stripState(row({ branch: "codex/fix-ports", onBaseBranch: false }), "idle", NOW);
    expect(state.blocked).toBe(true);
    expect(state.action).toBe("none");
    expect(state.detail).toContain("codex/fix-ports");
  });

  it("never offers to switch branches", () => {
    const state = stripState(row({ branch: "feature/x", onBaseBranch: false }), "idle", NOW);
    expect(state.detail).toMatch(/will not switch branches/i);
  });

  it("still offers a fetch while blocked, because fetch touches no working tree", () => {
    for (const overrides of [
      { branch: "feature/x", onBaseBranch: false },
      { branch: "HEAD" },
      { dirty: true },
      { ahead: 2 }
    ]) {
      expect(stripState(row(overrides), "idle", NOW).offerFetch).toBe(true);
    }
  });

  it("refuses a dirty tree", () => {
    expect(stripState(row({ dirty: true }), "idle", NOW).detail).toMatch(/uncommitted/i);
  });

  it("refuses when the checkout is ahead of origin", () => {
    expect(stripState(row({ ahead: 3 }), "idle", NOW).detail).toMatch(/3 local commits/i);
  });

  it("offers nothing at all, not even fetch, when the repository is unreadable", () => {
    const state = stripState(row({ error: "Not a git checkout", head: null }), "idle", NOW);
    expect(state.blocked).toBe(true);
    expect(state.offerFetch).toBe(false);
  });

  it("checks branch trouble before dirtiness, since it is the more basic problem", () => {
    const state = stripState(row({ branch: "feature/x", onBaseBranch: false, dirty: true }), "idle", NOW);
    expect(state.detail).toContain("feature/x");
  });
});

describe("stripState — the post-merge sequence", () => {
  it("offers a check when refs are stale", () => {
    const state = stripState(row({ fetchedAt: minutesAgo(180) }), "idle", NOW);
    expect(state.action).toBe("fetch");
    expect(state.label).toBe("Check for updates");
  });

  it("offers the pull, with the count, once commits are waiting", () => {
    const state = stripState(row({ behind: 3, verdict: verdict("hmr", "HMR should cover this.") }), "idle", NOW);
    expect(state.action).toBe("pull");
    expect(state.label).toBe("Pull 3 commits");
  });

  it("singularises one commit", () => {
    expect(stripState(row({ behind: 1 }), "idle", NOW).label).toBe("Pull 1 commit");
  });

  it("previews the verdict before the pull is tapped", () => {
    const state = stripState(row({ behind: 2, verdict: verdict("install-and-restart", "Install first.") }), "idle", NOW);
    expect(state.detail).toBe("Install first.");
  });

  it("asks for a restart after a pull that needs one", () => {
    const state = stripState(row({ verdict: verdict("restart") }), "pulled", NOW);
    expect(state.action).toBe("restart");
    expect(state.label).toBe("Restart services");
  });

  it("treats an unknown verdict as restart-worthy", () => {
    expect(stripState(row({ verdict: verdict("unknown") }), "pulled", NOW).action).toBe("restart");
  });

  it("goes straight to testing when HMR covers the pull", () => {
    const state = stripState(row({ verdict: verdict("hmr", "HMR should cover this.") }), "pulled", NOW);
    expect(state.action).toBe("none");
    expect(state.label).toBe("Ready to test");
  });

  it("keeps 'restart anyway' reachable when HMR is assumed to have covered it", () => {
    expect(stripState(row({ verdict: verdict("hmr") }), "pulled", NOW).offerRestartAnyway).toBe(true);
  });

  it("never offers a restart for a project with no service script", () => {
    const state = stripState(row({ controllable: false, verdict: verdict("hmr") }), "pulled", NOW);
    expect(state.offerRestartAnyway).toBe(false);
  });

  it("reports readiness after a restart", () => {
    expect(stripState(row(), "restarted", NOW).label).toBe("Ready to test");
  });

  it("dates the up-to-date state instead of showing a bare zero", () => {
    const state = stripState(row({ fetchedAt: minutesAgo(0) }), "idle", NOW);
    expect(state.action).toBe("none");
    expect(state.label).toMatch(/^Up to date · checked/);
  });
});

describe("refsAreStale / describeAge", () => {
  it("treats never-fetched refs as stale", () => {
    expect(refsAreStale(null, NOW)).toBe(true);
    expect(describeAge(null, NOW)).toBe("never checked");
  });

  it("treats a fetch inside the window as fresh", () => {
    expect(refsAreStale(minutesAgo(1), NOW)).toBe(false);
  });

  it("treats an old fetch as stale", () => {
    expect(refsAreStale(minutesAgo(30), NOW)).toBe(true);
  });

  it("scales the age it reports", () => {
    expect(describeAge(minutesAgo(0), NOW)).toBe("checked just now");
    expect(describeAge(minutesAgo(10), NOW)).toBe("checked 10m ago");
    expect(describeAge(minutesAgo(180), NOW)).toBe("checked 3h ago");
    expect(describeAge(minutesAgo(60 * 24 * 2), NOW)).toBe("checked 2d ago");
  });
});
