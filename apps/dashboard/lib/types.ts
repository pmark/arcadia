export interface ArcadiaJsonSuccess<TData> {
  ok: true;
  command: string;
  workspace: string;
  data: TData;
  artifacts: string[];
  warnings: string[];
}

export interface DashboardSnapshotResponse {
  snapshot: DashboardSnapshot;
}

export interface QaCandidate {
  id: string;
  project: string;
  label: string;
  environment: "Candidate" | "Stable";
  revision: string | null;
  pullRequestUrl: string | null;
  targetUrl: string | null;
  targetState: "ready" | "unreachable" | "missing" | "unverified";
  validation: string;
  evidenceFreshness: string;
  testProcedure: string;
  environmentKind: ProofEnvironmentKind;
  accessState: ProofAccessState;
  refreshable: boolean;
}

export type QaRefreshRefusalReason =
  | "unknown-project"
  | "no-repo"
  | "dirty"
  | "detached"
  | "wrong-branch"
  | "diverged"
  | "fetch-failed"
  | "fast-forward-failed"
  | "checkout-failed"
  | "restart-failed";

export interface QaRefreshResult {
  project: string;
  before: unknown | null;
  after: unknown | null;
  fetched: boolean;
  advanced: boolean;
  restarted: boolean;
  output: string | null;
  refused: QaRefreshRefusalReason | null;
  message: string;
}

export type RestartVerdict = "install-and-restart" | "restart" | "hmr" | "inert" | "unknown";

export interface VerdictReason {
  rule: string;
  label: string;
  verdict: RestartVerdict;
  paths: string[];
}

export interface ProjectVerdict {
  project: string;
  range: string;
  commits: number;
  verdict: RestartVerdict;
  headline: string;
  reasons: VerdictReason[];
  migrationsChanged: boolean;
  apps: string[];
  changedPaths: string[];
  truncated: boolean;
  error: string | null;
}

export interface QaProjectRow {
  project: string;
  freshness: string;
  baseBranch: string;
  /** The branch HEAD is on, `"HEAD"` when detached. */
  branch: string | null;
  onBaseBranch: boolean;
  head: string | null;
  behind: number | null;
  ahead: number | null;
  dirty: boolean;
  fetchedAt: string | null;
  error: string | null;
  controllable: boolean;
  verdict: ProjectVerdict | null;
  services: string | null;
}

export interface QaFetchResult {
  project: string;
  before: unknown | null;
  after: unknown | null;
  fetched: boolean;
  verdict: ProjectVerdict | null;
  refused: QaRefreshRefusalReason | null;
  message: string;
}

export interface QaRestartResult {
  project: string;
  restarted: boolean;
  output: string | null;
  refused: QaRefreshRefusalReason | null;
  message: string;
}

export interface QaSwitchResult {
  project: string;
  from: string | null;
  to: string;
  switched: boolean;
  leftBranchMerged: boolean | null;
  refused: QaRefreshRefusalReason | null;
  message: string;
}

export type ProofEnvironment = "Stable" | "Candidate";
export type ProofEnvironmentKind = "local" | "lan" | "remote" | "missing";
export type ProofAccessState = "public" | "access-protected" | "local-only" | "unknown";
export type ProofHealthState = "healthy" | "unhealthy";
export type ProofHeroState =
  | "failure"
  | "ready_for_operator_demo"
  | "qa_failed"
  | "release_decision_needed"
  | "stable_only"
  | "proof_unavailable";

export interface ProofTargetConfig {
  id: string;
  project: string;
  environment: ProofEnvironment;
  label: string;
  url: string;
  environmentKind: ProofEnvironmentKind;
  accessState: ProofAccessState;
  sourceRevision: string | null;
}

export interface ProofTargetCheck {
  id: string;
  target_id: string;
  project_id: string;
  url: string;
  health_state: ProofHealthState;
  http_status: number | null;
  latency_ms: number | null;
  error_message: string | null;
  checked_at: string;
  created_at: string;
}

export interface ProofHeroAction {
  label: string;
  targetId: string | null;
  url: string | null;
}

export interface ProofHeroResolution {
  state: ProofHeroState;
  headline: string;
  detail: string;
  primaryAction: ProofHeroAction | null;
}

export interface ProofTargetView {
  target: ProofTargetConfig;
  lastCheck: ProofTargetCheck | null;
}

