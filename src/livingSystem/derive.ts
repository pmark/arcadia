import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { discoverDocs } from "../docs/discover.js";
import type { DecisionDoc, LogDoc, PlanActionDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import { parseLivingSystemManifest } from "./contract.js";
import type {
  LivingSystemActionEvidence,
  LivingSystemDerivationInput,
  LivingSystemDerivationResult,
  LivingSystemEpisode,
  LivingSystemFreshnessReceipt,
  LivingSystemImpactProvenance,
  LivingSystemManifest,
  LivingSystemOperationalSignal,
  LivingSystemSignal,
  LivingSystemSourceReceipt,
  LivingSystemTopic,
  LivingSystemUnlinkedHistory
} from "./types.js";

const IMPACT_ORDER: Record<LivingSystemImpactProvenance["kind"], number> = {
  declared: 0,
  observed: 1,
  downstream: 2,
  unmapped: 3
};

/**
 * Assemble the deterministic living-system target from repository truth plus
 * explicitly supplied operational receipts. Nothing here invokes a model,
 * network service, clock, or heuristic history matcher.
 */
export function deriveLivingSystemModel(input: LivingSystemDerivationInput): LivingSystemDerivationResult {
  const parsed = parseLivingSystemManifest(input.repoRoot, input.projectSlug);
  if (!parsed.manifest) return { model: null, errors: parsed.errors };

  const discovered = discoverDocs(input.repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug === input.projectSlug
  );
  const plans = discovered.docs
    .filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === input.projectSlug)
    .sort((left, right) => stableCompare(left.relativePath, right.relativePath));
  const logs = discovered.docs
    .filter((doc): doc is LogDoc => doc.type === "log" && doc.project === input.projectSlug)
    .sort((left, right) => stableCompare(left.relativePath, right.relativePath));
  const decisions = discovered.docs
    .filter((doc): doc is DecisionDoc => doc.type === "decision" && doc.project === input.projectSlug)
    .sort((left, right) => stableCompare(left.id, right.id));

  const discoveryErrors = discovered.errors.map((error) => ({
    field: `${error.relativePath}:${error.field}`,
    message: error.message
  }));
  // The Project pointer and plans define the episode spine and must parse.
  // Other managed sources are additive evidence: preserve their parse failures
  // as visible validation Signals so one legacy Log or reference cannot erase
  // an otherwise truthful Project presentation.
  const errors = discoveryErrors.filter((error) =>
    error.field.startsWith("PROJECT.md:") || error.field.startsWith("docs/plans/")
  );
  const sourceGaps = discoveryErrors.filter((error) => !errors.includes(error));
  if (!project) errors.push({ field: "PROJECT.md", message: `No managed Project declares ${JSON.stringify(input.projectSlug)}.` });
  if (errors.length > 0 || !project) {
    errors.sort((left, right) => stableCompare(left.field, right.field) || stableCompare(left.message, right.message));
    return { model: null, errors };
  }

  const knownEpisodes = new Set(plans.flatMap((plan) => plan.actions.map((action) => `${plan.slug}#${action.id}`)));
  errors.push(...validateOperationalInputs(input.actionEvidence ?? [], input.operationalSignals ?? [], knownEpisodes));
  if (errors.length > 0) {
    errors.sort((left, right) => stableCompare(left.field, right.field) || stableCompare(left.message, right.message));
    return { model: null, errors };
  }
  const evidence = normalizeActionEvidence(input.actionEvidence ?? [], knownEpisodes);
  const operationalSignals = normalizeOperationalSignals(input.operationalSignals ?? [], knownEpisodes);
  const currentEpisodeId = resolveCurrentEpisode(project, plans);
  const planReceipts = new Map(plans.map((plan) => [plan.slug, receiptForDoc("plan", plan)]));
  const linkedLogs = indexLinkedLogs(logs);
  const episodes = plans.flatMap((plan) => plan.actions.map((action) => deriveEpisode({
    plan,
    action,
    manifest: parsed.manifest,
    planReceipt: planReceipts.get(plan.slug) as LivingSystemSourceReceipt,
    logs: linkedLogs.get(`${plan.slug}#${action.id}`) ?? [],
    evidence: evidence.filter((entry) => entry.action === `${plan.slug}#${action.id}`),
    operationalSignals: operationalSignals.filter((entry) => entry.episodeId === `${plan.slug}#${action.id}`)
  })));

  const signals = deriveSignals({
    project,
    currentEpisodeId,
    decisions,
    operationalSignals,
    episodes
  });
  signals.push(...sourceGaps.map((error) => sourceGapSignal(error.field, error.message)));
  signals.sort((left, right) => stableCompare(left.id, right.id));
  const unlinkedHistory = deriveUnlinkedHistory(logs);
  const modelSources = [
    sourceReceipt("manifest", "docs/living-system.yaml", null, hashFile(path.join(input.repoRoot, "docs/living-system.yaml"))),
    receiptForDoc("project", project),
    ...plans.map((plan) => receiptForDoc("plan", plan)),
    ...logs.map((log) => receiptForDoc("log", log)),
    ...decisions.map((decision) => receiptForDoc("decision", decision)),
    ...evidence.map((entry) => entry.source),
    ...operationalSignals.map((entry) => entry.source)
  ];

  return {
    model: {
      version: parsed.manifest.arcadiaLivingSystem,
      project: parsed.manifest.project,
      purpose: parsed.manifest.purpose,
      currentEpisodeId,
      topics: parsed.manifest.topics,
      relationships: parsed.manifest.relationships,
      views: parsed.manifest.views,
      episodes,
      signals,
      unlinkedHistory,
      sources: uniqueSources(modelSources),
      freshness: aggregateFreshness([...episodes.map((episode) => episode.freshness), ...signals.map((signal) => signal.freshness)])
    },
    errors: []
  };
}

