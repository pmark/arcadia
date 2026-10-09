import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  buildAskProcessingReceipt,
  buildAskRoutingDecision,
  loadAskRuleRegistry,
  matchAskRule,
  resolveGeneralProjectReference,
  resolveProjectReference,
  validateAskRuleRegistry,
  type AskProcessingReceipt
} from "../ask/rules.js";
import { captureAskEnvelope, type AskCaptureEnvelope, type CaptureAttachmentInput } from "../ask/captureEnvelope.js";
import { ingressSourceKind } from "../ask/replyCapture.js";
import {
  DUPLICATE_ASK_WINDOW_MS,
  SUPPRESSED_ACKNOWLEDGEMENT,
  SUPPRESSED_DUPLICATE_PREFIX,
  isTrivialAcknowledgement
} from "../ask/suppression.js";
import { ASK_QUESTION_CONTEXT_KEY, findOpenAskQuestionDuplicate } from "../ask/askQuestion.js";
import { buildAskHeard, type AskHeard } from "../ask/heard.js";
import { claimApprovalForAction, recordApprovalClaim } from "../ask/approvalClaim.js";
import { findAskMemo, memoStandsDown, type AskMemo } from "../ask/corrections.js";
import { askRoutingV2Setting } from "../workspace/config.js";
import { createCodexPacket, selectAgentProfileForWorkItem, selectPolicyPermittedProfileNameOrRefuse } from "../codex/packets.js";
import { resolveWorkItemPolicyIdentity, selectPolicyPermittedProfileNames } from "../production/policy.js";
import { milestoneNotFound, projectNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, writeTransaction } from "../db/connection.js";
import {
  createApprovalGate,
  createAskRequest,
  linkAskOutcomesToCapture,
  createBackBurnerItem,
  createExecutionPlan,
  createMilestoneForProject,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  getActiveMilestoneForProject,
  getExecutionPlan,
  getProjectMetadata,
  getMilestone,
  getProject,
  getProjectContext,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  listProjects,
  listProjectSummaries,
  listWorkItems,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem,
  resolveProjectContextFromRequest,
  updateProject,
  updateWorkItem
} from "../db/repositories.js";
import type {
  ApprovalGate,
  AskRequestSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  Project,
  ProjectSummary,
  ProjectContext,
  WorkItemSummary
} from "../domain/types.js";
import type { BackBurnerSurfaceCondition } from "../domain/types.js";
import type { BackBurnerFacetTag } from "../domain/constants.js";
import { isRequiresReviewValue, type ProjectStatus } from "../domain/constants.js";
import { ensureBuiltInSkills } from "../execution/skills.js";
import { executePlan } from "../execution/runner.js";
import {
  createPlanningApprovalDecision,
  persistCodexPacketRecords
} from "../execution/planningPreparation.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import { resolveIntent, type ResolvedIntent } from "../intent/resolver.js";
import type { IntakeProjectAttribute, IntakeProjectContext, IntakeResult, IntakeWorkspaceContext } from "../intake/index.js";
import { resolveIntake } from "../intake/index.js";
import { normalizeAskInput } from "../intake/normalization.js";
import { CODEX_REPO_PATH_REQUIRED_MESSAGE } from "../projects/setup.js";
import { parseReviewResponse } from "../review/responseParser.js";
import type { GoalStewardshipResult } from "../stewardship/index.js";
import { isPlanningOrResearchStewardship, stewardIntent } from "../stewardship/index.js";
import type { ReviewRequiredCommandData } from "./review.js";
import { runReviewRequiredCommand, runReviewResolveReplyCommand } from "./review.js";
import type { StatusCommandData } from "./status.js";
import { runStatusCommand } from "./status.js";
import {
  createProjectWithDefaults,
  projectProposalSpecForTemplate,
  runProjectProposeCommand
} from "./project.js";

export interface AskOptions {
  workspace: string;
  request: string;
  project?: string;
  milestone?: string;
  runSafe?: boolean;
  approvedReviewItemId?: string;
  /** Who holds the approval claim for `approvedReviewItemId` (see `ask/approvalClaim.ts`); a fresh one when omitted. */
  approvalClaimOwner?: string;
  sourceIngress?: string;
  userIdentifier?: string;
  channelIdentifier?: string;
  conversationIdentifier?: string;
  replyToMessageIdentifier?: string;
  adapterMetadata?: Record<string, unknown>;
  requestId?: string;
  attachments?: CaptureAttachmentInput[];
  reuseCaptureEnvelope?: boolean;
  executeReview?: boolean;
  reviewExecutor?: string;
  agentProfile?: string;
  /** Deterministic request to use the existing Back Burner intake path. */
  captureAsIdea?: boolean;
  surfaceCondition?: BackBurnerSurfaceCondition;
  sourceRef?: string;
  facetTags?: BackBurnerFacetTag[];
  /**
   * `arcadia ask correct`: re-route a captured Ask. `work` skips every other route (suppression, Clarify First, Back
   * Burner, direct answers) and creates the Action; `idea` shelves it in Back Burner; `reroute` runs the ordinary
   * routing again (for a Project change). Whichever it is, the Ask never resolves a Decision, is never suppressed as a
   * duplicate, and queues no Run.
   */
  correctionRoute?: "work" | "idea" | "reroute";
}

export interface AskCommandData {
  captureEnvelope: AskCaptureEnvelope;
  ask: AskRequestSummary | null;
  stewardship: GoalStewardshipResult;
  intake: IntakeResult;
  resolvedIntent: ResolvedIntent;
  result: {
    status: "ignored" | "acted" | "queued" | "requires_review" | "captured";
    summary: string;
  };
  workItem: WorkItemSummary | null;
  plan: ExecutionPlanSummary | null;
  approvalGates: ApprovalGate[];
  codexInvocations: CodexInvocation[];
  run: ExecutionRunSummary | null;
  project: Project | null;
  projectSummary: ProjectSummary | null;
  projects: ProjectSummary[] | null;
  status: StatusCommandData | null;
  review: ReviewRequiredCommandData | null;
  reviewItemId: string | null;
  decisionId: string | null;
  decisionSlug?: string | null;
  backBurnerItemId: string | null;
  /**
   * Present only when `ask.routing.v2` created no question for this Ask: `reason` is `acknowledgement` or
   * `duplicate:<review id>`, and `openQuestionId` is the still-open question an exact duplicate repeats.
   */
  suppressed?: { reason: string; openQuestionId: string | null };
  /** Present only when `config/arcadia.json` could not be read for `ask.routing.v2`: the default (on) was used. */
  routingWarning?: string;
  processingReceipt: AskProcessingReceipt | null;
  /** The one-line receipt that opens every result; see `buildAskHeard`. Set by `runAskCommand`. */
  heard?: AskHeard;
  /** Present only when an earlier operator correction of this exact text routed the Ask (no model, no pattern). */
  memo?: { type: string; date: string; source: string; correctionId: string };
}

/** The routes a correction or a memo can force on an Ask. `status` is memo only. */
type AskRoute = "work" | "idea" | "reroute" | "status";

export function runAskCommand(options: AskOptions): CommandSuccess<AskCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  // A broken config file must never lose an Ask: routing falls back to the default and the receipt says so.
  const routingSetting = askRoutingV2Setting(workspacePath);
  const trace: { memo?: AskMemo } = {};
  const routed = runAskCommandWithRouting(options, workspacePath, routingSetting.enabled, trace);
  const memoData: AskCommandData = trace.memo
    ? {
        ...routed.data,
        memo: { type: trace.memo.type, date: trace.memo.date, source: trace.memo.source, correctionId: trace.memo.id }
      }
    : routed.data;
  const response: CommandSuccess<AskCommandData> = { ...routed, data: { ...memoData, heard: buildAskHeard(memoData) } };
  if (!routingSetting.warning) return response;
  process.stderr.write(`warning: ${routingSetting.warning}\n`);
  return {
    ...response,
    data: { ...response.data, routingWarning: routingSetting.warning },
    warnings: [...response.warnings, routingSetting.warning]
  };
}

