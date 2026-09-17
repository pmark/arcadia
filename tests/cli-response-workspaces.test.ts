import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { createProject, createTempWorkspacePath, initializedWorkspace, parseJson, runCli, cleanupTrackedPaths } from "./cli-response-fixture.js";

afterEach(cleanupTrackedPaths);

describe("CLI response contract — workspaces and defaults", () => {
  it("emits JSON for the nested approved Action queue", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["advance", "queue", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("advance.queue");
    expect(json.data).toMatchObject({ revision: 0, ordered: [], orderValid: true });
  });

  it("emits JSON success for init", () => {
    const workspace = createTempWorkspacePath();
    const result = runCli(["init", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("init");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.databasePath).toBe(path.join(path.resolve(workspace), "database", "arcadia.sqlite3"));
    expect(json.artifacts).toContain(path.join(path.resolve(workspace), "database", "arcadia.sqlite3"));
    expect(existsSync(path.join(workspace, "config", "arcadia.json"))).toBe(true);
  });

  it("emits JSON success for status and generated report artifacts", () => {
    const workspace = initializedWorkspace();
    createProject(workspace);
    const result = runCli(["status", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.projectCount).toBe(1);
    expect(json.data.activeProjectCount).toBe(1);
    expect(json.data.runningWorkCount).toBe(0);
    expect(json.data.queuedWorkCount).toBe(1);
    expect(json.data.requiresReviewCount).toBe(0);
    expect(json.data.requiresReviewWorkCount).toBe(0);
    expect(json.data.recentArtifactCount).toBe(1);
    expect(json.data.reportPath).toBe(path.join(path.resolve(workspace), "reports", "status.md"));
    expect(json.artifacts).toContain(path.join(path.resolve(workspace), "reports", "status.md"));
  });

  it("emits JSON success for weekly review and generated report artifacts", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(
        "done",
        "2026-06-07T12:00:00.000Z",
        created.workItem.id
      );
    });

    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-06-03",
      "--until",
      "2026-06-09",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    const reportPath = path.join(path.resolve(workspace), "reports", "weekly", "2026-06-09.md");
    expect(json.ok).toBe(true);
    expect(json.command).toBe("review.weekly");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.window).toEqual({ since: "2026-06-03", until: "2026-06-09" });
    expect(json.data.reportPath).toBe(reportPath);
    expect(json.data.counts.completedWork).toBe(1);
    expect(json.artifacts).toContain(reportPath);
    expect(readFileSync(reportPath, "utf8")).toContain("Review window: 2026-06-03 to 2026-06-09");
  });

  it("emits JSON success for Back Burner capture and keeps review empty", () => {
    const workspace = initializedWorkspace();
    const asked = runCli(["ask", "Pinterest might help Rebuster.", "--workspace", workspace, "--json"]);
    expect(asked.status).toBe(0);
    const askedJson = parseJson(asked.stdout);
    expect(askedJson.data.result.status).toBe("captured");
    expect(askedJson.data.reviewItemId).toBeNull();
    expect(askedJson.data.backBurnerItemId).toMatch(/^bb_/);

    const backBurner = runCli(["back-burner", "list", "--workspace", workspace, "--status", "all", "--json"]);
    const review = runCli(["review", "--workspace", workspace, "--json"]);

    expect(backBurner.status).toBe(0);
    const json = parseJson(backBurner.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("back-burner.list");
    expect(json.data.count).toBe(1);
    expect(json.data.items[0].id).toBe(askedJson.data.backBurnerItemId);
    expect(json.data.items[0].original_input).toBe("Pinterest might help Rebuster.");

    expect(review.status).toBe(0);
    expect(parseJson(review.stdout).data.count).toBe(0);
  });

  it("shelves an explicitly conditioned and tagged idea through Ask", () => {
    const workspace = initializedWorkspace();
    const asked = runCli([
      "ask",
      "Revisit compact status output.",
      "--workspace",
      workspace,
      "--back-burner",
      "--surface-date",
      "2000-01-01",
      "--source-ref",
      "docs/ideas/status.md",
      "--tag",
      "quick-win",
      "experiment",
      "--json"
    ]);
    expect(asked.status).toBe(0);

    const listed = runCli([
      "back-burner",
      "list",
      "--workspace",
      workspace,
      "--status",
      "all",
      "--fired",
      "yes",
      "--tag",
      "quick-win",
      "--group-by",
      "tag",
      "--json"
    ]);
    expect(listed.status).toBe(0);
    const json = parseJson(listed.stdout);
    expect(json.data.count).toBe(1);
    expect(json.data.items[0]).toMatchObject({
      source_ref: "docs/ideas/status.md",
      surface_fired: true,
      effective_status: "opportunistic",
      facet_tags: ["quick-win", "experiment"]
    });
  });

  it("shows, promotes, and archives Back Burner items from the CLI", () => {
    const promoteWorkspace = initializedWorkspace();
    const asked = parseJson(runCli(["ask", "Pinterest might help Rebuster.", "--workspace", promoteWorkspace, "--json"]).stdout);
    const itemId = asked.data.backBurnerItemId;

    const shown = parseJson(runCli(["back-burner", "show", itemId, "--workspace", promoteWorkspace, "--json"]).stdout);
    expect(shown.command).toBe("back-burner.show");
    expect(shown.data.item.original_input).toBe("Pinterest might help Rebuster.");

    const promoted = parseJson(runCli(["back-burner", "promote", itemId, "--workspace", promoteWorkspace, "--json"]).stdout);
    expect(promoted.command).toBe("back-burner.promote");
    expect(promoted.data.result.status).toBe("promoted");
    expect(promoted.data.workItem.id).toMatch(/^work_/);

    const archiveWorkspace = initializedWorkspace();
    const archivedAsk = parseJson(runCli(["ask", "Maybe improve Arcadia intake.", "--workspace", archiveWorkspace, "--json"]).stdout);
    const archived = parseJson(runCli([
      "back-burner",
      "archive",
      archivedAsk.data.backBurnerItemId,
      "--workspace",
      archiveWorkspace,
      "--json"
    ]).stdout);
    expect(archived.command).toBe("back-burner.archive");
    expect(archived.data.item.status).toBe("archived");
  });

});