function sourceGapSignal(field: string, message: string): LivingSystemSignal {
  const id = createHash("sha256").update(`${field}\n${message}`).digest("hex").slice(0, 16);
  return {
    id: `validation:source-gap:${id}`,
    kind: "validation",
    summary: `Managed source could not contribute evidence: ${field}: ${message}`,
    state: "missing",
    episodeId: null,
    sources: [{
      kind: "validation",
      reference: field,
      observedAt: null,
      contentHash: null,
      availability: "missing"
    }],
    freshness: freshness(null, null, "missing", "The managed source did not satisfy the current parser contract."),
    uncertainty: "History or status from this source may be incomplete."
  };
}

function deriveEpisode(input: {
  plan: PlanDoc;
  action: PlanActionDoc;
  manifest: LivingSystemManifest;
  planReceipt: LivingSystemSourceReceipt;
  logs: Array<{ log: LogDoc; entry: LogDoc["entries"][number] }>;
  evidence: LivingSystemActionEvidence[];
  operationalSignals: LivingSystemOperationalSignal[];
}): LivingSystemEpisode {
  const id = `${input.plan.slug}#${input.action.id}`;
  const logReceipts = input.logs.map(({ log, entry }) => sourceReceipt(
    "log",
    `${log.relativePath}#${entry.date}--${slug(entry.title)}`,
    entry.date,
    hashFile(log.absolutePath)
  ));
  const direct = deriveDirectImpacts(input.action, input.manifest.topics, input.evidence, input.planReceipt);
  const impacts = addDownstreamImpacts(direct, input.manifest);
  if (impacts.length === 0) {
    impacts.push({ topicId: null, kind: "unmapped", sources: [input.planReceipt], viaRelationship: null });
  }
  impacts.sort((left, right) =>
    IMPACT_ORDER[left.kind] - IMPACT_ORDER[right.kind] || stableCompare(left.topicId ?? "", right.topicId ?? "")
  );
  const dates = input.logs.map(({ entry }) => entry.date).sort(stableCompare);
  const changed = input.logs.map(({ entry }) => entry.result).filter(Boolean).join("\n\n") || null;
  const evidenceFreshness = input.operationalSignals.map((signal) => signal.freshness);

  return {
    id,
    planSlug: input.plan.slug,
    actionId: input.action.id,
    milestone: input.action.milestone ?? input.plan.milestone,
    title: input.action.title,
    status: input.action.status,
    occurredOn: dates.at(-1) ?? null,
    why: input.action.source,
    changed,
    nextAction: input.action.nextAction,
    dependsOn: input.action.dependsOn.map((dependency) => `${input.plan.slug}#${dependency}`).sort(stableCompare),
    decisions: [...input.action.decisions].sort(stableCompare),
    impacts,
    sources: uniqueSources([input.planReceipt, ...logReceipts, ...input.evidence.map((entry) => entry.source)]),
    freshness: evidenceFreshness.length > 0
      ? aggregateFreshness(evidenceFreshness)
      : freshness(null, input.plan.updated, input.action.status === "done" && logReceipts.length === 0 ? "missing" : "unknown",
        input.action.status === "done" && logReceipts.length === 0 ? "Completed Action has no linked Log or operational evidence." : "No operational freshness receipt was supplied.")
  };
}