function runAskCommandWithRouting(
  options: AskOptions,
  workspacePath: string,
  flagEnabled: boolean,
  trace: { memo?: AskMemo }
): CommandSuccess<AskCommandData> {
  const normalizedInput = normalizeAskInput(options.request);
  const submittedRequest = normalizedInput.askText;
  const askRules = withDatabase(workspacePath, (db) =>
    validateAskRuleRegistry(workspacePath, db, loadAskRuleRegistry(workspacePath))
  );
  const captureEnvelope = withDatabase(workspacePath, (db) => captureAskEnvelope(db, {
    requestId: options.requestId,
    originalText: options.request,
    ingressSource: options.sourceIngress?.trim() || "ask",
    attachments: options.attachments,
    reuseExisting: options.reuseCaptureEnvelope
  }));
  const ruleMatch = matchAskRule(submittedRequest, askRules);
  const request = ruleMatch?.payload ?? submittedRequest;
  let processingReceipt: AskProcessingReceipt | null = null;
  if (!request.trim()) {
    if (ruleMatch) {
      const routing = withDatabase(workspacePath, (db) => {
        const explicit = resolveProjectReference(db, options.project);
        if (options.project && !explicit) throw projectNotFound(options.project);
        return buildAskRoutingDecision({ explicit, prefix: ruleMatch.rule.destination });
      });
      processingReceipt = buildAskProcessingReceipt({
        match: ruleMatch,
        routing,
        originalRequest: submittedRequest,
        adapterMetadata: options.adapterMetadata
      });
    }
    const ignored = ignoredAskData(options.request);
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        ...ignored,
        captureEnvelope,
        processingReceipt,
        result: ruleMatch
          ? { status: "ignored", summary: "Ask rule matched; processing payload is empty." }
          : ignored.result
      }
    });
  }

  const registries = loadPhase3Registries(workspacePath);
  validatePhase3Registries(registries);
  // ask.routing.v2: an agent-written Ask (agent.ask, codex.*) keeps the earlier routing, as does a workspace that turned the flag off.
  const routingV2 = ingressSourceKind(options.sourceIngress?.trim() || "ask") !== "agent" && flagEnabled;
  const parsedReviewResponse = parseReviewResponse(request, reviewResponseContextFromAskOptions(options));
  const { intake, workspaceContext } = withDatabase(workspacePath, (db) => {
    const workspaceContext = buildIntakeContext(db);
    return { intake: resolveIntake(request, workspaceContext, { operatorPhrasings: routingV2 }), workspaceContext };
  });
  const selectProject = (reference: string | undefined) =>
    withDatabase(workspacePath, (db) => {
      const selected = resolveProjectReference(db, reference) ?? ruleMatch?.rule.destination ?? null;
      return selected ? { id: selected.id, name: selected.name } : null;
    });
  const registryResolved = resolveIntent(request, registries);
  const usingRegistryFallback = intake.resolvedIntent === "CaptureThought" && registryResolved.matched;
  // The ordinary stewardship for this text: what the patterns decide, given whether an approved Decision is being applied.
  const deriveStewardship = (approved: boolean, selectedProject: { id: string; name: string } | null) => {
    const preliminaryResolved = usingRegistryFallback ? registryResolved : resolvedIntentFromIntake(intake, approved);
    const resolved = usingRegistryFallback
      ? registryResolved
      : resolvedIntentForStewardship(
          intake,
          stewardIntent({
            rawInput: request,
            intake,
            resolved: preliminaryResolved,
            workspaceContext,
            approvedFromReview: approved,
            reviewResponseHasReference: parsedReviewResponse.hasReviewReference,
            reviewResponseHasResponse: parsedReviewResponse.hasResponse,
            selectedProject,
            routingV2
          }),
          approved
        );
    const computedStewardship = stewardIntent({
      rawInput: request,
      intake,
      resolved,
      workspaceContext,
      approvedFromReview: approved,
      reviewResponseHasReference: parsedReviewResponse.hasReviewReference,
      reviewResponseHasResponse: parsedReviewResponse.hasResponse,
      selectedProject,
      routingV2
    });
    return { resolved, computedStewardship };
  };
  // The memo stage runs before every intake pattern: an operator already corrected these exact words, so route them as
  // that correction did. Never for a reply to a Decision, a rule-routed or explicit idea Ask, a correction itself, an
  // agent Ask or a workspace with the flag off. It can only pick work, idea or status, so it can never answer a Decision.
  let memo =
    routingV2 &&
    options.correctionRoute === undefined &&
    !options.approvedReviewItemId &&
    !ruleMatch &&
    !options.captureAsIdea &&
    !parsedReviewResponse.hasReviewReference
      ? withDatabase(workspacePath, (db) => {
          const found = findAskMemo(db, request);
          // A Project routing would not resolve (deleted, or paused) would make the Ask fail; the memo stands down
          // and ordinary routing runs. This is the resolver routing itself uses.
          return found && found.projectId && !resolveProjectReference(db, found.projectId) ? null : found;
        })
      : null;
  // A memo may replace the Clarify First and Back Burner outcomes, and the pattern outcome otherwise. It never lets an
  // Ask skip Requires Review or Blocked: if the ordinary route for these words is one of those, the memo stands down.
  // So does an intake that matched a concrete intent, needs review and is not safe to execute, even when a missing
  // field routes it to Clarify First ("deploy the site to production" with no Project): a memo must never turn that
  // into an Action. A capture_thought intake matched no intent at all, so it is always flagged that way and is exactly
  // what a memo exists to replace; stewardship routes it before it looks at review flags too.
  if (memo) {
    const ordinary = deriveStewardship(false, selectProject(options.project)).computedStewardship.recommendedExecutionPath;
    if (memoStandsDown(ordinary, intake)) memo = null;
  }
  if (memo) trace.memo = memo;
  const route: AskRoute | undefined = options.correctionRoute ?? memo?.type;
  // An explicit Project from the operator wins over the one the memo remembers.
  const projectRef = options.project ?? memo?.projectId ?? undefined;
  // A work correction takes the approved-Decision path: it skips Clarify First and Back Burner and creates the Action.
  const forceWork = route === "work";
  const correcting = route !== undefined;
  // Work, idea and status corrections (and memos) never take a direct answer route (project create/update, listings).
  const skipDirectRoutes = route === "work" || route === "idea" || route === "status";
  const approvedFromReview = Boolean(options.approvedReviewItemId) || forceWork;
  const selectedProject = selectProject(projectRef);
  const { resolved, computedStewardship } = deriveStewardship(approvedFromReview, selectedProject);
  const stewardship: GoalStewardshipResult = options.captureAsIdea || route === "idea"
    ? {
        ...computedStewardship,
        intentType: "Back Burner Idea",
        recommendedExecutionPath: "Back Burner",
        planningRecommended: false,
        clarificationRequired: false,
        reviewRequired: false,
        generatedCodexGoalText: null,
        classificationReason: "Explicit idea capture is deterministically routed to Back Burner."
      }
    : computedStewardship;
  // Every Ask row records the deterministic intake flags, so a report can count them without re-reading prose.
  const askRoutingFlags = {
    recurrenceFlag: intake.extractedFields.recurrence === "true",
    planningFlag: intake.extractedFields.planning === "true",
    // A memo hit says so; otherwise the rules' own confidence label.
    confidence: memo ? "memo" : intake.confidenceLabel
  };
  const routing = withDatabase(workspacePath, (db) => {
    const explicit = resolveProjectReference(db, projectRef);
    if (projectRef && !explicit) {
      throw projectNotFound(projectRef);
    }
    const review = parsedReviewResponse.reviewId
      ? getReviewItem(db, parsedReviewResponse.reviewId)
      : parsedReviewResponse.reviewSlug
        ? getReviewItemBySlug(db, parsedReviewResponse.reviewSlug)
        : null;
    const extractedId = projectIdFromIntake(intake) ?? intake.project?.id ?? null;
    const extracted = resolveProjectReference(db, extractedId);
    return buildAskRoutingDecision({
      explicit,
      prefix: ruleMatch?.rule.destination,
      reply: resolveProjectReference(db, review?.project_id),
      extracted,
      general: resolveGeneralProjectReference(db, request)
    });
  });
  const routedProjectId = routing.selected?.projectId ?? null;
  if (ruleMatch) {
    processingReceipt = buildAskProcessingReceipt({
      match: ruleMatch,
      routing,
      originalRequest: submittedRequest,
      extractedFields: intake.extractedFields,
      adapterMetadata: options.adapterMetadata
    });
  }
  if (
    stewardship.recommendedExecutionPath !== "Back Burner" &&
    (options.surfaceCondition || options.sourceRef || (options.facetTags?.length ?? 0) > 0)
  ) {
    throw validationError("Back Burner surfacing metadata requires an idea routed to Back Burner.", {
      remedy: "Pass --back-burner to shelve this request explicitly."
    });
  }
  let run: ExecutionRunSummary | null = null;

  // Under ask.routing.v2 only two things create no question: a whole-message acknowledgement and an exact repeat of
  // a question still open. Each leaves a receipt that says why, and the report counts it apart from a vanished Ask.
  const suppression = routingV2 && !ruleMatch && !approvedFromReview && !correcting && !options.captureAsIdea && !parsedReviewResponse.hasReviewReference
    ? withDatabase(workspacePath, (db): { reason: string; summary: string; reviewItemId: string | null } | null => {
        if (isTrivialAcknowledgement(request)) {
          return {
            reason: SUPPRESSED_ACKNOWLEDGEMENT,
            summary: "Suppressed: the whole message is an acknowledgement, so no new question was created.",
            reviewItemId: null
          };
        }
        const since = new Date(Date.now() - DUPLICATE_ASK_WINDOW_MS).toISOString();
        const duplicate = findOpenAskQuestionDuplicate(db, request, since, routedProjectId);
        return duplicate
          ? {
              reason: `${SUPPRESSED_DUPLICATE_PREFIX}${duplicate.id}`,
              summary: `Suppressed: an identical question (${duplicate.slug ?? duplicate.id}) is already open, so no new question was created.`,
              reviewItemId: duplicate.id
            }
          : null;
      })
    : null;
  if (suppression) {
    const suppressedStewardship: GoalStewardshipResult = {
      ...stewardship,
      recommendedExecutionPath: "Blocked",
      planningRecommended: false,
      clarificationRequired: false,
      reviewRequired: false,
      generatedCodexGoalText: null,
      classificationReason: suppression.summary
    };
    const ask = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "suppressed",
        stewardshipJson: stewardshipJson(suppressedStewardship),
        status: "planned",
        suppressedReason: suppression.reason
      });
      return ask;
    });
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship: suppressedStewardship,
        intake,
        resolvedIntent: resolved,
        result: { status: "ignored", summary: suppression.summary },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null,
        suppressed: { reason: suppression.reason, openQuestionId: suppression.reviewItemId }
      }
    });
  }

  // A reply tied to a known Decision belongs to the review workflow even when
  // it is free-form prose. Clarification answers are intentionally not one of
  // the short approve/reject/defer tokens recognized by the parser.
  if (!correcting && parsedReviewResponse.hasReviewReference && !options.project && !ruleMatch) {
    const reviewResolution = runReviewResolveReplyCommand({
      workspace: workspacePath,
      id: parsedReviewResponse.reviewId,
      reply: request,
      execute: options.executeReview,
      executor: options.reviewExecutor,
      // This path already captured the same text above; one reply, one envelope.
      captureId: captureEnvelope.id
    });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: "ReviewResponse",
        registryVersion: registries.intents.version,
        outputKind: "review_response",
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      })
    );

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: {
          ...resolved,
          intentId: "ReviewResponse",
          outputKind: "review_response",
          matched: true
        },
        result: {
          status: "acted",
          summary: reviewResolution.data.confirmation
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: reviewResolution.data.item.id,
        decisionId: reviewResolution.data.item.id,
        backBurnerItemId: null
      },
      artifacts: reviewResolution.artifacts
    });
  }

  const proposalSpec = intake.action.kind === "instantiate_project"
    ? projectProposalSpecForTemplate(intake.action.template?.id)
    : null;
  if (
    !skipDirectRoutes &&
    intake.confidenceLabel === "high" &&
    intake.action.kind === "instantiate_project" &&
    intake.action.projectName &&
    proposalSpec &&
    /^create\s+(?:an?\s+)?\S.+\s+blog\s+site[.!]?$/i.test(request.trim())
  ) {
    const proposal = runProjectProposeCommand({
      workspace: workspacePath,
      name: intake.action.projectName,
      idea: request,
      spec: proposalSpec
    });
    const ask = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: intake.resolvedIntent,
        registryVersion: registries.intents.version,
        outputKind: "requires_review",
        workItemId: proposal.data.workItem.id,
        planId: proposal.data.plan.id,
        stewardshipJson: stewardshipJson(stewardship),
        status: "requires_review"
      });
      linkAskOutcomesToCapture(db, { askRequestId: ask.id, captureId: captureEnvelope.id, workItemId: proposal.data.workItem.id, planId: proposal.data.plan.id, reviewItemId: proposal.data.decision.id });
      return ask;
    });
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolvedIntentFromIntake(intake),
        result: {
          status: "requires_review",
          summary: `Proposed ${proposal.data.project.name}; enter its empty GitHub repository URL and approve the scoped staging build.`
        },
        workItem: proposal.data.workItem,
        plan: proposal.data.plan,
        approvalGates: proposal.data.approvalGates,
        codexInvocations: [],
        run: null,
        project: proposal.data.project,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: proposal.data.decision.id,
        decisionId: proposal.data.decision.id,
        decisionSlug: proposal.data.decision.slug,
        backBurnerItemId: null
      },
      artifacts: proposal.artifacts
    });
  }

  // A status memo is the operator saying these words mean "show status", whatever the patterns would have said.
  if (route === "status" || (!skipDirectRoutes && intake.action.kind === "show_status" && intake.confidenceLabel === "high")) {
    const status = runStatusCommand({ workspace: workspacePath });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        // A status memo answers with status whatever the patterns made of these words; the report reads this kind.
        outputKind: "status_summary",
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      })
    );
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: "Status shown."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: status.data,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null
      },
      artifacts: status.artifacts
    });
  }

  if (!skipDirectRoutes && intake.action.kind === "show_review" && intake.confidenceLabel === "high") {
    const review = runReviewRequiredCommand({ workspace: workspacePath });
    const ask = withDatabase(workspacePath, (db) =>
      createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      })
    );
    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: "Requires Review Decisions shown."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: review.data,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null
      }
    });
  }

  if (
    !skipDirectRoutes &&
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "create_project" &&
    intake.action.projectName
  ) {
    const created = createProjectWithDefaults({
      workspace: workspacePath,
      name: intake.action.projectName
    });
    const ask = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      });
      linkAskOutcomesToCapture(db, {
        askRequestId: ask.id,
        captureId: captureEnvelope.id,
        workItemId: created.data.workItem.id
      });
      return ask;
    });
    const workItem = withDatabase(workspacePath, (db) => getWorkItem(db, created.data.workItem.id));
    if (!workItem) {
      throw workItemNotFound(created.data.workItem.id);
    }

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "acted",
          summary: `Created project ${created.data.project.name}.`
        },
        workItem,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: created.data.project,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null
      },
      artifacts: created.artifacts
    });
  }

  if (
    !skipDirectRoutes &&
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "update_entity_attribute" &&
    intake.action.entityType === "project" &&
    intake.action.entityId &&
    intake.action.attribute &&
    intake.action.value &&
    !intake.action.invalidReason
  ) {
    const action = routedProjectId && routedProjectId !== intake.action.entityId
      ? { ...intake.action, entityId: routedProjectId }
      : intake.action;
    const { ask, project } = withDatabase(workspacePath, (db) => {
      const project = applyProjectAttributeUpdate(db, action);

      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      });
      return { ask, project };
    });

    return actedProjectUpdate({
      workspacePath,
      ask,
      stewardship,
      intake,
      resolved,
      project,
      captureEnvelope,
      processingReceipt,
      summary: `Updated ${renderResolvedAttribute(intake)} for ${project.name}.`
    });
  }

  if (
    !skipDirectRoutes &&
    (intake.confidenceLabel === "high" || approvedFromReview) &&
    intake.action.kind === "show_project" &&
    intake.action.projectId
  ) {
    const projectId = routedProjectId ?? intake.action.projectId;
    const { ask, projectSummary } = withDatabase(workspacePath, (db) => {
      const projectSummary = listProjectSummaries(db).find((candidate) => candidate.id === projectId) ?? null;
      if (!projectSummary) {
        throw projectNotFound(projectId);
      }

      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      });
      return { ask, projectSummary };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: { status: "acted", summary: `Shown project ${projectSummary.name}.` },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null
      }
    });
  }

  if (!skipDirectRoutes && (intake.confidenceLabel === "high" || approvedFromReview) && intake.action.kind === "list_projects") {
    const { ask, projects } = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: resolved.outputKind,
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      });
      return { ask, projects: listProjectSummaries(db) };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: { status: "acted", summary: "Projects listed." },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects,
        status: null,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: null
      }
    });
  }

  if (stewardship.recommendedExecutionPath === "Back Burner" && !approvedFromReview) {
    const { ask, backBurnerItem } = withDatabase(workspacePath, (db) => {
      const projectId = routedProjectId;
      if (projectId && !getProject(db, projectId)) {
        throw projectNotFound(projectId);
      }
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "back_burner",
        stewardshipJson: stewardshipJson(stewardship),
        status: "planned"
      });
      const backBurnerItem = createBackBurnerItem(db, {
        askRequestId: ask.id,
        originalInput: intake.rawInput,
        ingressSource: options.sourceIngress ?? "cli.ask",
        classification: intake.classification,
        confidence: intake.confidence,
        reason: stewardship.classificationReason || intake.classificationReason || intake.explanation,
        status: intake.classification === "Idea" ? "opportunistic" : "incubating",
        suggestedNextStep: intake.suggestedNextStep,
        surfaceCondition: options.surfaceCondition,
        projectId,
        sourceRef: options.sourceRef,
        facetTags: options.facetTags
      });
      linkAskOutcomesToCapture(db, { askRequestId: ask.id, captureId: captureEnvelope.id, backBurnerItemId: backBurnerItem.id });
      return { ask, backBurnerItem };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "captured",
          summary: "Captured in Back Burner."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: null,
        decisionId: null,
        backBurnerItemId: backBurnerItem.id
      }
    });
  }

  if (
    (stewardship.recommendedExecutionPath === "Clarify First" ||
      stewardship.recommendedExecutionPath === "Requires Review") &&
    !usingRegistryFallback &&
    !approvedFromReview
  ) {
    const { ask, reviewItem } = withDatabase(workspacePath, (db) => {
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "requires_review",
        stewardshipJson: stewardshipJson(stewardship),
        status: "requires_review"
      });
      const reviewItem = createReviewItem(db, {
        askRequestId: ask.id,
        projectId: routedProjectId,
        decisionNeeded: decisionNeededForStewardship(intake, stewardship, routingV2),
        recommendation: recommendationForStewardship(intake, stewardship, routingV2),
        sourceInput: intake.rawInput,
        proposedAction: intake.proposedAction,
        resolvedIntent: intake.resolvedIntent,
        confidenceLabel: intake.confidenceLabel,
        confidence: intake.confidence,
        missingFields: intake.missingFields,
        context: {
          extractedFields: intake.extractedFields,
          explanation: intake.explanation,
          action: intake.action,
          project: intake.project,
          template: intake.template,
          stewardship,
          // Marks the one review_item this branch creates as the Ask's question (see askQuestionOrigin).
          ...(stewardship.recommendedExecutionPath === "Clarify First" ? { [ASK_QUESTION_CONTEXT_KEY]: true } : {})
        }
      });
      linkAskOutcomesToCapture(db, { askRequestId: ask.id, captureId: captureEnvelope.id, reviewItemId: reviewItem.id });
      return { ask, reviewItem };
    });

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "requires_review",
          summary: "Requires Review Decision created."
        },
        workItem: null,
        plan: null,
        approvalGates: [],
        codexInvocations: [],
        run: null,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: reviewItem.id,
        decisionId: reviewItem.id,
        decisionSlug: reviewItem.slug,
        backBurnerItemId: null
      }
    });
  }

  // Approving a Decision claims it in the transaction that makes the Action (see `ask/approvalClaim.ts`).
  const approvalClaimOwner = options.approvalClaimOwner ?? randomUUID();
  const initial = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    // One immediate transaction: the Action, its plan, its gates and the approval claim commit together, and the
    // Decision's status is re-read under the write lock, so a concurrent approval that lost the race creates nothing.
    return writeTransaction(db, () => {
    const claim = options.approvedReviewItemId
      ? claimApprovalForAction(db, { reviewItemId: options.approvedReviewItemId, owner: approvalClaimOwner })
      : ({ kind: "create" } as const);
    const context = resolveAskContext(db, {
      ...options,
      project: routedProjectId ?? undefined,
      request
    });
    if (claim.kind === "resume") {
      // An earlier attempt made the Action and failed before the approval committed: reuse it, never make a second.
      const workItem = getWorkItem(db, claim.workItemId);
      const plan = getExecutionPlan(db, claim.planId);
      if (!workItem || !plan) throw workItemNotFound(claim.workItemId);
      recordApprovalClaim(db, {
        reviewItemId: options.approvedReviewItemId as string,
        owner: approvalClaimOwner,
        workItemId: workItem.id,
        planId: plan.id
      });
      return { workItem, plan, projectContext: context.projectContext };
    }
    const created = createWorkItemWithOptionalArtifact(db, {
      projectId: context.projectId,
      milestoneId: context.milestoneId,
      title: resolved.title,
      rawInput: request,
      queue: resolved.queue,
      workClassification: resolved.workClassification,
      nextAction: resolved.nextAction,
      expectedArtifact: resolved.expectedArtifact ?? undefined,
      // An Action made from an Ask has only the resolver's next action, which no
      // grader has judged. `clarify` is what makes it actionable.
      clarificationStatus: "unclarified"
    });
    const workItem = getWorkItem(db, created.workItem.id);
    if (!workItem) {
      throw workItemNotFound(created.workItem.id);
    }

    const plan = createExecutionPlan(db, {
      workItemId: workItem.id,
      summary: `Intent plan for "${workItem.title}" (${resolved.intentId}).`,
      steps: resolved.skillSequence
    });
    if (!plan) {
      throw workItemNotFound(workItem.id);
    }

    for (const gate of resolved.approvalGates) {
      createApprovalGate(db, {
        gateType: gate.gateType,
        reason: gate.reason,
        workItemId: workItem.id,
        planId: plan.id
      });
    }

    if (options.approvedReviewItemId) {
      recordApprovalClaim(db, {
        reviewItemId: options.approvedReviewItemId,
        owner: approvalClaimOwner,
        workItemId: workItem.id,
        planId: plan.id
      });
    }

    return { workItem, plan, projectContext: context.projectContext };
    });
  });

  if (resolved.codexPurpose && initial.projectContext && !initial.projectContext.metadata?.repo_path) {
    const missingRepositoryPathMessage = CODEX_REPO_PATH_REQUIRED_MESSAGE;
    const data = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
      updateWorkItem(db, initial.workItem.id, {
        queue: "requires_review",
        workClassification: "requires_review",
        nextAction: missingRepositoryPathMessage
      });
      const ask = createAskRequest(db, {
        ...askRoutingFlags,
        captureId: captureEnvelope.id,
        rawRequest: options.request,
        resolvedIntent: resolved.intentId,
        registryVersion: registries.intents.version,
        outputKind: "requires_review",
        workItemId: initial.workItem.id,
        planId: initial.plan.id,
        promptPacketPath: null,
        stewardshipJson: stewardshipJson(stewardship),
        status: "requires_review"
      });
      const reviewItem = createReviewItem(db, {
        askRequestId: ask.id,
        workItemId: initial.workItem.id,
        planId: initial.plan.id,
        projectId: initial.projectContext?.project.id ?? null,
        decisionNeeded: `Requires Review: ${missingRepositoryPathMessage}`,
        recommendation: `Set project metadata repo path, then ask again. Example: arcadia project metadata --workspace ${workspacePath} ${initial.projectContext?.project.id} --repo-path <repository-root>`,
        sourceInput: request,
        proposedAction: missingRepositoryPathMessage,
        resolvedIntent: resolved.intentId,
        confidenceLabel: "high",
        confidence: 1,
        missingFields: ["repository path"],
        context: {
          project: {
            id: initial.projectContext?.project.id,
            name: initial.projectContext?.project.name
          },
          workItemId: initial.workItem.id,
          planId: initial.plan.id,
          reason: missingRepositoryPathMessage
        }
      });
      linkAskOutcomesToCapture(db, {
        askRequestId: ask.id,
        captureId: captureEnvelope.id,
        workItemId: initial.workItem.id,
        planId: initial.plan.id,
        reviewItemId: reviewItem.id
      });
      linkApprovedDecisionToAsk(db, options.approvedReviewItemId, ask.id);

      return {
        ask,
        workItem: getWorkItem(db, initial.workItem.id) as WorkItemSummary,
        approvalGates: listApprovalGatesForWorkItem(db, initial.workItem.id),
        reviewItem
      };
    }));

    return createSuccess({
      command: "ask",
      workspace: workspacePath,
      data: {
        captureEnvelope,
        processingReceipt,
        ask: data.ask,
        stewardship,
        intake,
        resolvedIntent: resolved,
        result: {
          status: "requires_review",
          summary: "Requires Review Decision created."
        },
        workItem: data.workItem,
        plan: initial.plan,
        approvalGates: data.approvalGates,
        codexInvocations: [],
        run,
        project: null,
        projectSummary: null,
        projects: null,
        status: null,
        review: null,
        reviewItemId: data.reviewItem.id,
        decisionId: data.reviewItem.id,
        backBurnerItemId: null
      }
    });
  }

  const agentSelection = resolved.codexPurpose
    ? selectAgentProfileForWorkItem({
        profiles: registries.codingAgents.profiles,
        adapters: registries.providerAdapters,
        workItem: initial.workItem,
        purpose: resolved.codexPurpose,
        requestedName: options.agentProfile
          ?? withDatabase(workspacePath, (db) =>
            selectPolicyPermittedProfileNameOrRefuse({
              profiles: registries.codingAgents.profiles,
              adapters: registries.providerAdapters,
              workItem: initial.workItem,
              purpose: resolved.codexPurpose as "build" | "planning",
              permittedCandidateNames: selectPolicyPermittedProfileNames(
                db,
                registries.codingAgents.profiles,
                resolved.codexPurpose as "build" | "planning",
                resolveWorkItemPolicyIdentity(db, initial.workItem)
              )
            })
          ),
        defaults: registries.codingAgents.defaults
      })
    : null;
  const codexPacket = resolved.codexPurpose && agentSelection
    ? createCodexPacket({
        workspace: workspacePath,
        request,
        resolved,
        workItem: initial.workItem,
        planId: initial.plan.id,
        projectContext: initial.projectContext,
        agentProfile: agentSelection.profile,
        agentConfiguration: agentSelection.configuration,
        executionRequirement: agentSelection.executionRequirement,
        stewardship
      })
    : null;

  const data = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
    let packetArtifact = null as ReturnType<typeof persistCodexPacketRecords>["packetArtifact"] | null;
    if (codexPacket) {
      packetArtifact = persistCodexPacketRecords(db, {
        packet: codexPacket,
        workItem: initial.workItem,
        plan: initial.plan
      }).packetArtifact;
    }

    const ask = createAskRequest(db, {
        ...askRoutingFlags,
      captureId: captureEnvelope.id,
      rawRequest: options.request,
      resolvedIntent: resolved.intentId,
      registryVersion: registries.intents.version,
      outputKind: resolved.outputKind,
      workItemId: initial.workItem.id,
      planId: initial.plan.id,
      promptPacketPath: codexPacket?.relativePromptPath ?? null,
      stewardshipJson: stewardshipJson(stewardship),
      status: isRequiresReviewValue(resolved.workClassification) ? "requires_review" : "planned"
    });

    const planningDecision = codexPacket?.purpose === "planning" && packetArtifact
      ? createPlanningApprovalDecision(db, {
          askRequestId: ask.id,
          workItem: initial.workItem,
          plan: initial.plan,
          packet: codexPacket,
          packetArtifact,
          sourceInput: request,
          proposedAction: interpretationForPlanning(intake),
          expectedArtifact: resolved.expectedArtifact ?? initial.workItem.expected_artifact ?? "Planning Artifact"
        })
      : null;

    linkAskOutcomesToCapture(db, {
      askRequestId: ask.id,
      captureId: captureEnvelope.id,
      workItemId: initial.workItem.id,
      planId: initial.plan.id,
      reviewItemId: planningDecision?.id
    });
    linkApprovedDecisionToAsk(db, options.approvedReviewItemId, ask.id);

    return {
      ask,
      workItem: getWorkItem(db, initial.workItem.id) as WorkItemSummary,
      plan: initial.plan,
      approvalGates: listApprovalGatesForWorkItem(db, initial.workItem.id),
      codexInvocations: listCodexInvocationsForWorkItem(db, initial.workItem.id),
      planningDecision
    };
  }));

  // A memo routes an Ask the way a correction does: it never runs anything.
  if (options.runSafe && !memo && data.plan.steps.every((step) => step.executor_type === "deterministic" && step.safe_to_run === 1)) {
    const result = withDatabase(workspacePath, (db) => executePlan(db, workspacePath, data.plan));
    run = result.run;
  }

  return createSuccess({
    command: "ask",
    workspace: workspacePath,
    data: {
      captureEnvelope,
      processingReceipt,
      ask: data.ask,
      stewardship,
      intake,
      resolvedIntent: resolved,
      result: {
        status: isRequiresReviewValue(resolved.workClassification) ? "requires_review" : "queued",
        summary: isRequiresReviewValue(resolved.workClassification) ? "Requires Review Decision created." : "Action created."
      },
      workItem: data.workItem,
      plan: data.plan,
      approvalGates: data.approvalGates,
      codexInvocations: data.codexInvocations,
      run,
      project: null,
      projectSummary: null,
      projects: null,
      status: null,
      review: null,
        reviewItemId: data.planningDecision?.id ?? null,
        decisionId: data.planningDecision?.id ?? null,
        decisionSlug: data.planningDecision?.slug ?? null,
      backBurnerItemId: null
    },
    artifacts: [
      ...(codexPacket
        ? [
            codexPacket.promptPath,
            codexPacket.jsonlOutputPath,
            codexPacket.finalMessagePath,
            codexPacket.metadataPath,
            codexPacket.critiquePath
          ]
        : []),
      ...(run?.mission_log_path ? [path.join(workspacePath, run.mission_log_path)] : []),
      ...(run?.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : []) ?? [])
    ]
  });
}

