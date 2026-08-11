import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Artifact } from "../domain/types.js";
import { validationError } from "../cli/errors.js";
import { slugify } from "../utils/slug.js";
import { loadWorkspaceConfig } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export const ARCADIA_VAULT_README = `# Arcadia Memory

This subtree is generated and managed by Arcadia. SQLite remains Arcadia's operational source of truth; these Records and Ideas are durable, human-readable long-term-memory projections.

Accepted Records may be linked or indexed elsewhere in this vault, and independent notes may link to them freely. Files under \`Arcadia/Records/\` and \`Arcadia/Ideas/\` should not be renamed, moved, or edited by automated organizers because Arcadia owns their complete generated contents.

Deleting or changing a Record does not change Arcadia operational state. Run \`arcadia memory sync --workspace <path>\` to restore missing or stale managed Records.
`;

interface MemoryRow {
  decision_id: string;
  decision_status: string;
  decision_created_at: string;
  decided_at: string | null;
  context_json: string | null;
  artifact_id: string;
  artifact_title: string;
  artifact_type: string;
  artifact_status: string;
  artifact_path: string;
  artifact_created_at: string;
  project_id: string;
  project_name: string;
  action_id: string;
  action_title: string;
  action_raw_input: string;
  action_expected_artifact: string | null;
  action_status: string;
  action_next_action: string;
  milestone_title: string | null;
  run_id: string | null;
  mission_log_id: string | null;
  mission_log_path: string | null;
  validation_artifact_id: string | null;
}

export type MemorySyncStatus = "created" | "updated" | "skipped" | "failed";

export interface MemorySyncEntry {
  artifactId: string;
  artifactTitle: string;
  project: string;
  status: MemorySyncStatus;
  recordPath: string | null;
  error: string | null;
}

export interface MemorySyncResult {
  enabled: boolean;
  dryRun: boolean;
  vaultPath: string | null;
  entries: MemorySyncEntry[];
  counts: Record<MemorySyncStatus, number>;
}

export interface IngressMemoryNoteInput {
  title: string;
  content: string;
  source: string;
  sourcePath: string;
  capturedAt: string;
  classification: string;
  status: string;
  tags: string[];
  askId?: string | null;
  backBurnerItemId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  actionId?: string | null;
  actionTitle?: string | null;
  nextAction?: string | null;
  finalPath?: string | null;
}

export interface IngressMemoryNoteResult {
  notePath: string;
  status: "created" | "updated";
}

interface VaultTarget {
  vaultPath: string;
  arcadiaRoot: string;
  recordsRoot: string;
  ideasRoot: string;
}

