#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runInboxAddCommand } from "./commands/inbox.js";
import { runInitCommand } from "./commands/init.js";
import { runLogCreateCommand } from "./commands/log.js";
import { runProjectCreateCommand, runProjectListCommand } from "./commands/project.js";
import { runQueueCommand } from "./commands/queue.js";
import { runReportStatusCommand } from "./commands/report.js";
import { runStatusCommand } from "./commands/status.js";

export function buildProgram(): Command {
  const program = new Command();

  program.name("arcadia").description("Local-first project operating system CLI").version("0.1.0");

  program
    .command("init")
    .description("Initialize an Arcadia workspace")
    .argument("<workspace>", "Workspace path")
    .action((workspace: string) => runInitCommand(workspace));

  program
    .command("status")
    .description("Print workspace status and write reports/status.md")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runStatusCommand(options));

  const project = program.command("project").description("Project commands");
  project
    .command("create")
    .description("Interactively create a project")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runProjectCreateCommand(options));
  project
    .command("list")
    .description("List projects")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runProjectListCommand(options));

  const inbox = program.command("inbox").description("Inbox commands");
  inbox
    .command("add")
    .description("Interactively add a manually classified inbox item")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runInboxAddCommand(options));

  program
    .command("queue")
    .description("Show grouped queues")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runQueueCommand(options));

  const log = program.command("log").description("Mission log commands");
  log
    .command("create")
    .description("Interactively create a mission log")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runLogCreateCommand(options));

  const report = program.command("report").description("Report commands");
  report
    .command("status")
    .description("Write reports/status.md")
    .requiredOption("--workspace <path>", "Workspace path")
    .action((options: { workspace: string }) => runReportStatusCommand(options));

  return program;
}

if (isMainModule()) {
  buildProgram().parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
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
