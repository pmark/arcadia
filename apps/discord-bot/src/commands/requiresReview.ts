import type { ArcadiaCli } from "../arcadia/cli.js";
import { formatRequiresReview } from "../formatters/requiresReviewFormatter.js";

export async function requiresReviewCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.queue();
  return formatRequiresReview(response.data.queues.needs_mark);
}
