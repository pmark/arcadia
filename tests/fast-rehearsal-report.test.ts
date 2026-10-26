import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectScenarioReports, readCombinedReport, writeCombinedReport } from "../scripts/fast-rehearsal-report.mjs";
import { detectEnvironmentWalls, sessionTokensFromLog } from "../src/production/sessionCapability.js";
import { ENVIRONMENT_WALL_SESSION, environmentWallSessionLog } from "./fast-rehearsal/helpers/environmentWall.js";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "fast-rehearsal-report-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("the recorded environment-wall Session builder", () => {
  it("keeps legacy diagnostic prose unattributed while carrying its recorded token shape", () => {
    const log = environmentWallSessionLog();
    expect(detectEnvironmentWalls(log)).toEqual([]);
    expect(sessionTokensFromLog(log)).toEqual({
      inputTokens: ENVIRONMENT_WALL_SESSION.totalInputTokens - ENVIRONMENT_WALL_SESSION.cachedInputTokens,
      cachedInputTokens: ENVIRONMENT_WALL_SESSION.cachedInputTokens,
      outputTokens: ENVIRONMENT_WALL_SESSION.outputTokens
    });
  });
});

describe("fast-rehearsal report loading fails loudly", () => {
  it("names a missing report directory", () => {
    const missing = path.join(tmp(), "nope");
    expect(() => collectScenarioReports(missing)).toThrow(missing);
  });

  it("refuses a directory with no scenario report, naming it", () => {
    const dir = tmp();
    expect(() => collectScenarioReports(dir)).toThrow(/no scenario wrote a report/);
    expect(() => collectScenarioReports(dir)).toThrow(dir);
  });

  it("names an unparsable scenario report and an unparsable or missing report.json", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.json"), "{not json");
    expect(() => collectScenarioReports(dir)).toThrow(/a\.json is unparsable/);
    expect(() => readCombinedReport(path.join(dir, "report.json"))).toThrow(/report\.json is missing/);
    writeFileSync(path.join(dir, "report.json"), "oops");
    expect(() => readCombinedReport(path.join(dir, "report.json"))).toThrow(/report\.json is unparsable/);
  });

  it("returns the scenarios and the written combined report when all is well", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "b.json"), JSON.stringify({ file: "b", scenario: "b" }));
    writeFileSync(path.join(dir, "a.json"), JSON.stringify({ file: "a", scenario: "a" }));
    const reports = collectScenarioReports(dir);
    expect(reports.map((r: { scenario: string }) => r.scenario)).toEqual(["a", "b"]);
    expect(writeCombinedReport(dir, { scenarios: reports }).scenarios).toHaveLength(2);
  });
});