/**
 * Records which Ask an approval of a Decision produced, in the transaction that creates the Ask row (a later one than
 * the Action's: the Action, its plan, its gates and the approval claim commit first, in `initial`). The approval itself
 * (status, answer correction, pending execution) commits later still, in `review approve`. If an attempt fails after
 * the Action exists but before this link, the claim lets the retry resume that Action; if it fails after this link, the
 * retry finds the link and reuses the Action. Either way a retry never creates a second one.
 */
function linkApprovedDecisionToAsk(db: Database.Database, reviewItemId: string | undefined, askId: string): void {
  if (!reviewItemId) return;
  const linked = db.prepare(
    `UPDATE review_items SET resulting_ask_request_id = ?
      WHERE id = ? AND status IN ('open', 'deferred') AND resulting_ask_request_id IS NULL`
  ).run(askId, reviewItemId);
  // The Ask row commits with this link; if the Decision was decided or linked meanwhile, neither is written.
  if (linked.changes === 0) {
    throw validationError("Requires Review Decision was decided or linked by another approval, so this attempt wrote nothing.", {
      id: reviewItemId
    });
  }
}

function actedProjectUpdate(input: {
  workspacePath: string;
  ask: AskRequestSummary;
  stewardship: GoalStewardshipResult;
  intake: IntakeResult;
  resolved: ResolvedIntent;
  project: Project;
  captureEnvelope: AskCaptureEnvelope;
  processingReceipt: AskProcessingReceipt | null;
  summary: string;
}): CommandSuccess<AskCommandData> {
  return createSuccess({
    command: "ask",
    workspace: input.workspacePath,
    data: {
      captureEnvelope: input.captureEnvelope,
      processingReceipt: input.processingReceipt,
      ask: input.ask,
      stewardship: input.stewardship,
      intake: input.intake,
      resolvedIntent: input.resolved,
      result: {
        status: "acted",
        summary: input.summary
      },
      workItem: null,
      plan: null,
      approvalGates: [],
      codexInvocations: [],
      run: null,
      project: input.project,
      projectSummary: null,
      projects: null,
      status: null,
      review: null,
      reviewItemId: null,
      decisionId: null,
      backBurnerItemId: null
    }
  });
}

