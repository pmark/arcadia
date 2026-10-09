import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { GOLDEN_RELATIVE_PATH, loadGoldenCases } from "../ask/goldenCases.js";
import {
  VANISHED_IDS_SHOWN,
  buildAskReport,
  type AskReportCounts,
  type AskReportData
} from "../ask/report.js";
import { parseTimeBound } from "../timeline/time.js";
import { runTodoCommand } from "./todo.js";

export const DEFAULT_REPORT_WINDOW = "7d";

export interface AskReportOptions {
  workspace: string;
  /** ISO time or relative look-back (`7d`); default 7d. */
  since?: string;
  now?: Date;
  /** The checkout holding tests/fixtures/ask-golden.jsonl. Defaults to the directory the operator stands in. */
  repoRoot?: string;
  /** Directories whose Projects `arcadia todo` treats as fixtures. A test seam; leave it unset to see what the operator sees. */
  fixtureRoots?: string[];
}

/**
 * `arcadia ask report`: read-only. "Listed by arcadia todo" is decided by running todo's own projection (the full
 * view, so no display cap hides a record) and reading which review items and Actions it lists; nothing here
 * re-implements what todo shows.
 */
export function runAskReportCommand(options: AskReportOptions): CommandSuccess<AskReportData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const since = parseTimeBound(options.since?.trim() || DEFAULT_REPORT_WINDOW, now, "--since");
  if (since.getTime() > now.getTime()) {
    throw validationError("--since is in the future; the window would be empty.", {
      flag: "--since",
      since: since.toISOString(),
      until: now.toISOString()
    });
  }

  const todo = runTodoCommand({
    workspace: workspacePath,
    all: true,
    now,
    ...(options.fixtureRoots ? { fixtureRoots: options.fixtureRoots } : {})
  }).data;
  const listed = new Set(todo.items.filter((item) => !item.staleReason).map((item) => item.sourceRef));
  const todoNotes: string[] = [];
  const collapsed = todo.counts.fixture.items + todo.counts.noRepoPath.items;
  if (collapsed > 0) {
    todoNotes.push(
      `arcadia todo collapses ${collapsed} item(s) of fixture Projects or Projects with no repo_path into counts. An Ask whose only open record is one of them is not listed, so it counts as vanished here unless it was acted on (an Action exists), answered, or filed as an Idea on purpose.`
    );
  }
  if (todo.unavailable.length > 0) {
    todoNotes.push(
      `arcadia todo could not read ${todo.unavailable.length} source(s), so the vanish rate may be overstated: ${todo.unavailable.join(" | ")}`
    );
  }

  const repoRoot = options.repoRoot ?? invocationRoot();
  const golden = loadGoldenCases(repoRoot);
  const data = withReadOnlyDatabase(workspacePath, (db) =>
    buildAskReport(db, {
      since,
      until: now,
      listed,
      golden,
      goldenPath: golden ? GOLDEN_RELATIVE_PATH : null,
      todoNotes
    })
  );
  return createSuccess({ command: "ask.report", workspace: workspacePath, data });
}

const percent = (numerator: number, denominator: number, rate: number | null): string =>
  `${numerator}/${denominator}${rate === null ? "" : ` (${(rate * 100).toFixed(1)}%)`}`;

function countLines(counts: AskReportCounts, indent: string): string[] {
  const lines = [
    `${indent}Asks ${counts.asks} · suppressed ${counts.suppressed} (no question created, apart from the vanish rate) · classified ${counts.classified}`,
    `${indent}Vanish rate (target zero): ${percent(counts.vanished, counts.eligible, counts.vanishRate)} of Asks at least an hour old`,
    `${indent}Corrected ÷ classified: ${percent(counts.corrected, counts.classified, counts.correctedRate)}`,
    `${indent}Questions ÷ Asks: ${percent(counts.questions, counts.asks, counts.questionRate)}`,
    `${indent}Back Burner arrivals: ${counts.backBurnerArrivals} (filed on purpose ${counts.backBurnerOperatorFiled}, shelved as a fallback ${counts.backBurnerArrivals - counts.backBurnerOperatorFiled})`,
    `${indent}Memo hits: ${counts.memoHits} · flagged recurrence ${counts.recurrence} · flagged planning ${counts.planning}`,
    `${indent}Corrections (memos in force, all time): ${counts.memos} · not yet backed by a golden case: ${
      counts.notBackedByGolden === null ? "unknown (golden set unreadable)" : counts.notBackedByGolden
    }`
  ];
  if (counts.vanishedAskIds.length > 0) {
    const shown = counts.vanishedAskIds.slice(0, VANISHED_IDS_SHOWN);
    const more = counts.vanishedAskIds.length - shown.length;
    lines.push(`${indent}Vanished: ${shown.join(", ")}${more > 0 ? ` and ${more} more (--json lists all)` : ""}; trace one with arcadia ask show <id>`);
  }
  return lines;
}

export function renderAskReportSuccess(response: CommandSuccess<AskReportData>): string[] {
  const data = response.data;
  const lines = [`Ask report, ${data.window.since} to ${data.window.until} (operator Asks only)`, ""];
  if (data.sources.length === 0) lines.push("No operator Ask was captured in this window.");
  for (const source of data.sources) lines.push(`Source ${source.source}`, ...countLines(source, "  "), "");
  if (data.sources.length > 1) lines.push("All operator sources", ...countLines(data.total, "  "), "");
  if (data.capturedWithoutAskRecord > 0) {
    lines.push(`Captured with no Ask record: ${data.capturedWithoutAskRecord} (in no rate; some are empty rule payloads)`, "");
  }
  lines.push(
    `Schedule revival trigger: ${data.schedule.recurrence} Ask(s) flagged recurrence, ${data.schedule.threshold} or more revives it: ${data.schedule.revivalTriggerMet ? "MET" : "not met"}`,
    `Golden set: ${
      data.corrections.golden.path ? `${data.corrections.golden.cases} case(s) in ${data.corrections.golden.path}` : "not readable from this checkout"
    }`
  );
  for (const hint of data.patternHints) {
    lines.push(
      `Pattern: ${hint.memos} memos share corrected type ${hint.type} and the token pattern "${hint.pattern}"${hint.backedByGolden ? " (a golden case already backs it)" : ""}.`,
      "  An agent may propose a deterministic rule and a golden case for it in a reviewed PR. No rule is generated automatically. Write the golden case as a paraphrase; never copy Ask text into a repository."
    );
  }
  lines.push("", ...data.notes);
  return lines;
}