export interface ProofTargetListResponse {
  project: { id: string; slug: string; name: string };
  targets: ProofTargetView[];
  hero: ProofHeroResolution;
}

export interface ProofTargetCheckResponse {
  project: { id: string; slug: string; name: string };
  target: ProofTargetConfig;
  check: ProofTargetCheck;
  hero: ProofHeroResolution;
}

export interface IngressActivityResponse {
  source: string;
  root: string;
  generatedAt: string;
  service: {
    healthStatePath: string;
    healthy: boolean | null;
    checkedAt: string | null;
    counts: { observed: number; discovered: number; processed: number; failed: number } | null;
    error: string | null;
  };
  current: Array<{
    id: string;
    fileName: string;
    status: "pending" | "processing" | "completed" | "failed" | "preserved" | "skipped";
    location: "root" | "in" | "processing" | "done" | "failed";
    timestamp: string;
    path: string;
    summary: string;
    workflowId: string | null;
    runId: string | null;
    runManifestPath: string | null;
    artifactCount: number;
    failureReason: string | null;
  }>;
  activeRuns: Array<{
    id: string;
    workflowId: string;
    status: string;
    currentStep: string;
    inputPath: string;
    startedAt: string;
    statusMessage: string;
    mostRecentOutput: string | null;
    failureReason: string | null;
    runManifestPath: string | null;
  }>;
  recent: IngressActivityResponse["current"];
  counts: {
    pending: number;
    processing: number;
    activeRuns: number;
    failed: number;
    recent: number;
  };
}

export interface CaptureEnvelope {
  id: string;
  requestId: string;
  originalText: string;
  ingressSource: string;
  capturedAt: string;
  submittedUrls: string[];
  canonicalLinkCandidates: Array<{ submittedUrl: string; canonicalCandidate: string; reason: string }>;
  attachments: Array<{ id: string; originalFilename: string; mediaType: string; byteSize: number; sha256: string; storageReference: string; proposedRole: string; derivationStatus: string }>;
  derivations: Array<{ processor: string; source: string; processedAt: string; status: string; confidence: number | null; result: Record<string, unknown> | null }>;
  status: "captured";
  authority: "untrusted_input";
}

export interface AskResponse {
  captureEnvelope: CaptureEnvelope;
  ask: {
    id: string;
    raw_request: string;
    resolved_intent: string;
    prompt_packet_path: string | null;
    status: string;
  } | null;
  stewardship?: {
    intentType: string;
    recommendedExecutionPath: string;
    planningRecommended: boolean;
    clarificationRequired: boolean;
    reviewRequired: boolean;
    generatedCodexGoalText: string | null;
    classificationReason: string;
  };
  intake: {
    resolvedIntent: string;
    classification?: string;
    confidence: number;
    confidenceLabel: string;
    proposedAction: string;
    suggestedNextStep?: string | null;
  };
  resolvedIntent: {
    intentId: string;
    matched: boolean;
    outputKind: string;
    workClassification: string;
  };
  result: {
    status: "ignored" | "acted" | "queued" | "requires_review" | "captured";
    summary: string;
  };
  workItem: {
    id: string;
    title: string;
    project_name: string | null;
    milestone_title: string | null;
    queue: string;
    work_classification: string;
  } | null;
  plan: {
    id: string;
    status: string;
    summary: string;
  } | null;
  run: {
    id: string;
    status: string;
    summary: string;
  } | null;
  reviewItemId: string | null;
  decisionId?: string | null;
  backBurnerItemId: string | null;
}

export interface AskFeedbackItem {
  id: string;
  ask_request_id: string;
  decision: "up" | "down";
  note: string | null;
  source_ingress: string | null;
  created_at: string;
}

export interface FeedbackRecordResponse {
  feedback: AskFeedbackItem;
  result: {
    status: "recorded";
    summary: string;
  };
}

export interface FeedbackListResponse {
  items: AskFeedbackItem[];
  counts: {
    up: number;
    down: number;
  };
}

