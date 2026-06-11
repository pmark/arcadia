import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatCodexTasks } from "../formatters/codexFormatter.js";

export async function codexCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.codexTasks(true);
  return formatCodexTasks(response.data);
}