function deriveDirectImpacts(
  action: PlanActionDoc,
  topics: LivingSystemTopic[],
  evidence: LivingSystemActionEvidence[],
  planReceipt: LivingSystemSourceReceipt
): LivingSystemImpactProvenance[] {
  const impacts: LivingSystemImpactProvenance[] = [];
  for (const topic of topics) {
    if (action.references.some((reference) => topic.sources.some((source) => pathsOverlap(reference, source)))) {
      impacts.push({ topicId: topic.id, kind: "declared", sources: [planReceipt], viaRelationship: null });
    }
    const matchingEvidence = evidence.filter((entry) =>
      entry.changedPaths.some((changedPath) => topic.sources.some((source) => pathsOverlap(changedPath, source)))
    );
    if (matchingEvidence.length > 0) {
      impacts.push({
        topicId: topic.id,
        kind: "observed",
        sources: uniqueSources(matchingEvidence.map((entry) => entry.source)),
        viaRelationship: null
      });
    }
  }
  return impacts;
}

function addDownstreamImpacts(
  direct: LivingSystemImpactProvenance[],
  manifest: LivingSystemManifest
): LivingSystemImpactProvenance[] {
  const impacts = [...direct];
  const directIds = new Set(direct.map((impact) => impact.topicId).filter((value): value is string => Boolean(value)));
  for (const relationship of manifest.relationships) {
    if (!directIds.has(relationship.from) || directIds.has(relationship.to)) continue;
    const upstream = direct.filter((impact) => impact.topicId === relationship.from);
    impacts.push({
      topicId: relationship.to,
      kind: "downstream",
      sources: uniqueSources(upstream.flatMap((impact) => impact.sources)),
      viaRelationship: relationship
    });
  }
  return impacts;
}

