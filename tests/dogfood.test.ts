import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandSuccess } from "../src/cli/response.js";
import { createSuccess } from "../src/cli/response.js";
import {
  DOGFOOD_GOAL,
  DOGFOOD_MILESTONE,
  DOGFOOD_MISSION,
  DOGFOOD_NEXT_ACTION,
  dogfoodWorkspacePath,
  runDogfoodAskCommand,
  runDogfoodInitCommand,
  runDogfoodReviewApproveCommand,
  runDogfoodReviewCommand,
  runDogfoodReviewDeferCommand,
  runDogfoodReviewRejectCommand,
  runDogfoodReviewShowCommand,
  runDogfoodStatusCommand
} from "../src/commands/dogfood.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, listProjectSummaries, listRecentMissionLogs, listWorkItems } from "../src/db/repositories.js";
import type { AskCommandData, AskOptions } from "../src/commands/ask.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

beforeEach(removeDogfoodWorkspace);
afterEach(removeDogfoodWorkspace);

function removeDogfoodWorkspace(): void {
  rmSync(dogfoodWorkspacePath(), { recursive: true, force: true });
}

describe("arcadia dogfood", () => {
  it("initializes the compatibility workspace with seeded Arcadia project values", () => {
    const result = runDogfoodInitCommand();

    expect(result.command).toBe("dogfood.init");
    expect(result.workspace).toBe(dogfoodWorkspacePath());
    expect(existsSync(path.join(dogfoodWorkspacePath(), "config", "arcadia.json"))).toBe(true);
    expect(existsSync(path.join(dogfoodWorkspacePath(), "database", "arcadia.sqlite3"))).toBe(true);
    expect(result.data.project.name).toBe("Arcadia");
    expect(result.data.project.mission).toBe(DOGFOOD_MISSION);
    expect(result.data.project.goal).toBe(DOGFOOD_GOAL);
    expect(result.data.project.status).toBe("active");
    expect(result.data.milestone.title).toBe(DOGFOOD_MILESTONE);
    expect(result.data.workItem.next_action).toBe(DOGFOOD_NEXT_ACTION);
    expect(existsSync(path.join(dogfoodWorkspacePath(), result.data.missionLog.markdown_path))).toBe(true);

    withDatabase(dogfoodWorkspacePath(), (db) => {
      const [project] = listProjectSummaries(db);
      expect(project.name).toBe("Arcadia");
      expect(project.goal).toBe(DOGFOOD_GOAL);
      expect(project.current_milestone).toBe(DOGFOOD_MILESTONE);
      expect(project.next_action).toBe(DOGFOOD_NEXT_ACTION);
      expect(countRows(db, "mission_logs")).toBe(1);
    });
  });

  it("is idempotent", () => {
    const first = runDogfoodInitCommand();
    const second = runDogfoodInitCommand();

    expect(second.data.project.id).toBe(first.data.project.id);
    expect(second.data.milestone.id).toBe(first.data.milestone.id);
    expect(second.data.workItem.id).toBe(first.data.workItem.id);
    expect(second.data.missionLog.id).toBe(first.data.missionLog.id);

    withDatabase(dogfoodWorkspacePath(), (db) => {
      expect(countRows(db, "projects")).toBe(1);
      expect(listWorkItems(db).filter((item) => item.raw_input === DOGFOOD_NEXT_ACTION)).toHaveLength(1);
      expect(listRecentMissionLogs(db, 10)).toHaveLength(1);
    });
  });

  it("routes dogfood ask through the existing ask implementation", () => {
    runDogfoodInitCommand();
    const calls: AskOptions[] = [];
    const fakeAsk = (options: AskOptions): CommandSuccess<AskCommandData> => {
      calls.push(options);
      return createSuccess({
        command: "ask",
        workspace: dogfoodWorkspacePath(),
        data: {} as AskCommandData
      });
    };

    const result = runDogfoodAskCommand(
      { request: "Create a work item for implementing Discord notifications.", runSafe: true },
      fakeAsk
    );

    expect(result.command).toBe("dogfood.ask");
    expect(calls).toEqual([
      {
        workspace: ".arcadia-workspace",
        request: "Create a work item for implementing Discord notifications.",
        runSafe: true
      }
    ]);
  });

  it("uses Intake through the real dogfood ask command", () => {
    runDogfoodInitCommand();

    const result = runDogfoodAskCommand({ request: "What should I focus on today?" });

    expect(result.command).toBe("dogfood.ask");
    expect(result.workspace).toBe(dogfoodWorkspacePath());
    expect(result.data.intake.resolvedIntent).toBe("ShowStatus");
    expect(result.data.result.status).toBe("acted");
    expect(result.data.status?.projectCount).toBeGreaterThan(0);
    expect(result.data.workItem).toBeNull();
  });

  it("runs dogfood review commands against the repo-local workspace", () => {
    runDogfoodInitCommand();
    const asked = runDogfoodAskCommand({ request: "Make Arcadia easier somehow." });
    expect(asked.data.result.status).toBe("requires_review");
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const review = runDogfoodReviewCommand();
    expect(review.command).toBe("dogfood.review");
    expect(review.workspace).toBe(dogfoodWorkspacePath());
    expect(review.data.items.map((item) => item.id)).toContain(asked.data.reviewItemId);
    expect(runDogfoodReviewShowCommand(asked.data.reviewItemId).data.item.id).toBe(asked.data.reviewItemId);

    const deferred = runDogfoodReviewDeferCommand(asked.data.reviewItemId);
    expect(deferred.command).toBe("dogfood.review.defer");
    expect(deferred.data.result.status).toBe("deferred");
    const rejected = runDogfoodReviewRejectCommand(asked.data.reviewItemId);
    expect(rejected.command).toBe("dogfood.review.reject");
    expect(rejected.data.result.status).toBe("rejected");
  });

  it("approves compatibility Requires Review by resuming execution and updates status", () => {
    runDogfoodInitCommand();
    const asked = runDogfoodAskCommand({ request: "Create a NextJS app called Arcadia Companion." });
    expect(asked.data.result.status).toBe("requires_review");
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const approved = runDogfoodReviewApproveCommand(asked.data.reviewItemId);
    expect(approved.command).toBe("dogfood.review.approve");
    expect(approved.workspace).toBe(dogfoodWorkspacePath());
    expect(approved.data.result.status).toBe("approved");
    expect(approved.data.approval?.workItem?.id).toMatch(/^work_/);
    expect(approved.data.item.resultingAskRequestId).toBe(approved.data.approval?.ask.id);

    const status = runDogfoodStatusCommand();
    expect(status.command).toBe("dogfood.status");
    expect(status.workspace).toBe(dogfoodWorkspacePath());
    expect(status.data.projectCount).toBeGreaterThan(0);
    expect(status.data.codexCount).toBeGreaterThan(0);
  });

  it("emits JSON for dogfood review decision subcommands", () => {
    runDogfoodInitCommand();
    const asked = runDogfoodAskCommand({ request: "Create a NextJS app called Arcadia Companion." });
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const result = spawnSync(
      tsxBin,
      [
        path.join(repoRoot, "src", "cli.ts"),
        "dogfood",
        "review",
        "approve",
        asked.data.reviewItemId,
        "--json"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("dogfood.review.approve");
    expect(json.data.item.resultingAskRequestId).toBe(json.data.approval.ask.id);
  });

  it("emits dogfood command identity for ask JSON while preserving ask data", () => {
    runDogfoodInitCommand();

    const result = spawnSync(
      tsxBin,
      [
        path.join(repoRoot, "src", "cli.ts"),
        "dogfood",
        "ask",
        "What should I focus on today?",
        "--json"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("dogfood.ask");
    expect(json.data.ask.id).toMatch(/^ask_/);
    expect(json.data.intake.resolvedIntent).toBe("ShowStatus");
  });
});
