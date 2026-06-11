import { existsSync, rmSync } from "node:fs";
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
  runDogfoodInitCommand
} from "../src/commands/dogfood.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, listProjectSummaries, listRecentMissionLogs, listWorkItems } from "../src/db/repositories.js";
import type { AskCommandData, AskOptions } from "../src/commands/ask.js";

beforeEach(removeDogfoodWorkspace);
afterEach(removeDogfoodWorkspace);

function removeDogfoodWorkspace(): void {
  rmSync(dogfoodWorkspacePath(), { recursive: true, force: true });
}

describe("arcadia dogfood", () => {
  it("initializes a valid dogfood workspace with seeded Arcadia project values", () => {
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
    const initialized = runDogfoodInitCommand();
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

    expect(result.command).toBe("ask");
    expect(calls).toEqual([
      {
        workspace: ".arcadia-workspace",
        request: "Create a work item for implementing Discord notifications.",
        project: initialized.data.project.id,
        milestone: initialized.data.milestone.id,
        runSafe: true
      }
    ]);
  });
});
