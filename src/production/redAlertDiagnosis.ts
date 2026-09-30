import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { runAgentAskDraftCommand } from "../commands/agentAsk.js";
import { openDatabase } from "../db/connection.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import { GATE_PATH_PATTERNS } from "../soak/rehearsalSoak.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { loadWorkspaceConfig } from "../workspace/config.js";
import type { RedAlert } from "./redAlerts.js";
import { listOpenRedAlerts } from "./redAlerts.js";

/**
 * Bounded diagnosis of an open red alert. It reads the alert's evidence file,
 * asks one model call for a cause with file:line evidence and a proposed fix,
 * files or updates one bug Issue, and drafts (never settles) an Agent Ask for
 * the fix Action. It edits no code, opens no pull request, and merges nothing.
 *
 * Spend guardrails: off unless the workspace sets `redAlertDiagnosis.enabled`;
 * one attempt per alert episode, ever (the claim row is the limit, so a crash
 * or failure is never retried); the model is reached only through the
 * Intelligence service, local-preferred, with paid usage refused; and the
 * declared token budget is enforced in code before and after the one call.
 */

export const DEFAULT_DIAGNOSIS_TOKEN_BUDGET = 4000;
export const DIAGNOSIS_OUTCOMES = ["proposed", "needs_operator", "budget_exceeded", "no_cause", "failed"] as const;
export type DiagnosisOutcome = (typeof DIAGNOSIS_OUTCOMES)[number];

/** Beyond the guard-merge list: files whose change touches credentials. */
const CREDENTIAL_PATH_PATTERNS: readonly RegExp[] = [/(^|\/)\.env(\..*)?$/, /(^|\/)[^/]*(secrets?|credentials?)[^/]*$/i];

