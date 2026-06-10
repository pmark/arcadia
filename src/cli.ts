#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { renderInboxImportSuccess, runInboxAddCommand, runInboxImportCommand } from "./commands/inbox.js";
import { renderInitSuccess, runInitCommand } from "./commands/init.js";
import { runLogCreateCommand } from "./commands/log.js";
import { renderProjectListSuccess, runProjectCreateCommand, runProjectListCommand } from "./commands/project.js";
import { renderQueueSuccess, runQueueCommand } from "./commands/queue.js";
import { renderReportStatusSuccess, runReportStatusCommand } from "./commands/report.js";
import { renderStatusSuccess, runStatusCommand } from "./commands/status.js";
import {
  renderWorkDoneSuccess,
  renderWorkListSuccess,
  renderWorkUpdateSuccess,
  runWorkDoneCommand,
  runWorkListCommand,
  runWorkUpdateCommand
} from "./commands/work.js";
import { normalizeError } from "./cli/errors.js";
import {
  createFailure,
  type CommandSuccess,
  type HumanRenderer,
  wantsJson,
  writeFailure,
  writeSuccess
} from "./cli/response.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("arcadia")
    .description("Local-first project operating system CLI")
    .version("0.1.0")
    .exitOverride((error) => {
      if (error.exitCode !== 0) {
        throw error;
      }
    })
    .configureOutput({
      writeErr() {}
    });

  addJsonOption(
    program
    .command("init")
    .description("Initialize an Arcadia workspace")
      .argument("<workspace>", "Workspace path")
  ).action((workspace: string, options: { json?: boolean }) =>
    runCliAction("init", options, () => runInitCommand(workspace), renderInitSuccess)
  );

  addJsonOption(
    program
    .command("status")
    .description("Print workspace status and write reports/status.md")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("status", options, () => runStatusCommand(options), renderStatusSuccess)
  );

  const project = program.command("project").description("Project commands");
  project
    .command("create")
    .description("Interactively create a project")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runProjectCreateCommand(options));
  addJsonOption(
    project
    .command("list")
    .description("List projects")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("project.list", options, () => runProjectListCommand(options), renderProjectListSuccess)
  );

  const inbox = program.command("inbox").description("Inbox commands");
  inbox
    .command("add")
    .description("Interactively add a manually classified inbox item")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runInboxAddCommand(options));
  addJsonOption(
    inbox
      .command("import")
      .description("Import a manually classified inbox item without prompts")
      .requiredOption("--workspace <path>", "Workspace path")
      .requiredOption("--title <title>", "Work item title")
      .requiredOption("--input <text>", "Raw input text")
      .requiredOption("--queue <queue>", "Queue: inbox, work_queue, needs_mark, blocked")
      .requiredOption("--classification <classification>", "Work classification: autonomous, codex, needs_mark, blocked")
      .requiredOption("--next-action <action>", "Next action")
      .option("--project <project-id>", "Optional project id")
      .option("--milestone <milestone-id>", "Optional milestone id")
      .option("--expected-artifact <artifact>", "Optional expected artifact")
  ).action(
    (options: {
      workspace: string;
      title: string;
      input: string;
      queue: string;
      classification: string;
      nextAction: string;
      project?: string;
      milestone?: string;
      expectedArtifact?: string;
      json?: boolean;
    }) => runCliAction("inbox.import", options, () => runInboxImportCommand(options as never), renderInboxImportSuccess)
  );

  addJsonOption(
    program
    .command("queue")
    .description("Show grouped queues")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("queue", options, () => runQueueCommand(options), renderQueueSuccess)
  );

  const work = program.command("work").description("Work item commands");
  addJsonOption(
    work
      .command("list")
      .description("List work items")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("work.list", options, () => runWorkListCommand(options), renderWorkListSuccess)
  );
  addJsonOption(
    work
      .command("update")
      .description("Update an existing work item")
      .argument("<work-id>", "Work item id")
      .requiredOption("--workspace <path>", "Workspace path")
      .option("--queue <queue>", "Queue: inbox, work_queue, needs_mark, blocked")
      .option("--classification <classification>", "Work classification: autonomous, codex, needs_mark, blocked")
      .option("--next-action <action>", "Next action")
      .option("--status <status>", "Status: open, in_progress, done, blocked")
  ).action((workId: string, options: {
    workspace: string;
    queue?: string;
    classification?: string;
    nextAction?: string;
    status?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "work.update",
      options,
      () => runWorkUpdateCommand({ ...options, workId }),
      renderWorkUpdateSuccess
    )
  );
  addJsonOption(
    work
      .command("done")
      .description("Mark a work item complete")
      .argument("<work-id>", "Work item id")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((workId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("work.done", options, () => runWorkDoneCommand({ ...options, workId }), renderWorkDoneSuccess)
  );

  const log = program.command("log").description("Mission log commands");
  log
    .command("create")
    .description("Interactively create a mission log")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runLogCreateCommand(options));

  const report = program.command("report").description("Report commands");
  addJsonOption(
    report
    .command("status")
    .description("Write reports/status.md")
      .requiredOption("--workspace <path>", "Workspace path")
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("report.status", options, () => runReportStatusCommand(options), renderReportStatusSuccess)
  );

  return program;
}

if (isMainModule()) {
  buildProgram().parseAsync(process.argv).catch((error: unknown) => {
    const normalized = normalizeError(error);
    const context = { json: wantsJson(process.argv) };
    writeFailure(createFailure(commandNameFromArgv(process.argv), normalized, workspaceFromArgv(process.argv)), context);
    process.exitCode = normalized.exitCode;
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

function addJsonOption(command: Command): Command {
  return command.option("--json", "Emit machine-readable JSON output");
}

async function runCliAction<TData>(
  command: string,
  options: { workspace?: string; json?: boolean },
  action: () => CommandSuccess<TData> | Promise<CommandSuccess<TData>>,
  renderHuman: HumanRenderer<TData>
): Promise<void> {
  const context = { json: Boolean(options.json) };

  try {
    const response = await action();
    writeSuccess(response, context, renderHuman);
  } catch (error) {
    const normalized = normalizeError(error);
    writeFailure(createFailure(command, normalized, options.workspace ? path.resolve(options.workspace) : undefined), context);
    process.exitCode = normalized.exitCode;
  }
}

function commandNameFromArgv(argv: string[]): string {
  const parts = argv.slice(2).filter((part) => part !== "--json" && !part.startsWith("-"));
  const [first, second] = parts;

  if (first === "project" && second === "list") {
    return "project.list";
  }

  if (first === "inbox" && second === "import") {
    return "inbox.import";
  }

  if (first === "work" && ["list", "update", "done"].includes(second ?? "")) {
    return `work.${second}`;
  }

  if (first === "report" && second === "status") {
    return "report.status";
  }

  return first ?? "unknown";
}

function workspaceFromArgv(argv: string[]): string | undefined {
  const index = argv.indexOf("--workspace");
  if (index === -1 || !argv[index + 1]) {
    return undefined;
  }

  return path.resolve(argv[index + 1]);
}
