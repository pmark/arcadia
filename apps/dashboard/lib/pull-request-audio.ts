import { submitReadAloud } from "./read-aloud";
import { loadPullRequestSummary } from "./pull-request-summary";

export class StalePullRequestSummaryError extends Error {
  public constructor() {
    super("The displayed TLDR is stale. Use Refresh TLDR before playing audio.");
    this.name = "StalePullRequestSummaryError";
  }
}

export async function preparePullRequestAudio(repository: string, number: number, expected: { sourceRevision: string; summaryJobId: string }) {
  const current = await loadPullRequestSummary(repository, number);
  if (current.sourceRevision !== expected.sourceRevision) throw new StalePullRequestSummaryError();
  if (!current.summary) throw new Error("Generate the TLDR successfully before preparing its audio.");
  if (current.summary.jobId !== expected.summaryJobId) throw new StalePullRequestSummaryError();
  const { source, summary } = current;
  return { source, summary, job: await submitReadAloud(summary.text) };
}