/** Files in a proposed fix that make it an operator-only change. */
export function safetyGateFilesTouched(files: string[]): string[] {
  const patterns = [...GATE_PATH_PATTERNS, ...CREDENTIAL_PATH_PATTERNS];
  return files.map((file) => file.replace(/^\.\//, "")).filter((file) => patterns.some((pattern) => pattern.test(file)));
}

export interface DiagnosisFinding {
  cause: string | null;
  evidence: Array<{ file: string; line: number; note: string }>;
  proposedFix: { summary: string; files: string[]; acceptance: string[] } | null;
}

export interface DiagnosisModel {
  /** The route this model call goes through, recorded on the alert before the call. */
  route: string;
  diagnose(input: { prompt: string }): Promise<{ finding: unknown; tokensUsed: number; route?: string }>;
}

export interface GhResult {
  status: number;
  stdout: string;
  stderr: string;
}
export type GhRunner = (args: string[]) => GhResult;
export type AskDrafter = (request: string) => { path: string };

export interface DiagnosisDeps {
  model: DiagnosisModel;
  gh: GhRunner;
  draftAsk: AskDrafter;
  now?: () => Date;
}

export interface DiagnosisSettings {
  enabled: boolean;
  issueRepo: string | null;
  tokenBudget: number;
  disabledReason: string | null;
}

export interface RedAlertDiagnosis {
  requestId: string;
  alertId: string;
  status: DiagnosisOutcome | "started";
  tokenBudget: number;
  tokensUsed: number;
  modelRoute: string;
  issueUrl: string | null;
  askPath: string | null;
  gateFiles: string[];
  note: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Read the workspace flag. Anything short of `enabled: true` plus an `issueRepo` is disabled. */
export function readDiagnosisSettings(workspace: string): DiagnosisSettings {
  const configFile = getWorkspacePaths(workspace).configFile;
  const config = existsSync(configFile) ? loadWorkspaceConfig(configFile).redAlertDiagnosis : undefined;
  const tokenBudget = config?.tokenBudget ?? DEFAULT_DIAGNOSIS_TOKEN_BUDGET;
  if (config?.enabled !== true) return { enabled: false, issueRepo: null, tokenBudget, disabledReason: "redAlertDiagnosis.enabled is not true" };
  if (!config.issueRepo) return { enabled: false, issueRepo: null, tokenBudget, disabledReason: "redAlertDiagnosis.issueRepo is not set" };
  return { enabled: true, issueRepo: config.issueRepo, tokenBudget, disabledReason: null };
}

interface DiagnosisRow {
  request_id: string;
  alert_id: string;
  status: RedAlertDiagnosis["status"];
  token_budget: number;
  tokens_used: number;
  model_route: string;
  issue_url: string | null;
  ask_path: string | null;
  gate_files: string | null;
  note: string | null;
  started_at: string;
  finished_at: string | null;
}

function toDiagnosis(row: DiagnosisRow): RedAlertDiagnosis {
  return {
    requestId: row.request_id,
    alertId: row.alert_id,
    status: row.status,
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    modelRoute: row.model_route,
    issueUrl: row.issue_url,
    askPath: row.ask_path,
    gateFiles: row.gate_files ? (JSON.parse(row.gate_files) as string[]) : [],
    note: row.note,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

/** Diagnoses keyed by alert request id. Safe on a read-only connection. */
export function listRedAlertDiagnoses(db: Database.Database): RedAlertDiagnosis[] {
  try {
    return (db.prepare("SELECT * FROM production_red_alert_diagnoses ORDER BY started_at ASC").all() as DiagnosisRow[]).map(toDiagnosis);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return [];
    throw error;
  }
}

export function buildDiagnosisPrompt(alert: RedAlert, evidence: string): string {
  return [
    "You are diagnosing one managed-production failure in the Arcadia repository.",
    "Read the alert evidence and name the single most likely cause in the code.",
    'Reply with JSON only: {"cause": string|null, "evidence": [{"file": string, "line": number, "note": string}],',
    '"proposedFix": {"summary": string, "files": [string], "acceptance": [string]}|null}.',
    "Every evidence entry must be a repository-relative file and a real line number. If you cannot name a cause, set cause to null.",
    "Do not invent files or lines. Do not propose changes you cannot tie to the evidence.",
    "",
    `Alert ${alert.id} (${alert.trigger}) for ${alert.actionKey ?? alert.projectSlug}`,
    `Detail: ${alert.detail}`,
    "",
    "Evidence file:",
    evidence
  ].join("\n");
}

/** Deliberately crude (4 characters per token): a ceiling check, not a meter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function parseFinding(raw: unknown): DiagnosisFinding | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const cause = typeof record.cause === "string" && record.cause.trim() ? record.cause.trim() : null;
  const evidence = (Array.isArray(record.evidence) ? record.evidence : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.file !== "string" || !item.file.trim() || !Number.isInteger(item.line) || (item.line as number) < 1) return [];
    return [{ file: item.file.trim(), line: item.line as number, note: typeof item.note === "string" ? item.note.trim() : "" }];
  });
  const fix = record.proposedFix;
  let proposedFix: DiagnosisFinding["proposedFix"] = null;
  if (fix && typeof fix === "object") {
    const item = fix as Record<string, unknown>;
    const strings = (input: unknown) => (Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : []);
    if (typeof item.summary === "string" && item.summary.trim()) {
      proposedFix = { summary: item.summary.trim(), files: strings(item.files), acceptance: strings(item.acceptance) };
    }
  }
  return { cause, evidence, proposedFix };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function issueMarker(alert: RedAlert): string {
  return `red-alert:${alert.id}`;
}

/** File the alert's bug Issue, or comment on the one that already carries its marker. */
function fileIssue(gh: GhRunner, repo: string, alert: RedAlert, finding: DiagnosisFinding, gateFiles: string[]): string {
  const marker = issueMarker(alert);
  const body = [
    `Automated diagnosis of red alert \`${alert.id}\` (${alert.trigger}) on ${alert.actionKey ?? alert.projectSlug}.`,
    "",
    `Cause: ${finding.cause}`,
    "",
    "Evidence:",
    ...finding.evidence.map((entry) => `- \`${entry.file}:${entry.line}\` ${entry.note}`),
    "",
    `Proposed fix: ${finding.proposedFix?.summary ?? "none"}`,
    ...(gateFiles.length > 0 ? ["", `Touches safety-gate files (${gateFiles.join(", ")}): operator review required; never auto-merge.`] : []),
    "",
    `Alert evidence: ${alert.evidencePath}`,
    `<!-- ${marker} -->`
  ].join("\n");
  const found = ghOk(gh, ["issue", "list", "--repo", repo, "--state", "all", "--search", `"${marker}" in:body`, "--json", "number,url", "--limit", "1"]);
  const existing = (safeJson(found.stdout) as Array<{ number: number; url: string }> | null)?.[0];
  if (existing) {
    ghOk(gh, ["issue", "comment", String(existing.number), "--repo", repo, "--body", body]);
    return existing.url;
  }
  const created = ghOk(gh, ["issue", "create", "--repo", repo, "--label", "bug", "--title", `Red alert ${alert.id}: ${finding.cause!.slice(0, 80)}`, "--body", body]);
  return created.stdout.trim().split("\n").pop() ?? "";
}

function ghOk(gh: GhRunner, args: string[]): GhResult {
  const result = gh(args);
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result;
}

function draftFixAsk(alert: RedAlert, finding: DiagnosisFinding, issueUrl: string, gateFiles: string[], draftAsk: AskDrafter): string {
  const fix = finding.proposedFix!;
  const acceptance = [
    ...fix.acceptance,
    ...(gateFiles.length > 0
      ? [`The change stops at an open pull request for the operator because it touches ${gateFiles.join(", ")}; it is not merged automatically.`]
      : [])
  ];
  const request = JSON.stringify({
    agent_ask: "v1",
    request_id: `red-alert-fix-${alert.id}-${alert.requestId.match(/-e(\d+)$/)?.[1] ?? "1"}`,
    project: alert.projectSlug,
    intent: "action",
    desired_result: `Fix the cause of red alert ${alert.id}: ${fix.summary} (${issueUrl})`,
    rationale: `Proposed by the bounded red-alert diagnosis. Cause: ${finding.cause}`,
    actions: [
      {
        id: `fix-${alert.id}`,
        desired_result: fix.summary,
        acceptance: acceptance.length > 0 ? acceptance : [`The failure behind red alert ${alert.id} no longer recurs.`],
        dependencies: [],
        references: [issueUrl]
      }
    ]
  });
  return draftAsk(request).path;
}

/**
 * Diagnose one alert. Returns `null` when a diagnosis was already claimed for
 * this alert episode (the single-diagnosis limit); otherwise the recorded
 * outcome. Never throws for a model, gh, or Ask failure: those are recorded as
 * `failed` and the alert stays open.
 */
export async function diagnoseRedAlert(
  db: Database.Database,
  alert: RedAlert,
  settings: DiagnosisSettings,
  deps: DiagnosisDeps
): Promise<RedAlertDiagnosis | null> {
  const now = deps.now ?? (() => new Date());
  const claim = db
    .prepare(
      `INSERT OR IGNORE INTO production_red_alert_diagnoses (request_id, alert_id, status, token_budget, model_route, started_at)
       VALUES (?, ?, 'started', ?, ?, ?)`
    )
    .run(alert.requestId, alert.id, settings.tokenBudget, deps.model.route, now().toISOString());
  if (claim.changes === 0) return null;

  const finish = (status: DiagnosisOutcome, patch: { note: string; tokensUsed?: number; issueUrl?: string; askPath?: string; gateFiles?: string[]; route?: string }) => {
    db.prepare(
      `UPDATE production_red_alert_diagnoses SET status = ?, note = ?, tokens_used = ?, issue_url = ?, ask_path = ?, gate_files = ?,
         model_route = ?, finished_at = ? WHERE request_id = ?`
    ).run(status, patch.note, patch.tokensUsed ?? 0, patch.issueUrl ?? null, patch.askPath ?? null, patch.gateFiles ? JSON.stringify(patch.gateFiles) : null,
      patch.route ?? deps.model.route, now().toISOString(), alert.requestId);
    try {
      appendFileSync(
        alert.evidencePath,
        [
          "",
          "## Diagnosis",
          "",
          `- Outcome: ${status}`,
          `- Token budget: ${settings.tokenBudget} (used ${patch.tokensUsed ?? 0})`,
          `- Model route: ${patch.route ?? deps.model.route}`,
          `- Issue: ${patch.issueUrl ?? "none"}`,
          `- Proposed fix Ask: ${patch.askPath ?? "none"}`,
          `- Note: ${patch.note}`,
          ""
        ].join("\n")
      );
    } catch {
      // The database row is the record; a missing evidence file must not turn an outcome into an error.
    }
    return toDiagnosis(db.prepare("SELECT * FROM production_red_alert_diagnoses WHERE request_id = ?").get(alert.requestId) as DiagnosisRow);
  };

  const evidence = existsSync(alert.evidencePath) ? readFileSync(alert.evidencePath, "utf8") : alert.detail;
  const prompt = buildDiagnosisPrompt(alert, evidence);
  const estimated = estimateTokens(prompt);
  if (estimated > settings.tokenBudget) {
    return finish("budget_exceeded", { note: `The prompt alone (about ${estimated} tokens) exceeds the ${settings.tokenBudget}-token budget; no model call was made.`, tokensUsed: estimated });
  }

  let result: Awaited<ReturnType<DiagnosisModel["diagnose"]>>;
  try {
    result = await deps.model.diagnose({ prompt });
  } catch (error) {
    return finish("failed", { note: `Model call failed: ${error instanceof Error ? error.message : String(error)}` });
  }
  const route = result.route ?? deps.model.route;
  if (result.tokensUsed > settings.tokenBudget) {
    return finish("budget_exceeded", { note: `The call used ${result.tokensUsed} tokens, over the ${settings.tokenBudget}-token budget; its answer was discarded.`, tokensUsed: result.tokensUsed, route });
  }
  const finding = parseFinding(result.finding);
  if (!finding || !finding.cause || finding.evidence.length === 0) {
    return finish("no_cause", { note: "The diagnosis named no cause with file:line evidence.", tokensUsed: result.tokensUsed, route });
  }
  if (!finding.proposedFix) {
    return finish("no_cause", { note: "The diagnosis named a cause but no proposed fix.", tokensUsed: result.tokensUsed, route });
  }

  const gateFiles = safetyGateFilesTouched(finding.proposedFix.files);
  let issueUrl: string | undefined;
  try {
    issueUrl = fileIssue(deps.gh, settings.issueRepo!, alert, finding, gateFiles);
    const askPath = draftFixAsk(alert, finding, issueUrl, gateFiles, deps.draftAsk);
    return gateFiles.length > 0
      ? finish("needs_operator", { note: `Fix touches safety-gate files (${gateFiles.join(", ")}); stops at an open pull request for the operator and is never auto-merged.`, tokensUsed: result.tokensUsed, issueUrl, askPath, gateFiles, route })
      : finish("proposed", { note: "Issue filed and fix Action drafted; settlement is the operator's.", tokensUsed: result.tokensUsed, issueUrl, askPath, route });
  } catch (error) {
    return finish("failed", { note: `Recording the diagnosis failed: ${error instanceof Error ? error.message : String(error)}`, tokensUsed: result.tokensUsed, issueUrl, gateFiles, route });
  }
}

export interface DiagnoseOpenAlertsResult {
  enabled: boolean;
  disabledReason: string | null;
  diagnosed: RedAlertDiagnosis[];
  skipped: number;
}

/** Diagnose every open alert that has not had its one diagnosis. A no-op, touching nothing, when disabled. */
export async function diagnoseOpenRedAlerts(
  db: Database.Database,
  settings: DiagnosisSettings,
  deps: () => DiagnosisDeps
): Promise<DiagnoseOpenAlertsResult> {
  if (!settings.enabled) return { enabled: false, disabledReason: settings.disabledReason, diagnosed: [], skipped: 0 };
  const alerts = listOpenRedAlerts(db);
  if (alerts.length === 0) return { enabled: true, disabledReason: null, diagnosed: [], skipped: 0 };
  const resolved = deps();
  const diagnosed: RedAlertDiagnosis[] = [];
  let skipped = 0;
  for (const alert of alerts) {
    const outcome = await diagnoseRedAlert(db, alert, settings, resolved);
    if (outcome) diagnosed.push(outcome);
    else skipped += 1;
  }
  return { enabled: true, disabledReason: null, diagnosed, skipped };
}

const DIAGNOSIS_ROUTE = "text.generate local-preferred fast (paid usage refused)";
const DIAGNOSIS_TIMEOUT_MS = 180_000;
const DIAGNOSIS_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    cause: { type: ["string", "null"] },
    evidence: { type: "array", items: { type: "object", properties: { file: { type: "string" }, line: { type: "number" }, note: { type: "string" } }, required: ["file", "line"] } },
    proposedFix: { type: ["object", "null"], properties: { summary: { type: "string" }, files: { type: "array", items: { type: "string" } }, acceptance: { type: "array", items: { type: "string" } } } }
  },
  required: ["cause", "evidence", "proposedFix"]
};

/**
 * The real model: one in-process Intelligence job, local-preferred, paid usage
 * refused, no retries. The Intelligence request carries no output-token cap, so
 * the budget is enforced around the call (prompt size before, reported usage
 * after) rather than inside it.
 */
export function createIntelligenceDiagnosisModel(db: Database.Database, workspacePath: string): DiagnosisModel {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const client = createLiteLlmHttpClient({ baseUrl: config.liteLlmBaseUrl, apiKey: config.liteLlmApiKey, timeoutMs: DIAGNOSIS_TIMEOUT_MS });
  const worker = new IntelligenceWorker(repository, client, config, artifactStore);
  return {
    route: DIAGNOSIS_ROUTE,
    async diagnose({ prompt }) {
      const request: IntelligenceRequest = {
        idempotencyKey: `red-alert-diagnosis-${Date.now()}`,
        operationId: "arcadia.production.diagnose-red-alert",
        clientApp: "arcadia-red-alert-diagnosis",
        capability: "text.generate",
        execution: "local-preferred",
        profile: "fast",
        input: { instructions: prompt },
        outputContract: { schemaId: "arcadia.production.red-alert-diagnosis.v1", schemaVersion: 1, jsonSchema: DIAGNOSIS_SCHEMA },
        template: { id: "arcadia.production.red-alert-diagnosis", version: "1" },
        executionPolicy: { allowPaidUsage: false, maxRetries: 0 }
      };
      const { job: submitted } = await submitIntelligenceRequest(repository, request);
      const finished = await worker.runOnce();
      const job = finished?.id === submitted.id ? finished : await repository.findById(submitted.id);
      if (!job || job.status !== "completed") {
        throw new Error(`Intelligence job did not complete (${job?.status ?? "missing"}): ${job?.error?.message ?? "no detail"}`);
      }
      const usage = job.usage;
      return {
        finding: job.result,
        tokensUsed: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
        route: usage?.routeId ?? usage?.modelRoute ?? DIAGNOSIS_ROUTE
      };
    }
  };
}

export const defaultGhRunner: GhRunner = (args) => {
  const result = spawnSync("gh", args, { encoding: "utf8", timeout: 60_000 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** Drafts into the workspace's own red-alerts folder, never a Project checkout, so no repository is dirtied. */
export function createWorkspaceAskDrafter(workspacePath: string): AskDrafter {
  const dir = path.join(workspacePath, "artifacts", "generated", "red-alerts");
  return (request) => ({ path: runAgentAskDraftCommand({ request, workspace: workspacePath, dir }).data.path });
}

let diagnosisInFlight = false;

/**
 * The worker's entry point: fire-and-forget, one run at a time, reading the
 * flag first so a disabled workspace pays nothing beyond one config read. It
 * opens its own database handle because the model call outlives the tick's.
 */
export function startRedAlertDiagnosisInBackground(workspacePath: string, log: (message: string) => void): void {
  if (diagnosisInFlight) return;
  let settings: DiagnosisSettings;
  try {
    settings = readDiagnosisSettings(workspacePath);
  } catch (error) {
    log(`Red alert diagnosis settings unreadable (ignored): ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!settings.enabled) return;
  diagnosisInFlight = true;
  const db = openDatabase(workspacePath);
  void diagnoseOpenRedAlerts(db, settings, () => ({
    model: createIntelligenceDiagnosisModel(db, workspacePath),
    gh: defaultGhRunner,
    draftAsk: createWorkspaceAskDrafter(workspacePath)
  }))
    .then((result) => {
      for (const diagnosis of result.diagnosed) log(`Red alert ${diagnosis.alertId} diagnosis: ${diagnosis.status} (${diagnosis.note ?? ""})`);
    })
    .catch((error) => log(`Red alert diagnosis failed (ignored): ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      diagnosisInFlight = false;
      try {
        db.close();
      } catch {
        // Already closed.
      }
    });
}
