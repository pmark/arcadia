import type { ArcadiaError } from "./errors.js";

export interface CommandSuccess<TData = unknown> {
  ok: true;
  command: string;
  workspace?: string;
  data: TData;
  artifacts: string[];
  warnings: string[];
}

export interface CommandFailure {
  ok: false;
  command: string;
  workspace?: string;
  error: {
    code: ArcadiaError["code"];
    message: string;
    details: ArcadiaError["details"];
  };
}

export interface CommandContext {
  json: boolean;
}

export type HumanRenderer<TData> = (response: CommandSuccess<TData>) => string[];

export function createSuccess<TData>(input: {
  command: string;
  workspace?: string;
  data: TData;
  artifacts?: string[];
  warnings?: string[];
}): CommandSuccess<TData> {
  return {
    ok: true,
    command: input.command,
    workspace: input.workspace,
    data: input.data,
    artifacts: input.artifacts ?? [],
    warnings: input.warnings ?? []
  };
}

export function createFailure(command: string, error: ArcadiaError, workspace?: string): CommandFailure {
  return {
    ok: false,
    command,
    workspace,
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  };
}

export function writeSuccess<TData>(
  response: CommandSuccess<TData>,
  context: CommandContext,
  renderHuman: HumanRenderer<TData>
): void {
  if (context.json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderHuman(response).join("\n")}\n`);
}

export function writeFailure(response: CommandFailure, context: CommandContext): void {
  if (context.json) {
    process.stderr.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  process.stderr.write(`Error [${response.error.code}]: ${response.error.message}\n`);
}

export function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
}
