import { submitReadAloud } from "./read-aloud";
import { requirePullRequestSummary } from "./pull-request-summary";

export class StalePullRequestSummaryError extends Error {
  public constructor() {
    super("The displayed TLDR is stale. Reload TLDR before playing audio.");
    this.name = "StalePullRequestSummaryError";
  }
}

export async function preparePullRequestAudio(repository: string, number: number, expected: { sourceRevision: string; summaryJobId: string }) {
  const { source, summary } = await requirePullRequestSummary(repository, number);
  if (summary.sourceRevision !== expected.sourceRevision || summary.jobId !== expected.summaryJobId) {
    throw new StalePullRequestSummaryError();
  }
  return { source, summary, job: await submitReadAloud(summary.text) };
}