function deriveSignals(input: {
  project: ProjectDoc;
  currentEpisodeId: string | null;
  decisions: DecisionDoc[];
  operationalSignals: LivingSystemOperationalSignal[];
  episodes: LivingSystemEpisode[];
}): LivingSystemSignal[] {
  const signals: LivingSystemSignal[] = [];
  if (input.currentEpisodeId) {
    signals.push({
      id: `current:${input.currentEpisodeId}`,
      kind: "current_pointer",
      summary: `Current Action is ${input.currentEpisodeId}.`,
      state: "current",
      episodeId: input.currentEpisodeId,
      sources: [receiptForDoc("project", input.project)],
      freshness: freshness(null, input.project.updated, "unknown", "The checked-in pointer has no observation timestamp."),
      uncertainty: null
    });
  }
  for (const decision of input.decisions) {
    signals.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      summary: decision.question,
      state: decision.status,
      episodeId: decision.plan && decision.action ? `${decision.plan}#${decision.action}` : null,
      sources: [receiptForDoc("decision", decision)],
      freshness: freshness(null, decision.updated, "unknown", "Decision date is authoritative; observation time is absent."),
      uncertainty: decision.status === "open" ? "Decision remains open." : null
    });
  }
  for (const signal of input.operationalSignals) {
    signals.push({
      id: signal.id,
      kind: signal.kind,
      summary: signal.summary,
      state: signal.state,
      episodeId: signal.episodeId,
      sources: [signal.source],
      freshness: signal.freshness,
      uncertainty: signal.uncertainty
    });
  }
  for (const episode of input.episodes) {
    const hasEvidence = signals.some((signal) => signal.episodeId === episode.id && signal.kind !== "decision");
    if (episode.status === "done" && !hasEvidence && episode.changed === null) {
      signals.push({
        id: `missing-evidence:${episode.id}`,
        kind: "validation",
        summary: `No linked proof is available for completed Action ${episode.id}.`,
        state: "missing",
        episodeId: episode.id,
        sources: episode.sources,
        freshness: freshness(null, null, "missing", "No Log result or operational proof receipt was supplied."),
        uncertainty: "Completion is documented, but proof is missing from the derivation inputs."
      });
    }
  }
  return signals.sort((left, right) => stableCompare(left.id, right.id));
}

function deriveUnlinkedHistory(logs: LogDoc[]): LivingSystemUnlinkedHistory[] {
  return logs.flatMap((log) => log.entries
    .filter((entry) => !entry.action)
    .map((entry) => ({
      id: `${log.relativePath}#${entry.date}--${slug(entry.title)}`,
      date: entry.date,
      title: entry.title,
      summary: entry.result,
      source: sourceReceipt("log", log.relativePath, entry.date, hashFile(log.absolutePath))
    })))
    .sort((left, right) => stableCompare(left.date, right.date) || stableCompare(left.id, right.id));
}

function indexLinkedLogs(logs: LogDoc[]): Map<string, Array<{ log: LogDoc; entry: LogDoc["entries"][number] }>> {
  const index = new Map<string, Array<{ log: LogDoc; entry: LogDoc["entries"][number] }>>();
  for (const log of logs) {
    for (const entry of log.entries) {
      if (!entry.action) continue;
      const entries = index.get(entry.action) ?? [];
      entries.push({ log, entry });
      entries.sort((left, right) => stableCompare(left.entry.date, right.entry.date) || stableCompare(left.entry.title, right.entry.title));
      index.set(entry.action, entries);
    }
  }
  return index;
}

function resolveCurrentEpisode(project: ProjectDoc, plans: PlanDoc[]): string | null {
  const plan = plans.find((candidate) => candidate.slug === project.activePlan);
  const action = project.currentAction ?? plan?.currentAction ?? null;
  return plan && action ? `${plan.slug}#${action}` : null;
}

function normalizeActionEvidence(entries: LivingSystemActionEvidence[], known: Set<string>): LivingSystemActionEvidence[] {
  return entries
    .filter((entry) => known.has(entry.action))
    .map((entry) => ({ ...entry, changedPaths: [...new Set(entry.changedPaths)].sort(stableCompare) }))
    .sort((left, right) => stableCompare(left.action, right.action) || sourceCompare(left.source, right.source));
}

