export const LIVING_SYSTEM_VERSION = "v1" as const;

export type LivingSystemVersion = typeof LIVING_SYSTEM_VERSION;
export type LivingSystemViewOrder = "declaration" | "id" | "title";

export interface LivingSystemTopic {
  id: string;
  title: string;
  why: string;
  useWhen: string;
  summary: string;
  sources: string[];
  tags: string[];
}

export interface LivingSystemRelationship {
  from: string;
  to: string;
  type: string;
  summary: string | null;
}

export type LivingSystemViewSelector =
  | { kind: "all" }
  | { kind: "topic"; topicId: string }
  | { kind: "tag"; tag: string };

export interface LivingSystemView {
  id: string;
  title: string;
  purpose: string;
  selectors: LivingSystemViewSelector[];
  order: LivingSystemViewOrder;
  /** The selected Topic ids after validation, de-duplication, and ordering. */
  topicIds: string[];
}

/** Durable Project meaning normalized from `docs/living-system.yaml`. */
export interface LivingSystemManifest {
  arcadiaLivingSystem: LivingSystemVersion;
  project: string;
  purpose: string;
  topics: LivingSystemTopic[];
  relationships: LivingSystemRelationship[];
  views: LivingSystemView[];
}

export type LivingSystemSourceKind =
  | "manifest"
  | "project"
  | "plan"
  | "log"
  | "decision"
  | "run"
  | "artifact"
  | "pull_request"
  | "git"
  | "validation"
  | "projection";

export interface LivingSystemSourceReceipt {
  kind: LivingSystemSourceKind;
  reference: string;
  observedAt: string | null;
  contentHash: string | null;
  availability: "present" | "missing" | "conflicting";
}

export interface LivingSystemFreshnessReceipt {
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  state: "current" | "stale" | "missing" | "unknown";
  reason: string | null;
}

export interface LivingSystemImpactProvenance {
  topicId: string | null;
  kind: "declared" | "observed" | "downstream" | "unmapped";
  sources: LivingSystemSourceReceipt[];
  viaRelationship: LivingSystemRelationship | null;
}

/** Action-centered history derived from managed documents and operational evidence. */
export interface LivingSystemEpisode {
  id: string;
  planSlug: string;
  actionId: string;
  milestone: string | null;
  title: string;
  status: "open" | "in_progress" | "done" | "blocked";
  why: string | null;
  changed: string | null;
  nextAction: string | null;
  dependsOn: string[];
  decisions: string[];
  impacts: LivingSystemImpactProvenance[];
  sources: LivingSystemSourceReceipt[];
  freshness: LivingSystemFreshnessReceipt;
}

/** Current or historical evidence derived from an authoritative operational source. */
export interface LivingSystemSignal {
  id: string;
  kind: "current_pointer" | "decision" | "run" | "artifact" | "pull_request" | "git" | "validation";
  summary: string;
  state: string;
  episodeId: string | null;
  sources: LivingSystemSourceReceipt[];
  freshness: LivingSystemFreshnessReceipt;
  uncertainty: string | null;
}

export interface LivingSystemUnlinkedHistory {
  id: string;
  date: string;
  title: string;
  source: LivingSystemSourceReceipt;
}

/**
 * Stable projection target. The manifest supplies only structure; every field
 * below it is populated from Arcadia's existing managed or operational truth.
 */
export interface LivingSystemModel {
  version: LivingSystemVersion;
  project: string;
  purpose: string;
  topics: LivingSystemTopic[];
  relationships: LivingSystemRelationship[];
  views: LivingSystemView[];
  episodes: LivingSystemEpisode[];
  signals: LivingSystemSignal[];
  unlinkedHistory: LivingSystemUnlinkedHistory[];
  sources: LivingSystemSourceReceipt[];
  freshness: LivingSystemFreshnessReceipt;
}

export interface LivingSystemValidationError {
  field: string;
  message: string;
}

export type LivingSystemManifestResult =
  | { manifest: LivingSystemManifest; errors: [] }
  | { manifest: null; errors: LivingSystemValidationError[] };
