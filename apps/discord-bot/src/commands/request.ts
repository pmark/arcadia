import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatRequest } from "../formatters/requestFormatter.js";
import { discordSubmissionStatePath, recordDiscordSubmission } from "../notifications/state.js";

export async function requestCommand(
  cli: ArcadiaCli,
  workspace: string,
  request: string,
  runSafe = false
): Promise<string> {
  const response = await cli.ask(request, { runSafe });
  await recordDiscordSubmission(discordSubmissionStatePath(workspace), {
    askId: response.data.ask.id,
    workItemId: response.data.workItem?.id ?? null,
    runId: response.data.run?.id ?? null
  });
  return formatRequest(response.data);
}
