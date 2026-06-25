import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import type { AskCommandData, AskOptions } from "./ask.js";
import { renderAskSuccess, runAskCommand } from "./ask.js";
import type { InitCommandData } from "./init.js";
import { runInitCommand } from "./init.js";
import type {
  ReviewDecisionCommandData,
  ReviewRequiredCommandData,
  ReviewShowCommandData
} from "./review.js";
import {
  runReviewApproveCommand,
  runReviewDeferCommand,
  runReviewRejectCommand,
  runReviewRequiredCommand,
  runReviewShowCommand
} from "./review.js";
import type { StatusCommandData } from "./status.js";
import { runStatusCommand } from "./status.js";
import {
  ARCADIA_PROJECT_GOAL,
  ARCADIA_PROJECT_MILESTONE,
  ARCADIA_PROJECT_MISSION,
  ARCADIA_PROJECT_NAME,
  ARCADIA_PROJECT_NEXT_ACTION
} from "../workspace/arcadiaProject.js";
import type { Milestone, MissionLog, Project, WorkItem } from "../domain/types.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export const DOGFOOD_WORKSPACE = ".arcadia-workspace";
export const DOGFOOD_PROJECT_NAME = ARCADIA_PROJECT_NAME;
export const DOGFOOD_MISSION = ARCADIA_PROJECT_MISSION;
export const DOGFOOD_GOAL = ARCADIA_PROJECT_GOAL;
export const DOGFOOD_MILESTONE = ARCADIA_PROJECT_MILESTONE;
export const DOGFOOD_NEXT_ACTION = ARCADIA_PROJECT_NEXT_ACTION;

export interface DogfoodInitCommandData {
  workspacePath: string;
  project: Project;
  milestone: Milestone;
  workItem: WorkItem;
  missionLog: MissionLog;
  createdConfig: boolean;
}

export type DogfoodAskRunner = (options: AskOptions) => CommandSuccess<AskCommandData>;

export function dogfoodWorkspacePath(): string {
  return resolveWorkspacePath(DOGFOOD_WORKSPACE);
}

export function runDogfoodInitCommand(): CommandSuccess<DogfoodInitCommandData> {
  const initialized = runInitCommand(DOGFOOD_WORKSPACE, { profile: "arcadia" });
  const data = dogfoodInitDataFromInit(initialized.data);

  return createSuccess({
    command: "dogfood.init",
    workspace: initialized.workspace,
    data,
    artifacts: initialized.artifacts
  });
}

export function runDogfoodAskCommand(
  options: { request: string; runSafe?: boolean },
  askRunner: DogfoodAskRunner = runAskCommand
): CommandSuccess<AskCommandData> {
  return withCommand(
    "dogfood.ask",
    askRunner({
      workspace: DOGFOOD_WORKSPACE,
      request: options.request,
      runSafe: options.runSafe
    })
  );
}

export function runDogfoodStatusCommand(): CommandSuccess<StatusCommandData> {
  return withCommand("dogfood.status", runStatusCommand({ workspace: DOGFOOD_WORKSPACE }));
}

export function runDogfoodReviewCommand(): CommandSuccess<ReviewRequiredCommandData> {
  return withCommand("dogfood.review", runReviewRequiredCommand({ workspace: DOGFOOD_WORKSPACE }));
}

export function runDogfoodReviewShowCommand(id: string): CommandSuccess<ReviewShowCommandData> {
  return withCommand("dogfood.review.show", runReviewShowCommand({ workspace: DOGFOOD_WORKSPACE, id }));
}

export function runDogfoodReviewApproveCommand(
  id: string,
  options: { execute?: boolean; executor?: string } = {}
): CommandSuccess<ReviewDecisionCommandData> {
  return withCommand("dogfood.review.approve", runReviewApproveCommand({ workspace: DOGFOOD_WORKSPACE, id, ...options }));
}

export function runDogfoodReviewRejectCommand(id: string): CommandSuccess<ReviewDecisionCommandData> {
  return withCommand("dogfood.review.reject", runReviewRejectCommand({ workspace: DOGFOOD_WORKSPACE, id }));
}

export function runDogfoodReviewDeferCommand(id: string): CommandSuccess<ReviewDecisionCommandData> {
  return withCommand("dogfood.review.defer", runReviewDeferCommand({ workspace: DOGFOOD_WORKSPACE, id }));
}

export function renderDogfoodInitSuccess(response: CommandSuccess<DogfoodInitCommandData>): string[] {
  return [
    `Initialized Arcadia compatibility workspace: ${response.data.workspacePath}`,
    `Project: ${response.data.project.name} (${response.data.project.status})`,
    `Outcome: ${response.data.project.outcome ?? response.data.project.goal ?? "None"}`,
    `Milestone: ${response.data.milestone.title}`,
    `Next action: ${response.data.workItem.next_action}`,
    `Mission log: ${response.data.missionLog.markdown_path}`
  ];
}

export function renderDogfoodAskSuccess(response: CommandSuccess<AskCommandData>): string[] {
  return renderAskSuccess(response);
}

function dogfoodInitDataFromInit(data: InitCommandData): DogfoodInitCommandData {
  if (!data.seed) {
    throw new Error("Arcadia profile seed is required for dogfood init.");
  }

  return {
    workspacePath: data.workspacePath,
    project: data.seed.project,
    milestone: data.seed.milestone,
    workItem: data.seed.workItem,
    missionLog: data.seed.missionLog,
    createdConfig: data.createdConfig
  };
}

function withCommand<TData>(command: string, response: CommandSuccess<TData>): CommandSuccess<TData> {
  return {
    ...response,
    command
  };
}