function validateOperationalInputs(
  evidence: LivingSystemActionEvidence[],
  signals: LivingSystemOperationalSignal[],
  known: Set<string>
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  evidence.forEach((entry, index) => {
    if (!known.has(entry.action)) {
      errors.push({ field: `actionEvidence[${index}].action`, message: `Unknown Action reference ${JSON.stringify(entry.action)}.` });
    }
    if (entry.changedPaths.length === 0) {
      errors.push({ field: `actionEvidence[${index}].changedPaths`, message: "Changed-file evidence must name at least one path." });
    }
    entry.changedPaths.forEach((changedPath, pathIndex) => {
      if (!isRepositoryPath(changedPath)) {
        errors.push({
          field: `actionEvidence[${index}].changedPaths[${pathIndex}]`,
          message: `Changed path ${JSON.stringify(changedPath)} is not repository-relative.`
        });
      }
    });
  });
  const signalIds = new Set<string>();
  signals.forEach((signal, index) => {
    if (signalIds.has(signal.id)) {
      errors.push({ field: `operationalSignals[${index}].id`, message: `Duplicate Signal id ${JSON.stringify(signal.id)}.` });
    }
    signalIds.add(signal.id);
    if (signal.episodeId !== null && !known.has(signal.episodeId)) {
      errors.push({
        field: `operationalSignals[${index}].episodeId`,
        message: `Unknown Action reference ${JSON.stringify(signal.episodeId)}.`
      });
    }
  });
  return errors;
}

function normalizeOperationalSignals(entries: LivingSystemOperationalSignal[], known: Set<string>): LivingSystemOperationalSignal[] {
  return [...entries]
    .filter((entry) => entry.episodeId === null || known.has(entry.episodeId))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function receiptForDoc(kind: "project" | "plan" | "log" | "decision", doc: ProjectDoc | PlanDoc | LogDoc | DecisionDoc): LivingSystemSourceReceipt {
  return sourceReceipt(kind, doc.relativePath, null, hashFile(doc.absolutePath));
}

function sourceReceipt(
  kind: LivingSystemSourceReceipt["kind"],
  reference: string,
  observedAt: string | null,
  contentHash: string | null,
  availability: LivingSystemSourceReceipt["availability"] = "present"
): LivingSystemSourceReceipt {
  return { kind, reference, observedAt, contentHash, availability };
}

function freshness(
  observedAt: string | null,
  sourceUpdatedAt: string | null,
  state: LivingSystemFreshnessReceipt["state"],
  reason: string | null
): LivingSystemFreshnessReceipt {
  return { observedAt, sourceUpdatedAt, state, reason };
}

function aggregateFreshness(receipts: LivingSystemFreshnessReceipt[]): LivingSystemFreshnessReceipt {
  if (receipts.length === 0) return freshness(null, null, "missing", "No freshness receipts are available.");
  const rank: Record<LivingSystemFreshnessReceipt["state"], number> = { current: 0, unknown: 1, stale: 2, missing: 3 };
  const worst = [...receipts].sort((left, right) => rank[right.state] - rank[left.state] || stableCompare(left.reason ?? "", right.reason ?? ""))[0];
  return { ...worst };
}

function uniqueSources(sources: LivingSystemSourceReceipt[]): LivingSystemSourceReceipt[] {
  const byIdentity = new Map<string, LivingSystemSourceReceipt>();
  for (const source of sources) {
    byIdentity.set(`${source.kind}\0${source.reference}\0${source.observedAt ?? ""}\0${source.contentHash ?? ""}\0${source.availability}`, source);
  }
  return [...byIdentity.values()].sort(sourceCompare);
}

function sourceCompare(left: LivingSystemSourceReceipt, right: LivingSystemSourceReceipt): number {
  return stableCompare(`${left.kind}\0${left.reference}\0${left.observedAt ?? ""}`, `${right.kind}\0${right.reference}\0${right.observedAt ?? ""}`);
}

function pathsOverlap(left: string, right: string): boolean {
  if (!isRepositoryPath(left) || !isRepositoryPath(right)) return false;
  const normalizedLeft = path.posix.normalize(left).replace(/\/$/, "");
  const normalizedRight = path.posix.normalize(right).replace(/\/$/, "");
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function isRepositoryPath(value: string): boolean {
  return Boolean(value) && !value.includes("://") && !path.posix.isAbsolute(value) && !value.split("/").includes("..");
}

function hashFile(filePath: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entry";
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