export interface DashboardSnapshot {
  generatedAt: string;
  workspace: string;
  counts: {
    activeProjects: number;
    pausedProjects: number;
    incubatingProjects: number;
    totalProjects: number;
    attention: number;
    requiresReview: number;
    backBurner: number;
    backBurnerFired: number;
    backBurnerIncubating: number;
    activeRuns: number;
    recentRuns: number;
    recentArtifacts: number;
    activityEvents: number;
  };
  dailyAdvantage: DashboardDailyAdvantage | null;
  reviewFocus: DashboardReviewFocus | null;
  agentQueue: AgentQueue;
  projects: DashboardProject[];
  attentionItems: DashboardAttentionItem[];
  activityEvents: DashboardActivityEvent[];
  capabilities: DashboardCapability[];
  blogging: DashboardBloggingSnapshot;
  rebuster: DashboardRebusterSnapshot;
  currentMilestones: DashboardMilestone[];
  requiresReviewItems: DashboardReviewItem[];
  backBurnerItems: DashboardBackBurnerItem[];
  recentRuns: DashboardRun[];
  recentArtifacts: DashboardArtifact[];
  managedActions?: Array<{ workItemId: string; projectId: string; planSlug: string; actionId: string }>;
}

export interface DashboardReviewFocus {
  projectOrder: string[];
  excludedProjects: string[];
  maxItems: number;
}

export type PullRequestReadiness =
  | "blocked"
  | "checks_failing"
  | "checks_pending"
  | "draft"
  | "ready"
  | "merge_ready"
  | "unknown";

export interface DashboardPullRequestCheck {
  name: string;
  status: string | null;
  conclusion: string | null;
  url: string | null;
}

export interface DashboardOutstandingPullRequest {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN";
  isDraft: boolean;
  mergeStateStatus: string | null;
  headBranch: string;
  baseBranch: string;
  author: string | null;
  reviewDecision: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  checks: DashboardPullRequestCheck[];
  readiness: PullRequestReadiness;
  readinessLabel: string;
  summary: string;
  briefing: DashboardPullRequestBriefing | null;
}

export interface DashboardPullRequestBriefing {
  changedFiles: string[];
  unmentionedFiles: string[];
  decisionFiles: string[];
  materialFacts: string[];
  basePullRequest: { number: number; title: string; headBranch: string } | null;
}

export interface DashboardPullRequestProjectError {
  projectId: string;
  projectName: string;
  repositoryPath: string | null;
  message: string;
}

export interface DashboardOutstandingPullRequests {
  generatedAt: string;
  projectsScanned: number;
  pullRequests: DashboardOutstandingPullRequest[];
  errors: DashboardPullRequestProjectError[];
  counts: {
    total: number;
    blocked: number;
    checksFailing: number;
    checksPending: number;
    drafts: number;
    ready: number;
    mergeReady: number;
    unknown: number;
  };
}

export type AgentQueueEntryState = "ready" | "running" | "flagged" | "attention";
export type AgentQueueAttentionKind =
  | "document"
  | "repository"
  | "decision"
  | "packet"
  | "run"
  | "responsibility";

export interface AgentQueueBlocker {
  relativePath: string;
  field: string;
  message: string;
  remedy: string;
}

export interface AgentQueueEntry {
  id: string;
  state: AgentQueueEntryState;
  attentionKind: AgentQueueAttentionKind | null;
  selected: boolean;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  repositoryRoot: string | null;
  planSlug: string | null;
  planPath: string | null;
  actionId: string | null;
  actionTitle: string | null;
  responsibility: string | null;
  expectedArtifact: string | null;
  tokenImpact: string | null;
  tokenBudget: string | null;
  status: string;
  reason: string;
  nextAction: string;
  blockers: AgentQueueBlocker[];
  runId: string | null;
  decisionId: string | null;
  updatedAt: string;
}

export interface AgentQueue {
  generatedAt: string;
  ready: AgentQueueEntry[];
  running: AgentQueueEntry[];
  flagged: AgentQueueEntry[];
  attention: AgentQueueEntry[];
  counts: {
    ready: number;
    running: number;
    flagged: number;
    attention: number;
  };
}

export interface DashboardDailyAdvantage {
  actionId: string;
  projectId: string;
  projectName: string;
  mission: string;
  outcome: string | null;
  milestoneId: string;
  milestoneTitle: string;
  actionTitle: string;
  nextAction: string;
  expectedArtifact: string;
  repositoryPath: string;
  whyItMatters: string;
  whyNow: string;
  status: "ready" | "prepared";
  statusLabel: string;
  decisionId: string | null;
  decisionSlug: string | null;
  packetPath: string | null;
}