type UpdateEntityAttributeAction = Extract<IntakeResult["action"], { kind: "update_entity_attribute" }>;
type ProjectAttributeUpdateHandler = (
  db: Parameters<typeof getProject>[0],
  action: UpdateEntityAttributeAction
) => Project;

const PROJECT_ATTRIBUTE_UPDATE_HANDLERS: Record<IntakeProjectAttribute, ProjectAttributeUpdateHandler> = {
  goal: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { goal: requireAttributeValue(action) });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  mission: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { mission: requireAttributeValue(action) });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  status: (db, action) => {
    const project = updateProject(db, requireEntityId(action), { status: requireAttributeValue(action) as ProjectStatus });
    if (!project) {
      throw projectNotFound(requireEntityId(action));
    }
    return project;
  },
  current_milestone: (db, action) => {
    const projectId = requireEntityId(action);
    const project = getProject(db, projectId);
    if (!project) {
      throw projectNotFound(projectId);
    }

    const milestone = createMilestoneForProject(db, projectId, requireAttributeValue(action), "active");
    if (!milestone) {
      throw projectNotFound(projectId);
    }
    return project;
  },
  next_action: (db, action) => {
    const projectId = requireEntityId(action);
    const project = getProject(db, projectId);
    if (!project) {
      throw projectNotFound(projectId);
    }

    const target = listWorkItems(db).find((item) => item.project_id === projectId && item.status !== "done");
    if (!target) {
      throw validationError("Project has no open Action to hold next action.", { projectId });
    }

    const updated = updateWorkItem(db, target.id, { nextAction: requireAttributeValue(action) });
    if (!updated) {
      throw workItemNotFound(target.id);
    }
    return project;
  }
};

