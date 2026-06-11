import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatRunDetail, formatRuns } from "../formatters/runFormatter.js";

export async function runsCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.runs(5);
  return formatRuns(response.data.runs);
}

export async function runCommand(cli: ArcadiaCli, runId: string): Promise<string> {
  const response = await cli.run(runId);
  return formatRunDetail(response.data);
}
