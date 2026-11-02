import { existsSync, statSync } from "node:fs";
import { ArcadiaError } from "../cli/errors.js";
import { resolveInvocationPath } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { checkDesignFile, type DesignCheckResult, type DesignMatrix } from "../design/record.js";
import { resolveWorkspace } from "../workspace/resolve.js";

export interface DesignCheckOptions { path: string; ready?: boolean; matrix?: boolean; workspace?: string; }
export interface DesignCheckData {
  file: string;
  kind: DesignCheckResult["kind"];
  schema: string | null;
  ready: boolean;
  problems: string[];
  warnings: string[];
  recordHash?: string;
  matrix?: DesignMatrix;
}

/**
 * The workspace a `workspace` source is verified against. It must not require a
 * ready database: only the directory is used, and nothing is opened or written.
 * No workspace, or one that is not a directory, leaves those sources unverified.
 */
function reachableWorkspace(flag: string | undefined): string | null {
  try {
    const { workspacePath } = resolveWorkspace({ workspace: flag?.trim() ? resolveInvocationPath(flag) : undefined });
    return workspacePath && existsSync(workspacePath) && statSync(workspacePath).isDirectory() ? workspacePath : null;
  } catch {
    return null;
  }
}

/** Read-only: validates a design record or field guide and, on request, derives its matrix. */
export function runDesignCheckCommand(options: DesignCheckOptions): CommandSuccess<DesignCheckData> {
  const file = resolveInvocationPath(options.path);
  const workspace = reachableWorkspace(options.workspace);
  const result = checkDesignFile(file, { ready: options.ready, matrix: options.matrix, workspace });
  const data: DesignCheckData = {
    file,
    kind: result.kind,
    schema: result.schema,
    ready: Boolean(options.ready) && result.kind === "record",
    problems: result.problems,
    warnings: result.warnings,
    ...(result.recordHash ? { recordHash: result.recordHash } : {}),
    ...(result.matrix ? { matrix: result.matrix } : {})
  };
  if (result.problems.length > 0) {
    // Human output prints only the message, so the problems travel in it as well as in details.
    const lines = [
      `${result.kind === "field-guide" ? "Field guide" : result.kind === "record" ? "Design record" : "Design file"} ${file} has ${result.problems.length} problem(s)${data.ready ? " (--ready)" : ""}:`,
      ...result.problems.map((problem) => `- ${problem}`),
      ...(result.warnings.length ? ["Warnings:", ...result.warnings.map((warning) => `- ${warning}`)] : []),
      ...(result.recordHash ? [`record_hash: ${result.recordHash}`] : [])
    ];
    throw new ArcadiaError("VALIDATION_ERROR", lines.join("\n"), 1, { ...data });
  }
  return createSuccess({ command: "design.check", workspace: workspace ?? undefined, data, warnings: result.warnings });
}

export function renderDesignCheckSuccess(response: CommandSuccess<DesignCheckData>): string[] {
  const { data } = response;
  const lines = [
    `${data.kind === "field-guide" ? "Field guide" : "Design record"} is valid${data.ready ? " and ready" : ""}: ${data.file}`,
    `Schema: ${data.schema}`
  ];
  if (data.recordHash) lines.push(`record_hash: ${data.recordHash}`);
  if (data.warnings.length) lines.push("Warnings:", ...data.warnings.map((warning) => `- ${warning}`));
  if (data.matrix) lines.push(...renderMatrix(data.matrix));
  return lines;
}

function renderMatrix(matrix: DesignMatrix): string[] {
  const none = (list: unknown[]): string[] => (list.length ? [] : ["  (none)"]);
  return [
    "",
    "Shared (concepts with origins in two or more sources):",
    ...matrix.shared.map((entry) => `  ${entry.concept} ${entry.title} [${entry.sources.join(", ")}]`), ...none(matrix.shared),
    "Differentiated (one source):",
    ...matrix.differentiated.flatMap((group) => [`  ${group.source} ${group.title}`, ...group.concepts.map((entry) => `    ${entry.concept} ${entry.title}`)]), ...none(matrix.differentiated),
    "Choices:",
    ...matrix.choices.flatMap((choice) => [
      `  ${choice.choice} ${choice.question} [${choice.status}${choice.chosen ? `: ${choice.chosen} by ${choice.decidedBy ?? "unknown"}` : ""}]`,
      ...choice.options.map((option) => `    ${option.concept} ${option.title} (${option.position}): ${option.consequence}`)
    ]), ...none(matrix.choices),
    "Trace (requirement to chosen concepts to origins):",
    ...matrix.trace.flatMap((row) => [
      `  ${row.requirement} ${row.statement} [mission ${row.mission.join(", ") || "none"}]`,
      ...row.concepts.map((entry) => `    ${entry.concept} ${entry.title} <- ${entry.origins.map((origin) => `${origin.source} ${origin.locator}`).join("; ")}`)
    ]), ...none(matrix.trace),
    "Cut or later:",
    ...matrix.cutOrLater.map((entry) => `  ${entry.concept} ${entry.title} (${entry.position}): ${entry.reason ?? entry.revival ?? ""}`), ...none(matrix.cutOrLater)
  ];
}
