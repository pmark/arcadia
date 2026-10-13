import { submitReadAloud } from "./read-aloud";
import { requirePullRequestSummary } from "./pull-request-summary";

export async function preparePullRequestAudio(repository: string, number: number) {
  const { source, summary } = await requirePullRequestSummary(repository, number);
  return { source, summary, job: await submitReadAloud(summary.text) };
}