function applyProjectAttributeUpdate(
  db: Parameters<typeof getProject>[0],
  action: UpdateEntityAttributeAction
): Project {
  if (action.entityType !== "project") {
    throw validationError("Only project entity updates are supported.", { entityType: action.entityType });
  }

  if (!action.attribute) {
    throw validationError("Project attribute is required.");
  }

  const handler = PROJECT_ATTRIBUTE_UPDATE_HANDLERS[action.attribute];
  return handler(db, action);
}

function requireEntityId(action: UpdateEntityAttributeAction): string {
  if (!action.entityId) {
    throw validationError("Project is required.");
  }
  return action.entityId;
}

function requireAttributeValue(action: UpdateEntityAttributeAction): string {
  if (!action.value?.trim()) {
    throw validationError("Attribute value is required.");
  }
  return action.value;
}

export interface RenderAskOptions {
  /** Also print the stewardship, interpretation and Ask rule detail. `--json` always carries it. */
  verbose?: boolean;
}

/**
 * Every result opens with the one `Heard:` line, then the essentials: ids, the Project and what was created. The
 * stewardship and rule detail follows only with `--verbose`; `--json` carries all of it.
 */
export function renderAskSuccess(response: CommandSuccess<AskCommandData>, options: RenderAskOptions = {}): string[] {
  const heard = response.data.heard ?? buildAskHeard(response.data);
  const lines = [heard.line];

  if (options.verbose) {
    lines.push(
      `Stewardship intent: ${response.data.stewardship.intentType}`,
      `Execution path: ${response.data.stewardship.recommendedExecutionPath}`,
      `Stewardship reason: ${response.data.stewardship.classificationReason}`,
      `Planning recommended: ${response.data.stewardship.planningRecommended ? "yes" : "no"}`,
      `Clarification required: ${response.data.stewardship.clarificationRequired ? "yes" : "no"}`,
      `Review required: ${response.data.stewardship.reviewRequired ? "yes" : "no"}`,
      `Codex goal: ${response.data.stewardship.generatedCodexGoalText ?? "None"}`
    );
  }
  lines.push(`Ask: ${response.data.ask?.id ?? "None"}`);
  if (options.verbose) {
    lines.push(
      `Interpreted as: ${response.data.intake.resolvedIntent}`,
      `Confidence: ${response.data.intake.confidenceLabel} (${response.data.intake.confidence.toFixed(2)})`
    );
  }
  lines.push(
    `Project: ${response.data.intake.project?.name ?? response.data.workItem?.project_name ?? response.data.project?.name ?? response.data.projectSummary?.name ?? "None"}`
  );
  if (options.verbose || response.data.intake.action.kind === "update_entity_attribute") {
    lines.push(
      `Attribute: ${renderResolvedAttribute(response.data.intake)}`,
      `Value: ${renderResolvedAttributeValue(response.data.intake)}`
    );
  }
  if (options.verbose) {
    lines.push(`Outcome: ${response.data.project?.goal ?? "None"}`, `Action: ${response.data.intake.proposedAction}`);
  }
  lines.push(`Result: ${response.data.result.summary}`);

  if (response.data.workItem) {
    lines.push(`Action: ${response.data.workItem.id}`);
    lines.push(`Plan: ${response.data.plan?.id ?? "None"}`);
    lines.push(`Queue: ${isRequiresReviewValue(response.data.workItem.queue) ? "requires_review" : response.data.workItem.queue}`);
    lines.push(`Responsibility: ${labelWorkClassification(response.data.workItem.work_classification)}`);
  }

  if (response.data.reviewItemId) {
    lines.push(`Decision created: ${response.data.decisionSlug ?? response.data.reviewItemId}`);
  }

  if (response.data.suppressed) {
    lines.push(`Suppressed: ${response.data.suppressed.reason}`);
    if (response.data.suppressed.openQuestionId) lines.push(`Open question: ${response.data.suppressed.openQuestionId}`);
  }

  if (response.data.backBurnerItemId) {
    lines.push(`Back Burner: ${response.data.backBurnerItemId}`);
  }

  if (response.data.projectSummary) {
    lines.push(`Status: ${response.data.projectSummary.status}`);
    lines.push(`Mission: ${response.data.projectSummary.mission}`);
    lines.push(`Current milestone: ${response.data.projectSummary.current_milestone ?? "None"}`);
    lines.push(`Next action: ${response.data.projectSummary.next_action ?? "None"}`);
  }

  if (response.data.projects) {
    lines.push(`Projects: ${response.data.projects.length}`);
    lines.push(...response.data.projects.map((project) => `- ${project.name} (${project.status})`));
  }

  if (options.verbose && response.data.processingReceipt) {
    const receipt = response.data.processingReceipt;
    lines.push(
      `Ask rule: ${receipt.ruleId} v${receipt.ruleVersion}`,
      `Rule evidence: ${JSON.stringify(receipt.matchEvidence.matchedText)} at start (${receipt.matchEvidence.boundary})`,
      `Rule destination: ${receipt.routing.selected?.projectName ?? receipt.destination.projectName} via ${receipt.routing.selected?.source ?? "exact_prefix"}`,
      `Ignored routes: ${receipt.routing.ignored.map((candidate) => `${candidate.source} -> ${candidate.projectName} (${candidate.reason})`).join("; ") || "None"}`,
      `Processing payload: ${receipt.strippedPayload || "(empty)"}`,
      `Processors: ${receipt.orderedProcessors.join(" -> ")}`,
      `Proposed writes: ${receipt.proposedWrites.join("; ") || "None"}`,
      `Non-actions: ${receipt.nonActions.join("; ") || "None"}`,
      `Rule approval gates: ${receipt.approvalGates.join("; ") || "None"}`
    );
  }

  lines.push(
    `Approval gates: ${response.data.approvalGates.length}`,
    `Codex packets: ${response.data.codexInvocations.length}`,
    `Run: ${response.data.run?.id ?? "Not run"}`
  );

  return lines;
}

