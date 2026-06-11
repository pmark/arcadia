import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatRuns } from "../formatters/runFormatter.js";

export async function runsCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.runs(5);
  return formatRuns(response.data.runs);
}
