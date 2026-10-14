import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { usageError, validationError } from "../cli/errors.js";
import {
  PLAN_SLUG, buildCloseOut, closeOutPath, decideWrite, loadCloseOutInputs, renderCloseOut, type CloseOutRecord
} from "../plans/closeOut.js";

export interface PlanCloseOutOptions { repo: string; planSlug: string; write?: boolean }

export interface PlanCloseOutData {
  record: CloseOutRecord;
  path: string;
  written: boolean;
  unchanged: boolean;
  excludedLedgerRows: number;
}

/**
 * Publishes `text` at `target` without ever replacing an existing file: write a temporary sibling, then `linkSync`
 * (fails EEXIST when the target exists). The temporary file is removed on every path.
 */
export function publishNoOverwrite(
  target: string,
  text: string,
  hooks: { write?: (file: string, text: string) => void; beforePublish?: () => void } = {}
): void {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    (hooks.write ?? writeFileSync)(temporary, text);
    hooks.beforePublish?.();
    try {
      linkSync(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw validationError(`${path.basename(target)} appeared while it was being written and was left untouched; review it, delete it deliberately to re-record, then re-run \`arcadia plan close-out <slug> --write\``);
      }
      throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Read-only by default; `--write` creates `docs/plans/<slug>.close-out.json` and never replaces a differing record. */
export function runPlanCloseOutCommand(options: PlanCloseOutOptions): CommandSuccess<PlanCloseOutData> {
  if (!PLAN_SLUG.test(options.planSlug)) {
    throw usageError(`Plan slug must be lowercase words joined by hyphens, got ${JSON.stringify(options.planSlug)}`);
  }
  const repoRoot = path.resolve(options.repo);
  let loaded;
  try {
    loaded = loadCloseOutInputs(repoRoot, options.planSlug);
  } catch (error) {
    throw validationError((error as Error).message, { cause: String(error) });
  }
  if (loaded.errors.length > 0) {
    throw validationError(`The session ledger has errors; fix them before closing out a Plan:\n${loaded.errors.join("\n")}`);
  }
  const record = buildCloseOut(loaded.input);
  const relative = closeOutPath(options.planSlug);
  const absolute = path.join(repoRoot, relative);
  let written = false;
  let unchanged = false;
  if (options.write) {
    const decision = decideWrite(existsSync(absolute) ? readFileSync(absolute, "utf8") : null, record);
    if (decision.action === "refuse") throw validationError(`${relative}: ${decision.reason}`);
    if (decision.action === "write") {
      mkdirSync(path.dirname(absolute), { recursive: true });
      publishNoOverwrite(absolute, renderCloseOut(record));
      written = true;
    } else unchanged = true;
  }
  return createSuccess({
    command: "plan.close-out",
    data: { record, path: relative, written, unchanged, excludedLedgerRows: loaded.excludedLedgerRows },
    artifacts: written ? [relative] : []
  });
}

export function renderPlanCloseOutSuccess(response: CommandSuccess<PlanCloseOutData>): string[] {
  const { record, path: file, written, unchanged, excludedLedgerRows } = response.data;
  const done = record.actions.filter(action => action.status === "done").length;
  return [
    `Plan ${record.plan.slug}: ${done}/${record.actions.length} Actions done, ${record.openRemainders.length} open remainder(s), ${record.openBlockers.length} open blocker(s)`,
    `Ledger evidence: ${record.ledger.evidence} (${record.ledger.rowsMatched} of ${record.ledger.rowsConsidered} rows match this Plan)` +
      (record.ledger.evidence === "none" ? "; aggregates are null" : `: ${record.ledger.reviewRounds} review round(s), ${record.ledger.subagentTokens} subagent tokens, ${record.ledger.operatorTouches} operator touch(es)`),
    `Closed: ${record.plan.closed ? "yes" : "no"} (status ${record.plan.status})`,
    `Frictions: ${record.frictions.length} (${record.frictions.filter(item => item.uncited).length} fixed without a cited test), ${record.unresolvedFrictionIds.length} unresolved id(s)`,
    `Successor: ${record.successor.recommendation ?? `none (${record.successor.reason})`}`,
    `Hash: ${record.hash}`,
    `${excludedLedgerRows} ledger row(s) cite Actions of other Plans and are excluded (listed up to 20 in the record)`,
    written ? `Wrote ${file}` : unchanged ? `${file} already holds this record; nothing written` : `Not written; use --write to create ${file}`
  ];
}
