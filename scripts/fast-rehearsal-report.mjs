// Collect and verify the fast-rehearsal report. A missing or unparsable
// report is a loud failure that names the path, never a silent empty run.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Per-scenario reports in `reportDir`; throws naming the file or directory when none can be read. */
export function collectScenarioReports(reportDir) {
  if (!existsSync(reportDir)) throw new Error(`fast-rehearsal: report directory ${reportDir} does not exist; no scenario ran (is the cwd the repository root?).`);
  const files = readdirSync(reportDir).filter((file) => file.endsWith(".json") && file !== "report.json");
  if (files.length === 0) throw new Error(`fast-rehearsal: no scenario wrote a report into ${reportDir}; vitest ran no fast-rehearsal scenario (check the test filter and cwd).`);
  return files
    .map((file) => {
      try {
        return JSON.parse(readFileSync(path.join(reportDir, file), "utf8"));
      } catch (error) {
        throw new Error(`fast-rehearsal: scenario report ${path.join(reportDir, file)} is unparsable (${error.message}).`);
      }
    })
    .sort((a, b) => `${a.file}/${a.scenario}`.localeCompare(`${b.file}/${b.scenario}`));
}

/** Write report.json and read it back; throws naming its path when it is missing or unparsable. */
export function writeCombinedReport(reportDir, combined) {
  const file = path.join(reportDir, "report.json");
  writeFileSync(file, `${JSON.stringify(combined, null, 2)}\n`);
  return readCombinedReport(file);
}

export function readCombinedReport(file) {
  if (!existsSync(file)) throw new Error(`fast-rehearsal: report ${file} is missing.`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`fast-rehearsal: report ${file} is unparsable (${error.message}).`);
  }
}
