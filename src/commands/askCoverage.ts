import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { ingressSourceKind, type IngressSourceKind } from "../ask/replyCapture.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import type { DecisionDoc } from "../docs/types.js";
import { validationError } from "../cli/errors.js";
import { parseTimeBound } from "../timeline/time.js";
import { defaultIngressRoot, listProcessedIngressSidecars } from "./ingress.js";

export const ASK_COVERAGE_SCHEMA = "arcadia-ask-coverage-v1";
export const DIRECT_CHAT_NOT_MEASURED = "direct chat: not measured";
export const DEFAULT_COVERAGE_WINDOW = "7d";

export interface AskCoverageOptions {
  workspace: string;
  /** ISO time or relative look-back (`7d`); default 7d. */
  since?: string;
  /** Ingress root holding the `<source>/Done` and `Failed` sidecars; default the iCloud ArcadiaIngress folder. */
  ingressRoot?: string;
  now?: Date;
}

export type CoverageSurfaceId = "ingress-files" | "discord" | "review-replies" | "decision-replies";

export interface AskCoverageSurface {
  id: CoverageSurfaceId;
  label: string;
  /** `intake` surfaces feed the numerator; `provenance` surfaces only preserve words behind a canonical write. */
  kind: Exclude<IngressSourceKind, "agent">;
  /** True only for operator-intake sources. Provenance counts are reported but never added to the intake total. */
  countsAsIntake: boolean;
  /** Captured envelopes for this surface in the window, by ingress source. */
  sources: Record<string, number>;
  captured: number;
  /** Count of the independent canonical record; null when the surface has none or it could not be read. */
  canonical: number | null;
  denominator: "known" | "unknown" | "unavailable";
  /**
   * Ingress only: canonical sidecars whose Ask capture envelope was found by shared id. Null when
   * the sidecars carry no usable id, in which case `captured` is the numerator. When set it is the
   * numerator, so the ratio cannot exceed 100%.
   */
  matched: number | null;
  /**
   * True only for an operator-intake surface with a known denominator. False means this surface's
   * captured count must not be read against the Ingress percentage (Discord has no denominator).
   */
  comparableToIntakeCoverage: boolean;
  /** (matched ?? captured) / canonical, rounded to three places; null when the denominator is unknown or zero. */
  coverage: number | null;
  canonicalRecord: string;
  note: string | null;
}

export interface AskCoverageSourceCounts {
  total: number;
  bySource: Record<string, number>;
}

export interface AskCoverageData {
  schema: typeof ASK_COVERAGE_SCHEMA;
  headline: string;
  directChat: typeof DIRECT_CHAT_NOT_MEASURED;
  window: { since: string; until: string };
  /** Sum over intake surfaces that have a known denominator. Never includes provenance, agent or unclassified envelopes. */
  intake: {
    surfaces: CoverageSurfaceId[];
    captured: number;
    canonical: number;
    coverage: number | null;
    /** Operator-intake envelopes on surfaces with no independent record: captured N, denominator unknown. */
    capturedDenominatorUnknown: number;
    /** Always false: the denominator-unknown count is not comparable to the coverage percentage. */
    capturedDenominatorUnknownComparable: false;
  };
  surfaces: AskCoverageSurface[];
  /** agent.ask and codex.* envelopes: never operator input. */
  excludedAgent: AskCoverageSourceCounts;
  /** Sources the vocabulary does not classify (`ask`, `cli.ask`, ...): not counted anywhere. */
  unclassified: AskCoverageSourceCounts;
  notes: string[];
}

interface SurfaceDefinition {
  id: CoverageSurfaceId;
  label: string;
  kind: "intake" | "provenance";
  canonicalRecord: string;
  matches: (source: string) => boolean;
}