export function buildIntakeContext(db: Parameters<typeof listProjects>[0]): IntakeWorkspaceContext {
  const projects: IntakeProjectContext[] = listProjects(db).map((project) => {
    const metadata = getProjectMetadata(db, project.id);
    const activeMilestone = getActiveMilestoneForProject(db, project.id);
    return {
      id: project.id,
      name: project.name,
      goal: project.goal,
      aliases: decodeStringArray(metadata?.aliases),
      activeMilestoneId: activeMilestone?.id ?? null,
      activeMilestoneTitle: activeMilestone?.title ?? null
    };
  });

  const recentActivity = listWorkItems(db).slice(0, 20).map((item) => ({
    id: item.id,
    projectId: item.project_id,
    projectName: item.project_name,
    title: item.title
  }));

  return { projects, recentActivity };
}

export function resolvedIntentForStewardship(
  intake: IntakeResult,
  stewardship: GoalStewardshipResult,
  approvedFromReview = false
): ResolvedIntent {
  if (
    isPlanningOrResearchStewardship(stewardship) &&
    stewardship.recommendedExecutionPath === "Plan First"
  ) {
    return {
      intentId: stewardship.intentType === "Research Request" ? "ResearchRequest" : "PlanningRequest",
      matched: true,
      title: titleFromRequest(intake.rawInput),
      outputKind: "codex_planning_packet",
      queue: "work_queue",
      workClassification: "agent",
      nextAction: "Review the Codex planning packet and use it to choose the next execution step.",
      expectedArtifact: stewardship.intentType === "Research Request"
        ? "Research brief and recommendation"
        : expectedPlanningArtifactForIntake(intake),
      skillSequence: [
        {
          skillName: "codex_planning",
          title: stewardship.intentType === "Research Request" ? "Prepare research brief" : "Prepare goal stewardship plan",
          command: null,
          executorType: "codex_planning",
          safeToRun: false,
          needsOperator: "Planning output should be reviewed before implementation."
        }
      ],
      approvalGates: [],
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: "planning"
    };
  }

  return resolvedIntentFromIntake(intake, approvedFromReview);
}

