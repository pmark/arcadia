#!/usr/bin/env node
import * as dotenv from "dotenv";

dotenv.config();

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import {
  renderArtifactCreateSuccess,
  renderArtifactListSuccess,
  renderArtifactValidatePlanningSuccess,
  renderArtifactUpdateSuccess,
  runArtifactCreateCommand,
  runArtifactValidatePlanningCommand,
  runArtifactListCommand,
  runArtifactUpdateCommand
} from "./commands/artifact.js";
import { renderAskSuccess, runAskCommand } from "./commands/ask.js";
import { renderAskRuleTestSuccess, runAskRuleTestCommand } from "./commands/askRule.js";
import {
  renderAgentAskContractSuccess,
  renderAgentAskNotificationSentSuccess,
  renderAgentAskNotificationsSuccess,
  renderAgentAskPreviewSuccess,
  renderAgentAskSettleSuccess,
  runAgentAskContractCommand,
  runAgentAskNotificationSentCommand,
  runAgentAskNotificationsCommand,
  runAgentAskPreviewCommand,
  runAgentAskSettleCommand
} from "./commands/agentAsk.js";
import {
  renderBackBurnerArchiveSuccess,
  renderBackBurnerListSuccess,
  renderBackBurnerPromoteSuccess,
  renderBackBurnerShowSuccess,
  runBackBurnerArchiveCommand,
  runBackBurnerListCommand,
  runBackBurnerPromoteCommand,
  runBackBurnerShowCommand
} from "./commands/backBurner.js";
import {
  renderFeedbackListSuccess,
  renderFeedbackRecordSuccess,
  runFeedbackListCommand,
  runFeedbackRecordCommand
} from "./commands/feedback.js";
import {
  renderBlogConfigureSiteSuccess,
  renderBlogCreateIdeaSuccess,
  renderBlogDraftPostSuccess,
  renderBlogPrepareScheduleSuccess,
  renderBlogReviewSuccess,
  renderBlogSitesSuccess,
  runBlogConfigureSiteCommand,
  runBlogCreateIdeaCommand,
  runBlogDraftPostCommand,
  runBlogPrepareScheduleCommand,
  runBlogReviewCommand,
  runBlogSitesCommand
} from "./commands/blog.js";
import { renderCaptureSuccess, runCaptureCommand } from "./commands/capture.js";
import {
  renderCodexAssociateSuccess,
  renderCodexListSuccess,
  runCodexAssociateCommand,
  runCodexListCommand,
  runCodexSyncCommand
} from "./commands/codex.js";
import {
  renderAttentionSuccess,
  renderDashboardSnapshotSuccess,
  runAttentionCommand,
  runDashboardSnapshotCommand
} from "./commands/dashboard.js";
import {
  renderAdvanceQueueSuccess,
  renderAdvanceQueueReorderSuccess,
  renderAdvanceQueueMakeNextSuccess,
  renderAdvanceSuccess,
  renderSessionShowSuccess,
  runAdvanceCommand,
  runAdvanceQueueCommand,
  runAdvanceQueueArrangeCommand,
  runAdvanceQueueMakeNextCommand,
  runAdvanceQueueReorderCommand,
  runAdvanceQueueUndoCommand,
  runSessionShowCommand
} from "./commands/advance.js";
import {
  renderDogfoodAskSuccess,
  renderDogfoodInitSuccess,
  runDogfoodAskCommand,
  runDogfoodInitCommand,
  runDogfoodReviewApproveCommand,
  runDogfoodReviewCommand,
  runDogfoodReviewDeferCommand,
  runDogfoodReviewRejectCommand,
  runDogfoodReviewShowCommand,
  runDogfoodStatusCommand
} from "./commands/dogfood.js";
import { renderInboxImportSuccess, runInboxAddCommand, runInboxImportCommand } from "./commands/inbox.js";
import { renderInitSuccess, runInitCommand } from "./commands/init.js";
import {
  renderIngressActivitySuccess,
  renderIngressProcessSuccess,
  runIngressCaptureCommand,
  runIngressDescribeCommand,
  runIngressActivityCommand,
  runIngressListCommand,
  runIngressProcessCommand,
  runIngressRecoverCommand,
  renderIngressRecoverSuccess
} from "./commands/ingress.js";
import { runRuntimeCommand, renderRuntimeSuccess } from "./commands/runtime.js";
import {
  renderIngressServiceDoctorSuccess,
  renderIngressServiceStatusSuccess,
  renderIngressServiceTickSuccess,
  runIngressServiceDoctorCommand,
  runIngressServiceInstallCommand,
  runIngressServiceStatusCommand,
  runIngressServiceTickCommand,
  runIngressServiceUninstallCommand
} from "./commands/ingressService.js";
import {
  renderExperimentBriefSuccess,
  runExperimentBriefCommand
} from "./commands/experiment.js";
import { runLogCreateCommand } from "./commands/log.js";
import { renderGoSuccess, runGoCommand } from "./commands/go.js";
import {
  renderMilestoneCompleteSuccess,
  renderMilestoneCreateSuccess,
  renderMilestoneListSuccess,
  runMilestoneCompleteCommand,
  runMilestoneCreateCommand,
  runMilestoneListCommand
} from "./commands/milestone.js";
import { renderMemorySyncSuccess, runMemorySyncCommand } from "./commands/memory.js";
import { renderLivingSystemSyncSuccess, runLivingSystemSyncCommand } from "./livingSystem/sync.js";
import {
  renderProjectCreateSuccess,
  renderProjectImportSuccess,
  renderProjectListSuccess,
  renderProjectMetadataSuccess,
  renderProjectPrepareSuccess,
  renderProjectReplySuccess,
  renderProjectSetupContextAllSuccess,
  renderProjectSetupContextSuccess,
  renderProjectShowSuccess,
  renderProjectUpdateSuccess,
  runProjectCreateCommand,
  runProjectImportCommand,
  runProjectListCommand,
  runProjectMetadataCommand,
  runProjectPrepareCommand,
  runProjectReplyCommand,
  runProjectSetupContextAllCommand,
  runProjectSetupContextCommand,
  runProjectShowCommand,
  runProjectUpdateCommand
} from "./commands/project.js";
import { renderQueueSuccess, runQueueCommand } from "./commands/queue.js";
import { renderReportStatusSuccess, runReportStatusCommand } from "./commands/report.js";
import {
  renderReviewRequiredSuccess,
  renderReviewDecisionSuccess,
  renderReviewResolveReplySuccess,
  renderReviewOpenSuccess,
  renderReviewFlagAgentSuccess,
  renderReviewReassessSuccess,
  renderReviewShowSuccess,
  renderReviewWeeklySuccess,
  runReviewApproveCommand,
  runReviewDeferCommand,
  runReviewOpenCommand,
  runReviewFlagAgentCommand,
  runReviewReassessCommand,
  runReviewRejectCommand,
  runReviewResolveReplyCommand,
  runReviewRequiredCommand,
  runReviewShowCommand,
  runReviewWeeklyCommand
} from "./commands/review.js";
import {
  renderQaListSuccess,
  renderQaPrReviewSuccess,
  renderQaRecordSuccess,
  runQaListCommand,
  runQaPrReviewCommand,
  runQaRecordCommand,
  runQaRefreshCommand,
  runQaStatusCommand,
  runQaFetchCommand,
  runQaRestartCommand,
  runQaSwitchCommand,
  runQaVerdictCommand,
  renderQaRefreshSuccess,
  renderQaStatusSuccess,
  renderQaFetchSuccess,
  renderQaRestartSuccess,
  renderQaSwitchSuccess,
  renderQaVerdictSuccess
} from "./commands/qa.js";
import {
  renderProofTargetCheckSuccess,
  renderProofTargetListSuccess,
  runProofTargetCheckCommand,
  runProofTargetListCommand
} from "./commands/proofTargets.js";
import {
  renderRebusterConfigureSuccess,
  renderRebusterCreateRebusSuccess,
  renderRebusterIngestEventSuccess,
  renderRebusterStatusSuccess,
  runRebusterConfigureCommand,
  runRebusterCreateRebusCommand,
  runRebusterIngestEventCommand,
  runRebusterStatusCommand
} from "./commands/rebuster.js";
import {
  renderRunListSuccess,
  renderRunRetrySuccess,
  renderRunShowSuccess,
  runRunListCommand,
  runRunRetryCommand,
  runRunShowCommand
} from "./commands/run.js";
import { renderStatusSuccess, runStatusCommand } from "./commands/status.js";
import {
  renderIntelligenceImageSmokeSuccess,
  renderIntelligenceListJobsSuccess,
  renderIntelligenceSpeechSmokeSuccess,
  renderIntelligenceUsageSuccess,
  runIntelligenceImageSmokeCommand,
  runIntelligenceListJobsCommand,
  runIntelligenceServeCommand,
  runIntelligenceSpeechSmokeCommand,
  runIntelligenceUsageCommand
} from "./commands/intelligence.js";
import {
  renderOrientationEntryListSuccess,
  renderOrientationEntrySuccess,
  renderOrientationPacketComposeSuccess,
  renderOrientationPacketExportSuccess,
  renderOrientationCapacityClearSuccess,
  renderOrientationCapacityShowSuccess,
  renderOrientationCapacitySuccess,
  renderOrientationFitsSuccess,
  renderOrientationPacketListSuccess,
  renderOrientationPacketMarkSentSuccess,
  renderOrientationReplySuccess,
  renderOrientationTimelineSuccess,
  runOrientationCapacityClearCommand,
  runOrientationCapacitySetCommand,
  runOrientationCapacityShowCommand,
  runOrientationEntryAddCommand,
  runOrientationEntryCompleteCommand,
  runOrientationEntryConfirmCommand,
  runOrientationEntryDropCommand,
  runOrientationEntryListCommand,
  runOrientationEntryUpdateCommand,
  runOrientationFitsCommand,
  runOrientationPacketComposeCommand,
  runOrientationPacketExportCommand,
  runOrientationPacketListCommand,
  runOrientationPacketMarkSentCommand,
  runOrientationReplyCommand,
  runOrientationTimelineCommand
} from "./commands/orientation.js";
import {
  renderMissionControlFitsSuccess,
  renderMissionControlNodeSuccess,
  renderMissionControlOverviewSuccess,
  renderMissionControlReplySuccess,
  runMissionControlFitsCommand,
  runMissionControlNodeCommand,
  runMissionControlOverviewCommand,
  runMissionControlReplyCommand
} from "./commands/missionControl.js";
import {
  runWorkerInstallCommand,
  runWorkerStartCommand,
  runWorkerStatusCommand,
  runWorkerStopCommand,
  runWorkerUninstallCommand
} from "./commands/worker.js";
import { renderClarifySuccess, runClarifyCommand } from "./commands/clarify.js";
import {
  renderDigestComposeSuccess,
  renderDigestExportSuccess,
  renderDigestMarkPostedSuccess,
  renderDigestRunSuccess,
  runDigestComposeCommand,
  runDigestExportCommand,
  runDigestMarkPostedCommand,
  runDigestRunCommand
} from "./commands/digest.js";
import { renderDocsSyncSuccess, runDocsSyncCommand } from "./commands/docs.js";
import {
  renderDecisionApproveSuccess,
  renderDecisionNewSuccess,
  renderDecisionValidateSuccess,
  runDecisionApproveCommand,
  runDecisionNewCommand,
  runDecisionValidateCommand
} from "./commands/decision.js";
import {
  renderNextHistorySuccess,
  renderNextReadySuccess,
  renderNextSuccess,
  runNextCommand,
  runNextHistoryCommand,
  runNextReadyCommand
} from "./commands/next.js";
import { renderDocketSuccess, runDocketCommand } from "./commands/docket.js";
import { renderPlansSuccess, runPlansCommand } from "./commands/plans.js";
import { renderTidySuccess, runTidyCommand } from "./commands/tidy.js";
import { renderPortfolioSuccess, runPortfolioCommand } from "./commands/portfolio.js";
import { renderNowSuccess, runNowCommand } from "./commands/now.js";
import { renderPathSuccess, runPathCommand } from "./commands/path.js";
import {
  renderWorkResolveQuestionSuccess,
  renderWorkShowQuestionSuccess,
  runWorkResolveQuestionCommand,
  runWorkShowQuestionCommand
} from "./commands/workQuestion.js";
import { renderGateSuccess, runGateStatusCommand } from "./commands/gate.js";
import { renderWayStatusSuccess, runWayStatusCommand } from "./commands/way.js";
import {
  renderWorkAddSubtaskSuccess,
  renderWorkDoneSuccess,
  renderWorkListSuccess,
  renderWorkPlanSuccess,
  renderWorkRunSuccess,
  renderWorkUpdateSuccess,
  runWorkAddSubtaskCommand,
  runWorkDoneCommand,
  runWorkListCommand,
  runWorkPlanCommand,
  runWorkRunCommand,
  runWorkUpdateCommand
} from "./commands/work.js";
import { renderWorkMonitorSuccess, runWorkMonitorCommand } from "./commands/workMonitor.js";
import { renderWorkPullRequestsSuccess, runWorkPullRequestsCommand } from "./commands/workPullRequests.js";
import {
  renderWorkflowListSuccess,
  renderWorkflowMatchSuccess,
  renderWorkflowRunSuccess,
  renderWorkflowRunsSuccess,
  renderWorkflowShowSuccess,
  renderWorkflowValidateSuccess,
  runWorkflowAddCommand,
  runWorkflowListCommand,
  runWorkflowMatchCommand,
  runWorkflowRunCommand,
  runWorkflowRunsCommand,
  runWorkflowRunShowCommand,
  runWorkflowSetEnabledCommand,
  runWorkflowShowCommand,
  runWorkflowValidateCommand
} from "./commands/workflow.js";
import { normalizeError, validationError } from "./cli/errors.js";
import { invocationRoot, resolveInvocationPath } from "./cli/invocation.js";
import type { BackBurnerSurfaceCondition } from "./domain/types.js";
import type { BackBurnerFacetTag } from "./domain/constants.js";
import { ORIENTATION_EFFORTS, type OrientationEffort } from "./orientation/types.js";
import { recordCliActivity } from "./activity/recorder.js";
import {
  renderActivityListSuccess,
  renderReportSuccess,
  renderTimeListSuccess,
  renderTimeLogSuccess,
  runActivityListCommand,
  runReportCommand,
  runTimeListCommand,
  runTimeLogCommand
} from "./commands/activity.js";
import {
  createFailure,
  createSuccess,
  type CommandSuccess,
  type HumanRenderer,
  wantsJson,
  writeFailure,
  writeSuccess
} from "./cli/response.js";
import { loadUserConfig, setDefaultWorkspace, userConfigPath } from "./workspace/config.js";
import { getWorkspacePaths } from "./workspace/paths.js";
import { resolveWorkspace, type WorkspaceResolution } from "./workspace/resolve.js";

interface ConfigDefaultWorkspaceData {
  defaultWorkspace: string | null;
  configPath: string;
}