const SURFACES: SurfaceDefinition[] = [
  {
    id: "ingress-files",
    label: "Ingress files",
    kind: "intake",
    canonicalRecord: "processed-file sidecars (Done/Failed) under the Ingress root",
    matches: (source) => source.startsWith("ingress:")
  },
  {
    id: "discord",
    label: "Discord messages",
    kind: "intake",
    canonicalRecord: "none (Discord has no independent countable record Arcadia can read)",
    matches: (source) => source === "discord.message" || source === "discord.request"
  },
  {
    id: "review-replies",
    label: "Review replies",
    kind: "provenance",
    canonicalRecord: "review_items decided (approved or rejected) in the window",
    matches: (source) => source === "operator.reply.review" || source === "operator.reply.work-question"
  },
  {
    id: "decision-replies",
    label: "Decision replies",
    kind: "provenance",
    canonicalRecord: "Decision documents answered with free text (not an offered option label) in the window",
    matches: (source) => source === "operator.reply.decision"
  }
];

export function runAskCoverageCommand(options: AskCoverageOptions): CommandSuccess<AskCoverageData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const since = parseTimeBound(options.since?.trim() || DEFAULT_COVERAGE_WINDOW, now, "--since");
  if (since.getTime() > now.getTime()) {
    throw validationError("--since is in the future; the window would be empty.", {
      flag: "--since",
      since: since.toISOString(),
      until: now.toISOString()
    });
  }
  const data = withReadOnlyDatabase(workspacePath, (db) =>
    buildAskCoverage(db, { since, until: now, ingressRoot: options.ingressRoot ?? defaultIngressRoot() })
  );
  return createSuccess({ command: "ask.coverage", workspace: workspacePath, data });
}