export function resolvedIntentFromIntake(intake: IntakeResult, approvedFromReview = false): ResolvedIntent {
  if ((!approvedFromReview && intake.confidenceLabel !== "high") || intake.resolvedIntent === "CaptureThought") {
    return {
      intentId: intake.resolvedIntent,
      matched: false,
      title: `Requires Review: ${titleFromRequest(intake.rawInput)}`,
      outputKind: "requires_review",
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: reviewNextAction(intake),
      expectedArtifact: intake.action.kind === "create_work"
        ? expectedArtifactForCreateWork(intake)
        : "Clarified Arcadia request",
      skillSequence: [
        {
          skillName: "requires_review_decision",
          title: "Review intake interpretation",
          command: null,
          executorType: "operator",
          safeToRun: false,
          needsOperator: reviewNextAction(intake)
        }
      ],
      approvalGates: [],
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: null
    };
  }

  if (intake.action.kind === "instantiate_project") {
    const templateName = intake.action.template?.name ?? intake.extractedFields.template ?? "templated project";
    const projectName = intake.action.projectName ?? "Untitled project";
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: `Create ${templateName}: ${projectName}`,
      outputKind: "codex_build_packet",
      queue: "work_queue",
      workClassification: intake.action.template?.workClassification ?? "agent",
      nextAction: `Review the ${templateName} build packet and approve Codex build if appropriate.`,
      expectedArtifact: intake.action.template?.expectedArtifact ?? "Templated project Codex build packet",
      skillSequence: [
        {
          skillName: "codex_build",
          title: `Prepare Codex build packet for ${templateName}`,
          command: null,
          executorType: "codex_build",
          safeToRun: false,
          needsOperator: "Codex build requires explicit review before repository changes."
        }
      ],
      approvalGates: approvalGatesForIntake(intake).map((gateType) => ({
        gateType,
        reason: reasonForGate(gateType)
      })),
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: "build"
    };
  }

  if (intake.action.kind === "create_project") {
    const projectName = intake.action.projectName ?? "Untitled project";
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: `Create project: ${projectName}`,
      outputKind: "project_created",
      queue: "work_queue",
      workClassification: "autonomous",
      nextAction: `Clarify the project mission and first concrete next action for ${projectName}.`,
      expectedArtifact: "Arcadia project record",
      skillSequence: [],
      approvalGates: [],
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: null
    };
  }

  if (intake.action.kind === "create_work") {
    if (normalizeForArtifact(intake.rawInput) === "generate this week s arcadia project status report") {
      return {
        intentId: "GenerateStatusReport",
        matched: true,
        title: "Generate this week's Arcadia project status report",
        outputKind: "status_report",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Generate the deterministic Arcadia status report.",
        expectedArtifact: "Weekly Arcadia project status report",
        skillSequence: [{
          skillName: "generate_status_report",
          title: "Generate status report",
          command: "arcadia status",
          executorType: "deterministic",
          safeToRun: true,
          needsOperator: null
        }],
        approvalGates: [],
        templates: [],
        slots: intake.extractedFields,
        codexPurpose: null
      };
    }
    return {
      intentId: intake.resolvedIntent,
      matched: true,
      title: intake.action.title,
      outputKind: "codex_build_packet",
      queue: "work_queue",
      workClassification: intake.action.workClassification,
      nextAction: `Review the Codex build packet for: ${intake.action.title}.`,
      expectedArtifact: expectedArtifactForCreateWork(intake),
      skillSequence: [
        {
          skillName: "codex_build",
          title: "Prepare Codex build packet",
          command: null,
          executorType: "codex_build",
          safeToRun: false,
          needsOperator: "Codex build requires explicit review before repository changes."
        }
      ],
      approvalGates: approvalGatesForIntake(intake).map((gateType) => ({
        gateType,
        reason: reasonForGate(gateType)
      })),
      templates: [],
      slots: intake.extractedFields,
      codexPurpose: "build"
    };
  }

  return {
    intentId: intake.resolvedIntent,
    matched: true,
    title: titleFromRequest(intake.rawInput),
    outputKind: outputKindForIntake(intake),
    queue: "work_queue",
    workClassification: "autonomous",
    nextAction: intake.proposedAction,
    expectedArtifact: null,
    skillSequence: [],
    approvalGates: [],
    templates: [],
    slots: intake.extractedFields,
    codexPurpose: null
  };
}

function stewardshipJson(stewardship: GoalStewardshipResult): string {
  return JSON.stringify(stewardship);
}

function ignoredAskData(rawRequest: string): Omit<AskCommandData, "captureEnvelope"> {
  const stewardship: GoalStewardshipResult = {
    originalInput: rawRequest,
    interpretedIntent: "Ignore empty input.",
    intentType: "Back Burner Idea",
    relatedProject: null,
    relatedGoal: null,
    recommendedExecutionPath: "Blocked",
    planningRecommended: false,
    clarificationRequired: false,
    reviewRequired: false,
    generatedCodexGoalText: null,
    classificationReason: "Input was empty after trimming."
  };
  const intake: IntakeResult = {
    rawInput: rawRequest,
    resolvedIntent: "CaptureThought",
    classification: "IncubatingThought",
    confidence: 0,
    confidenceLabel: "low",
    extractedFields: {},
    missingFields: ["input"],
    proposedAction: "Ignore empty input.",
    safeToExecute: false,
    reviewRequired: false,
    explanation: "Input was empty after trimming.",
    classificationReason: "Empty input is not actionable.",
    suggestedNextStep: null,
    action: {
      kind: "capture_thought",
      title: "Empty input"
    },
    project: null,
    template: null
  };

  return {
    ask: null,
    stewardship,
    intake,
    resolvedIntent: {
      intentId: "CaptureThought",
      matched: false,
      title: "Empty input",
      outputKind: "ignored",
      queue: "inbox",
      workClassification: "autonomous",
      nextAction: "Ignore empty input.",
      expectedArtifact: null,
      skillSequence: [],
      approvalGates: [],
      templates: [],
      slots: {},
      codexPurpose: null
    },
    result: {
      status: "ignored",
      summary: "Ignored empty input."
    },
    workItem: null,
    plan: null,
    approvalGates: [],
    codexInvocations: [],
    run: null,
    project: null,
    projectSummary: null,
    projects: null,
    status: null,
    review: null,
    reviewItemId: null,
    decisionId: null,
    backBurnerItemId: null,
    processingReceipt: null
  };
}

