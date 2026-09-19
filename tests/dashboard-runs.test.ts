import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDashboardRunsCommand } from "../src/commands/dashboard.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { withDatabase } from "../src/db/connection.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-dashboard-runs-"));
  temporary.push(root);
  const target = path.join(root, "workspace");
  initWorkspace(target);
  withDatabase(target, () => undefined);
  return target;
}

describe("dashboard runs", () => {
  it("returns only the active read model by default", () => {
    const response = runDashboardRunsCommand({ workspace: workspace() });
    expect(response.data.runs).toMatchObject({ activeAgentSessions: [], activeExecutionRuns: [], recentRuns: [] });
  });

  it("accepts an explicit zero and a positive limit", () => {
    const target = workspace();
    expect(runDashboardRunsCommand({ workspace: target, limit: "0" }).data.runs.recentRuns).toEqual([]);
    expect(runDashboardRunsCommand({ workspace: target, limit: "10" }).data.runs.recentRuns).toEqual([]);
  });

  it.each(["abc", "-1", "1.5", ""])("rejects an invalid --limit of %j instead of treating it as absent", (limit) => {
    expect(() => runDashboardRunsCommand({ workspace: workspace(), limit })).toThrow(/--limit must be a whole number/);
  });
});