export function buildAskCoverage(
  db: Database.Database,
  input: { since: Date; until: Date; ingressRoot: string }
): AskCoverageData {
  const sinceIso = input.since.toISOString();
  const untilIso = input.until.toISOString();
  const inWindow = (timestamp: string): boolean => {
    const time = Date.parse(timestamp);
    return Number.isFinite(time) && time >= input.since.getTime() && time <= input.until.getTime();
  };

  const rows = db
    .prepare(
      `SELECT ingress_source AS source, COUNT(*) AS count FROM ask_capture_envelopes
       WHERE captured_at >= ? AND captured_at <= ? GROUP BY ingress_source`
    )
    .all(sinceIso, untilIso) as Array<{ source: string; count: number }>;

  const excludedAgent: AskCoverageSourceCounts = { total: 0, bySource: {} };
  const unclassified: AskCoverageSourceCounts = { total: 0, bySource: {} };
  const bySurface = new Map<CoverageSurfaceId, Record<string, number>>();
  for (const { source, count } of rows) {
    const kind = ingressSourceKind(source);
    if (kind === "agent") {
      excludedAgent.total += count;
      excludedAgent.bySource[source] = count;
      continue;
    }
    const surface = kind === null ? undefined : SURFACES.find((candidate) => candidate.matches(source));
    if (!surface) {
      unclassified.total += count;
      unclassified.bySource[source] = count;
      continue;
    }
    bySurface.set(surface.id, { ...(bySurface.get(surface.id) ?? {}), [source]: count });
  }

  const notes: string[] = [];
  const canonicalFor = (
    id: CoverageSurfaceId
  ): { count: number | null; state: "known" | "unknown" | "unavailable"; note: string | null; matched?: number } => {
    if (id === "discord") {
      return {
        count: null,
        state: "unknown",
        note: "Captured N, denominator unknown. Not comparable to the Ingress percentage: this count says nothing about coverage."
      };
    }
    if (id === "review-replies") {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM review_items WHERE status IN ('approved', 'rejected') AND decided_at >= ? AND decided_at <= ?")
        .get(sinceIso, untilIso) as { count: number };
      return {
        count: row.count,
        state: "known",
        note: "Counts every decided review item, including decisions made without free text (those are never captured), so this ratio is a floor."
      };
    }
    if (id === "decision-replies") return decisionCanonical(db, input.since, input.until);
    const sidecars = listProcessedIngressSidecars(input.ingressRoot);
    if (sidecars === null) {
      return { count: null, state: "unavailable", note: `Ingress root not found: ${input.ingressRoot}. Pass --ingress-root.` };
    }
    const counted = sidecars.filter((item) => item.status !== "skipped" && inWindow(item.timestamp));
    // Match by shared id when every counted sidecar names one; otherwise fall back to comparing counts.
    if (!counted.every((item) => (item.captureIds ?? []).length > 0)) {
      return {
        count: counted.length,
        state: "known",
        note: "Empty skipped requests are not counted. A file captured but not yet processed raises captured above canonical."
      };
    }
    const envelopes = db
      .prepare("SELECT id, request_id AS requestId, captured_at AS capturedAt FROM ask_capture_envelopes WHERE ingress_source LIKE 'ingress:%'")
      .all() as Array<{ id: string; requestId: string; capturedAt: string }>;
    const envelopeIds = new Set(envelopes.flatMap((envelope) => [envelope.id, envelope.requestId]));
    const sidecarIds = new Set(sidecars.flatMap((item) => item.captureIds ?? []));
    const matched = counted.filter((item) => (item.captureIds ?? []).some((captureId) => envelopeIds.has(captureId))).length;
    const unprocessed = envelopes.filter(
      (envelope) => inWindow(envelope.capturedAt) && !sidecarIds.has(envelope.id) && !sidecarIds.has(envelope.requestId)
    ).length;
    return {
      count: counted.length,
      matched,
      state: "known",
      note: [
        "Processed files are matched to Ask capture envelopes by shared id, so the ratio cannot exceed 100%. Empty skipped requests are not counted.",
        unprocessed > 0 ? `${unprocessed} captured envelope${unprocessed === 1 ? "" : "s"} in the window have no processed file yet.` : null
      ].filter(Boolean).join(" ")
    };
  };

  const surfaces: AskCoverageSurface[] = SURFACES.map((definition) => {
    const sources = bySurface.get(definition.id) ?? {};
    const captured = Object.values(sources).reduce((sum, count) => sum + count, 0);
    const canonical = canonicalFor(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      countsAsIntake: definition.kind === "intake",
      sources,
      captured,
      canonical: canonical.count,
      denominator: canonical.state,
      matched: canonical.matched ?? null,
      comparableToIntakeCoverage: definition.kind === "intake" && canonical.state === "known",
      coverage:
        canonical.count !== null && canonical.count > 0
          ? Math.round(((canonical.matched ?? captured) / canonical.count) * 1000) / 1000
          : null,
      canonicalRecord: definition.canonicalRecord,
      note: canonical.note
    };
  });

  const measuredIntake = surfaces.filter((surface) => surface.countsAsIntake && surface.denominator === "known");
  const intakeCaptured = measuredIntake.reduce((sum, surface) => sum + (surface.matched ?? surface.captured), 0);
  const intakeCanonical = measuredIntake.reduce((sum, surface) => sum + (surface.canonical ?? 0), 0);
  const unmeasured = surfaces
    .filter((surface) => surface.countsAsIntake && surface.denominator !== "known")
    .reduce((sum, surface) => sum + surface.captured, 0);

  notes.push(
    "Numerator counts only sources marked operator intake. Review and Decision replies are provenance-only: their envelopes preserve words behind a canonical write and are shown per surface, never added to the intake total.",
    "agent.ask and codex.* envelopes are excluded and reported separately; sources the vocabulary does not classify are reported, not counted."
  );

  return {
    schema: ASK_COVERAGE_SCHEMA,
    headline: `Operator input coverage, ${sinceIso} to ${untilIso}. ${DIRECT_CHAT_NOT_MEASURED}: this is not the share of all operator input.`,
    directChat: DIRECT_CHAT_NOT_MEASURED,
    window: { since: sinceIso, until: untilIso },
    intake: {
      surfaces: measuredIntake.map((surface) => surface.id),
      captured: intakeCaptured,
      canonical: intakeCanonical,
      coverage: intakeCanonical > 0 ? Math.round((intakeCaptured / intakeCanonical) * 1000) / 1000 : null,
      capturedDenominatorUnknown: unmeasured,
      capturedDenominatorUnknownComparable: false
    },
    surfaces,
    excludedAgent,
    unclassified,
    notes
  };
}

