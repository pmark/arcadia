export interface WorkflowDefinition {
  version: 1;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  match: {
    sources: string[];
    extensions: string[];
    fileNameIncludes?: string[];
  };
  action: {
    executable: string;
    arguments: string[];
    workingDirectory: string;
    timeoutSeconds: number;
    safeToRunAutomatically: boolean;
  };
  output: {
    directory: string;
    expectedPattern: string;
    collectedPathPrefix: string;
  };
  publication: {
    destinationRoot: string;
    directoryTemplate: string;
    fileNameTemplate: string;
    verify: "sha256" | "size";
  };
  retry: {
    maxAttempts: number;
    idempotency: "sha256";
  };
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface WorkflowPublishedFile {
  sourcePath: string;
  destinationPath: string;
  size: number;
  sha256: string;
  copied: boolean;
}

export type WorkflowRunStatus = "would_run" | "running" | "completed" | "failed" | "already_completed";

export interface WorkflowRunRecord {
  schemaVersion: 1;
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  inputPath: string;
  inputSha256: string;
  recordingDate: string;
  currentStep: "planned" | "extracting" | "publishing" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  command: { executable: string; arguments: string[]; workingDirectory: string };
  exitStatus: number | null;
  signal: string | null;
  stdoutLogPath: string | null;
  stderrLogPath: string | null;
  runManifestPath: string | null;
  sourceOutputDirectory: string | null;
  destinationDirectory: string;
  files: WorkflowPublishedFile[];
  statusMessage: string;
  mostRecentOutput: string | null;
  failureReason: string | null;
  recommendedRecoveryAction: string | null;
  retryable: boolean;
}
