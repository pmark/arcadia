export const PRESERVATION_STATES = ["unsaved", "local_only", "pushed", "in_pr", "landed"] as const;
export type PreservationState = (typeof PRESERVATION_STATES)[number];

export const DELIVERY_STATES = [
  "working",
  "needs_preservation",
  "needs_pr",
  "draft",
  "reviewable",
  "merge_ready",
  "blocked",
  "landed",
  "unknown"
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface WorkMonitorProject {
  id: string;
  name: string;
  repositoryPath: string | null;
}

export interface WorkingCopyChanges {
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
  paths: string[];
  areas: string[];
}

export interface PullRequestSnapshot {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string | null;
  updatedAt: string | null;
}

export interface WorkingCopyAssessment {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  worktreePath: string | null;
  branch: string | null;
  detached: boolean;
  head: string;
  baseRef: string;
  upstream: string | null;
  aheadOfUpstream: number | null;
  behindUpstream: number | null;
  commitsNotInBase: number;
  remoteBranchExists: boolean;
  changes: WorkingCopyChanges;
  pullRequest: PullRequestSnapshot | null;
  pullRequestLookup: "queried" | "unavailable" | "disabled";
  preservation: PreservationState;
  delivery: DeliveryState;
  summary: string;
  recommendedAction: string | null;
  lastCommitSubject: string | null;
  lastCommitAt: string | null;
}

export interface RepositoryWorkingCopyAssessment {
  projectId: string;
  projectName: string;
  repositoryPath: string | null;
  baseRef: string | null;
  workingCopies: WorkingCopyAssessment[];
  error: string | null;
}

export interface WorkMonitorSnapshot {
  scannedAt: string;
  repositories: RepositoryWorkingCopyAssessment[];
  totals: {
    projects: number;
    workingCopies: number;
    unsaved: number;
    localOnly: number;
    pushedWithoutPr: number;
    pullRequestUnknown: number;
    inPr: number;
    landed: number;
    configurationErrors: number;
  };
}