/**
 * Decision documents are the canonical record of a Decision reply. Only an
 * answer that is not one of the Decision's offered option labels is free text,
 * the only kind `decision approve` captures. `decided` is a date, so the window
 * is applied at date granularity.
 */
function decisionCanonical(
  db: Database.Database,
  since: Date,
  until: Date
): { count: number | null; state: "known" | "unavailable"; note: string | null } {
  const sinceDate = since.toISOString().slice(0, 10);
  const untilDate = until.toISOString().slice(0, 10);
  const repos = new Set<string>();
  const skipped: string[] = [];
  for (const project of listProjects(db)) {
    const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim();
    if (!repoPath) continue;
    if (existsSync(repoPath)) repos.add(repoPath);
    else skipped.push(project.slug);
  }
  if (repos.size === 0) {
    return { count: null, state: "unavailable", note: "No Project repository is readable, so Decision documents cannot be counted." };
  }
  const counted = new Set<string>();
  for (const repoPath of repos) {
    try {
      for (const doc of discoverDocs(repoPath).docs) {
        if (doc.type !== "decision") continue;
        if (isFreeTextAnswer(doc) && doc.decided !== null && doc.decided >= sinceDate && doc.decided <= untilDate) {
          counted.add(`${repoPath}:${doc.id}`);
        }
      }
    } catch {
      skipped.push(repoPath);
    }
  }
  return {
    count: counted.size,
    state: "known",
    note: [
      "Decision `decided` is a date, so the window is applied by day.",
      skipped.length > 0 ? `Unreadable repositories skipped: ${skipped.join(", ")}.` : null
    ].filter(Boolean).join(" ")
  };
}

function isFreeTextAnswer(doc: DecisionDoc): boolean {
  if (doc.status === "open" || !doc.answer?.trim()) return false;
  const answer = doc.answer.trim().toLowerCase();
  return !doc.options.some((option) => option.label.trim().toLowerCase() === answer);
}

export function renderAskCoverageSuccess(response: CommandSuccess<AskCoverageData>): string[] {
  const data = response.data;
  const lines = [data.headline, ""];
  for (const surface of data.surfaces) {
    const label = `${surface.label} (${surface.kind === "intake" ? "operator intake" : "provenance-only, not counted as intake"})`;
    if (surface.denominator === "known" && surface.canonical !== null) {
      const percent = surface.coverage === null ? "n/a" : `${(surface.coverage * 100).toFixed(1)}%`;
      const matchedText = surface.matched === null ? "" : `, ${surface.matched} matched by id`;
      lines.push(`${label}: captured ${surface.captured} of ${surface.canonical} canonical (${percent}${matchedText})`);
    } else if (surface.denominator === "unavailable") {
      lines.push(`${label}: captured ${surface.captured}, denominator unavailable`);
    } else {
      lines.push(`${label}: captured ${surface.captured}, denominator unknown (not comparable to the Ingress percentage)`);
    }
    for (const [source, count] of Object.entries(surface.sources)) lines.push(`    ${source}: ${count}`);
    if (surface.note) lines.push(`    ${surface.note}`);
  }
  lines.push(
    "",
    data.intake.surfaces.length > 0
      ? `Measured operator intake (${data.intake.surfaces.join(", ")}): captured ${data.intake.captured} of ${data.intake.canonical} canonical` +
          (data.intake.coverage === null ? "" : ` (${(data.intake.coverage * 100).toFixed(1)}%)`)
      : "Measured operator intake: no surface with a readable canonical record",
    `Operator intake with denominator unknown: ${data.intake.capturedDenominatorUnknown} captured (not comparable to the percentage above)`,
    `Excluded, agent-written (agent.ask, codex.*): ${data.excludedAgent.total}${formatBySource(data.excludedAgent)}`,
    `Not classified (not counted): ${data.unclassified.total}${formatBySource(data.unclassified)}`,
    "",
    ...data.notes
  );
  return lines;
}

function formatBySource(counts: AskCoverageSourceCounts): string {
  const entries = Object.entries(counts.bySource);
  return entries.length === 0 ? "" : ` (${entries.map(([source, count]) => `${source} ${count}`).join(", ")})`;
}