export interface DashboardProject {
  id: string;
  name: string;
  mission: string;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  currentMilestone: string | null;
  currentMilestoneId: string | null;
  nextAction: string | null;
  workClassification: string | null;
  responsibility: string | null;
  workClassificationLabel: string | null;
  responsibilityLabel: string | null;
  repoPath: string | null;
  repositoryUrl: string | null;
  projectTemplate: string | null;
  generatorSkill: string | null;
  deploymentTarget: string | null;
  buildAgent: string | null;
  stagingUrl: string | null;
  statusSummary: string | null;
  validationCommands: string[];
  setupWarnings: string[];
  lastArtifact: DashboardArtifact | null;
  updatedAt: string;
}

export interface ProjectContinuation {
  context: {
    repoRoot: string;
    projectSlug: string;
    projectName: string;
    projectStatus: string;
    activePlan: string;
    planPath: string;
    planStatus: string;
    planTokenImpact: "none" | "small" | "medium" | "large" | "xlarge";
    planTokenBudget: string;
    milestone: string | null;
    action: {
      id: string;
      title: string;
      status: string;
      responsibility: string;
      effort: string | null;
      nextAction: string | null;
      expectedArtifact: string | null;
      clarification: string | null;
      gapType: string | null;
      question: string | null;
      confidence: string | null;
      source: string | null;
      dependsOn: string[];
      acceptanceCriteria: string[];
      decisions: string[];
      references: string[];
      execution: unknown;
      resolvedExecution: unknown;
    };
    actionPath: string;
    requiredDecisions: Array<{ id: string; slug: string; status: string; question: string; resolved: boolean }>;
    authorization: string;
  } | null;
  blockers: Array<{ relativePath: string; field: string; message: string; remedy: string }>;
  operatorQuestion: string | null;
  dispatchable: boolean;
  projectId: string;
  repoRoot: string;
}

export interface DashboardCapability {
  id: string;
  name: string;
  version: string;
  status: "available";
  dashboardSurfaces: string[];
}

export interface DashboardBloggingSnapshot {
  sites: DashboardBlogSite[];
  reviewItems: DashboardBlogReviewItem[];
}

export interface DashboardBlogSite {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  streamKey: string;
  status: string;
  statusLabel: string;
  nextScheduledTitle: string | null;
  nextScheduledFor: string | null;
  draftsNeedingReview: number;
  ideasCount: number;
  postsCount: number;
  latestArtifactPath: string | null;
  updatedAt: string;
}

export interface DashboardBlogReviewItem {
  kind: "post" | "schedule";
  id: string;
  title: string;
  siteId: string;
  siteName: string;
  streamKey: string;
  projectId: string;
  projectName: string;
  status: string;
  statusLabel: string;
  artifactId: string | null;
  artifactPath: string | null;
  reviewItemId: string;
  reviewSlug: string | null;
  decisionNeeded: string;
  updatedAt: string;
}

export interface DashboardRebusterSnapshot {
  connection: DashboardRebusterConnection;
  status: DashboardRebusterStatus;
  decisions: DashboardRebusterDecision[];
  recentEvents: DashboardRebusterEvent[];
}

export interface DashboardRebusterConnection {
  configured: boolean;
  projectId: string | null;
  projectName: string | null;
  repoPath: string | null;
  baseUrl: string | null;
  dashboardUrl: string | null;
  status: "configured" | "unconfigured";
  statusLabel: string;
  statusSummary: string | null;
  lastHealthCheckAt: string | null;
  lastSyncAt: string | null;
  updatedAt: string | null;
}

export interface DashboardRebusterStatus {
  summary: string;
  lastEventType: string | null;
  lastEventAt: string | null;
  openDecisionCount: number;
  recentEventCount: number;
}

export interface DashboardRebusterEvent {
  id: string;
  externalId: string;
  eventType: string;
  eventLabel: string;
  rebusId: string;
  answer: string;
  status: string;
  statusLabel: string;
  summary: string;
  decisionRequired: boolean;
  recommendation: string | null;
  rebusterUrl: string;
  artifactRefs: Array<Record<string, unknown>>;
  occurredAt: string;
  updatedAt: string;
  projectId: string;
  projectName: string | null;
  reviewItemId: string | null;
  reviewSlug: string | null;
  reviewStatus: string | null;
}

