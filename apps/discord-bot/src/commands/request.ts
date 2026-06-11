import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatRequest } from "../formatters/requestFormatter.js";

export async function requestCommand(cli: ArcadiaCli, request: string): Promise<string> {
  const response = await cli.ask(request);
  return formatRequest(response.data);
}