function reviewResponseContextFromAskOptions(options: AskOptions): { reviewId?: string | null; reviewSlug?: string | null } {
  const reviewId = metadataString(options.adapterMetadata, "reviewId");
  const reviewSlug = metadataString(options.adapterMetadata, "reviewSlug");
  return { reviewId, reviewSlug };
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An Ask routing v2 turned into one question: it matched no execution pattern (or was a reply naming no Decision). */
function isUnmatchedAskQuestion(intake: IntakeResult, stewardship: GoalStewardshipResult, routingV2: boolean): boolean {
  return (
    routingV2 &&
    stewardship.recommendedExecutionPath === "Clarify First" &&
    (intake.action.kind === "capture_thought" || stewardship.intentType === "Review Response")
  );
}

function askExcerpt(rawInput: string): string {
  const flat = rawInput.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function decisionNeededForStewardship(intake: IntakeResult, stewardship: GoalStewardshipResult, routingV2 = false): string {
  if (isUnmatchedAskQuestion(intake, stewardship, routingV2)) {
    return `What should Arcadia do with this? "${askExcerpt(intake.rawInput)}"`;
  }

  if (stewardship.recommendedExecutionPath === "Clarify First") {
    if (intake.resolvedIntent === "UpdateEntityAttribute") {
      return decisionNeededForIntake(intake);
    }

    return `Clarify before execution: ${stewardship.classificationReason}`;
  }

  if (stewardship.recommendedExecutionPath === "Requires Review") {
    return `Approve or reject the stewarded path: ${stewardship.interpretedIntent}`;
  }

  return decisionNeededForIntake(intake);
}

function decisionNeededForIntake(intake: IntakeResult): string {
  if (intake.missingFields.length > 0) {
    if (intake.missingFields.includes("project")) {
      return "Requires Review: project ambiguous or missing.";
    }

    if (intake.missingFields.includes("attribute")) {
      return "Requires Review: attribute ambiguous or missing.";
    }

    if (intake.action.kind === "update_entity_attribute" && intake.action.invalidReason) {
      return `Requires Review: invalid attribute value (${intake.action.invalidReason}).`;
    }

    if (intake.missingFields.includes("attributeValue")) {
      return "Requires Review: missing attribute value.";
    }

    return `Confirm missing fields: ${intake.missingFields.join(", ")}.`;
  }

  if (!intake.safeToExecute) {
    return `Approve or reject this proposed Arcadia action: ${intake.proposedAction}`;
  }

  return reviewNextAction(intake);
}

function recommendationForStewardship(intake: IntakeResult, stewardship: GoalStewardshipResult, routingV2 = false): string {
  if (isUnmatchedAskQuestion(intake, stewardship, routingV2)) {
    return "Approve to create it as work (approving never starts an executor; running it is a separate approval), reject to drop it, or send it again with --back-burner to keep it as an idea.";
  }

  if (stewardship.recommendedExecutionPath === "Clarify First") {
    return "Clarify the missing target or outcome, then approve only if the stewarded intent is correct.";
  }

  if (stewardship.planningRecommended) {
    return "Plan first, then approve implementation only after scope, risks, and approval boundaries are clear.";
  }

  return recommendationForIntake(intake);
}

function renderResolvedAttribute(intake: IntakeResult): string {
  if (intake.action.kind === "update_entity_attribute") {
    return intake.action.attributeName ?? intake.extractedFields.attribute ?? "None";
  }

  return "None";
}

function renderResolvedAttributeValue(intake: IntakeResult): string {
  if (intake.action.kind === "update_entity_attribute") {
    return intake.action.value ?? "None";
  }

  return "None";
}

function recommendationForIntake(intake: IntakeResult): string {
  if (intake.confidenceLabel === "low") {
    return "Defer or clarify before creating work.";
  }

  if (intake.missingFields.length > 0) {
    return "Provide the missing fields, then approve only if the proposed action is correct.";
  }

  if (!intake.safeToExecute) {
    return "Approve only if the project, outcome, and action match your intent.";
  }

  return "Review the proposed action before execution.";
}

export function projectIdFromIntake(intake: IntakeResult): string | null {
  switch (intake.action.kind) {
    case "create_work":
      return intake.action.projectId;
    case "update_entity_attribute":
      return intake.action.entityId;
    case "show_project":
      return intake.action.projectId;
    default:
      return null;
  }
}

function outputKindForIntake(intake: IntakeResult): string {
  switch (intake.resolvedIntent) {
    case "ShowStatus":
      return "status_summary";
    case "ReviewRequired":
      return "review_packets";
    case "ShowProject":
      return "project_summary";
    case "ListProjects":
      return "project_list";
    case "UpdateEntityAttribute":
      return "project_update";
    default:
      return "intake_result";
  }
}

function expectedArtifactForCreateWork(intake: IntakeResult): string {
  const requested = intake.extractedFields.requestedArtifact;
  if (requested) {
    return requested;
  }

  const project = intake.project?.name ?? intake.extractedFields.project ?? "selected project";
  const subject = [
    intake.extractedFields.platform ?? intake.extractedFields.channel ?? null,
    intake.extractedFields.feature ??
      intake.extractedFields.target ??
      (intake.action.kind === "create_work" ? intake.action.title : null)
  ].filter((value): value is string => Boolean(value)).join(" ");
  return `${subject || "Requested work"} for ${project} implementation with tests.`;
}

function expectedPlanningArtifactForIntake(intake: IntakeResult): string {
  const project = intake.project?.name ?? intake.extractedFields.project ?? "selected project";
  const subject = (canonicalArtifactSubject(intake) ?? "project execution").replace(/\s+support$/i, "");
  return `${capitalizePlanningSubject(subject)} plan for ${project} with ordered phases, risks/open questions, approval requirements, and recommended next action.`;
}

function interpretationForPlanning(intake: IntakeResult): string {
  const project = intake.project?.name ?? intake.extractedFields.project ?? "the selected Project";
  const subject = (canonicalArtifactSubject(intake) ?? "project execution").replace(/\s+support$/i, "");
  return `Prepare a ${subject} plan for ${project}.`;
}

function capitalizePlanningSubject(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function canonicalArtifactSubject(intake: IntakeResult): string | null {
  const platform = intake.extractedFields.platform;
  const base = intake.extractedFields.purpose ??
    intake.extractedFields.action ??
    intake.extractedFields.requestedAction ??
    null;
  if (!base && !platform) {
    return null;
  }

  const cleaned = cleanArtifactSubject(platform ? base?.replace(new RegExp(`\\b(?:for|to|in)\\s+${escapeRegExp(platform)}\\b.*$`, "i"), "") ?? "" : base ?? "");
  if (platform && cleaned && !normalizeForArtifact(cleaned).includes(normalizeForArtifact(platform))) {
    return `${platform} ${decapitalize(cleaned)}`;
  }

  return cleaned || platform || null;
}

function cleanArtifactSubject(value: string): string {
  return value
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:plan\s+and\s+implement|implement|plan|build|add|create|prepare|fix|publish|improve)\s+/i, "")
    .trim();
}

function normalizeForArtifact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function decapitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function approvalGatesForIntake(intake: IntakeResult): ResolvedIntent["approvalGates"][number]["gateType"][] {
  const normalized = intake.rawInput.toLowerCase();
  const gates = new Set<ResolvedIntent["approvalGates"][number]["gateType"]>();

  if (intake.action.kind === "instantiate_project") {
    gates.add("destructive_filesystem_changes");
    if (/astro|blog|site|next|website|web app|serverless|api/.test(normalized)) {
      gates.add("external_deployment");
    }
  }

  if (intake.action.kind === "create_work") {
    gates.add("destructive_filesystem_changes");
    if (/credential|oauth|api key|token|secret|pinterest|external service/.test(normalized)) {
      gates.add("credentials_required");
    }
    if (/deploy|deployment|production release|external service/.test(normalized)) {
      gates.add("external_deployment");
    }
    if (/pinterest|social|post|posting|publish|publication/.test(normalized)) {
      gates.add("publication");
    }
    if (/send|message|email|discord|slack|post|posting|publish/.test(normalized)) {
      gates.add("send_email_or_messages");
    }
    if (/spend|buy|purchase|paid|budget|ad campaign|ads?\b|money/.test(normalized)) {
      gates.add("financial_action");
    }
    if (/production data|prod data|customer data|live data|production credentials/.test(normalized)) {
      gates.add("production_data_access");
    }
    if (/merge to main|merge into main/.test(normalized)) {
      gates.add("merge_to_main");
    }
  }

  return [...gates];
}

function reasonForGate(gateType: ResolvedIntent["approvalGates"][number]["gateType"]): string {
  switch (gateType) {
    case "credentials_required":
      return "Credentials are required before this work can access external services.";
    case "external_deployment":
      return "External deployment requires explicit approval.";
    case "publication":
      return "Publication requires explicit approval.";
    case "destructive_filesystem_changes":
      return "Repository or filesystem changes require explicit review.";
    case "production_data_access":
      return "Production data access requires explicit approval.";
    case "financial_action":
      return "Financial actions require explicit approval.";
    case "merge_to_main":
      return "Merging to main requires explicit approval.";
    case "send_email_or_messages":
      return "Sending email or messages requires explicit approval.";
  }
}

function reviewNextAction(intake: IntakeResult): string {
  if (intake.missingFields.length > 0) {
    return `Clarify missing intake fields: ${intake.missingFields.join(", ")}.`;
  }

  return "Clarify the desired Arcadia action before execution.";
}

function titleFromRequest(request: string): string {
  return request.trim().split(/\r?\n/)[0]?.trim().slice(0, 120) || "Natural language request";
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function labelWorkClassification(value: string): string {
  return isRequiresReviewValue(value) ? "Requires Review" : value;
}

interface ResolvedAskContext {
  projectId: string | null;
  milestoneId: string | null;
  projectContext: ProjectContext | null;
}

function resolveAskContext(db: Parameters<typeof getProject>[0], options: AskOptions): ResolvedAskContext {
  let projectId = options.project ?? null;
  let milestoneId = options.milestone ?? null;

  if (projectId && !getProject(db, projectId)) {
    throw projectNotFound(projectId);
  }

  if (milestoneId) {
    const milestone = getMilestone(db, milestoneId);
    if (!milestone) {
      throw milestoneNotFound(milestoneId);
    }

    if (projectId && milestone.project_id !== projectId) {
      throw milestoneNotFound(milestoneId);
    }

    projectId ??= milestone.project_id;
  }

  if (!projectId) {
    const resolvedProject = resolveProjectContextFromRequest(db, options.request);
    const defaultProject = resolvedProject ?? resolveOnlyActiveProjectContext(db);
    projectId = defaultProject?.project.id ?? null;
    milestoneId ??= defaultProject?.activeMilestone?.id ?? null;
    return {
      projectId,
      milestoneId,
      projectContext: defaultProject
    };
  }

  milestoneId ??= getActiveMilestoneForProject(db, projectId)?.id ?? null;
  const projectContext = getProjectContext(db, projectId);
  if (!projectContext) {
    throw validationError("Project context could not be resolved.", { projectId });
  }

  return {
    projectId,
    milestoneId,
    projectContext
  };
}

function resolveOnlyActiveProjectContext(db: Parameters<typeof getProject>[0]): ProjectContext | null {
  const activeProjects = listProjects(db).filter((project) => project.status === "active");
  if (activeProjects.length !== 1) {
    return null;
  }

  return getProjectContext(db, activeProjects[0].id);
}