export interface DashboardRebusterDecision {
  id: string;
  externalId: string;
  answer: string;
  status: string;
  statusLabel: string;
  summary: string;
  recommendation: string | null;
  rebusterUrl: string;
  occurredAt: string;
  projectId: string;
  projectName: string | null;
  reviewItemId: string;
  reviewSlug: string | null;
}

export interface DashboardAttentionItem {
  id: string;
  kind: "review" | "codex_packet" | "run" | "blocked_work";
  severity: "action" | "blocked" | "info";
  projectName: string | null;
  projectId: string | null;
  milestone: string | null;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  reason: string;
  workItemId: string | null;
  actionId: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
  expectedArtifact: string | null;
  targetRepositoryRoot: string | null;
  relatedArtifactId: string | null;
  relatedArtifactTitle: string | null;
  relatedArtifactPath: string | null;
  finalArtifactPath: string | null;
  validationPath: string | null;
  relatedReviewId: string | null;
  relatedReviewSlug: string | null;
  relatedDecisionId: string | null;
  relatedDecisionSlug: string | null;
  relatedRunId: string | null;
  relatedCodexInvocationId: string | null;
  nextAction: string;
  interpretation: string | null;
  safetyBoundaries: string[];
  responsibility: string | null;
  primaryActions: DashboardAttentionAction[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAttentionAction {
  label: string;
  kind: "view" | "approve" | "reject" | "defer" | "command";
  command: string | null;
  href: string | null;
  reviewAction: "approve" | "reject" | "defer" | null;
}

export interface DashboardActivityEvent {
  id: string;
  eventType: string;
  eventLabel: string;
  summary: string;
  projectName: string | null;
  projectId: string | null;
  askId: string | null;
  reviewId: string | null;
  reviewSlug: string | null;
  decisionId: string | null;
  decisionSlug: string | null;
  workItemId: string | null;
  actionId: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
  runId: string | null;
  artifactId: string | null;
  artifactPath: string | null;
  backBurnerItemId: string | null;
  codexInvocationId: string | null;
  occurredAt: string;
}

export interface DashboardMilestone {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
}

export interface DashboardReviewItem {
  id: string;
  slug: string;
  decisionId: string;
  decisionSlug: string;
  displayId: string;
  workItemId: string | null;
  actionId: string | null;
  projectId: string | null;
  project: string | null;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  category: string;
  decisionNeeded: string;
  context: string;
  recommendation: string | null;
  proposedAction: string;
  missingFields: string[];
  options: string[];
  sourceInput: string;
  createdAt: string;
  updatedAt: string;
  resultingAskRequestId: string | null;
  contextJson: string | null;
  resolvedIntent: string;
  packetArtifactId: string | null;
  codexInvocationId: string | null;
  artifactPath: string | null;
  promptPath: string | null;
  finalMessagePath: string | null;
  validationPath: string | null;
  planningArtifact: {
    title: string;
    idea: string;
    milestone: string | null;
    proposedActions: string[];
    tokenImpact: string;
    tokenBudget: string;
    repository: string;
    artifactSha256: string;
  } | null;
}

export interface DashboardBackBurnerItem {
  id: string;
  originalInput: string;
  ingressSource: string;
  classification: string;
  confidence: number;
  reason: string;
  status: string;
  statusLabel: string;
  storedStatus: string;
  surfaceFired: boolean;
  surfaceWarning: string | null;
  suggestedNextStep: string | null;
  createdAt: string;
  updatedAt: string;
  promotedWorkItemId: string | null;
  promotedWorkItemTitle: string | null;
}

export interface DashboardRun {
  id: string;
  workItemId?: string | null;
  status: string;
  statusLabel: string;
  projectId: string | null;
  projectName: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  workItemTitle: string;
  actionTitle: string;
  summary: string;
  planSummary: string;
  currentStep: string | null;
  latestMessage: string;
  artifactsProduced: DashboardArtifact[];
  failureReason: string | null;
  reviewReason: string | null;
  missionLogPath: string | null;
}

export interface DashboardArtifact {
  id: string;
  workItemId?: string | null;
  title: string;
  artifactType: string;
  status: string;
  statusLabel: string;
  path: string | null;
  projectId: string | null;
  projectName: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
  updatedAt: string;
}
