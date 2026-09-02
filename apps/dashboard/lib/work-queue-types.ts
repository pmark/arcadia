export type WorkQueueState = "ready" | "running" | "flagged" | "attention";

export interface WorkQueueBlocker {
  relativePath: string;
  field: string;
  message: string;
  remedy: string;
}

export interface WorkQueueEntry {
  id: string;
  state: WorkQueueState;
  attentionKind: string | null;
  selected: boolean;
  pointerAuthorized?: boolean;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  planSlug: string | null;
  actionId: string | null;
  actionTitle: string | null;
  responsibility: string | null;
  expectedArtifact: string | null;
  tokenImpact: string | null;
  tokenBudget: string | null;
  outcome?: string | null;
  milestone?: string | null;
  effort?: string | null;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  decisions?: string[];
  status: string;
  reason: string;
  nextAction: string;
  blockers: WorkQueueBlocker[];
  runId: string | null;
  decisionId: string | null;
  updatedAt: string;
  orderKey?: string | null;
  position?: number | null;
  orderStatus?: "explicit" | "unpositioned" | "not_applicable";
}

export interface WorkQueueOrderReceipt {
  id: string;
  requestId: string;
  revisionBefore: number;
  revisionAfter: number;
  before: string[];
  after: string[];
  operation:
    | { kind: "move"; move: string; placement: "top" | "before" | "after"; anchor: string | null }
    | { kind: "arrange"; order: string[] }
    | { kind: "undo"; receiptId: string };
  applied: boolean;
  createdAt: string;
}

export interface WorkQueue {
  generatedAt: string;
  revision: number;
  ordered: WorkQueueEntry[];
  nextActionKey: string | null;
  unpositionedCount: number;
  orderValid: boolean;
  undoReceipt: WorkQueueOrderReceipt | null;
  counts: { ready: number; running: number; flagged: number; attention: number };
}

export interface WorkQueueMutationResponse {
  receipt: WorkQueueOrderReceipt;
  nextActionKey: string | null;
}

export interface WorkQueuePointerReceipt {
  id: string;
  actionKey: string;
  previousAction: string | null;
  nextAction: string;
  projectPath: string;
  planPath: string;
  previewFingerprint: string;
  applied: boolean;
}

export interface WorkQueueMakeNextResponse {
  receipt: WorkQueuePointerReceipt;
  nextActionKey: string | null;
}