interface WorkspaceResolveData {
  source: WorkspaceResolution["source"];
  workspacePath: string | null;
  detail?: string;
}

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
      .option("--profile <name>", "Optional workspace profile: arcadia")
  ).action((workspace: string, options: { profile?: string; json?: boolean }) =>
    runCliAction("init", options, () => runInitCommand(workspace, options), renderInitSuccess)
  );

  const config = program.command("config").description("User-level Arcadia configuration");
  const configSet = config.command("set").description("Set user-level Arcadia configuration");
  addJsonOption(
    configSet
      .command("defaultWorkspace")
      .description("Set the persistent default workspace")
      .argument("<workspace>", "Workspace path")
  ).action((workspace: string, options: { json?: boolean }) =>
    runCliAction(
      "config.set.defaultWorkspace",
      options,
      () => {
        const updated = setDefaultWorkspace(workspace);
        return createSuccess({
          command: "config.set.defaultWorkspace",
          data: {
            defaultWorkspace: updated.defaultWorkspace ?? null,
            configPath: userConfigPath()
          }
        });
      },
      renderConfigDefaultWorkspaceSuccess
    )
  );

  const configGet = config.command("get").description("Inspect user-level Arcadia configuration");
  addJsonOption(
    configGet
      .command("defaultWorkspace")
      .description("Show the persistent default workspace")
  ).action((options: { json?: boolean }) =>
    runCliAction(
      "config.get.defaultWorkspace",
      options,
      () => {
        const loaded = loadUserConfig();
        return createSuccess({
          command: "config.get.defaultWorkspace",
          data: {
            defaultWorkspace: loaded.defaultWorkspace ?? null,
            configPath: userConfigPath()
          }
        });
      },
      renderConfigDefaultWorkspaceSuccess
    )
  );

  const workspace = program.command("workspace").description("Workspace utilities");
  addJsonOption(
    workspace
      .command("resolve")
      .description("Show the workspace resolution result")
      .option("--workspace <path>", "Workspace path")
  ).action((options: { workspace?: string; json?: boolean }) =>
    runCliAction(
      "workspace.resolve",
      options,
      () => {
        const resolution = resolveWorkspace({ workspace: options.workspace });
        return createSuccess({
          command: "workspace.resolve",
          workspace: resolution.workspacePath ?? undefined,
          data: {
            source: resolution.source,
            workspacePath: resolution.workspacePath,
            detail: resolution.detail
          }
        });
      },
      renderWorkspaceResolveSuccess
    )
  );

  const dogfood = program.command("dogfood").description("Compatibility shortcuts for .arcadia-workspace");
  addJsonOption(
    dogfood
      .command("init")
      .description("Initialize .arcadia-workspace with the Arcadia workspace profile")
  ).action((options: { json?: boolean }) =>
    runCliAction("dogfood.init", options, () => runDogfoodInitCommand(), renderDogfoodInitSuccess)
  );
  addJsonOption(
    dogfood
      .command("ask")
      .description("Issue a request through arcadia ask using .arcadia-workspace")
      .argument("<request>", "Natural-language request")
      .option("--run-safe", "Immediately run deterministic safe steps")
  ).action((request: string, options: { runSafe?: boolean; json?: boolean }) =>
    runCliAction(
      "dogfood.ask",
      options,
      () => runDogfoodAskCommand({ request, runSafe: options.runSafe }),
      renderDogfoodAskSuccess
    )
  );
  addJsonOption(
    dogfood
      .command("status")
      .description("Print status for .arcadia-workspace")
  ).action((options: { json?: boolean }) =>
    runCliAction("dogfood.status", options, () => runDogfoodStatusCommand(), renderStatusSuccess)
  );
  const dogfoodReview = dogfood
    .command("review")
    .description("Review Requires Review items in .arcadia-workspace");
  addJsonOption(dogfoodReview).action((options: { json?: boolean }) =>
    runCliAction(
      "dogfood.review",
      jsonOptionsFromArgv(options),
      () => runDogfoodReviewCommand(),
      renderReviewRequiredSuccess
    )
  );
  addJsonOption(
    dogfoodReview
      .command("show")
      .description("Show detailed Requires Review context from .arcadia-workspace")
      .argument("<id>", "Requires Review item id")
  ).action((id: string, options: { json?: boolean }) =>
    runCliAction(
      "dogfood.review.show",
      jsonOptionsFromArgv(options),
      () => runDogfoodReviewShowCommand(id),
      renderReviewShowSuccess
    )
  );
  addJsonOption(
    dogfoodReview
      .command("approve")
      .description("Approve a Requires Review item from .arcadia-workspace")
      .argument("<id>", "Requires Review item id")
      .option("--execute", "Execute the approved review item with an agent executor")
      .option("--no-execute", "Approve without executor execution and leave an execution review item")
      .option("--executor <name>", "Executor adapter to use when execution runs", "codex")
  ).action((id: string, options: { execute?: boolean; executor?: string; json?: boolean }) =>
    runCliAction(
      "dogfood.review.approve",
      jsonOptionsFromArgv(options),
      () => runDogfoodReviewApproveCommand(id, { execute: options.execute, executor: options.executor }),
      renderReviewDecisionSuccess
    )
  );
  addJsonOption(
    dogfoodReview
      .command("reject")
      .description("Reject a Requires Review item from .arcadia-workspace")
      .argument("<id>", "Requires Review item id")
  ).action((id: string, options: { json?: boolean }) =>
    runCliAction(
      "dogfood.review.reject",
      jsonOptionsFromArgv(options),
      () => runDogfoodReviewRejectCommand(id),
      renderReviewDecisionSuccess
    )
  );
  addJsonOption(
    dogfoodReview
      .command("defer")
      .description("Keep a Requires Review item open in .arcadia-workspace")
      .argument("<id>", "Requires Review item id")
  ).action((id: string, options: { json?: boolean }) =>
    runCliAction(
      "dogfood.review.defer",
      jsonOptionsFromArgv(options),
      () => runDogfoodReviewDeferCommand(id),
      renderReviewDecisionSuccess
    )
  );

  addJsonOption(
    program
    .command("status")
      .description("Print workspace status and write reports/status.md")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("status", options, () => runStatusCommand(options), renderStatusSuccess)
  );

  addJsonOption(
    program
      .command("ask")
      .description("Resolve natural language intent into an auditable Action and workflow plan")
      .argument("<request>", "Natural-language request")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--project <project-id>", "Optional project id")
      .option("--milestone <milestone-id>", "Optional milestone id")
      .option("--agent-profile <name>", "Coding agent profile for planning or build packets")
      .option("--source-ingress <source>", "Ingress source for audit trails")
      .option("--request-id <id>", "Idempotency key for this submitted capture")
      .option("--back-burner", "Shelve this request through the existing Back Burner intake path")
      .option("--source-ref <reference>", "Path, document id, or URL containing the full idea")
      .option("--surface-date <YYYY-MM-DD>", "Resurface on or after this date")
      .option("--surface-dependency <action-id>", "Resurface when this Action reaches --dependency-status")
      .option("--dependency-status <status>", "Dependency status: open, in_progress, done, blocked", "done")
      .option("--surface-predicate <name>", "Resurface when a registered predicate returns true")
      .option("--tag <tags...>", "Facet tags for grouping")
      .option("--reply-review-id <review-id>", "Review id from adapter reply context")
      .option("--run-safe", "Immediately run deterministic safe steps")
  ).action((request: string, options: {
    workspace: string;
    project?: string;
    milestone?: string;
    agentProfile?: string;
    sourceIngress?: string;
    requestId?: string;
    backBurner?: boolean;
    sourceRef?: string;
    surfaceDate?: string;
    surfaceDependency?: string;
    dependencyStatus?: string;
    surfacePredicate?: string;
    tag?: string[];
    replyReviewId?: string;
    runSafe?: boolean;
    json?: boolean;
  }) => runCliAction(
    "ask",
    options,
    () => runAskCommand({
      ...options,
      request,
      captureAsIdea: options.backBurner,
      surfaceCondition: surfaceConditionFromOptions(options),
      facetTags: options.tag as BackBurnerFacetTag[] | undefined,
      adapterMetadata: options.replyReviewId ? { reviewId: options.replyReviewId } : undefined
    }),
    renderAskSuccess
  ));

  const askRule = program.command("ask-rule").description("Inspect deterministic Ask routing rules");

  const agentAsk = program.command("agent-ask").description("Preview coding-agent Project management intent");
  addJsonOption(agentAsk.command("preview")
    .description("Normalize Agent Ask v1 and preview canonical effects without Project writes")
    .argument("[request]", "Strict Agent Ask v1 YAML or natural fallback text")
    .option("--file <path>", "Read the Agent Ask from a file")
    .option("--request-id <id>", "Required idempotency key for natural fallback")
    .option("--project <project>", "Destination Project for natural fallback")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((request: string | undefined, options: { workspace: string; file?: string; requestId?: string; project?: string; json?: boolean }) =>
    runCliAction("agent-ask.preview", options, () => runAgentAskPreviewCommand({ ...options, request }), renderAgentAskPreviewSuccess)
  );
  addJsonOption(agentAsk.command("settle")
    .description("Preview or apply the terminal disposition and effects of one Agent Ask proposal")
    .requiredOption("--proposal <id>", "Proposal id or original Agent Ask request id")
    .requiredOption("--request-id <id>", "Idempotency key for this settlement")
    .requiredOption("--disposition <accepted|rejected>", "Terminal proposal disposition")
    .option("--responsibility <autonomous|codex>", "Approved Responsibility for each created Action")
    .option("--top", "Place the accepted Action bundle or active Plan at the top of the queue")
    .option("--before <project/action>", "Place the accepted Action bundle or active Plan before this ordered Action")
    .option("--after <project/action>", "Place the accepted Action bundle or active Plan after this ordered Action")
    .option("--revision <number>", "Expected queue revision")
    .option("--preview <sha256>", "Exact preview fingerprint required with --apply")
    .option("--apply", "Apply the exact previewed settlement")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string; proposal: string; requestId: string; disposition: string; responsibility?: string;
    top?: boolean; before?: string; after?: string; revision?: string; preview?: string; apply?: boolean; json?: boolean;
  }) => runCliAction("agent-ask.settle", options, () => runAgentAskSettleCommand({
    ...options,
    disposition: options.disposition as "accepted" | "rejected",
    responsibility: options.responsibility as "autonomous" | "codex" | undefined,
    revision: options.revision === undefined ? undefined : Number(options.revision)
  }), renderAgentAskSettleSuccess));
  addJsonOption(agentAsk.command("contract")
    .description("Print the Agent Ask v1 schema, intents, and authority boundary")
  ).action((options: { json?: boolean }) =>
    runCliAction("agent-ask.contract", options, () => runAgentAskContractCommand(), renderAgentAskContractSuccess)
  );
  addJsonOption(agentAsk.command("notifications")
    .description("List durable Agent Ask settlement pings pending Discord delivery")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("agent-ask.notifications", options, () => runAgentAskNotificationsCommand(options), renderAgentAskNotificationsSuccess)
  );
  addJsonOption(agentAsk.command("notification-sent")
    .description("Record successful Discord delivery for one Agent Ask settlement")
    .requiredOption("--settlement <id>", "Settlement id")
    .requiredOption("--message-id <id>", "Discord message id")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; settlement: string; messageId: string; json?: boolean }) =>
    runCliAction("agent-ask.notification-sent", options, () => runAgentAskNotificationSentCommand(options), renderAgentAskNotificationSentSuccess)
  );
  addJsonOption(
    askRule
      .command("test")
      .description("Preview matching, extraction, routing, and processing without writes")
      .argument("<request>", "Ask message to test")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--project <project>", "Explicit destination Project id, slug, or name")
  ).action((request: string, options: { workspace: string; project?: string; json?: boolean }) =>
    runCliAction(
      "ask-rule.test",
      options,
      () => runAskRuleTestCommand({ ...options, request }),
      renderAskRuleTestSuccess
    )
  );

  addJsonOption(
    program
    .command("capture")
      .description("Capture executable intent as a structured Action")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--text <intent>", "Natural-language intent")
      .option("--project <project-id>", "Optional project id")
      .option("--milestone <milestone-id>", "Optional milestone id")
      .option("--expected-artifact <artifact>", "Optional expected artifact")
  ).action((options: {
    workspace: string;
    text: string;
    project?: string;
    milestone?: string;
    expectedArtifact?: string;
    json?: boolean;
  }) => runCliAction("capture", options, () => runCaptureCommand(options), renderCaptureSuccess));

  const backBurner = program.command("back-burner").description("List and manage Back Burner items");
  addJsonOption(
    backBurner
      .command("list")
      .description("List Back Burner items")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--status <status>", "Status filter: incubating, opportunistic, promoted, archived, all")
      .option("--fired <state>", "Condition filter: yes, no, all", "all")
      .option("--project <project>", "Project id or slug filter")
      .option("--tag <tag>", "Facet tag filter")
      .option("--group-by <facet>", "Group by: fired, project, tag, none", "fired")
  ).action((options: { workspace: string; status?: string; fired?: string; project?: string; tag?: string; groupBy?: string; json?: boolean }) =>
    runCliAction(
      "back-burner.list",
      options,
      () => runBackBurnerListCommand({
        ...options,
        status: options.status as Parameters<typeof runBackBurnerListCommand>[0]["status"],
        fired: parseFiredFilter(options.fired),
        tag: options.tag as Parameters<typeof runBackBurnerListCommand>[0]["tag"],
        groupBy: parseBackBurnerGroup(options.groupBy)
      }),
      renderBackBurnerListSuccess
    )
  );
  addJsonOption(
    backBurner
      .command("show")
      .description("Show one Back Burner item")
      .argument("<id>", "Back Burner item id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("back-burner.show", options, () => runBackBurnerShowCommand({ ...options, id }), renderBackBurnerShowSuccess)
  );
  addJsonOption(
    backBurner
      .command("promote")
      .description("Promote a Back Burner item to an Action")
      .argument("<id>", "Back Burner item id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--title <title>", "Action title")
      .option("--project <project-id>", "Optional project id")
      .option("--next-action <text>", "Action next action")
      .option("--classification <classification>", "Legacy alias for --responsibility")
      .option("--responsibility <responsibility>", "Responsibility: autonomous or codex")
  ).action((id: string, options: {
    workspace: string;
    title?: string;
    project?: string;
    nextAction?: string;
    classification?: string;
    responsibility?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "back-burner.promote",
      options,
      () => {
        const normalized = normalizeResponsibilityOption(options);
        return runBackBurnerPromoteCommand({
          ...normalized,
          id,
          classification: normalized.classification as Parameters<typeof runBackBurnerPromoteCommand>[0]["classification"]
        });
      },
      renderBackBurnerPromoteSuccess
    )
  );
  addJsonOption(
    backBurner
      .command("archive")
      .description("Archive a Back Burner item")
      .argument("<id>", "Back Burner item id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "back-burner.archive",
      options,
      () => runBackBurnerArchiveCommand({ ...options, id }),
      renderBackBurnerArchiveSuccess
    )
  );

  const feedback = program.command("feedback").description("Record and list Decisions on Ask responses");
  addJsonOption(
    feedback
      .command("record")
      .description("Record a thumbs-up or thumbs-down Decision on an Ask response")
      .argument("<ask-request-id>", "Ask Request id")
      .requiredOption("--decision <up|down>", "Feedback decision: up or down")
      .option("--note <text>", "Optional note explaining the feedback")
      .option("--source-ingress <source>", "Ingress source for audit trails")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((askRequestId: string, options: {
    workspace: string;
    decision: string;
    note?: string;
    sourceIngress?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "feedback.record",
      options,
      () => {
        if (options.decision !== "up" && options.decision !== "down") {
          throw validationError("--decision must be 'up' or 'down'.", { decision: options.decision });
        }
        return runFeedbackRecordCommand({ ...options, askRequestId, decision: options.decision });
      },
      renderFeedbackRecordSuccess
    )
  );
  addJsonOption(
    feedback
      .command("list")
      .description("List recent Ask response Decisions")
      .option("--limit <n>", "Maximum number of items to return", "50")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; limit?: string; json?: boolean }) =>
    runCliAction(
      "feedback.list",
      options,
      () => runFeedbackListCommand({ ...options, limit: options.limit ? Number(options.limit) : undefined }),
      renderFeedbackListSuccess
    )
  );

  const experiment = program.command("experiment").description("Experiment commands");
  addJsonOption(
    experiment
      .command("brief")
      .description("Create a deterministic experiment brief Artifact and Decision")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--project <project>", "Project id, slug, exact name, or alias")
      .requiredOption("--opportunity <text>", "Opportunity being considered")
      .requiredOption("--hypothesis <text>", "Hypothesis being tested")
      .requiredOption("--metric <text>", "Primary metric")
      .option("--baseline <text>", "Known baseline; defaults to Baseline unknown")
      .requiredOption("--evidence-needed <text>", "Evidence that must be collected")
      .requiredOption("--decision-criteria <text>", "Decision criteria")
      .requiredOption("--recommended-next-action <text>", "Recommended next Action")
      .option("--source-back-burner-item-id <id>", "Optional source Back Burner item id")
  ).action((options: {
    workspace: string;
    project: string;
    opportunity: string;
    hypothesis: string;
    metric: string;
    baseline?: string;
    evidenceNeeded: string;
    decisionCriteria: string;
    recommendedNextAction: string;
    sourceBackBurnerItemId?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "experiment.brief",
      options,
      () => runExperimentBriefCommand(options),
      renderExperimentBriefSuccess
    )
  );

  const project = program.command("project").description("Project commands");
  addJsonOption(
    project
      .command("create")
      .description("Create a project with built-in defaults")
      .argument("[name]", "Project name")
      .argument("[path]", "Optional project path")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((name: string | undefined, projectPath: string | undefined, options: { workspace?: string; json?: boolean }) => {
    const resolved = resolveProjectCreateArguments(name, projectPath, options);
    return runCliAction(
      "project.create",
      resolved.options,
      () => runProjectCreateCommand(resolved.commandOptions),
      renderProjectCreateSuccess
    );
  });
  addJsonOption(
    project
      .command("prepare")
      .description("Turn an explicit software-Project idea into governed, approval-ready planning work")
      .argument("<name>", "Project name")
      .argument("<idea>", "Free-form project idea")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--path <path>", "Repository path; defaults to the workspace Projects directory", resolveInvocationPath)
      .option("--agent-profile <name>", "Coding agent profile for the read-only planning packet")
  ).action((name: string, idea: string, options: {
    workspace: string;
    path?: string;
    agentProfile?: string;
    json?: boolean;
  }) => runCliAction(
    "project.prepare",
    options,
    () => runProjectPrepareCommand({ ...options, name, idea }),
    renderProjectPrepareSuccess
  ));
  addJsonOption(
    project
    .command("list")
    .description("List projects")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("project.list", options, () => runProjectListCommand(options), renderProjectListSuccess)
  );
  addJsonOption(
    project
      .command("show")
      .description("Show project details")
      .argument("<project-id>", "Project id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((projectId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "project.show",
      options,
      () => runProjectShowCommand({ ...options, projectId }),
      renderProjectShowSuccess
    )
  );
  addJsonOption(
    project
      .command("import")
      .description("Create a project without prompts")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--name <name>", "Project name")
      .requiredOption("--mission <mission>", "Project mission")
      .option("--goal <goal>", "Legacy alias for --outcome")
      .option("--outcome <outcome>", "Project outcome")
      .requiredOption("--milestone <milestone>", "Initial active milestone")
      .requiredOption("--next-action <action>", "Initial next action")
      .option("--classification <classification>", "Legacy alias for --responsibility")
      .option("--responsibility <responsibility>", "Responsibility: autonomous, codex, requires_review, blocked")
      .option("--status <status>", "Project status: active, paused, incubating, completed", "active")
      .option("--expected-artifact <artifact>", "Initial expected artifact")
  ).action((options: {
    workspace: string;
    name: string;
    mission: string;
    goal?: string;
    outcome?: string;
    milestone: string;
    nextAction: string;
    classification?: string;
    responsibility?: string;
    status: string;
    expectedArtifact?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "project.import",
      options,
      () => runProjectImportCommand(normalizeSemanticOptions(options) as Parameters<typeof runProjectImportCommand>[0]),
      renderProjectImportSuccess
    )
  );
  addJsonOption(
    project
      .command("update")
      .description("Update project fields")
      .argument("<project-id>", "Project id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--status <status>", "Status: active, paused, incubating, completed")
      .option("--mission <mission>", "Project mission")
      .option("--goal <goal>", "Legacy alias for --outcome")
      .option("--outcome <outcome>", "Project outcome")
  ).action((projectId: string, options: {
    workspace: string;
    status?: string;
    mission?: string;
    goal?: string;
    outcome?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "project.update",
      options,
      () => runProjectUpdateCommand({ ...normalizeOutcomeOption(options), projectId }),
      renderProjectUpdateSuccess
    )
  );
  addJsonOption(
    project
      .command("metadata")
      .description("Upsert deterministic project metadata")
      .argument("<project-id>", "Project id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--alias <alias>", "Project alias; repeat for multiple aliases", collectValues, undefined)
      .option("--repo-path <path>", "Target repository path", resolveInvocationPath)
      .option("--repository-url <url>", "Empty GitHub repository HTTPS or SSH URL")
      .option("--build-agent <agent>", "Approved scaffold agent: codex or claude-code")
      .option("--status-summary <summary>", "Project status summary")
      .option("--validation-command <command>", "Validation command; repeat for multiple commands", collectValues, undefined)
  ).action((projectId: string, options: {
    workspace: string;
    alias?: string[];
    repoPath?: string;
    repositoryUrl?: string;
    buildAgent?: string;
    statusSummary?: string;
    validationCommand?: string[];
    json?: boolean;
  }) =>
    runCliAction(
      "project.metadata",
      options,
      () => runProjectMetadataCommand({
        workspace: options.workspace,
        projectId,
        aliases: options.alias,
        repoPath: options.repoPath,
        repositoryUrl: options.repositoryUrl,
        buildAgent: options.buildAgent,
        statusSummary: options.statusSummary,
        validationCommands: options.validationCommand
      }),
      renderProjectMetadataSuccess
    )
  );
  addJsonOption(
    project
      .command("reply <projectId> <text>")
      .description("Interpret a reply (one Intelligence call) into project field updates and apply them")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <source>", "cli|dashboard", "cli")
  ).action((projectId: string, text: string, options: { workspace: string; source?: string; json?: boolean }) =>
    runCliAction(
      "project.reply",
      options,
      () => runProjectReplyCommand({ workspace: options.workspace, projectId, text, source: options.source as never }),
      renderProjectReplySuccess
    )
  );
  addJsonOption(
    project
      .command("setup-context")
      .description("Generate explicit Arcadia context files in a project repository, or every configured project with --all")
      .argument("[project-id]", "Project id, slug, name, or alias")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--repo <path>", "Repository path", resolveInvocationPath)
      .option("--all", "Update every active project with a configured repository path")
  ).action((projectId: string | undefined, options: {
    workspace?: string;
    repo?: string;
    all?: boolean;
    json?: boolean;
  }) => {
    if (options.all) {
      if (projectId || options.repo) {
        throw validationError("--all cannot be combined with a project identifier or --repo.");
      }
      return runCliAction(
        "project.setup-context-all",
        options,
        () => runProjectSetupContextAllCommand({ workspace: options.workspace }),
        renderProjectSetupContextAllSuccess
      );
    }
    return runCliAction(
      "project.setup-context",
      options,
      () => runProjectSetupContextCommand({
        workspace: options.workspace,
        projectId,
        repoPath: options.repo
      }),
      renderProjectSetupContextSuccess
    );
  });

  const inbox = program.command("inbox").description("Inbox commands");
  inbox
    .command("add")
    .description("Interactively add a manually classified inbox item")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runInboxAddCommand(options));
  addJsonOption(
    inbox
      .command("import")
      .description("Import a manually assigned Action without prompts")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--title <title>", "Action title")
      .requiredOption("--input <text>", "Raw input text")
      .requiredOption("--queue <queue>", "Queue: inbox, work_queue, requires_review, blocked")
      .option("--classification <classification>", "Legacy alias for --responsibility")
      .option("--responsibility <responsibility>", "Responsibility: autonomous, codex, requires_review, blocked")
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
      classification?: string;
      responsibility?: string;
      nextAction: string;
      project?: string;
      milestone?: string;
      expectedArtifact?: string;
      json?: boolean;
    }) => runCliAction(
      "inbox.import",
      options,
      () => runInboxImportCommand(normalizeResponsibilityOption(options, { required: true }) as never),
      renderInboxImportSuccess
    )
  );

  addJsonOption(
    program
      .command("queue")
      .description("Show grouped queues")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("queue", options, () => runQueueCommand(options), renderQueueSuccess)
  );

  addJsonOption(
    program
      .command("attention")
      .description("List immediate user-facing blockers and review actions")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("attention", options, () => runAttentionCommand(options), renderAttentionSuccess)
  );

  const advance = addJsonOption(
    program.command("advance")
      .description("Resolve the one governed Project transition")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--repo <path>", "Project repository", resolveInvocationPath, invocationRoot())
      .option("--session <id>", "Open the immutable packet for one launched Session")
  ).action((options: { workspace: string; repo: string; session?: string; json?: boolean }) =>
    runCliAction("advance", options, () => runAdvanceCommand(options), renderAdvanceSuccess)
  );
  const advanceQueue = addJsonOption(
    advance
      .command("queue")
      .description("Show ready Actions, active Runs, and every stop before dispatch")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) => {
    const resolved = reviewOptionsFromArgv(options);
    return runCliAction("advance.queue", resolved, () => runAdvanceQueueCommand(resolved), renderAdvanceQueueSuccess);
  });
  addJsonOption(
    advanceQueue
      .command("reorder")
      .description("Preview or atomically apply one approved Action queue move")
      .requiredOption("--move <project/action>", "Ordered Action key to move")
      .option("--top", "Move the Action to the top")
      .option("--before <project/action>", "Move before this Action")
      .option("--after <project/action>", "Move after this Action")
      .requiredOption("--request-id <id>", "Idempotency key for this reorder")
      .option("--revision <number>", "Expected queue revision for optimistic concurrency")
      .option("--apply", "Persist the previewed reorder")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string;
    move: string;
    top?: boolean;
    before?: string;
    after?: string;
    requestId: string;
    revision?: string;
    apply?: boolean;
    json?: boolean;
  }) => {
    const resolved = reviewOptionsFromArgv(options);
    return runCliAction(
      "advance.queue.reorder",
      resolved,
      () => runAdvanceQueueReorderCommand({
        ...resolved,
        revision: resolved.revision === undefined ? undefined : Number(resolved.revision)
      }),
      renderAdvanceQueueReorderSuccess
    );
  });
  addJsonOption(
    advanceQueue
      .command("make-next")
      .description("Preview or apply the governed Project pointer transition for one eligible queued Action")
      .requiredOption("--action <project/action>", "Explicitly ordered Action key")
      .requiredOption("--revision <number>", "Expected queue revision")
      .requiredOption("--request-id <id>", "Idempotency key for this pointer transition")
      .option("--preview <sha256>", "Exact preview fingerprint required with --apply")
      .option("--apply", "Apply the exact previewed Project and Plan pointer patch")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string;
    action: string;
    revision: string;
    requestId: string;
    preview?: string;
    apply?: boolean;
    json?: boolean;
  }) => {
    const resolved = reviewOptionsFromArgv(options);
    return runCliAction(
      "advance.queue.make-next",
      resolved,
      () => runAdvanceQueueMakeNextCommand({
        workspace: resolved.workspace,
        actionKey: resolved.action,
        revision: Number(resolved.revision),
        requestId: resolved.requestId,
        previewFingerprint: resolved.preview,
        apply: resolved.apply
      }),
      renderAdvanceQueueMakeNextSuccess
    );
  });
  addJsonOption(
    advanceQueue
      .command("arrange")
      .description("Preview or atomically replace the complete approved Action order")
      .requiredOption("--order <project/action...>", "Every active approved Action key in desired order")
      .requiredOption("--request-id <id>", "Idempotency key for this batch arrangement")
      .option("--revision <number>", "Expected queue revision for optimistic concurrency")
      .option("--apply", "Persist the previewed arrangement")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string;
    order: string[];
    requestId: string;
    revision?: string;
    apply?: boolean;
    json?: boolean;
  }) => {
    const resolved = reviewOptionsFromArgv(options);
    return runCliAction(
      "advance.queue.arrange",
      resolved,
      () => runAdvanceQueueArrangeCommand({
        ...resolved,
        revision: resolved.revision === undefined ? undefined : Number(resolved.revision)
      }),
      renderAdvanceQueueReorderSuccess
    );
  });
  addJsonOption(
    advanceQueue
      .command("undo")
      .description("Preview or atomically undo the current applied queue receipt")
      .requiredOption("--receipt <id>", "Applied queue receipt to undo")
      .requiredOption("--request-id <id>", "Idempotency key for this undo")
      .option("--revision <number>", "Expected queue revision for optimistic concurrency")
      .option("--apply", "Persist the previewed undo")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string;
    receipt: string;
    requestId: string;
    revision?: string;
    apply?: boolean;
    json?: boolean;
  }) => {
    const resolved = reviewOptionsFromArgv(options);
    return runCliAction(
      "advance.queue.undo",
      resolved,
      () => runAdvanceQueueUndoCommand({
        workspace: resolved.workspace,
        receiptId: resolved.receipt,
        requestId: resolved.requestId,
        revision: resolved.revision === undefined ? undefined : Number(resolved.revision),
        apply: resolved.apply
      }),
      renderAdvanceQueueReorderSuccess
    );
  });

  const session = program.command("session").description("Inspect thin coding-agent Session receipts");
  addJsonOption(
    session.command("show [id]")
      .description("Show one Session, process liveness, and exact reattach command")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string | undefined, options: { workspace: string; json?: boolean }) =>
    runCliAction("session.show", options, () => runSessionShowCommand({ workspace: options.workspace, id }), renderSessionShowSuccess)
  );

  const decision = program.command("decision").description("Create and update checked-in Decision documents");
  addJsonOption(
    decision
      .command("new")
      .description("Write a new Decision document, validated before it is written")
      .argument("<slug>", "Kebab-case slug for the Decision")
      .requiredOption("--project <project>", "Project id or slug that owns this Decision")
      .requiredOption("--question <question>", "The question this Decision answers")
      .option("--gap-type <gap-type>", "missing-decision, missing-external-input, missing-definition, or missing-success-criteria")
      .option("--recommendation <recommendation>", "Recommended resolution")
      .option("--confidence <confidence>", "high, medium, or low")
      .option("--plan <plan>", "Plan slug this Decision is scoped to")
      .option("--action <action>", "Action reference this Decision is scoped to")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((slug: string, options: {
    workspace: string;
    project: string;
    question: string;
    gapType?: string;
    recommendation?: string;
    confidence?: string;
    plan?: string;
    action?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "decision.new",
      options,
      () => runDecisionNewCommand({
        workspace: options.workspace,
        project: options.project,
        slug,
        question: options.question,
        gapType: options.gapType as never,
        recommendation: options.recommendation,
        confidence: options.confidence as never,
        plan: options.plan,
        action: options.action
      }),
      renderDecisionNewSuccess
    )
  );
  addJsonOption(
    decision
      .command("approve")
      .description("Ratify a Decision: sets status, answer, and decided date, validated before it is written")
      .argument("<id>", "Decision numeric id, slug, or filename")
      .requiredOption("--project <project>", "Project id or slug that owns this Decision")
      .requiredOption("--answer <answer>", "What was actually decided")
      .option("--decided <YYYY-MM-DD>", "Date decided; defaults to today")
      .option("--status <status>", "open, approved, rejected, or deferred", "approved")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: {
    workspace: string;
    project: string;
    answer: string;
    decided?: string;
    status?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "decision.approve",
      options,
      () => runDecisionApproveCommand({
        workspace: options.workspace,
        project: options.project,
        id,
        answer: options.answer,
        decided: options.decided,
        status: options.status as never
      }),
      renderDecisionApproveSuccess
    )
  );
  addJsonOption(
    decision
      .command("validate")
      .description("Validate one existing Decision document without a full docs sync")
      .argument("<id>", "Decision numeric id, slug, or filename")
      .requiredOption("--project <project>", "Project id or slug that owns this Decision")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; project: string; json?: boolean }) =>
    runCliAction(
      "decision.validate",
      options,
      () => runDecisionValidateCommand({ workspace: options.workspace, project: options.project, id }),
      renderDecisionValidateSuccess
    )
  );

  const blog = program.command("blog").description("Blogging capability commands");
  addJsonOption(
    blog
      .command("sites")
      .description("List configured blog sites")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("blog.sites", options, () => runBlogSitesCommand(options), renderBlogSitesSuccess)
  );
  addJsonOption(
    blog
      .command("configure-site")
      .description("Configure a Blogging capability site for a project")
      .argument("<project>", "Project id, slug, or exact name")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--stream <stream>", "Blog stream key")
      .requiredOption("--name <name>", "Blog site display name")
      .option("--site-url <url>", "Public site URL")
      .option("--content-repo-path <path>", "Optional content repository path")
      .option("--content-root <path>", "Optional content root inside the repository")
  ).action((project: string, options: {
    workspace: string;
    stream: string;
    name: string;
    siteUrl?: string;
    contentRepoPath?: string;
    contentRoot?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "blog.configure-site",
      options,
      () => runBlogConfigureSiteCommand({ ...options, project }),
      renderBlogConfigureSiteSuccess
    )
  );
  addJsonOption(
    blog
      .command("create-idea")
      .description("Create a local blog idea artifact")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--site <site-id>", "Blog site id")
      .requiredOption("--title <title>", "Idea title")
      .requiredOption("--summary <summary>", "Idea summary")
      .option("--source <source>", "Idea source", "manual")
  ).action((options: {
    workspace: string;
    site: string;
    title: string;
    summary: string;
    source?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "blog.create-idea",
      options,
      () => runBlogCreateIdeaCommand({
        workspace: options.workspace,
        siteId: options.site,
        title: options.title,
        summary: options.summary,
        source: options.source
      }),
      renderBlogCreateIdeaSuccess
    )
  );
  addJsonOption(
    blog
      .command("prepare-schedule")
      .description("Prepare a local blog schedule artifact and review item")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--site <site-id>", "Blog site id")
      .requiredOption("--week <yyyy-mm-dd>", "Week start date")
  ).action((options: { workspace: string; site: string; week: string; json?: boolean }) =>
    runCliAction(
      "blog.prepare-schedule",
      options,
      () => runBlogPrepareScheduleCommand({ workspace: options.workspace, siteId: options.site, week: options.week }),
      renderBlogPrepareScheduleSuccess
    )
  );
  addJsonOption(
    blog
      .command("draft-post")
      .description("Create a local draft scaffold from a blog idea")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--idea <idea-id>", "Blog idea id")
  ).action((options: { workspace: string; idea: string; json?: boolean }) =>
    runCliAction(
      "blog.draft-post",
      options,
      () => runBlogDraftPostCommand({ workspace: options.workspace, ideaId: options.idea }),
      renderBlogDraftPostSuccess
    )
  );
  addJsonOption(
    blog
      .command("review")
      .description("List blog posts and schedules that need review")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("blog.review", options, () => runBlogReviewCommand(options), renderBlogReviewSuccess)
  );

  const rebuster = program.command("rebuster").description("Rebuster bridge capability commands");
  addJsonOption(
    rebuster
      .command("configure")
      .description("Configure the Rebuster bridge for an Arcadia project")
      .requiredOption("--project <id>", "Arcadia Project id, slug, or exact name")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--repo-path <path>", "Rebuster repository path", resolveInvocationPath)
      .option("--base-url <url>", "Rebuster API or app base URL")
      .option("--dashboard-url <url>", "Rebuster Studio dashboard URL")
  ).action((options: {
    workspace: string;
    project: string;
    repoPath?: string;
    baseUrl?: string;
    dashboardUrl?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "rebuster.configure",
      options,
      () => runRebusterConfigureCommand(options),
      renderRebusterConfigureSuccess
    )
  );
  addJsonOption(
    rebuster
      .command("status")
      .description("Show Rebuster bridge status")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("rebuster.status", options, () => runRebusterStatusCommand(options), renderRebusterStatusSuccess)
  );
  addJsonOption(
    rebuster
      .command("create-rebus")
      .description("Create a Rebuster rebus from a strict structured spec")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--spec <path>", "Strict structured Rebuster spec file")
      .option("--spec-text <text>", "Strict structured Rebuster spec text")
      .option("--force", "Allow eligible Rebuster record updates")
  ).action((options: { workspace: string; spec?: string; specText?: string; force?: boolean; json?: boolean }) =>
    runCliAction(
      "rebuster.create-rebus",
      options,
      () => runRebusterCreateRebusCommand(options),
      renderRebusterCreateRebusSuccess
    )
  );
  addJsonOption(
    rebuster
      .command("ingest-event")
      .description("Ingest a Rebuster event JSON payload")
      .argument("<json-file>", "Path to a Rebuster event JSON file")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((jsonFile: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "rebuster.ingest-event",
      options,
      () => runRebusterIngestEventCommand({ workspace: options.workspace, jsonFile }),
      renderRebusterIngestEventSuccess
    )
  );

  const dashboard = program.command("dashboard").description("Dashboard read model commands");
  addJsonOption(
    dashboard
      .command("snapshot")
      .description("Emit the read-only dashboard snapshot")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "dashboard.snapshot",
      options,
      () => runDashboardSnapshotCommand(options),
      renderDashboardSnapshotSuccess
    )
  );

  const codex = program.command("codex").description("Codex Companion commands");
  addJsonOption(
    codex
      .command("list")
      .description("List observed Codex tasks and goals")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <source>", "Codex source: all, local-goals, cloud", "all")
      .option("--active-only", "Only show non-terminal tasks")
      .option("--no-sync", "Use the last Arcadia snapshot without observing Codex first")
  ).action((options: { workspace: string; source?: string; activeOnly?: boolean; sync?: boolean; json?: boolean }) =>
    runCliAction("codex.list", options, () => runCodexListCommand(options), renderCodexListSuccess)
  );
  addJsonOption(
    codex
      .command("sync")
      .description("Refresh observed Codex task and goal state")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <source>", "Codex source: all, local-goals, cloud", "all")
      .option("--active-only", "Only show non-terminal tasks")
  ).action((options: { workspace: string; source?: string; activeOnly?: boolean; json?: boolean }) =>
    runCliAction("codex.sync", options, () => runCodexSyncCommand(options), renderCodexListSuccess)
  );
  addJsonOption(
    codex
      .command("associate")
      .description("Associate an observed Codex task with an Arcadia project")
      .argument("<task-id>", "Arcadia Codex task id or Codex source id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--project <project-id>", "Arcadia project id")
      .option("--milestone <milestone-id>", "Arcadia milestone id")
  ).action((taskId: string, options: { workspace: string; project: string; milestone?: string; json?: boolean }) =>
    runCliAction(
      "codex.associate",
      options,
      () => runCodexAssociateCommand({
        workspace: options.workspace,
        taskId,
        projectId: options.project,
        milestoneId: options.milestone
      }),
      renderCodexAssociateSuccess
    )
  );

  addJsonOption(
    program
      .command("runtime")
      .description("Whether every installed Arcadia launch agent runs under the pinned runtime")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) => runCliAction(
    "runtime",
    options,
    () => runRuntimeCommand(options),
    renderRuntimeSuccess
  ));

  const ingress = program.command("ingress").description("iCloud Drive file ingress commands");
  addJsonOption(
    ingress
      .command("list")
      .description("List files waiting in the iCloud Drive ingress folder")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    json?: boolean;
  }) => runCliAction(
    "ingress.list",
    options,
    () => runIngressListCommand(options),
    (response) => response.data.files.map((file) => `${file.name} (${file.kind})`)
  ));
  addJsonOption(
    ingress
      .command("activity")
      .description("Show current and recent iCloud Drive ingress activity")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
      .option("--limit <count>", "Number of recent activity entries", "20")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    limit?: string;
    json?: boolean;
  }) => runCliAction(
    "ingress.activity",
    options,
    () => runIngressActivityCommand({ ...options, limit: Number(options.limit ?? 20) }),
    renderIngressActivitySuccess
  ));
  addJsonOption(
    ingress
      .command("describe")
      .description("Queue a description-driven Action for selected ingress files")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
      .requiredOption("--file <name>", "Ingress file name; repeat for multiple files", collectValues, [])
      .requiredOption("--description <text>", "What to do with the selected files")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    file?: string[];
    description: string;
    json?: boolean;
  }) => runCliAction(
    "ingress.describe",
    options,
    () => runIngressDescribeCommand({ ...options, files: options.file ?? [] }),
    (response) => [
      `Queued ingress Action for ${response.data.selectedFiles.length} file(s).`,
      `Request: ${response.data.requestFile}`
    ]
  ));
  addJsonOption(
    ingress
      .command("capture")
      .description("Copy local files into the iCloud ingress attachment convention and queue them")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
      .requiredOption("--file <path>", "Local file path; repeat for multiple files", collectValues, [])
      .option("--description <text>", "Optional instruction for the captured files")
      .option("--request-id <id>", "Idempotency key for this submitted capture")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    file?: string[];
    description?: string;
    requestId?: string;
    json?: boolean;
  }) => runCliAction(
    "ingress.capture",
    options,
    () => runIngressCaptureCommand({ ...options, files: options.file ?? [] }),
    (response) => [
      `Queued ingress capture for ${response.data.selectedFiles.length} file(s).`,
      `Request: ${response.data.requestFile}`
    ]
  ));
  addJsonOption(
    ingress
      .command("process")
      .description("Process iCloud Drive ingress request files")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
      .option("--stable-seconds <seconds>", "Minimum unchanged age before processing workflow files", "30")
      .option("--run-safe", "Immediately run deterministic safe steps")
      .option("--dry-run", "Report files that would be processed without changing files")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    stableSeconds?: string;
    runSafe?: boolean;
    dryRun?: boolean;
    json?: boolean;
  }) => runCliAction(
    "ingress.process",
    options,
    () => runIngressProcessCommand({ ...options, stableSeconds: Number(options.stableSeconds ?? 30) }),
    renderIngressProcessSuccess
  ));

  addJsonOption(
    ingress
      .command("recover")
      .description("Requeue files stranded in Processing by a pass that did not finish")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <name>", "Ingress source folder", "iCloudIdeas")
      .option("--ingress-root <path>", "ArcadiaIngress root folder")
      .option("--apply", "Actually requeue the files listed; without it nothing is changed")
  ).action((options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    apply?: boolean;
    json?: boolean;
  }) => runCliAction(
    "ingress.recover",
    options,
    () => runIngressRecoverCommand(options),
    renderIngressRecoverSuccess
  ));

  const ingressService = ingress.command("service").description("Install and inspect periodic macOS ingress processing");
  const addIngressServiceOptions = (command: Command): Command => command
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .option("--source <name>", "Ingress source folder", "iCloudIdeas")
    .option("--ingress-root <path>", "ArcadiaIngress root folder")
    .option("--interval-seconds <seconds>", "Launch interval in seconds", "60")
    .option("--stable-seconds <seconds>", "Minimum unchanged age for workflow files", "30")
    .option("--run-safe", "Run deterministic Workflows marked safe automatically");
  const normalizeIngressServiceOptions = (options: {
    workspace: string;
    source?: string;
    ingressRoot?: string;
    intervalSeconds?: string;
    stableSeconds?: string;
    json?: boolean;
  }) => ({
    ...options,
    intervalSeconds: Number(options.intervalSeconds ?? 60),
    stableSeconds: Number(options.stableSeconds ?? 30),
    runSafe: true
  });
  addJsonOption(addIngressServiceOptions(
    ingressService.command("install").description("Install or update the periodic macOS ingress service")
  )).action((options) => runCliAction(
    "ingress.service.install",
    options,
    () => runIngressServiceInstallCommand(normalizeIngressServiceOptions(options)),
    renderIngressServiceStatusSuccess
  ));
  addJsonOption(addIngressServiceOptions(
    ingressService.command("status").description("Show whether the periodic ingress service is installed and loaded")
  )).action((options) => runCliAction(
    "ingress.service.status",
    options,
    () => runIngressServiceStatusCommand(normalizeIngressServiceOptions(options)),
    renderIngressServiceStatusSuccess
  ));
  addJsonOption(addIngressServiceOptions(
    ingressService.command("doctor").description("Check the service, iCloud access, Workflow, and publication dependencies")
  )).action((options) => runCliAction(
    "ingress.service.doctor",
    options,
    () => runIngressServiceDoctorCommand(normalizeIngressServiceOptions(options)),
    renderIngressServiceDoctorSuccess
  ));
  addJsonOption(addIngressServiceOptions(
    ingressService.command("run").description("Run one service health check and ingress pass")
  )).action((options) => runCliAction(
    "ingress.service.run",
    options,
    () => runIngressServiceTickCommand(normalizeIngressServiceOptions(options)),
    renderIngressServiceTickSuccess
  ));
  addJsonOption(addIngressServiceOptions(
    ingressService.command("uninstall").description("Unload and remove the periodic macOS ingress service")
  )).action((options) => runCliAction(
    "ingress.service.uninstall",
    options,
    () => runIngressServiceUninstallCommand(normalizeIngressServiceOptions(options)),
    renderIngressServiceStatusSuccess
  ));

  const workflow = program.command("workflow").description("Discover and run deterministic local workflows");
  addJsonOption(
    workflow
      .command("list")
      .description("List configured workflows")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("workflow.list", options, () => runWorkflowListCommand(options), renderWorkflowListSuccess)
  );
  addJsonOption(
    workflow
      .command("show")
      .description("Show one workflow definition")
      .argument("<workflow-id>", "Workflow id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workflowId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("workflow.show", options, () => runWorkflowShowCommand({ ...options, workflowId }), renderWorkflowShowSuccess)
  );
  addJsonOption(
    workflow
      .command("match")
      .description("Identify the enabled workflow matching a file")
      .argument("<input-file>", "Input file")
      .option("--source <name>", "Optional ingress source")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((inputPath: string, options: { workspace: string; source?: string; json?: boolean }) =>
    runCliAction("workflow.match", options, () => runWorkflowMatchCommand({ ...options, inputPath }), renderWorkflowMatchSuccess)
  );
  addJsonOption(
    workflow
      .command("validate")
      .description("Validate a configured workflow or definition file without running it")
      .argument("[workflow-id]", "Workflow id")
      .option("--file <path>", "Workflow definition JSON file")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workflowId: string | undefined, options: { workspace: string; file?: string; json?: boolean }) =>
    runCliAction(
      "workflow.validate",
      options,
      () => runWorkflowValidateCommand({ ...options, workflowId, filePath: options.file }),
      renderWorkflowValidateSuccess
    )
  );
  addJsonOption(
    workflow
      .command("add")
      .description("Install a validated workflow definition in the workspace")
      .argument("<definition-file>", "Workflow definition JSON file")
      .option("--force", "Replace an existing workspace definition")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((filePath: string, options: { workspace: string; force?: boolean; json?: boolean }) =>
    runCliAction("workflow.add", options, () => runWorkflowAddCommand({ ...options, filePath }), renderWorkflowShowSuccess)
  );
  for (const enabled of [true, false]) {
    const commandName = enabled ? "enable" : "disable";
    addJsonOption(
      workflow
        .command(commandName)
        .description(`${enabled ? "Enable" : "Disable"} a workflow`)
        .argument("<workflow-id>", "Workflow id")
        .option("--workspace <path>", "Workspace path", defaultWorkspace())
    ).action((workflowId: string, options: { workspace: string; json?: boolean }) =>
      runCliAction(
        `workflow.${commandName}`,
        options,
        () => runWorkflowSetEnabledCommand({ ...options, workflowId, enabled }),
        renderWorkflowShowSuccess
      )
    );
  }
  addJsonOption(
    workflow
      .command("run")
      .description("Run a workflow against one input file")
      .argument("<workflow-id>", "Workflow id")
      .argument("<input-file>", "Input file")
      .option("--destination-root <path>", "Override the configured publication root")
      .option("--dry-run", "Validate and show the command and destination without writing files")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workflowId: string, inputPath: string, options: {
    workspace: string;
    destinationRoot?: string;
    dryRun?: boolean;
    json?: boolean;
  }) => runCliAction(
    "workflow.run",
    options,
    () => runWorkflowRunCommand({ ...options, workflowId, inputPath }),
    renderWorkflowRunSuccess
  ));
  addJsonOption(
    workflow
      .command("runs")
      .description("List durable workflow Runs")
      .option("--workflow <workflow-id>", "Filter by workflow id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; workflow?: string; json?: boolean }) =>
    runCliAction(
      "workflow.runs",
      options,
      () => runWorkflowRunsCommand({ ...options, workflowId: options.workflow }),
      renderWorkflowRunsSuccess
    )
  );
  const workflowRun = workflow.command("run-info").description("Inspect workflow Run evidence");
  addJsonOption(
    workflowRun
      .command("show")
      .description("Show one workflow Run")
      .argument("<run-id>", "Run id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((runId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "workflow.run.show",
      options,
      () => runWorkflowRunShowCommand({ ...options, runId }),
      renderWorkflowRunSuccess
    )
  );

  const digest = program.command("digest").description("Narrative Project digest commands");
  addJsonOption(
    digest
      .command("compose")
      .description("Compose one Project digest for an explicit activity window")
      .requiredOption("--project <project>", "Project id or slug")
      .requiredOption("--period <period>", "Window label: day, week, or month")
      .requiredOption("--from <instant>", "Inclusive ISO-8601 window start")
      .requiredOption("--to <instant>", "Exclusive ISO-8601 window end")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: {
    workspace: string;
    project: string;
    period: string;
    from: string;
    to: string;
    json?: boolean;
  }) => runCliAction("digest.compose", options, () => runDigestComposeCommand(options), renderDigestComposeSuccess));
  addJsonOption(
    digest
      .command("export")
      .description("Export one composed narrative digest Artifact into the Obsidian vault")
      .argument("<digest-id>", "Narrative digest id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((digestId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("digest.export", options, () => runDigestExportCommand({ ...options, digestId }), renderDigestExportSuccess)
  );
  addJsonOption(
    digest
      .command("run")
      .description("Compose, export, and queue delivery of every due Project and portfolio digest")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("digest.run", options, () => runDigestRunCommand(options), renderDigestRunSuccess)
  );
  addJsonOption(
    digest
      .command("mark-posted")
      .description("Record that a composed digest reached its delivery surface")
      .argument("<digest-id>", "Narrative digest id")
      .requiredOption("--message-id <id>", "Delivery surface message id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((digestId: string, options: { workspace: string; messageId: string; json?: boolean }) =>
    runCliAction(
      "digest.mark-posted",
      options,
      () => runDigestMarkPostedCommand({ ...options, digestId }),
      renderDigestMarkPostedSuccess
    )
  );

  const artifact = program.command("artifact").description("Artifact commands");
  addJsonOption(
    artifact
      .command("create")
      .description("Create an artifact, optionally linked to a project and/or Action")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--title <title>", "Artifact title")
      .requiredOption("--type <type>", "Artifact type")
      .option("--status <status>", "Status: planned, drafted, ready, published", "planned")
      .option("--path <path>", "Artifact path")
      .option("--project <project-id>", "Project id to link")
      .option("--work-item <work-item-id>", "Action id to link")
  ).action((options: {
    workspace: string;
    title: string;
    type: string;
    status?: string;
    path?: string;
    project?: string;
    workItem?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "artifact.create",
      options,
      () => runArtifactCreateCommand({
        workspace: options.workspace,
        projectId: options.project,
        workItemId: options.workItem,
        title: options.title,
        artifactType: options.type,
        status: options.status,
        path: options.path
      }),
      renderArtifactCreateSuccess
    )
  );
  addJsonOption(
    artifact
      .command("list")
      .description("List artifacts")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("artifact.list", options, () => runArtifactListCommand(options), renderArtifactListSuccess)
  );
  addJsonOption(
    artifact
      .command("update")
      .description("Update artifact status or path")
      .argument("<artifact-id>", "Artifact id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--status <status>", "Status: planned, drafted, ready, published")
      .option("--path <path>", "Artifact path")
  ).action((artifactId: string, options: { workspace: string; status?: string; path?: string; json?: boolean }) =>
    runCliAction(
      "artifact.update",
      options,
      () => runArtifactUpdateCommand({ ...options, artifactId }),
      renderArtifactUpdateSuccess
    )
  );
  addJsonOption(
    artifact
      .command("validate-planning")
      .description("Validate a Codex planning artifact against its originating packet")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--packet <path>", "Originating Codex planning packet path")
      .requiredOption("--artifact <path>", "Codex-produced planning artifact path")
  ).action((options: { workspace: string; packet: string; artifact: string; json?: boolean }) =>
    runCliAction(
      "artifact.validate-planning",
      options,
      () => runArtifactValidatePlanningCommand({
        workspace: options.workspace,
        packetPath: options.packet,
        artifactPath: options.artifact
      }),
      renderArtifactValidatePlanningSuccess
    )
  );

  const work = program.command("work").description("Action commands");
  addJsonOption(
    work
      .command("monitor")
      .description("Read-only scan of Project working copies, branches, and pull-request preservation state")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--no-pull-requests", "Use local Git evidence only; do not query GitHub")
  ).action((options: { workspace: string; pullRequests?: boolean; json?: boolean }) =>
    runCliAction(
      "work.monitor",
      options,
      () => runWorkMonitorCommand({
        workspace: options.workspace,
        includePullRequests: options.pullRequests
      }),
      renderWorkMonitorSuccess
    )
  );
  addJsonOption(
    work
      .command("prs")
      .description("List outstanding GitHub pull requests across Project repositories")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "work.pull-requests",
      options,
      () => runWorkPullRequestsCommand(options),
      renderWorkPullRequestsSuccess
    )
  );
  addJsonOption(
    work
      .command("list")
      .description("List Actions")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("work.list", options, () => runWorkListCommand(options), renderWorkListSuccess)
  );
  addJsonOption(
    work
      .command("update")
      .description("Update an existing Action")
      .argument("<work-id>", "Action id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--queue <queue>", "Queue: inbox, work_queue, requires_review, blocked")
      .option("--classification <classification>", "Legacy alias for --responsibility")
      .option("--responsibility <responsibility>", "Responsibility: autonomous, codex, requires_review, blocked")
      .option("--next-action <action>", "Next action")
      .option("--status <status>", "Status: open, in_progress, done, blocked")
      .option("--effort <size>", "Coarse time cost: quick|short|session|project, or none to clear")
      .option("--expected-artifact <artifact>", "Expected artifact, or none to clear")
      .option(
        "--clarification-status <status>",
        "Clarify-step state: unclarified|clarified|question_open, or none to clear"
      )
      .option(
        "--gap-type <type>",
        "What blocks clarification: missing-decision|missing-external-input|missing-definition|missing-success-criteria, or none to clear"
      )
      .option("--question <question>", "The one question whose answer unblocks this Action, or none to clear")
      .option("--confidence <level>", "Trust in the clarification: high|medium|low, or none to clear")
      .option("--source <source>", "What justified the clarification (an Action detail, a linked doc), or none to clear")
      .option("--parent <work-id>", "Re-parent under another Action, or none to promote to top level")
  ).action((workId: string, options: {
    workspace: string;
    queue?: string;
    classification?: string;
    responsibility?: string;
    nextAction?: string;
    status?: string;
    effort?: string;
    expectedArtifact?: string;
    clarificationStatus?: string;
    gapType?: string;
    question?: string;
    confidence?: string;
    source?: string;
    parent?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "work.update",
      options,
      () => runWorkUpdateCommand({
        ...normalizeResponsibilityOption(options),
        workId,
        effort: parseEffortOption(options.effort),
        expectedArtifact: parseClearableOption(options.expectedArtifact),
        clarificationStatus: parseClearableOption(options.clarificationStatus),
        gapType: parseClearableOption(options.gapType),
        openQuestion: parseClearableOption(options.question),
        confidence: parseClearableOption(options.confidence),
        clarificationSource: parseClearableOption(options.source),
        parentWorkItemId: parseClearableOption(options.parent)
      }),
      renderWorkUpdateSuccess
    )
  );
  addJsonOption(
    work
      .command("add-subtask")
      .description("Create a child Action under an existing one")
      .argument("<parent-id>", "Parent Action id")
      .requiredOption("--title <title>", "Subtask title")
      .option("--next-action <action>", "Concrete next action; defaults to the title, left unclarified")
      .option("--queue <queue>", "Queue: inbox, work_queue, requires_review, blocked")
      .option("--responsibility <responsibility>", "Responsibility: autonomous, codex, requires_review, blocked")
      .option("--expected-artifact <artifact>", "Optional expected artifact")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((parentId: string, options: {
    workspace: string;
    title: string;
    nextAction?: string;
    queue?: string;
    responsibility?: string;
    expectedArtifact?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "work.add-subtask",
      options,
      () => runWorkAddSubtaskCommand({
        workspace: options.workspace,
        parentId,
        title: options.title,
        nextAction: options.nextAction,
        queue: options.queue,
        classification: options.responsibility,
        expectedArtifact: options.expectedArtifact
      }),
      renderWorkAddSubtaskSuccess
    )
  );
  addJsonOption(
    work
      .command("show-question")
      .description("Full context for one Action's blocking question, and what it stands in front of on the Path")
      .argument("<work-id>", "Action id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "work.show-question",
      options,
      () => runWorkShowQuestionCommand({ ...options, workId }),
      renderWorkShowQuestionSuccess
    )
  );
  addJsonOption(
    work
      .command("resolve-question")
      .description("Answer an Action's blocking question, opening its Decision first if one was never opened")
      .argument("<work-id>", "Action id")
      .requiredOption("--answer <answer>", "The answer to record")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workId: string, options: { workspace: string; answer: string; json?: boolean }) =>
    runCliAction(
      "work.resolve-question",
      options,
      () => runWorkResolveQuestionCommand({ ...options, workId }),
      renderWorkResolveQuestionSuccess
    )
  );
  addJsonOption(
    work
      .command("done")
      .description("Mark an Action complete")
      .argument("<work-id>", "Action id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("work.done", options, () => runWorkDoneCommand({ ...options, workId }), renderWorkDoneSuccess)
  );
  addJsonOption(
    work
      .command("plan")
      .description("Create a workflow plan; coding-agent planning Actions also get an approval Decision")
      .argument("<work-id>", "Action id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--agent-profile <name>", "Coding agent profile for the planning packet")
  ).action((workId: string, options: { workspace: string; agentProfile?: string; json?: boolean }) =>
    runCliAction("work.plan", options, () => runWorkPlanCommand({ ...options, workId }), renderWorkPlanSuccess)
  );
  addJsonOption(
    work
      .command("run")
      .description("Run safe deterministic steps for an Action")
      .argument("<work-id>", "Action id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--plan <plan-id>", "Optional execution plan id")
      .option("--allow-codex-planning", "Allow approved Codex planning steps to run")
      .option("--allow-codex-build", "Allow approved Codex build steps to run")
      .option("--agent-profile <name>", "Coding agent profile name")
  ).action((workId: string, options: {
    workspace: string;
    plan?: string;
    allowCodexPlanning?: boolean;
    allowCodexBuild?: boolean;
    agentProfile?: string;
    json?: boolean;
  }) =>
    runCliAction("work.run", options, () => runWorkRunCommand({ ...options, workId }), renderWorkRunSuccess)
  );

  const run = program.command("run").description("Run commands");
  addJsonOption(
    run
      .command("list")
      .description("List recent runs")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--limit <n>", "Maximum number of runs to return", "10")
  ).action((options: { workspace: string; limit?: string; json?: boolean }) =>
    runCliAction("run.list", options, () => runRunListCommand(options), renderRunListSuccess)
  );
  addJsonOption(
    run
      .command("show")
      .description("Show a run audit trail")
      .argument("<run-id>", "Run id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((runId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("run.show", options, () => runRunShowCommand({ ...options, runId }), renderRunShowSuccess)
  );
  addJsonOption(
    run
      .command("retry")
      .description("Request an immutable retry Decision for a failed planning Run")
      .argument("<run-id>", "Run id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((runId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction("run.retry", options, () => runRunRetryCommand({ ...options, runId }), renderRunRetrySuccess)
  );

  const log = program.command("log").description("Mission log commands");
  log
    .command("create")
    .description("Interactively create a mission log")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runLogCreateCommand(options));

  const milestone = program.command("milestone").description("Milestone commands");
  addJsonOption(
    milestone
      .command("list")
      .description("List milestones")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--status <status>", "Optional status filter: active, paused, completed")
      .option("--limit <n>", "Maximum number of milestones to return", "10")
  ).action((options: { workspace: string; status?: string; limit?: string; json?: boolean }) =>
    runCliAction("milestone.list", options, () => runMilestoneListCommand(options), renderMilestoneListSuccess)
  );
  addJsonOption(
    milestone
      .command("create")
      .description("Create a milestone for a project")
      .argument("<project-id>", "Project id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--title <title>", "Milestone title")
  ).action((projectId: string, options: { workspace: string; title: string; json?: boolean }) =>
    runCliAction(
      "milestone.create",
      options,
      () => runMilestoneCreateCommand({ ...options, projectId }),
      renderMilestoneCreateSuccess
    )
  );
  addJsonOption(
    milestone
      .command("complete")
      .description("Mark a milestone complete")
      .argument("<milestone-id>", "Milestone id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((milestoneId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "milestone.complete",
      options,
      () => runMilestoneCompleteCommand({ ...options, milestoneId }),
      renderMilestoneCompleteSuccess
    )
  );

  const report = program.command("report").description("Report commands");
  addJsonOption(
    report
    .command("status")
    .description("Write reports/status.md")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("report.status", options, () => runReportStatusCommand(options), renderReportStatusSuccess)
  );

  const memory = program.command("memory").description("Persist accepted Arcadia memory projections");
  addJsonOption(
    memory
      .command("sync")
      .description("Create or repair accepted planning Artifact Records in the configured Obsidian vault")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--dry-run", "Report changes without modifying the vault")
  ).action((options: { workspace: string; dryRun?: boolean; json?: boolean }) =>
    runCliAction("memory.sync", options, () => runMemorySyncCommand(options), renderMemorySyncSuccess)
  );
  const memorySystem = memory.command("system").description("Project the Arcadia living-system presentation");
  addJsonOption(
    memorySystem
      .command("sync")
      .description("Preview or apply deterministic Project maps and Action timelines")
      .option("--project <project>", "Project slug")
      .option("--all", "Sync every active Project independently")
      .option("--apply", "Write the previewed changes to the configured Obsidian vault")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; project?: string; all?: boolean; apply?: boolean; json?: boolean }) =>
    runCliAction(
      "memory.system.sync",
      options,
      () => runLivingSystemSyncCommand(options),
      renderLivingSystemSyncSuccess
    )
  );

  const review = program
    .command("review")
    .description("List and decide Requires Review items")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .option("--json", "Emit machine-readable JSON output")
    .action((options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "review",
      reviewOptionsFromArgv(options),
      () => runReviewRequiredCommand({ workspace: reviewOptionsFromArgv(options).workspace }),
      renderReviewRequiredSuccess
    )
  );
  addJsonOption(
    review
      .command("open")
      .description("Open a clarification Decision holding one question about an Action")
      .argument("<work-id>", "Action id")
      .requiredOption("--question <question>", "The single question whose answer unblocks the Action")
      .option(
        "--gap-type <type>",
        "Why it is blocked: missing-decision|missing-external-input|missing-definition|missing-success-criteria"
      )
      .option("--recommendation <text>", "Optional recommendation to accompany the question")
      .option("--confidence <level>", "Confidence in the Action so far: high|medium|low")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((workId: string, options: {
    workspace: string;
    question: string;
    gapType?: string;
    recommendation?: string;
    confidence?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "review.open",
      reviewOptionsFromArgv(options),
      () => runReviewOpenCommand({
        ...reviewOptionsFromArgv(options),
        workId,
        question: options.question,
        gapType: options.gapType,
        recommendation: options.recommendation,
        confidence: options.confidence
      }),
      renderReviewOpenSuccess
    )
  );
  addJsonOption(
    review
      .command("show")
      .description("Show detailed Requires Review context")
      .argument("<id>", "Requires Review item id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "review.show",
      reviewOptionsFromArgv(options),
      () => runReviewShowCommand({ ...reviewOptionsFromArgv(options), id }),
      renderReviewShowSuccess
    )
  );
  addJsonOption(
    review
      .command("reassess")
      .description("Recheck a plan question against the Project's current governed state")
      .argument("<id>", "Requires Review Decision id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "review.reassess",
      reviewOptionsFromArgv(options),
      () => runReviewReassessCommand({ ...reviewOptionsFromArgv(options), id }),
      renderReviewReassessSuccess
    )
  );
  addJsonOption(
    review
      .command("flag-agent")
      .description("Park a plan question for later coding-agent review without starting a Run")
      .argument("<id>", "Requires Review Decision id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "review.flag-agent",
      reviewOptionsFromArgv(options),
      () => runReviewFlagAgentCommand({ ...reviewOptionsFromArgv(options), id }),
      renderReviewFlagAgentSuccess
    )
  );
  addJsonOption(
    review
      .command("approve")
      .description("Approve a Requires Review item and continue the intended Arcadia workflow")
      .argument("<id>", "Requires Review item id")
      .option("--execute", "Execute the approved review item with an agent executor")
      .option("--no-execute", "Approve without executor execution and leave an execution review item")
      .option("--executor <name>", "Executor adapter to use when execution runs", "codex")
      .option("--answer <text>", "Answer to a clarification Decision (required for those; no executor runs)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; execute?: boolean; executor?: string; answer?: string; json?: boolean }) =>
    runCliAction(
      "review.approve",
      reviewOptionsFromArgv(options),
      () => runReviewApproveCommand({ ...reviewOptionsFromArgv(options), id, execute: options.execute, executor: options.executor, answer: options.answer }),
      renderReviewDecisionSuccess
    )
  );
  addJsonOption(
    review
      .command("reject")
      .description("Reject a Requires Review item without executing it")
      .argument("<id>", "Requires Review item id")
      .option("--feedback <text>", "Required feedback when sending a prepared plan back for refinement")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; feedback?: string; json?: boolean }) =>
    runCliAction(
      "review.reject",
      reviewOptionsFromArgv(options),
      () => runReviewRejectCommand({ ...reviewOptionsFromArgv(options), id, feedback: options.feedback }),
      renderReviewDecisionSuccess
    )
  );
  addJsonOption(
    review
      .command("defer")
      .description("Keep a Requires Review item open for future review")
      .argument("<id>", "Requires Review item id")
      .option("--trigger <text>", "Trigger condition that will bring this Decision back for review")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((id: string, options: { workspace: string; trigger?: string; json?: boolean }) =>
    runCliAction(
      "review.defer",
      reviewOptionsFromArgv(options),
      () => runReviewDeferCommand({ ...reviewOptionsFromArgv(options), id, trigger: options.trigger }),
      renderReviewDecisionSuccess
    )
  );
  addJsonOption(
    review
      .command("resolve-reply")
      .description("Resolve a Requires Review item from a short reply")
      .argument("<reply>", "Reply text, such as 'R45 A' or 'approve'")
      .option("--id <id>", "Requires Review item id when the reply came from a known message")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((reply: string, options: { id?: string; workspace: string; json?: boolean }) =>
    runCliAction(
      "review.resolve-reply",
      reviewOptionsFromArgv(options),
      () => runReviewResolveReplyCommand({ ...reviewOptionsFromArgv(options), id: options.id, reply }),
      renderReviewResolveReplySuccess
    )
  );
  addJsonOption(
    review
      .command("weekly")
      .description("Write a deterministic progress review, for one Project or the whole workspace")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--since <YYYY-MM-DD>", "Inclusive review start date")
      .option("--until <YYYY-MM-DD>", "Inclusive review end date")
      .option("--project <project>", "Only review one Project, by id or slug")
  ).action((options: { workspace: string; since?: string; until?: string; project?: string; json?: boolean }) =>
    runCliAction(
      "review.weekly",
      reviewOptionsFromArgv(options),
      () => runReviewWeeklyCommand({ ...options, ...reviewOptionsFromArgv(options) }),
      renderReviewWeeklySuccess
    )
  );

  const qa = program.command("qa").description("Configured Candidate QA queue");
  addJsonOption(
    qa
      .command("list")
      .description("List checked-in active Candidates for operator QA")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("qa.list", options, () => runQaListCommand(options), renderQaListSuccess)
  );
  addJsonOption(
    qa
      .command("record")
      .description("Record an operator QA Decision against a configured Candidate revision")
      .argument("<candidate-id>", "Configured Candidate id")
      .requiredOption("--decision <decision>", "pass, fail, or needs-follow-up")
      .option("--note <text>", "Optional concise operator note")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((candidateId: string, options: { workspace: string; decision: "pass" | "fail" | "needs-follow-up"; note?: string; json?: boolean }) =>
    runCliAction(
      "qa.record",
      options,
      () => runQaRecordCommand({ workspace: options.workspace, candidateId, decision: options.decision, note: options.note }),
      renderQaRecordSuccess
    )
  );
  addJsonOption(
    qa
      .command("status")
      .description("Read-only: how far each project's checkout is from its base branch, and what its services report")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("qa.status", options, () => runQaStatusCommand(options), renderQaStatusSuccess)
  );
  addJsonOption(
    qa
      .command("fetch")
      .description("Ask origin what it has. Writes refs only — never the working tree")
      .argument("<project>", "Project slug from the QA target configuration")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((project: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "qa.fetch",
      options,
      () => runQaFetchCommand({ workspace: options.workspace, project }),
      renderQaFetchSuccess
    )
  );
  addJsonOption(
    qa
      .command("verdict")
      .description("Read-only: whether the commits waiting at origin need a service restart")
      .argument("<project>", "Project slug from the QA target configuration")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((project: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "qa.verdict",
      options,
      () => runQaVerdictCommand({ workspace: options.workspace, project }),
      renderQaVerdictSuccess
    )
  );
  addJsonOption(
    qa
      .command("switch")
      .description("Return a project's checkout to its base branch. Refuses a dirty tree; never picks any other branch")
      .argument("<project>", "Project slug from the QA target configuration")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((project: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "qa.switch",
      options,
      () => runQaSwitchCommand({ workspace: options.workspace, project }),
      renderQaSwitchSuccess
    )
  );
  addJsonOption(
    qa
      .command("restart")
      .description("Restart a project's services without touching git")
      .argument("<project>", "Project slug from the QA target configuration")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((project: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "qa.restart",
      options,
      () => runQaRestartCommand({ workspace: options.workspace, project }),
      renderQaRestartSuccess
    )
  );
  addJsonOption(
    qa
      .command("refresh")
      .description("Fast-forward a project to its base branch, then restart its services")
      .argument("<project>", "Project slug from the QA target configuration")
      .option("--skip-restart", "Bring the checkout current but leave services running")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((project: string, options: { workspace: string; skipRestart?: boolean; json?: boolean }) =>
    runCliAction(
      "qa.refresh",
      options,
      () => runQaRefreshCommand({ workspace: options.workspace, project, skipRestart: options.skipRestart }),
      renderQaRefreshSuccess
    )
  );
  addJsonOption(
    qa
      .command("pr")
      .description("Run independent read-only QA against one immutable GitHub pull-request revision")
      .argument("<pull-request-url>", "Full GitHub pull-request URL")
      .option("--reviewer <profile>", "Configured read-only coding-agent profile")
      .option("--rerun", "Run a new review even when this exact revision already has receipts")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((pullRequest: string, options: { workspace: string; reviewer?: string; rerun?: boolean; json?: boolean }) =>
    runCliAction(
      "qa.pr",
      options,
      () => runQaPrReviewCommand({
        workspace: options.workspace,
        pullRequest,
        reviewerProfile: options.reviewer,
        rerun: options.rerun
      }),
      renderQaPrReviewSuccess
    )
  );

  const proofTarget = program.command("proof-target").description("Configured Stable/Candidate proof targets for the Project Detail hero");
  addJsonOption(
    proofTarget
      .command("list")
      .description("List a Project's configured proof targets and resolve the demo hero state")
      .requiredOption("--project <project>", "Project id or slug")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; project: string; json?: boolean }) =>
    runCliAction(
      "proof-target.list",
      options,
      () => runProofTargetListCommand(options),
      renderProofTargetListSuccess
    )
  );
  addJsonOption(
    proofTarget
      .command("check")
      .description("Run a deterministic reachability check against a configured proof target and persist the result")
      .argument("<target-id>", "Configured proof target id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((targetId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "proof-target.check",
      options,
      () => runProofTargetCheckCommand({ workspace: options.workspace, targetId }),
      renderProofTargetCheckSuccess
    )
  );

  addJsonOption(
    program
      .command("clarify")
      .description("Evaluate unclarified Actions against the clarification rubric (dry run unless --apply)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--project <project-id>", "Only clarify Actions in this Project")
      .option("--work <work-id>", "Clarify one Action by id, whatever its current state")
      .option("--limit <count>", "Evaluate at most this many Actions")
      .option("--apply", "Persist the results; without it nothing is written")
  ).action((options: {
    workspace: string;
    project?: string;
    work?: string;
    limit?: string;
    apply?: boolean;
    json?: boolean;
  }) =>
    runCliAction(
      "clarify",
      options,
      () => runClarifyCommand({
        workspace: options.workspace,
        projectId: options.project,
        workId: options.work,
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
        apply: options.apply
      }),
      renderClarifySuccess
    )
  );

  addJsonOption(
    program
      .command("tidy")
      .description("Retire worktrees and branches whose work is already on the base branch; report everything else")
      .option("--repo <path>", "Repository to tidy", resolveInvocationPath, invocationRoot())
      .option("--apply", "Actually retire what is listed; without it nothing is changed")
      .option("--include-own-branches", "Also retire fully merged branches you named yourself, not just agent-owned ones")
      .option("--no-fetch", "Compare against the local base branch only; skip fetching origin first")
      .option("--no-github", "Skip pull-request verification even when the GitHub CLI is available")
  ).action((options: { repo?: string; apply?: boolean; includeOwnBranches?: boolean; fetch?: boolean; github?: boolean; json?: boolean }) =>
    runCliAction(
      "tidy",
      options,
      () => runTidyCommand({ ...options, noFetch: options.fetch === false, noGithub: options.github === false }),
      renderTidySuccess
    )
  );

  addJsonOption(
    program
      .command("docket")
      .description("What this repository says to work on next, read only from this repository")
      .option("--repo <path>", "Repository to read", resolveInvocationPath, invocationRoot())
      .option("--project <project>", "Project slug, when the repository declares more than one")
  ).action((options: { repo: string; project?: string; json?: boolean }) =>
    runCliAction("docket", options, () => runDocketCommand(options), renderDocketSuccess)
  );

  addJsonOption(
    program
      .command("plans")
      .description("Every plan a repository holds, governed or not, and why each ungoverned one has not started")
      .option("--repo <path>", "Repository to read", resolveInvocationPath, invocationRoot())
      .option("--project <project>", "Project slug, when the repository declares more than one")
  ).action((options: { repo: string; project?: string; json?: boolean }) =>
    runCliAction("plans", options, () => runPlansCommand(options), renderPlansSuccess)
  );

  const next = program
    .command("next")
    .description("Resolve the authoritative current action a coding agent should advance");
  addJsonOption(
    next
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--project <project>", "Project id or slug")
      .option("--ready", "List every Action in the active plan that could be dispatched now")
  ).action((options: { workspace: string; project?: string; ready?: boolean; json?: boolean }) =>
    options.ready
      ? runCliAction("next.ready", options, () => runNextReadyCommand(options), renderNextReadySuccess)
      : runCliAction("next", options, () => runNextCommand(options), renderNextSuccess)
  );

  addJsonOption(
    next
      .command("history")
      .description("How often dispatch was refused, and on which field")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--limit <count>", "How many recent resolutions to list", "20")
  ).action((_options: unknown, command: Command) => {
    // `next` declares --workspace too, and commander binds a repeated flag to
    // the parent. optsWithGlobals is what makes `next history --workspace X`
    // see it wherever it landed.
    const options = command.optsWithGlobals() as { workspace: string; limit?: string; json?: boolean };
    return runCliAction(
      "next.history",
      options,
      () => runNextHistoryCommand({ workspace: options.workspace, limit: Number(options.limit ?? 20) }),
      renderNextHistorySuccess
    );
  });

  addJsonOption(
    program
      .command("go")
      .description("Safely reconcile a completed agent worktree and verify the next governed handoff")
      .option("--repo <path>", "Target repository or any of its worktrees", resolveInvocationPath, invocationRoot())
      .option("--source <path>", "Completed agent worktree to reconcile; defaults to --repo", resolveInvocationPath)
      .option("--agent <agent>", "Prepare the next isolated worktree: codex or claude")
      .option("--apply", "Fast-forward and retire the source worktree; without it nothing is changed")
      .option("--model <model>", "Override the plan's recommended_model for the next agent session")
      .option("--effort <level>", "Override the plan's recommended_reasoning_effort for the next agent session")
      .option("--workspace <path>", "Workspace path used for the Session receipt", defaultWorkspace())
      .option("--launch", "Explicitly launch Claude Code in a detached tmux Session")
  ).action((options: { repo?: string; source?: string; agent?: string; apply?: boolean; model?: string; effort?: string; workspace?: string; launch?: boolean; json?: boolean }) =>
    runCliAction("go", options, () => {
      if (options.agent !== undefined && options.agent !== "codex" && options.agent !== "claude") {
        throw validationError("--agent must be codex or claude.", { agent: options.agent });
      }
      return runGoCommand({ ...options, agent: options.agent });
    }, renderGoSuccess)
  );

  const docs = program.command("docs").description("Managed documentation across every Project repository");
  addJsonOption(
    docs
      .command("sync")
      .description("Ingest managed docs into Arcadia (dry run unless --apply)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--project <project>", "Only crawl one Project, by id or slug")
      .option("--apply", "Persist the changes; without it nothing is written")
  ).action((options: { workspace: string; project?: string; apply?: boolean; json?: boolean }) =>
    runCliAction(
      "docs.sync",
      options,
      () => runDocsSyncCommand(options),
      renderDocsSyncSuccess
    )
  );

  const gate = program
    .command("gate")
    .description("Mark operator-owned gates on the declared North Star");

  addJsonOption(
    gate
      .command("complete <gateId>")
      .description("Mark one operator-owned gate done")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((gateId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "gate.complete",
      options,
      () => runGateStatusCommand({ workspace: options.workspace, gateId, status: "done" }),
      renderGateSuccess
    )
  );

  addJsonOption(
    gate
      .command("reopen <gateId>")
      .description("Return one operator-owned gate to open")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((gateId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "gate.reopen",
      options,
      () => runGateStatusCommand({ workspace: options.workspace, gateId, status: "open" }),
      renderGateSuccess
    )
  );

  addJsonOption(
    program
      .command("now")
      .description("The one screen: how far the declared North Star is, and the single next move toward it")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--narrate", "Ask local Intelligence to write the orientation paragraph", false)
      .option("--window <days>", "Attention window in days", "7")
  ).action((options: { workspace: string; narrate?: boolean; window?: string; json?: boolean }) =>
    runCliAction(
      "now",
      options,
      () =>
        runNowCommand({
          workspace: options.workspace,
          narrate: Boolean(options.narrate),
          windowDays: Number.parseInt(options.window ?? "7", 10) || 7
        }),
      renderNowSuccess
    )
  );

  addJsonOption(
    program
      .command("path")
      .description("Every documented step between today and the declared North Star, in dependency order")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("path", options, () => runPathCommand({ workspace: options.workspace }), renderPathSuccess)
  );

  addJsonOption(
    program
      .command("portfolio")
      .description("Executive view of every Project: work in flight, clarity, and Decisions waiting")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("portfolio", options, () => runPortfolioCommand(options), renderPortfolioSuccess)
  );

  addJsonOption(
    program
      .command("way")
      .description("Report which projects have drifted from the canonical Arcadia Way text")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction("way", options, () => runWayStatusCommand(options), renderWayStatusSuccess)
  );

  const worker = program.command("worker").description("Background execution worker daemon");

  worker
    .command("start")
    .description("Start the worker daemon and process queued execution runs")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runWorkerStartCommand(options));

  worker
    .command("stop")
    .description("Stop the running worker daemon")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runWorkerStopCommand(options));

  worker
    .command("status")
    .description("Show whether the worker daemon is running")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runWorkerStatusCommand(options));

  worker
    .command("install")
    .description("Install worker as a launchd service (macOS) that starts on login")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runWorkerInstallCommand(options));

  worker
    .command("uninstall")
    .description("Remove the launchd service and stop the worker")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .action((options: { workspace: string }) => runWorkerUninstallCommand(options));

  const intelligence = program
    .command("intelligence")
    .description("Generic local structured-generation service (Arcadia Intelligence v0.1)");

  intelligence
    .command("serve")
    .description("Start the Arcadia Intelligence API and in-process worker in the foreground")
    .option("--workspace <path>", "Workspace path", defaultWorkspace())
    .option("--port <number>", "HTTP port", (value) => Number.parseInt(value, 10))
    .action((options: { workspace: string; port?: number }) => runIntelligenceServeCommand(options));

  addJsonOption(
    intelligence
      .command("smoke-image")
      .description("Submit and run one local image-generation smoke job")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--prompt <text>", "Image prompt")
      .option("--route <name>", "Local image route name")
      .option("--idempotency-key <key>", "Optional idempotency key")
  ).action((options: {
    workspace: string;
    prompt?: string;
    route?: string;
    idempotencyKey?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "intelligence.smoke-image",
      options,
      () => runIntelligenceImageSmokeCommand(options),
      renderIntelligenceImageSmokeSuccess
    )
  );

  addJsonOption(
    intelligence
      .command("smoke-speech")
      .description("Submit and run one local text-to-speech smoke job (requires ARCADIA_SPEECH_LOCAL_ROUTE, a LiteLLM model alias)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--text <text>", "Text to synthesize")
      .option("--voice-id <id>", "Semantic Arcadia voice id (e.g. arcadia.narrator)")
      .option("--route <name>", "Local speech route/model alias")
      .option("--idempotency-key <key>", "Optional idempotency key")
  ).action((options: {
    workspace: string;
    text?: string;
    voiceId?: string;
    route?: string;
    idempotencyKey?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "intelligence.smoke-speech",
      options,
      () => runIntelligenceSpeechSmokeCommand(options),
      renderIntelligenceSpeechSmokeSuccess
    )
  );

  addJsonOption(
    intelligence
      .command("list-jobs")
      .description("List recent Arcadia Intelligence jobs for a given clientApp (read-only history)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .requiredOption("--client-app <name>", "clientApp to filter by")
      .option("--limit <n>", "Maximum number of jobs to return", "20")
  ).action((options: { workspace: string; clientApp: string; limit?: string; json?: boolean }) =>
    runCliAction(
      "intelligence.list-jobs",
      options,
      () => runIntelligenceListJobsCommand({
        workspace: options.workspace,
        clientApp: options.clientApp,
        limit: options.limit ? Number(options.limit) : undefined
      }),
      renderIntelligenceListJobsSuccess
    )
  );

  addJsonOption(
    intelligence
      .command("usage")
      .description("Show read-only current-day Intelligence usage and coding-agent availability")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--refresh", "Request a fresh provider usage snapshot")
  ).action((options: { workspace: string; refresh?: boolean; json?: boolean }) =>
    runCliAction(
      "intelligence.usage",
      options,
      () => runIntelligenceUsageCommand(options),
      renderIntelligenceUsageSuccess
    )
  );

  const orientation = program
    .command("orientation")
    .description("Daily Orientation Packet: a small Context Ledger, composed daily, corrected by reply");

  const orientationEntry = orientation
    .command("entry")
    .description("Manage Context Ledger entries");

  addJsonOption(
    orientationEntry
      .command("add")
      .description("Add a Context Ledger entry")
      .requiredOption("--type <type>", "active_concern|standing_responsibility|time_bound|parked_idea")
      .requiredOption("--title <text>", "One-line orientation fact")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--area <name>", "Life area (work, art, family, ideas, ...)")
      .option("--priority <level>", "low|normal|high|critical")
      .option("--horizon <horizon>", "now|soon|later|someday")
      .option("--due-at <iso>", "Hard date, ISO-8601 (time_bound entries)")
      .option("--effort <size>", "Coarse time cost: quick (≤15m) | short (≤1h) | session (1–3h) | project (multi-session)")
      .option("--detail <text>", "Optional longer context")
      .option("--source <source>", "cli|discord|admin|seed", "cli")
  ).action((options: {
    workspace: string;
    type: string;
    title: string;
    area?: string;
    priority?: string;
    horizon?: string;
    dueAt?: string;
    effort?: string;
    detail?: string;
    source?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "orientation.entry.add",
      options,
      () => runOrientationEntryAddCommand({
        workspace: options.workspace,
        entryType: options.type as never,
        title: options.title,
        area: options.area,
        priority: options.priority as never,
        horizon: options.horizon as never,
        dueAt: options.dueAt,
        effort: parseEffortOption(options.effort) ?? undefined,
        detail: options.detail,
        source: options.source as never
      }),
      renderOrientationEntrySuccess
    )
  );

  addJsonOption(
    orientationEntry
      .command("list")
      .description("List live Context Ledger entries (or --all for every status)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--all", "Include completed/dropped entries")
  ).action((options: { workspace: string; all?: boolean; json?: boolean }) =>
    runCliAction(
      "orientation.entry.list",
      options,
      () => runOrientationEntryListCommand(options),
      renderOrientationEntryListSuccess
    )
  );

  addJsonOption(
    orientationEntry
      .command("confirm <entryId>")
      .description("Confirm an entry is still true, refreshing its staleness clock")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((entryId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "orientation.entry.confirm",
      options,
      () => runOrientationEntryConfirmCommand({ workspace: options.workspace, entryId }),
      renderOrientationEntrySuccess
    )
  );

  addJsonOption(
    orientationEntry
      .command("complete <entryId>")
      .description("Mark an entry completed (leaves the live set)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((entryId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "orientation.entry.complete",
      options,
      () => runOrientationEntryCompleteCommand({ workspace: options.workspace, entryId }),
      renderOrientationEntrySuccess
    )
  );

  addJsonOption(
    orientationEntry
      .command("drop <entryId>")
      .description("Drop an entry (leaves the live set without completing it)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((entryId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "orientation.entry.drop",
      options,
      () => runOrientationEntryDropCommand({ workspace: options.workspace, entryId }),
      renderOrientationEntrySuccess
    )
  );

  addJsonOption(
    orientationEntry
      .command("update <entryId>")
      .description("Update an entry's fields, refreshing its staleness clock")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--title <text>", "New title")
      .option("--detail <text>", "New detail")
      .option("--area <name>", "New area")
      .option("--priority <level>", "low|normal|high|critical")
      .option("--horizon <horizon>", "now|soon|later|someday")
      .option("--due-at <iso>", "New hard date, ISO-8601")
      .option("--effort <size>", "quick|short|session|project, or none to clear the size")
  ).action((entryId: string, options: {
    workspace: string;
    title?: string;
    detail?: string;
    area?: string;
    priority?: string;
    horizon?: string;
    dueAt?: string;
    effort?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "orientation.entry.update",
      options,
      () => runOrientationEntryUpdateCommand({
        workspace: options.workspace,
        entryId,
        title: options.title,
        detail: options.detail,
        area: options.area,
        priority: options.priority as never,
        horizon: options.horizon as never,
        dueAt: options.dueAt,
        effort: parseEffortOption(options.effort)
      }),
      renderOrientationEntrySuccess
    )
  );

  addJsonOption(
    orientation
      .command("fits")
      .description("\"I have N minutes — what fits?\" Deterministic: filters by effort, ranks by urgency")
      .requiredOption("--minutes <n>", "Minutes actually available right now")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--limit <n>", "Maximum number of suggestions", "3")
  ).action((options: { workspace: string; minutes: string; limit?: string; json?: boolean }) =>
    runCliAction(
      "orientation.fits",
      options,
      () => runOrientationFitsCommand({
        workspace: options.workspace,
        minutes: Number(options.minutes),
        limit: options.limit ? Number(options.limit) : undefined
      }),
      renderOrientationFitsSuccess
    )
  );

  addJsonOption(
    orientation
      .command("timeline")
      .description("Every sized item drawn to the same scale, measured against what today holds")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--date <yyyy-mm-dd>", "Compare against this day's capacity, defaults to today")
  ).action((options: { workspace: string; date?: string; json?: boolean }) =>
    runCliAction(
      "orientation.timeline",
      options,
      () => runOrientationTimelineCommand({ workspace: options.workspace, localDate: options.date }),
      renderOrientationTimelineSuccess
    )
  );

  const orientationCapacity = orientation
    .command("capacity")
    .description("The one-line daily note of how much time today actually holds");

  addJsonOption(
    orientationCapacity
      .command("set")
      .description("State (or amend) today's capacity")
      .requiredOption("--note <text>", "One line in your own words, e.g. \"one client session + ~1h of gaps; evening gone\"")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--session-blocks <n>", "How many protected 1–3h blocks today holds (0 is meaningful)")
      .option("--fragment-minutes <n>", "Total minutes of small gaps between commitments")
      .option("--date <yyyy-mm-dd>", "Local date, defaults to today")
  ).action((options: {
    workspace: string;
    note: string;
    sessionBlocks?: string;
    fragmentMinutes?: string;
    date?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "orientation.capacity.set",
      options,
      () => runOrientationCapacitySetCommand({
        workspace: options.workspace,
        note: options.note,
        sessionBlocks: options.sessionBlocks === undefined ? undefined : Number(options.sessionBlocks),
        fragmentMinutes: options.fragmentMinutes === undefined ? undefined : Number(options.fragmentMinutes),
        localDate: options.date
      }),
      renderOrientationCapacitySuccess
    )
  );

  addJsonOption(
    orientationCapacity
      .command("show")
      .description("Show the capacity stated for a local day")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--date <yyyy-mm-dd>", "Local date, defaults to today")
  ).action((options: { workspace: string; date?: string; json?: boolean }) =>
    runCliAction(
      "orientation.capacity.show",
      options,
      () => runOrientationCapacityShowCommand({ workspace: options.workspace, localDate: options.date }),
      renderOrientationCapacityShowSuccess
    )
  );

  addJsonOption(
    orientationCapacity
      .command("clear")
      .description("Remove a day's capacity note (the packet falls back to its pre-capacity form)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--date <yyyy-mm-dd>", "Local date, defaults to today")
  ).action((options: { workspace: string; date?: string; json?: boolean }) =>
    runCliAction(
      "orientation.capacity.clear",
      options,
      () => runOrientationCapacityClearCommand({ workspace: options.workspace, localDate: options.date }),
      renderOrientationCapacityClearSuccess
    )
  );

  const orientationPacket = orientation
    .command("packet")
    .description("Compose and track daily Morning Packets");

  addJsonOption(
    orientationPacket
      .command("compose")
      .description("Compose today's packet (deterministic; --if-due is idempotent per local day)")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--if-due", "Succeed with alreadySent:true instead of erroring if today's packet already exists")
      .option("--no-daily-advantage", "Omit the Daily Advantage project-work line")
  ).action((options: { workspace: string; ifDue?: boolean; dailyAdvantage?: boolean; json?: boolean }) =>
    runCliAction(
      "orientation.packet.compose",
      options,
      () => runOrientationPacketComposeCommand({
        workspace: options.workspace,
        ifDue: options.ifDue,
        includeDailyAdvantage: options.dailyAdvantage
      }),
      renderOrientationPacketComposeSuccess
    )
  );

  addJsonOption(
    orientationPacket
      .command("export <packetId>")
      .description("Project a Morning Packet into the configured Obsidian vault, adding a local-AI perspective when absent")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((packetId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "orientation.packet.export",
      options,
      () => runOrientationPacketExportCommand({ workspace: options.workspace, packetId }),
      renderOrientationPacketExportSuccess
    )
  );

  addJsonOption(
    orientationPacket
      .command("mark-sent <packetId>")
      .description("Record the Discord message id a composed packet was pushed as")
      .requiredOption("--message-id <id>", "Discord message id")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((packetId: string, options: { workspace: string; messageId: string; json?: boolean }) =>
    runCliAction(
      "orientation.packet.mark-sent",
      options,
      () => runOrientationPacketMarkSentCommand({ workspace: options.workspace, packetId, messageId: options.messageId }),
      renderOrientationPacketMarkSentSuccess
    )
  );

  addJsonOption(
    orientationPacket
      .command("list")
      .description("List recently composed packets")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--limit <n>", "Maximum number to return", "10")
  ).action((options: { workspace: string; limit?: string; json?: boolean }) =>
    runCliAction(
      "orientation.packet.list",
      options,
      () => runOrientationPacketListCommand({ workspace: options.workspace, limit: options.limit ? Number(options.limit) : undefined }),
      renderOrientationPacketListSuccess
    )
  );

  addJsonOption(
    orientation
      .command("reply <text>")
      .description("Interpret a reply (one Intelligence call) into Context Ledger operations and apply them")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <source>", "cli|discord|admin", "cli")
      .option("--focused-entry-id <id>", "Prefer this entry when the reply is ambiguous between it and another")
  ).action((text: string, options: { workspace: string; source?: string; focusedEntryId?: string; json?: boolean }) =>
    runCliAction(
      "orientation.reply",
      options,
      () => runOrientationReplyCommand({
        workspace: options.workspace,
        text,
        source: options.source as never,
        focusedEntryId: options.focusedEntryId
      }),
      renderOrientationReplySuccess
    )
  );

  const time = program
    .command("time")
    .description("Log and review real time spent — described roughly, never clocked precisely");

  addJsonOption(
    time
      .command("log")
      .description("Log a block of work you already did")
      .requiredOption("--minutes <n>", "Roughly how long it took")
      .requiredOption("--description <text>", "What you did, in your own words")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--at <hh:mm>", "Roughly when it started, local clock")
      .option("--entry <entryId>", "Ledger entry this work was about")
      .option("--date <yyyy-mm-dd>", "Local date the work happened, defaults to today")
  ).action((options: {
    workspace: string;
    minutes: string;
    description: string;
    at?: string;
    entry?: string;
    date?: string;
    json?: boolean;
  }) =>
    runCliAction(
      "time.log",
      options,
      () => runTimeLogCommand({
        workspace: options.workspace,
        minutes: Number(options.minutes),
        description: options.description,
        at: options.at,
        entryId: options.entry,
        localDate: options.date
      }),
      renderTimeLogSuccess
    )
  );

  addJsonOption(
    time
      .command("list")
      .description("Show logged time")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--days <n>", "How many days back to include, including today", "1")
      .option("--date <yyyy-mm-dd>", "Last day of the window, defaults to today")
  ).action((options: { workspace: string; days?: string; date?: string; json?: boolean }) =>
    runCliAction(
      "time.list",
      options,
      () => runTimeListCommand({
        workspace: options.workspace,
        days: options.days ? Number(options.days) : undefined,
        localDate: options.date
      }),
      renderTimeListSuccess
    )
  );

  addJsonOption(
    program
      .command("activity")
      .description("The interaction log Arcadia keeps for free — when you were in it, and about what")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--days <n>", "How many days back to include, including today", "1")
      .option("--date <yyyy-mm-dd>", "Last day of the window, defaults to today")
  ).action((options: { workspace: string; days?: string; date?: string; json?: boolean }) =>
    runCliAction(
      "activity.list",
      options,
      () => runActivityListCommand({
        workspace: options.workspace,
        days: options.days ? Number(options.days) : undefined,
        localDate: options.date
      }),
      renderActivityListSuccess
    )
  );

  // Joins the existing `report` group (report status) rather than starting a
  // rival one — these are the same question at different time scales.
  for (const kind of ["daily", "weekly"] as const) {
    addJsonOption(
      report
        .command(kind)
        .description(kind === "daily" ? "Today's story" : "The last seven days")
        .option("--workspace <path>", "Workspace path", defaultWorkspace())
        .option("--date <yyyy-mm-dd>", "Last day of the window, defaults to today")
    ).action((options: { workspace: string; date?: string; json?: boolean }) =>
      runCliAction(
        `report.${kind}`,
        options,
        () => runReportCommand({ workspace: options.workspace, kind, localDate: options.date }),
        renderReportSuccess
      )
    );
  }

  const missionControl = program
    .command("mission-control")
    .description("Mission Control view: an overview across Life, Projects, and Decisions");

  addJsonOption(
    missionControl
      .command("overview")
      .description("Cross-tower overview: needs-you-now plus one summary per tower")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "mission-control.overview",
      options,
      () => runMissionControlOverviewCommand(options),
      renderMissionControlOverviewSuccess
    )
  );

  addJsonOption(
    missionControl
      .command("node <nodeId>")
      .description("Zoom into one node: its status, action items, context channel, and children")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
  ).action((nodeId: string, options: { workspace: string; json?: boolean }) =>
    runCliAction(
      "mission-control.node",
      options,
      () => runMissionControlNodeCommand({ workspace: options.workspace, nodeId }),
      renderMissionControlNodeSuccess
    )
  );

  addJsonOption(
    missionControl
      .command("fits")
      .description("What fits the time you actually have right now — deterministic, no model call")
      .requiredOption("--minutes <n>", "Minutes actually available")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--limit <n>", "Maximum number of suggestions", "3")
  ).action((options: { workspace: string; minutes: string; limit?: string; json?: boolean }) =>
    runCliAction(
      "mission-control.fits",
      options,
      () => runMissionControlFitsCommand({
        workspace: options.workspace,
        minutes: Number(options.minutes),
        limit: options.limit ? Number(options.limit) : undefined
      }),
      renderMissionControlFitsSuccess
    )
  );

  addJsonOption(
    missionControl
      .command("reply <nodeId> <text>")
      .description("Interpret a reply for whichever node this is, dispatching to the right interpreter")
      .option("--workspace <path>", "Workspace path", defaultWorkspace())
      .option("--source <source>", "cli|dashboard", "cli")
  ).action((nodeId: string, text: string, options: { workspace: string; source?: string; json?: boolean }) =>
    runCliAction(
      "mission-control.reply",
      options,
      () => runMissionControlReplyCommand({ workspace: options.workspace, nodeId, text, source: options.source as never }),
      renderMissionControlReplySuccess
    )
  );

  return program;
}

if (isMainModule()) {
  const program = buildProgram();
  program.parseAsync(process.argv).catch((error: unknown) => {
    // Commander's own help/version exits (bare `arcadia`, `arcadia --help`)
    // arrive here as CommanderErrors too, because the program suppresses
    // Commander's writeErr to keep its own JSON error format from being
    // doubled up with Commander's plain-text one. That suppression also ate
    // Commander's help text, since `help({ error: true })` writes through
    // writeErr. Print it explicitly instead of routing it through the
    // command-failure JSON formatter, which had nothing useful to say about
    // "no command given".
    if (error instanceof CommanderError && error.code.startsWith("commander.help")) {
      process.stdout.write(program.helpInformation());
      process.exitCode = error.exitCode === 0 ? 0 : 1;
      return;
    }

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

function defaultWorkspace(): string {
  return undefined as unknown as string;
}

/**
 * The same two-state distinction `parseEffortOption` makes, for free-text and
 * enum flags that have no validation to do at the CLI layer: undefined means
 * "leave it alone", the literal `none` means "clear it". Value validation stays
 * in the repository so every caller — CLI, Discord bot, future `clarify` — is
 * held to the same vocabulary.
 */
function parseClearableOption(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === "none" ? null : value;
}

/**
 * Shared by every `--effort` flag. Returns undefined for "leave it alone" and
 * null for the explicit `none`, which is how a size gets cleared back to
 * un-sized — the same two-state distinction the repository update honors.
 */
function parseEffortOption(value: string | undefined): OrientationEffort | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "") {
    return null;
  }
  if (!(ORIENTATION_EFFORTS as readonly string[]).includes(normalized)) {
    throw validationError(`Unknown effort "${value}". Expected one of: ${ORIENTATION_EFFORTS.join(", ")}, none.`, {
      effort: value
    });
  }
  return normalized as OrientationEffort;
}

function resolveProjectCreateArguments(
  name: string | undefined,
  projectPath: string | undefined,
  options: { workspace?: string; json?: boolean }
): {
  options: { workspace?: string; json?: boolean };
  commandOptions: { workspace: string; name?: string; path?: string };
} {
  if (!options.workspace && projectPath && isInitializedWorkspacePath(projectPath)) {
    return {
      options: { ...options, workspace: projectPath },
      commandOptions: { ...options, workspace: projectPath, name }
    };
  }

  return {
    options,
    commandOptions: { ...options, workspace: options.workspace as string, name, path: projectPath }
  };
}

function isInitializedWorkspacePath(candidate: string): boolean {
  return existsSync(getWorkspacePaths(candidate).configFile);
}

function normalizeSemanticOptions<TOptions extends {
  goal?: string;
  outcome?: string;
  classification?: string;
  responsibility?: string;
}>(options: TOptions): Omit<TOptions, "outcome" | "responsibility"> & {
  goal?: string;
  classification: string;
} {
  const normalized = normalizeResponsibilityOption(normalizeOutcomeOption(options), { required: true });
  return {
    ...normalized,
    classification: normalized.classification as string
  } as Omit<TOptions, "outcome" | "responsibility"> & {
    goal?: string;
    classification: string;
  };
}

function normalizeOutcomeOption<TOptions extends { goal?: string; outcome?: string }>(
  options: TOptions
): Omit<TOptions, "outcome"> & { goal?: string } {
  if (options.goal !== undefined && options.outcome !== undefined) {
    throw validationError("Use only one of --goal or --outcome.", {
      legacy: "--goal",
      canonical: "--outcome"
    });
  }

  const { outcome: _outcome, ...rest } = options;
  return {
    ...rest,
    goal: options.goal ?? options.outcome
  };
}

function normalizeResponsibilityOption<TOptions extends { classification?: string; responsibility?: string }>(
  options: TOptions,
  settings: { required?: boolean } = {}
): Omit<TOptions, "responsibility"> & { classification?: string } {
  if (options.classification !== undefined && options.responsibility !== undefined) {
    throw validationError("Use only one of --classification or --responsibility.", {
      legacy: "--classification",
      canonical: "--responsibility"
    });
  }

  const { responsibility: _responsibility, ...rest } = options;
  const classification = options.classification ?? options.responsibility;
  if (settings.required && classification === undefined) {
    throw validationError("Responsibility is required.", {
      options: ["--responsibility", "--classification"]
    });
  }

  return {
    ...rest,
    classification
  };
}

function surfaceConditionFromOptions(options: {
  surfaceDate?: string;
  surfaceDependency?: string;
  dependencyStatus?: string;
  surfacePredicate?: string;
}): BackBurnerSurfaceCondition | undefined {
  const selected = [options.surfaceDate, options.surfaceDependency, options.surfacePredicate].filter(
    (value) => value !== undefined
  );
  if (selected.length > 1) {
    throw validationError("Use only one Back Burner surface condition.", {
      options: ["--surface-date", "--surface-dependency", "--surface-predicate"]
    });
  }
  if (options.surfaceDate) return { kind: "date", date: options.surfaceDate };
  if (options.surfaceDependency) {
    const status = options.dependencyStatus ?? "done";
    if (!(["open", "in_progress", "done", "blocked"] as const).includes(status as "open")) {
      throw validationError("Dependency status must be one of: open, in_progress, done, blocked.", { status });
    }
    return { kind: "dependency", workItemId: options.surfaceDependency, status: status as "open" | "in_progress" | "done" | "blocked" };
  }
  if (options.surfacePredicate) return { kind: "predicate", name: options.surfacePredicate };
  return undefined;
}

function parseFiredFilter(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "all") return undefined;
  if (value === "yes") return true;
  if (value === "no") return false;
  throw validationError("Fired filter must be one of: yes, no, all.", { fired: value });
}

function parseBackBurnerGroup(value: string | undefined): "fired" | "project" | "tag" | "none" | undefined {
  if (value === undefined) return undefined;
  if ((["fired", "project", "tag", "none"] as const).includes(value as "fired")) {
    return value as "fired" | "project" | "tag" | "none";
  }
  throw validationError("Back Burner group must be one of: fired, project, tag, none.", { groupBy: value });
}

async function runCliAction<TData>(
  command: string,
  options: { workspace?: string; json?: boolean },
  action: () => CommandSuccess<TData> | Promise<CommandSuccess<TData>>,
  renderHuman: HumanRenderer<TData>
): Promise<void> {
  const context = { json: Boolean(options.json) };
  const startedAt = Date.now();

  try {
    const response = await action();
    writeSuccess(response, context, renderHuman);
    // Every surface reaches Arcadia through this one function, so recording
    // here is the whole of the interaction log — no per-command wiring, and
    // nothing that can drift out of date as commands are added.
    recordCliActivity({
      command,
      workspace: response.workspace ?? options.workspace,
      outcome: "ok",
      durationMs: Date.now() - startedAt,
      data: response.data
    });
  } catch (error) {
    const normalized = normalizeError(error);
    writeFailure(createFailure(command, normalized, options.workspace ? path.resolve(options.workspace) : undefined), context);
    process.exitCode = normalized.exitCode;
    recordCliActivity({
      command,
      workspace: options.workspace,
      outcome: "error",
      durationMs: Date.now() - startedAt
    });
  }
}

function commandNameFromArgv(argv: string[]): string {
  const parts = argv.slice(2).filter((part) => part !== "--json" && !part.startsWith("-"));
  const [first, second] = parts;

  if (first === "project" && second === "list") {
    return "project.list";
  }

  if (first === "project" && second === "create") {
    return "project.create";
  }

  if (first === "project" && second === "import") {
    return "project.import";
  }

  if (first === "project" && second === "update") {
    return "project.update";
  }

  if (first === "project" && second === "metadata") {
    return "project.metadata";
  }

  if (first === "project" && second === "setup-context") {
    return "project.setup-context";
  }

  if (first === "inbox" && second === "import") {
    return "inbox.import";
  }

  if (first === "milestone" && ["create", "complete"].includes(second ?? "")) {
    return `milestone.${second}`;
  }

  if (first === "artifact" && ["create", "list", "update", "validate-planning"].includes(second ?? "")) {
    return `artifact.${second}`;
  }

  if (first === "capture") {
    return "capture";
  }

  if (first === "ask") {
    return "ask";
  }

  if (first === "back-burner" && ["list", "show", "promote", "archive"].includes(second ?? "")) {
    return `back-burner.${second}`;
  }

  if (first === "feedback" && ["record", "list"].includes(second ?? "")) {
    return `feedback.${second}`;
  }

  if (first === "dogfood") {
    if (second === "review") {
      const third = parts[2];
      return ["show", "approve", "reject", "defer"].includes(third ?? "")
        ? `dogfood.review.${third}`
        : "dogfood.review";
    }

    return ["init", "ask", "status"].includes(second ?? "") ? `dogfood.${second}` : "dogfood";
  }

  if (first === "ingress" && second === "process") {
    return "ingress.process";
  }

  if (first === "workflow") {
    if (second === "run-info" && parts[2] === "show") return "workflow.run.show";
    if (["list", "show", "match", "validate", "add", "enable", "disable", "run", "runs"].includes(second ?? "")) {
      return `workflow.${second}`;
    }
    return "workflow";
  }

  if (first === "dashboard" && second === "snapshot") {
    return "dashboard.snapshot";
  }

  if (first === "intelligence" && second === "smoke-image") {
    return "intelligence.smoke-image";
  }

  if (first === "intelligence" && second === "smoke-speech") {
    return "intelligence.smoke-speech";
  }

  if (first === "intelligence" && second === "list-jobs") {
    return "intelligence.list-jobs";
  }

  if (first === "attention") {
    return "attention";
  }

  if (first === "work" && ["list", "update", "done", "plan", "run"].includes(second ?? "")) {
    return `work.${second}`;
  }

  if (first === "run" && second === "show") {
    return "run.show";
  }

  if (first === "gate" && ["complete", "reopen"].includes(second ?? "")) {
    return `gate.${second}`;
  }

  if (first === "report" && second === "status") {
    return "report.status";
  }

  if (first === "memory" && second === "sync") {
    return "memory.sync";
  }

  if (first === "review" && ["show", "approve", "reject", "defer", "weekly"].includes(second ?? "")) {
    return `review.${second}`;
  }

  if (first === "review") {
    return "review";
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

function reviewOptionsFromArgv<TOptions extends { workspace?: string; json?: boolean }>(
  options: TOptions
): TOptions & { workspace: string; json: boolean } {
  return {
    ...options,
    workspace: workspaceFromArgv(process.argv) ?? options.workspace ?? defaultWorkspace(),
    json: Boolean(options.json) || wantsJson(process.argv)
  };
}

function jsonOptionsFromArgv<TOptions extends { json?: boolean }>(options: TOptions): TOptions & { json: boolean } {
  return {
    ...options,
    json: Boolean(options.json) || wantsJson(process.argv)
  };
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function renderConfigDefaultWorkspaceSuccess(response: CommandSuccess<ConfigDefaultWorkspaceData>): string[] {
  return [
    `Default workspace: ${response.data.defaultWorkspace ?? "Not configured"}`,
    `Config: ${response.data.configPath}`
  ];
}

function renderWorkspaceResolveSuccess(response: CommandSuccess<WorkspaceResolveData>): string[] {
  return [
    `Source: ${response.data.source}`,
    `Workspace: ${response.data.workspacePath ?? "Not resolved"}`,
    ...(response.data.detail ? [`Detail: ${response.data.detail}`] : [])
  ];
}
