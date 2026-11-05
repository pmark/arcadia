/**
 * Run the real Claude reviewer offline against one saved attempt's evidence, N
 * times, and print what it judged. See src/qa/reviewerReplay.ts. Holds no
 * authority: it writes only under a new scratch directory.
 *
 * Exit: 0 every run passed (or --prompt-only), 1 a run did not pass, 2 bad input,
 * 3 stopped (unavailable reviewer, failed preflight, non-subscription sign-in or
 * missing binding).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_REPLAY_RUNS,
  DEFAULT_REPLAY_TIMEOUT_MS,
  isReplayStop,
  renderReplayReport,
  replayExitCode,
  ReplayInputError,
  runReviewerReplay,
  type ReplayPromptSource,
  type ReplaySubstitution,
  type ReviewerReplayOptions
} from "../src/qa/reviewerReplay.js";
import type { PrReviewRole } from "../src/qa/prReview.js";
import type { OperatorQaPlanSource } from "../src/sessions/operatorQaPlan.js";

const USAGE = `Usage: pnpm reviewer-replay (--attempt <saved attempt dir> | --fixture <json>) [options]

Which prompt the reviewer judges:
  --prompt saved          the exact bytes the attempt judged
  --prompt rebuild        this checkout's prompt builder; the saved plan text stays
  --prompt rebuild-plan   this checkout's prompt builder and plan renderer (default)
  --prompt-file <path>    a prepared prompt, verbatim
  --substitute-file <json>  then apply [{"find","replace","count"?}] to it: exact, counted, reported
  --plan-source <json>    the Action's governed plan inputs, when the saved plan cannot supply them

Options:
  --runs <n>              runs (default ${DEFAULT_REPLAY_RUNS})
  --timeout-minutes <n>   limit per run (default ${DEFAULT_REPLAY_TIMEOUT_MS / 60_000}, at most 30)
  --scratch <dir>         parent of the new scratch directory (default: system temporary directory)
  --label <text>          added to the scratch directory's name
  --role qa|code-review   a fixture's role (default qa); an attempt keeps its own
  --workspace <path>      Arcadia workspace (default: as Arcadia resolves it); only read
  --repo <path>           repository for plan Git facts (default: this checkout); only read
  --prompt-only           build and report the prompt; run no claude process
  --json                  print the report as JSON
`;

export function parseReplayArguments(argv: readonly string[], repositoryPath: string): { options: ReviewerReplayOptions; json: boolean } | null {
  const options: ReviewerReplayOptions = { repositoryPath };
  let json = false;
  const take = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new ReplayInputError(`${flag} needs a value.`);
    return value;
  };
  const readJson = <T>(file: string, flag: string): T => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (error) {
      throw new ReplayInputError(`${flag} ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--attempt": options.attempt = take(index++, flag); break;
      case "--fixture": options.fixture = take(index++, flag); break;
      case "--prompt": {
        const value = take(index++, flag);
        if (value !== "saved" && value !== "rebuild" && value !== "rebuild-plan") throw new ReplayInputError("--prompt is saved, rebuild or rebuild-plan.");
        options.prompt = value satisfies ReplayPromptSource;
        break;
      }
      case "--prompt-file": options.promptFile = take(index++, flag); break;
      case "--substitute-file": {
        const value = readJson<ReplaySubstitution[]>(take(index++, flag), flag);
        if (!Array.isArray(value)) throw new ReplayInputError("--substitute-file holds a JSON array.");
        options.substitutions = value;
        break;
      }
      case "--plan-source": options.planSource = readJson<OperatorQaPlanSource>(take(index++, flag), flag); break;
      case "--runs": options.runs = Number(take(index++, flag)); break;
      case "--timeout-minutes": options.timeoutMs = Number(take(index++, flag)) * 60_000; break;
      case "--scratch": options.scratchParent = take(index++, flag); break;
      case "--label": options.label = take(index++, flag); break;
      case "--role": {
        const value = take(index++, flag);
        if (value !== "qa" && value !== "code-review") throw new ReplayInputError("--role is qa or code-review.");
        options.role = value satisfies PrReviewRole;
        break;
      }
      case "--workspace": options.workspace = take(index++, flag); break;
      case "--repo": options.repositoryPath = path.resolve(take(index++, flag)); break;
      case "--prompt-only": options.promptOnly = true; break;
      case "--json": json = true; break;
      case "--help": case "-h": return null;
      default: throw new ReplayInputError(`Unknown argument: ${flag}`);
    }
  }
  return { options, json };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const parsed = parseReplayArguments(process.argv.slice(2), path.resolve(import.meta.dirname, ".."));
    if (!parsed) {
      process.stdout.write(USAGE);
    } else {
      const report = runReviewerReplay(parsed.options);
      process.stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderReplayReport(report).join("\n")}\n`);
      process.exitCode = replayExitCode(report);
    }
  } catch (error) {
    if (error instanceof ReplayInputError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else if (isReplayStop(error)) {
      process.stderr.write(`STOPPED (${error.reason}): ${error.message}\n`);
      process.exitCode = 3;
    } else {
      throw error;
    }
  }
}
