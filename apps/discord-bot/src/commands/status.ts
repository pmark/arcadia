import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatStatus } from "../formatters/statusFormatter.js";

export async function statusCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.status();
  return formatStatus(response.data);
}