export function writeIngressMemoryNote(
  workspace: string,
  input: IngressMemoryNoteInput
): IngressMemoryNoteResult | null {
  const target = resolveVaultTarget(workspace);
  if (!target) return null;

  const identity = input.backBurnerItemId ?? input.askId ?? `${input.sourcePath}:${input.capturedAt}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.capturedAt.slice(0, 10)) ? input.capturedAt.slice(0, 10) : "undated";
  const notePath = path.join(
    target.ideasRoot,
    `${date}-${slugify(input.title)}--${identity.replace(/[^A-Za-z0-9_-]+/g, "_")}.md`
  );
  assertDestinationSafe(target, notePath);
  const content = renderIngressMemoryNote(input);
  const current = existsSync(notePath) && statSync(notePath).isFile() ? readFileSync(notePath, "utf8") : null;
  const status = current === null ? "created" : "updated";
  if (current !== content) atomicWrite(target, notePath, content);
  writeManagedReadme(target);
  return { notePath, status };
}

export function syncAcceptedPlanningArtifacts(
  db: Database.Database,
  workspace: string,
  options: { dryRun?: boolean } = {}
): MemorySyncResult {
  const target = resolveVaultTarget(workspace);
  const dryRun = options.dryRun === true;
  if (!target) {
    return emptyResult(dryRun);
  }
  const rows = listAcceptedRows(db);
  const entries = rows.map((row) => {
    try {
      return exportRow(workspace, target, row, { dryRun, acceptedAt: row.decided_at ?? row.decision_created_at });
    } catch (error) {
      return failedEntry(row, error);
    }
  });
  if (!dryRun) {
    writeManagedReadme(target);
  }
  return resultForEntries(target, dryRun, entries);
}

export function exportPlanningAcceptanceBeforeTransition(
  db: Database.Database,
  workspace: string,
  decisionId: string,
  acceptedAt: string
): MemorySyncEntry | null {
  const target = resolveVaultTarget(workspace);
  if (!target) {
    return null;
  }
  const row = getAcceptanceRow(db, decisionId);
  if (!row) {
    throw validationError("Plan acceptance Decision is missing linked planning memory data.", { decisionId });
  }
  const entry = exportRow(workspace, target, row, { dryRun: false, acceptedAt });
  writeManagedReadme(target);
  return entry;
}

export interface ProgressReviewRecordInput {
  /** The Project reviewed, or `null` for a portfolio-wide review. */
  project: { id: string; name: string; slug: string } | null;
  window: { since: string; until: string };
  generatedAt: string;
  /** Workspace-relative path of the report this Record projects. */
  reportPath: string;
  /** The rendered report, exactly as written to the workspace. */
  content: string;
}

export interface NarrativeDigestRecordInput {
  /** The durable digest identity and its explicit half-open activity window. */
  digest: {
    id: string;
    period: "day" | "week" | "month";
    windowStart: string;
    windowEnd: string;
  };
  /** The Arcadia-owned Artifact containing the narrated Markdown. */
  artifact: Artifact;
  /**
   * What the digest is about. For the collective roll-up this is the synthetic
   * portfolio subject rather than a real Project row, which `scope` below
   * distinguishes so a vault reader is never told the roll-up is a Project.
   */
  project: { id: string; name: string; slug: string };
  scope?: "project" | "portfolio";
}

export interface OrientationPacketRecordInput {
  packet: {
    id: string;
    localDate: string;
    body: string;
    createdAt: string;
    discordMessageId: string | null;
  };
  /** Used when backfilling a packet that was composed before AI summaries existed. */
  supplementalAiSummary?: { headline: string; paragraph: string } | null;
}

/**
 * Project a compiled progress review into the vault.
 *
 * Unlike an accepted planning Artifact, this is **not** gated behind a
 * Decision, and deliberately so: a progress review is a deterministic
 * compilation of Logs, Actions, and Artifacts that already happened. There is
 * no model output to accept and no judgment to exercise — asking the operator
 * to approve a summation of facts would be ceremony, not a safeguard. The
 * acceptance gate exists for generated content; this is arithmetic.
 *
 * Returns `null` when the workspace has not opted into vault memory.
 */
export function exportProgressReview(
  workspace: string,
  input: ProgressReviewRecordInput,
  options: { dryRun?: boolean } = {}
): MemorySyncEntry | null {
  const target = resolveVaultTarget(workspace);
  if (!target) {
    return null;
  }

  const content = canonicalMarkdown(input.content);
  const scope = input.project ? input.project.slug : PORTFOLIO_SCOPE;
  const title = input.project
    ? `${input.project.name} progress, ${input.window.since} to ${input.window.until}`
    : `Portfolio progress, ${input.window.since} to ${input.window.until}`;
  // One Record per scope and window: re-running the same review updates it in
  // place rather than accumulating near-identical notes in the vault.
  const reviewKey = `${scope}/${input.window.since}..${input.window.until}`;
  const recordPath = path.join(
    target.recordsRoot,
    "Progress",
    slugify(scope),
    input.window.until.slice(0, 4),
    `${input.window.until}-progress-review.md`
  );
  assertDestinationSafe(target, recordPath);

  const current = existsSync(recordPath) && statSync(recordPath).isFile()
    ? readFileSync(recordPath, "utf8")
    : null;

  // Same guard the planning export uses: never clobber a Record that belongs
  // to a different review, however the paths came to collide.
  const claimedKey = current?.match(/^arcadia_review_key:\s+"([^"]+)"$/m)?.[1] ?? null;
  if (claimedKey && claimedKey !== reviewKey) {
    throw validationError("Refusing to overwrite a vault Record owned by a different progress review.", {
      recordPath,
      reviewKey,
      claimedKey
    });
  }

  // Hashed over the report with its generation timestamp removed, so re-running
  // a review that found nothing new is a no-op. Comparing whole rendered
  // Records would differ on the timestamp alone and rewrite the file — and a
  // vault that churns on every run is one the operator stops trusting as a
  // record of what actually changed.
  const contentHash = createHash("sha256").update(withoutVolatileLines(content)).digest("hex");
  const claimedHash = current?.match(/^content_sha256:\s+"([0-9a-f]+)"$/m)?.[1] ?? null;
  const status: MemorySyncStatus =
    current === null ? "created" : claimedHash === contentHash ? "skipped" : "updated";

  if (options.dryRun !== true && status !== "skipped") {
    atomicWrite(target, recordPath, renderProgressReviewRecord(input, title, reviewKey, contentHash));
    writeManagedReadme(target);
  }

  return {
    artifactId: reviewKey,
    artifactTitle: title,
    project: input.project?.name ?? "Portfolio",
    status,
    recordPath,
    error: null
  };
}

/**
 * Project one composed, AI-narrated digest into the vault.
 *
 * The digest Artifact remains the source record in the Arcadia workspace. This
 * function only makes a guarded, human-readable projection of it; it never
 * asks a model to narrate again or writes into the managed Project repository.
 */
export function exportNarrativeDigest(
  workspace: string,
  input: NarrativeDigestRecordInput,
  options: { dryRun?: boolean } = {}
): MemorySyncEntry | null {
  const target = resolveVaultTarget(workspace);
  if (!target) return null;
  if (input.artifact.artifact_type !== "narrative_digest") {
    throw validationError("Only narrative_digest Artifacts can be exported as narrative digest Records.", {
      artifactId: input.artifact.id,
      artifactType: input.artifact.artifact_type
    });
  }
  if (!input.artifact.path) {
    throw validationError("Narrative digest Artifact has no source Markdown path.", { artifactId: input.artifact.id });
  }

  const content = canonicalMarkdown(readFileSync(safeWorkspaceFile(workspace, input.artifact.path, "narrative digest Artifact"), "utf8"));
  const digestKey = `${input.project.slug}/${input.digest.period}/${input.digest.windowStart}..${input.digest.windowEnd}`;
  const title = `${input.project.name} ${input.digest.period} digest, ${input.digest.windowStart} to ${input.digest.windowEnd}`;
  const recordPath = path.join(
    target.recordsRoot,
    "Narrative Digests",
    slugify(input.project.slug),
    input.digest.windowEnd.slice(0, 4),
    input.digest.period,
    `${input.digest.windowEnd.slice(0, 10)}-narrative-digest.md`
  );
  assertDestinationSafe(target, recordPath);

  const current = existsSync(recordPath) && statSync(recordPath).isFile()
    ? readFileSync(recordPath, "utf8")
    : null;
  const claimedKey = current?.match(/^arcadia_digest_key:\s+"([^"]+)"$/m)?.[1] ?? null;
  if (claimedKey && claimedKey !== digestKey) {
    throw validationError("Refusing to overwrite a vault Record owned by a different narrative digest.", {
      recordPath,
      digestKey,
      claimedKey
    });
  }

  const contentHash = createHash("sha256").update(content).digest("hex");
  const claimedHash = current?.match(/^content_sha256:\s+"([0-9a-f]+)"$/m)?.[1] ?? null;
  const status: MemorySyncStatus = current === null ? "created" : claimedHash === contentHash ? "skipped" : "updated";
  if (options.dryRun !== true && status !== "skipped") {
    atomicWrite(target, recordPath, renderNarrativeDigestRecord(input, title, digestKey, contentHash, content));
    writeManagedReadme(target);
  }

  return {
    artifactId: input.artifact.id,
    artifactTitle: input.artifact.title,
    project: input.project.name,
    status,
    recordPath,
    error: null
  };
}

/** Project a durable Morning Packet into Obsidian without changing its sent Discord body. */
export function exportOrientationPacket(
  workspace: string,
  input: OrientationPacketRecordInput,
  options: { dryRun?: boolean } = {}
): MemorySyncEntry | null {
  const target = resolveVaultTarget(workspace);
  if (!target) return null;
  const orientationKey = input.packet.localDate;
  const title = `Morning orientation — ${input.packet.localDate}`;
  const recordPath = path.join(
    target.recordsRoot,
    "Orientation",
    input.packet.localDate.slice(0, 4),
    `${input.packet.localDate}-morning-orientation.md`
  );
  assertDestinationSafe(target, recordPath);
  const current = existsSync(recordPath) && statSync(recordPath).isFile()
    ? readFileSync(recordPath, "utf8")
    : null;
  const claimedKey = current?.match(/^arcadia_orientation_key:\s+"([^"]+)"$/m)?.[1] ?? null;
  if (claimedKey && claimedKey !== orientationKey) {
    throw validationError("Refusing to overwrite a vault Record owned by a different Morning Packet.", {
      recordPath,
      orientationKey,
      claimedKey
    });
  }
  const content = renderOrientationPacketRecord(input, title, orientationKey);
  const contentHash = createHash("sha256").update(content.replace(/^content_sha256:.*$/m, "content_sha256:")).digest("hex");
  const rendered = content.replace('content_sha256: "pending"', yaml("content_sha256", contentHash));
  const claimedHash = current?.match(/^content_sha256:\s+"([0-9a-f]+)"$/m)?.[1] ?? null;
  const status: MemorySyncStatus = current === null ? "created" : claimedHash === contentHash ? "skipped" : "updated";
  if (options.dryRun !== true && status !== "skipped") {
    atomicWrite(target, recordPath, rendered);
    writeManagedReadme(target);
  }
  return {
    artifactId: input.packet.id,
    artifactTitle: title,
    project: "Portfolio",
    status,
    recordPath,
    error: null
  };
}

/** Vault folder name for reviews that cover every Project rather than one. */
const PORTFOLIO_SCOPE = "portfolio";

/**
 * Strip lines that change on every run regardless of what happened, so two
 * reviews of an unchanged window hash identically.
 */
function withoutVolatileLines(markdown: string): string {
  return markdown.replace(/^Generated:.*$/gm, "");
}

/** Drop a document's opening `# Heading`, leaving the rest untouched. */
function withoutLeadingHeading(markdown: string): string {
  return markdown.replace(/^#\s+[^\n]*\n+/, "").trimEnd();
}

/** An Artifact's metadata belongs to the source, not inside its vault Record. */
function withoutLeadingFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

function renderProgressReviewRecord(
  input: ProgressReviewRecordInput,
  title: string,
  reviewKey: string,
  contentHash: string
): string {
  const content = canonicalMarkdown(input.content);
  const lines = [
    "---",
    "arcadia_record: true",
    "record_type: progress_review",
    yaml("arcadia_review_key", reviewKey),
    yamlNullable("arcadia_project_id", input.project?.id ?? null),
    yaml("project", input.project?.name ?? "Portfolio"),
    yaml("window_since", input.window.since),
    yaml("window_until", input.window.until),
    yaml("generated_at", input.generatedAt),
    yaml("source_report_path", input.reportPath),
    yaml("content_sha256", contentHash),
    "---",
    "",
    `# ${title}`,
    "",
    // The report opens with its own H1, which would render as a second title
    // under this Record's. The Record's title carries the window, so it wins.
    withoutLeadingHeading(content),
    "",
    "## Provenance",
    "",
    `- Compiled deterministically by \`arcadia review weekly\` on ${input.generatedAt}.`,
    `- Source report: ${input.reportPath}`,
    "- SQLite remains operational truth; this Record is a projection and is safe to delete.",
    ""
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function renderNarrativeDigestRecord(
  input: NarrativeDigestRecordInput,
  title: string,
  digestKey: string,
  contentHash: string,
  content: string
): string {
  const lines = [
    "---",
    "arcadia_record: true",
    "record_type: narrative_digest",
    "narration: local_preferred_ai",
    yaml("arcadia_digest_key", digestKey),
    yaml("arcadia_digest_id", input.digest.id),
    yaml("arcadia_digest_scope", input.scope ?? "project"),
    yaml("arcadia_artifact_id", input.artifact.id),
    // The portfolio roll-up belongs to no Project row; naming one here would
    // make the vault claim a link that does not exist in the database.
    yamlNullable("arcadia_project_id", input.scope === "portfolio" ? null : input.project.id),
    yaml("subject", input.project.name),
    yamlNullable("project", input.scope === "portfolio" ? null : input.project.name),
    yaml("period", input.digest.period),
    yaml("window_start", input.digest.windowStart),
    yaml("window_end", input.digest.windowEnd),
    yaml("source_artifact_path", input.artifact.path ?? ""),
    yaml("content_sha256", contentHash),
    "---",
    "",
    `# ${title}`,
    "",
    withoutLeadingHeading(withoutLeadingFrontmatter(content)),
    "",
    "## Provenance",
    "",
    "- AI-narrated from the digest's bounded Arcadia fact snapshot, using the local-preferred Intelligence route.",
    `- Digest: ${input.digest.id}`,
    `- Artifact: ${input.artifact.id} (${input.artifact.path})`,
    "- SQLite and the source Artifact remain operational truth; this Record is a projection and is safe to delete.",
    ""
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function renderOrientationPacketRecord(
  input: OrientationPacketRecordInput,
  title: string,
  orientationKey: string
): string {
  const hasEmbeddedAi = /^\*\*AI perspective\b/m.test(input.packet.body);
  const supplemental = input.supplementalAiSummary;
  const lines = [
    "---",
    "arcadia_record: true",
    "record_type: morning_orientation",
    yaml("arcadia_orientation_key", orientationKey),
    yaml("arcadia_packet_id", input.packet.id),
    yaml("local_date", input.packet.localDate),
    yaml("created_at", input.packet.createdAt),
    yamlNullable("discord_message_id", input.packet.discordMessageId),
    `ai_summary: ${hasEmbeddedAi || supplemental ? "present" : "unavailable"}`,
    'content_sha256: "pending"',
    "---",
    "",
    `# ${title}`,
    "",
    ...(supplemental ? [
      `## AI perspective — ${supplemental.headline}`,
      "",
      supplemental.paragraph,
      ""
    ] : []),
    "## Morning Packet",
    "",
    canonicalMarkdown(input.packet.body).trimEnd(),
    "",
    "## Provenance",
    "",
    "- The portfolio stand-up and planning sections were compiled deterministically from durable Arcadia records.",
    ...(hasEmbeddedAi || supplemental
      ? ["- The clearly labelled AI perspective used Arcadia's bounded local-preferred Intelligence route; it may interpret implications but must not invent activity."]
      : ["- AI perspective was unavailable; the deterministic packet remains complete and deliverable."]),
    `- Packet: ${input.packet.id}`,
    "- SQLite remains operational truth; this Record is a projection and is safe to delete.",
    ""
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function resolveVaultTarget(workspace: string): VaultTarget | null {
  const paths = getWorkspacePaths(workspace);
  const config = loadWorkspaceConfig(paths.configFile);
  if (!config.memory?.enabled) {
    return null;
  }
  const configured = config.memory.obsidianVaultPath?.trim();
  if (!configured) {
    throw validationError("Workspace memory is enabled but memory.obsidianVaultPath is missing.", {
      configPath: paths.configFile
    });
  }
  if (!path.isAbsolute(configured)) {
    throw validationError("Workspace memory.obsidianVaultPath must be an absolute path.", { configured });
  }
  if (!existsSync(configured) || !statSync(configured).isDirectory()) {
    throw validationError("Configured Obsidian vault directory does not exist.", { configured });
  }
  const vaultPath = realpathSync(configured);
  const workspacePath = realpathSync(workspace);
  const obsidianPath = path.join(vaultPath, ".obsidian");
  if (!existsSync(obsidianPath) || !statSync(obsidianPath).isDirectory()) {
    throw validationError("Configured memory path is not an Obsidian vault; .obsidian/ is missing.", { vaultPath });
  }
  if (isInside(vaultPath, workspacePath) || isInside(workspacePath, vaultPath)) {
    throw validationError("The Obsidian vault and Arcadia operational workspace must not contain one another.", {
      workspace: workspacePath,
      vaultPath
    });
  }
  const arcadiaRoot = path.join(vaultPath, "Arcadia");
  const recordsRoot = path.join(arcadiaRoot, "Records");
  const ideasRoot = path.join(arcadiaRoot, "Ideas");
  assertExistingPathSafe(vaultPath, arcadiaRoot);
  assertExistingPathSafe(vaultPath, recordsRoot);
  assertExistingPathSafe(vaultPath, ideasRoot);
  return { vaultPath, arcadiaRoot, recordsRoot, ideasRoot };
}

function exportRow(
  workspace: string,
  target: VaultTarget,
  row: MemoryRow,
  options: { dryRun: boolean; acceptedAt: string }
): MemorySyncEntry {
  if (row.artifact_type !== "planning_artifact") {
    throw validationError("Only planning Artifacts can be exported to long-term memory.", {
      artifactId: row.artifact_id,
      artifactType: row.artifact_type
    });
  }
  const sourceArtifact = safeWorkspaceFile(workspace, row.artifact_path, "planning Artifact");
  const planningContent = canonicalMarkdown(readFileSync(sourceArtifact, "utf8"));
  const context = parseContext(row.context_json);
  const validationPath = stringOrNull(context.validationResultPath);
  if (!validationPath) {
    throw validationError("Planning acceptance Decision is missing Validation evidence.", { decisionId: row.decision_id });
  }
  const validationFile = safeWorkspaceFile(workspace, validationPath, "planning Validation evidence");
  const validation = JSON.parse(readFileSync(validationFile, "utf8")) as { status?: unknown };
  if (validation.status !== "passed") {
    throw validationError("Planning Artifact cannot be exported because deterministic Validation did not pass.", {
      artifactId: row.artifact_id,
      validationStatus: validation.status ?? null
    });
  }
  const existing = findRecordByArtifactId(target.recordsRoot, row.artifact_id);
  const recordPath = existing ?? expectedRecordPath(target, row);
  assertDestinationSafe(target, recordPath);
  const record = renderRecord(row, planningContent, validationPath, options.acceptedAt);
  const current = existsSync(recordPath) && statSync(recordPath).isFile() ? readFileSync(recordPath, "utf8") : null;
  const claimedArtifactId = current?.match(/^arcadia_artifact_id:\s+"([^"]+)"$/m)?.[1] ?? null;
  if (claimedArtifactId && claimedArtifactId !== row.artifact_id) {
    throw validationError("Refusing to overwrite a vault Record owned by a different Artifact ID.", {
      recordPath,
      artifactId: row.artifact_id,
      claimedArtifactId
    });
  }
  const status: MemorySyncStatus = current === null ? "created" : current === record ? "skipped" : "updated";
  if (!options.dryRun && status !== "skipped") {
    atomicWrite(target, recordPath, record);
  }
  return {
    artifactId: row.artifact_id,
    artifactTitle: row.artifact_title,
    project: row.project_name,
    status,
    recordPath,
    error: null
  };
}

function renderRecord(row: MemoryRow, planningContent: string, validationPath: string, acceptedAt: string): string {
  const contentHash = createHash("sha256").update(planningContent).digest("hex");
  const actionStatus = row.decision_status === "approved" ? row.action_status : "done";
  const nextAction = row.decision_status === "approved"
    ? row.action_next_action
    : "Plan accepted; choose the next implementation Action when ready.";
  const lines = [
    "---",
    "arcadia_record: true",
    "record_type: accepted_planning_artifact",
    yaml("arcadia_artifact_id", row.artifact_id),
    yaml("arcadia_project_id", row.project_id),
    yaml("arcadia_action_id", row.action_id),
    yamlNullable("arcadia_run_id", row.run_id),
    yaml("arcadia_decision_id", row.decision_id),
    yaml("project", row.project_name),
    yaml("action", row.action_title),
    "artifact_status: ready",
    yaml("accepted_at", acceptedAt),
    yaml("source_artifact_path", row.artifact_path),
    yamlNullable("source_log_path", row.mission_log_path),
    yaml("content_sha256", contentHash),
    "---",
    "",
    `# ${row.artifact_title}`,
    "",
    "## Context",
    "",
    `- Project: ${row.project_name}`,
    ...(row.milestone_title ? [`- Milestone: ${row.milestone_title}`] : []),
    `- Original Action: ${row.action_title}`,
    `- Expected Artifact: ${row.action_expected_artifact ?? row.artifact_title}`,
    `- Why it mattered: ${singleLine(row.action_raw_input)}`,
    "",
    "## Accepted Planning Artifact",
    "",
    planningContent.trimEnd(),
    "",
    "## Outcome",
    "",
    `Deterministic Validation passed and the user accepted this planning Artifact. The original Action is ${actionStatus}; next Action: ${nextAction}`,
    "",
    "## Provenance",
    "",
    `- Artifact: ${row.artifact_id} (${row.artifact_path})`,
    `- Action: ${row.action_id}`,
    `- Run: ${row.run_id ?? "None"}`,
    `- Decision: ${row.decision_id}`,
    `- Validation: ${row.validation_artifact_id ?? "Unrecorded Artifact ID"} (${validationPath})`,
    `- Log: ${row.mission_log_id ?? "None"}${row.mission_log_path ? ` (${row.mission_log_path})` : ""}`,
    ""
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function listAcceptedRows(db: Database.Database): MemoryRow[] {
  return db.prepare(`${memorySelectSql()} WHERE ri.resolved_intent = 'CodexPlanningArtifactAcceptance' AND ri.status = 'approved' ORDER BY ri.decided_at, ri.id`)
    .all() as MemoryRow[];
}

function getAcceptanceRow(db: Database.Database, decisionId: string): MemoryRow | null {
  return (db.prepare(`${memorySelectSql()} WHERE ri.id = ? AND ri.resolved_intent = 'CodexPlanningArtifactAcceptance'`).get(decisionId) as MemoryRow | undefined) ?? null;
}

function memorySelectSql(): string {
  return `SELECT
    ri.id AS decision_id, ri.status AS decision_status, ri.created_at AS decision_created_at,
    ri.decided_at, ri.context_json,
    a.id AS artifact_id, a.title AS artifact_title, a.artifact_type, a.status AS artifact_status,
    a.path AS artifact_path, a.created_at AS artifact_created_at,
    p.id AS project_id, p.name AS project_name,
    wi.id AS action_id, wi.title AS action_title, wi.raw_input AS action_raw_input,
    wi.expected_artifact AS action_expected_artifact,
    wi.status AS action_status, wi.next_action AS action_next_action,
    m.title AS milestone_title,
    er.id AS run_id, er.mission_log_id, ml.markdown_path AS mission_log_path,
    va.id AS validation_artifact_id
  FROM review_items ri
  JOIN artifacts a ON a.id = ri.artifact_id
  JOIN projects p ON p.id = ri.project_id
  JOIN work_items wi ON wi.id = ri.work_item_id
  LEFT JOIN milestones m ON m.id = wi.milestone_id
  LEFT JOIN execution_runs er ON er.id = json_extract(ri.context_json, '$.runId')
  LEFT JOIN mission_logs ml ON ml.id = er.mission_log_id
  LEFT JOIN artifacts va ON va.work_item_id = wi.id
    AND va.artifact_type = 'planning_artifact_validation'
    AND va.path = json_extract(ri.context_json, '$.validationResultPath')`;
}

function expectedRecordPath(target: VaultTarget, row: MemoryRow): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(row.artifact_created_at)?.[0] ?? "undated";
  const year = date.slice(0, 4);
  const identity = row.artifact_id.replace(/[^A-Za-z0-9_-]+/g, "_");
  return path.join(target.recordsRoot, slugify(row.project_name), year, `${date}-${slugify(row.artifact_title)}--${identity}.md`);
}

function findRecordByArtifactId(recordsRoot: string, artifactId: string): string | null {
  if (!existsSync(recordsRoot)) return null;
  const matches: string[] = [];
  walkMarkdown(recordsRoot, (filePath) => {
    const prefix = readFileSync(filePath, "utf8").slice(0, 8192);
    if (prefix.includes(`arcadia_artifact_id: ${JSON.stringify(artifactId)}`)) matches.push(filePath);
  });
  matches.sort();
  if (matches.length > 1) {
    throw validationError("Multiple Arcadia vault Records claim the same Artifact ID.", { artifactId, paths: matches });
  }
  return matches[0] ?? null;
}

function walkMarkdown(directory: string, visit: (filePath: string) => void): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(entryPath, visit);
    else if (entry.isFile() && entry.name.endsWith(".md")) visit(entryPath);
  }
}

/**
 * Resolve a workspace-relative Artifact path, refusing anything that escapes
 * the operational workspace. Exported so every reader of an Artifact's stored
 * path goes through the same containment check rather than a second one.
 */
export function safeWorkspaceFile(workspace: string, relativePath: string, label: string): string {
  if (path.isAbsolute(relativePath)) {
    throw validationError(`The ${label} path must be workspace-relative.`, { path: relativePath });
  }
  const root = realpathSync(workspace);
  const candidate = path.resolve(root, relativePath);
  if (!isInside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    throw validationError(`The ${label} file is missing or outside the operational workspace.`, { path: relativePath });
  }
  const real = realpathSync(candidate);
  if (!isInside(root, real)) {
    throw validationError(`The ${label} resolves outside the operational workspace.`, { path: relativePath });
  }
  return real;
}

function atomicWrite(target: VaultTarget, destination: string, content: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  assertDestinationSafe(target, destination);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, destination);
}

function writeManagedReadme(target: VaultTarget): void {
  mkdirSync(target.recordsRoot, { recursive: true });
  assertExistingPathSafe(target.vaultPath, target.recordsRoot);
  const readmePath = path.join(target.arcadiaRoot, "README.md");
  if (!existsSync(readmePath) || readFileSync(readmePath, "utf8") !== ARCADIA_VAULT_README) {
    atomicWrite(target, readmePath, ARCADIA_VAULT_README);
  }
}

function renderIngressMemoryNote(input: IngressMemoryNoteInput): string {
  const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].sort();
  return [
    "---",
    "arcadia_memory: true",
    "record_type: ingress_idea",
    yaml("arcadia_ask_id", input.askId ?? ""),
    yaml("arcadia_back_burner_id", input.backBurnerItemId ?? ""),
    yaml("captured_at", input.capturedAt),
    yaml("source", input.source),
    yaml("source_path", input.sourcePath),
    yaml("classification", input.classification),
    yaml("status", input.status),
    yamlNullable("project_id", input.projectId ?? null),
    yamlNullable("project", input.projectName ?? null),
    yamlNullable("action_id", input.actionId ?? null),
    yamlNullable("action", input.actionTitle ?? null),
    yamlNullable("next_action", input.nextAction ?? null),
    yamlNullable("final_path", input.finalPath ?? null),
    `tags: ${JSON.stringify(tags)}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "## Arcadia curation",
    "",
    `- Classification: ${input.classification}`,
    `- Status: ${input.status}`,
    `- Project: ${input.projectName ?? "Unassigned"}`,
    `- Action: ${input.actionTitle ?? "None linked"}`,
    `- Next action: ${input.nextAction ?? "Review this captured idea."}`,
    `- Source: ${input.sourcePath}`,
    "",
    "## Captured content",
    "",
    canonicalMarkdown(input.content),
    ""
  ].join("\n");
}

function assertDestinationSafe(target: VaultTarget, destination: string): void {
  if (!isInside(target.arcadiaRoot, destination)) {
    throw validationError("Refusing to write outside the configured vault's Arcadia/ subtree.", { destination });
  }
  let existing = path.dirname(destination);
  while (!existsSync(existing)) existing = path.dirname(existing);
  const realExisting = realpathSync(existing);
  if (!isInside(target.vaultPath, realExisting)) {
    throw validationError("Vault destination resolves outside the configured vault.", { destination });
  }
}

function assertExistingPathSafe(vaultPath: string, candidate: string): void {
  if (!existsSync(candidate)) return;
  if (lstatSync(candidate).isSymbolicLink() && !isInside(vaultPath, realpathSync(candidate))) {
    throw validationError("Arcadia vault subtree symlink resolves outside the configured vault.", { candidate });
  }
  if (!statSync(candidate).isDirectory()) {
    throw validationError("Arcadia vault subtree path must be a directory.", { candidate });
  }
  if (!isInside(vaultPath, realpathSync(candidate))) {
    throw validationError("Arcadia vault subtree resolves outside the configured vault.", { candidate });
  }
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalMarkdown(value: string): string {
  return `${value.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}

function parseContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function yaml(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value)}`;
}

function yamlNullable(key: string, value: string | null): string {
  return value === null ? `${key}: null` : yaml(key, value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function failedEntry(row: MemoryRow, error: unknown): MemorySyncEntry {
  return {
    artifactId: row.artifact_id,
    artifactTitle: row.artifact_title,
    project: row.project_name,
    status: "failed",
    recordPath: null,
    error: error instanceof Error ? error.message : String(error)
  };
}

function emptyResult(dryRun: boolean): MemorySyncResult {
  return { enabled: false, dryRun, vaultPath: null, entries: [], counts: { created: 0, updated: 0, skipped: 0, failed: 0 } };
}

function resultForEntries(target: VaultTarget, dryRun: boolean, entries: MemorySyncEntry[]): MemorySyncResult {
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return { enabled: true, dryRun, vaultPath: target.vaultPath, entries, counts };
}
