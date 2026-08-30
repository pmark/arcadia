import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { createCodexPacket, selectAgentProfileForWorkItem } from "../codex/packets.js";
import { validationError } from "../cli/errors.js";
import {
  createExecutionPlan,
  getArtifact,
  getCodexInvocation,
  getProject,
  getProjectContext,
  getWorkItem,
  getWorkItemByDocRef,
  listArtifacts,
  mergeReviewItemContext,
  updateArtifact,
  updateReviewItemStatus
} from "../db/repositories.js";
import { syncProjectDocs } from "../docs/sync.js";
import { parseDoc } from "../docs/parse.js";
import { actionDocRef, parseActionDocRef } from "../docs/types.js";
import type { ReviewItemSummary, WorkItemSummary } from "../domain/types.js";
import { persistCodexPacketRecords } from "../execution/planningPreparation.js";
import { packetSha256, parseDecisionContext } from "../execution/planningAuthorization.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";
import {
  extractPlanningPromotionFields,
  validatePlanningArtifact,
  type PlanningPromotionFields
} from "../stewardship/artifactValidator.js";
import { localDateStamp } from "../utils/time.js";
import { slugify } from "../utils/slug.js";

const PROJECT_PREPARE_MARKER = "Explicit project idea supplied to arcadia project prepare.";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const CONCRETE_VERB = /^(?:add|build|create|define|deliver|implement|integrate|migrate|replace|ship|write)\b/i;

export interface ProjectIdeaPromotionPreparation {
  decisionId: string;
  projectId: string;
  projectSlug: string;
  repoPath: string;
  planSlug: string;
  planningActionId: string;
  planningWorkItemId: string;
  sourceIdea: string;
  planningArtifactId: string;
  planningArtifactPath: string;
  validationArtifactId: string;
  validationArtifactPath: string;
  buildProfile: string;
  fields: PlanningPromotionFields;
}

export interface ProjectIdeaPromotionReceipt {
  actionId: string;
  actionDocRef: string;
  planPath: string;
  sourceIdea: string;
  repoPath: string;
  planningArtifactId: string;
  planningArtifactPath: string;
  validationArtifactId: string;
  validationArtifactPath: string;
  acceptanceDecisionId: string;
  buildProfile: string;
  buildPlanId: string;
  buildInvocationId: string;
  buildPacketArtifactId: string;
  buildPacketPath: string;
  buildPacketSha256: string;
  trigger: string;
  reused: boolean;
}

/**
 * Recognize and fully preflight only the explicit `project prepare` workflow.
 * Ordinary accepted planning Artifacts retain their existing behavior.
 */
export function prepareProjectIdeaPromotion(
  db: Database.Database,
  workspace: string,
  decision: ReviewItemSummary
): ProjectIdeaPromotionPreparation | null {
  if (decision.resolved_intent !== "CodexPlanningArtifactAcceptance" || !decision.work_item_id) {
    return null;
  }

  const planningAction = getWorkItem(db, decision.work_item_id);
  if (!planningAction || planningAction.clarification_source !== PROJECT_PREPARE_MARKER) {
    return null;
  }
  if (!planningAction.project_id || !planningAction.doc_ref || !decision.artifact_id || !decision.codex_invocation_id) {
    throw validationError("Project-idea planning acceptance is missing its Project, managed Action, Artifact, or invocation.", {
      decisionId: decision.id
    });
  }

  const parsedRef = parseActionDocRef(planningAction.doc_ref);
  const projectContext = getProjectContext(db, planningAction.project_id);
  const repoPath = projectContext?.metadata?.repo_path?.trim();
  if (!parsedRef || !projectContext || !repoPath || !existsSync(repoPath)) {
    throw validationError("Project-idea planning acceptance cannot resolve its authoritative repository Action.", {
      decisionId: decision.id,
      docRef: planningAction.doc_ref,
      repoPath
    });
  }

  const artifact = getArtifact(db, decision.artifact_id);
  const invocation = getCodexInvocation(db, decision.codex_invocation_id);
  const context = parseDecisionContext(decision);
  const validationPath = typeof context.validationResultPath === "string" ? context.validationResultPath : null;
  const validationArtifact = listArtifacts(db).find((candidate) =>
    candidate.work_item_id === planningAction.id &&
    candidate.artifact_type === "planning_artifact_validation" &&
    candidate.path === validationPath
  );
  if (!artifact?.path || !invocation || !validationArtifact?.path) {
    throw validationError("Project-idea planning acceptance is missing current Artifact or Validation evidence.", {
      decisionId: decision.id,
      artifactId: decision.artifact_id,
      validationPath
    });
  }

  const packetPath = path.join(workspace, invocation.prompt_path);
  const artifactPath = path.join(workspace, artifact.path);
  const sidecarPath = path.join(workspace, validationArtifact.path);
  if (!existsSync(packetPath) || !existsSync(artifactPath) || !existsSync(sidecarPath)) {
    throw validationError("Project-idea planning Artifact, packet, or Validation file is missing.", {
      packetPath: invocation.prompt_path,
      artifactPath: artifact.path,
      validationPath: validationArtifact.path
    });
  }

  const sidecar = parseJsonObject(readFileSync(sidecarPath, "utf8"), "planning Validation sidecar");
  if (sidecar.status !== "passed" || sidecar.artifactPath !== artifact.path || sidecar.packetPath !== invocation.prompt_path) {
    throw validationError("Planning Validation evidence is stale or does not match the accepted Artifact and packet.", {
      decisionId: decision.id,
      validationPath: validationArtifact.path
    });
  }

  const packetText = readFileSync(packetPath, "utf8");
  const artifactText = readFileSync(artifactPath, "utf8");
  const validation = validatePlanningArtifact({ packetText, artifactText });
  const fields = extractPlanningPromotionFields(artifactText);
  if (!validation.passed || !fields || !CONCRETE_VERB.test(fields.smallestFollowUpGoal)) {
    throw validationError("Accepted planning Artifact no longer defines a valid concrete implementation promotion.", {
      decisionId: decision.id,
      failures: validation.failures.map((failure) => failure.code),
      smallestFollowUpGoal: fields?.smallestFollowUpGoal ?? null,
      remedy: "Restore or regenerate the validated planning Artifact, then accept it again."
    });
  }

  const registries = loadPhase3Registries(workspace);
  validatePhase3Registries(registries);
  const buildProfile = registries.codingAgents.defaults?.build;
  if (!buildProfile || !registries.codingAgents.profiles.some((profile) => profile.name === buildProfile && profile.purpose === "build")) {
    throw validationError("Project-idea promotion requires one configured default build profile.", {
      configuredDefault: buildProfile ?? null
    });
  }

  return {
    decisionId: decision.id,
    projectId: planningAction.project_id,
    projectSlug: projectContext.project.slug,
    repoPath,
    planSlug: parsedRef.planSlug,
    planningActionId: parsedRef.actionId,
    planningWorkItemId: planningAction.id,
    sourceIdea: planningAction.raw_input,
    planningArtifactId: artifact.id,
    planningArtifactPath: artifact.path,
    validationArtifactId: validationArtifact.id,
    validationArtifactPath: validationArtifact.path,
    buildProfile,
    fields
  };
}

/** Rewrite both checked-in pointers before operational state is synchronized. */
export function writeProjectIdeaPromotionDocuments(
  prepared: ProjectIdeaPromotionPreparation
): ProjectIdeaPromotionDocumentWrite {
  const projectPath = path.join(prepared.repoPath, "PROJECT.md");
  const relativePlanPath = path.join("docs", "plans", `${prepared.planSlug}.md`);
  const planPath = path.join(prepared.repoPath, relativePlanPath);
  const originalProject = readRequiredFile(projectPath, "Project document");
  const originalPlan = readRequiredFile(planPath, "active plan document");
  const projectBlock = parseFrontmatter(originalProject, "PROJECT.md");
  const planBlock = parseFrontmatter(originalPlan, relativePlanPath);

  if (projectBlock.data.active_plan !== prepared.planSlug) {
    throw validationError("Project active plan changed before planning promotion.", {
      expected: prepared.planSlug,
      actual: projectBlock.data.active_plan ?? null
    });
  }
  const actions = Array.isArray(planBlock.data.actions) ? planBlock.data.actions as Array<Record<string, unknown>> : [];
  const marker = promotionMarker(prepared.decisionId);
  const existing = actions.find((action) => action.source === marker);
  if (existing) {
    const actionId = String(existing.id ?? "");
    if (!actionId || projectBlock.data.current_action !== actionId || planBlock.data.current_action !== actionId) {
      throw validationError("Existing planning promotion has inconsistent Project or plan pointers.", {
        decisionId: prepared.decisionId,
        actionId: actionId || null
      });
    }
    return {
      actionId,
      actionDocRef: actionDocRef(prepared.planSlug, actionId),
      planPath: relativePlanPath,
      projectPath,
      absolutePlanPath: planPath,
      originalProject,
      originalPlan,
      reused: true
    };
  }

  if (
    projectBlock.data.current_action !== prepared.planningActionId ||
    planBlock.data.current_action !== prepared.planningActionId
  ) {
    throw validationError("Authoritative work pointer moved before planning promotion.", {
      expectedAction: prepared.planningActionId,
      projectAction: projectBlock.data.current_action ?? null,
      planAction: planBlock.data.current_action ?? null
    });
  }
  const sourceIndex = actions.findIndex((action) => action.id === prepared.planningActionId);
  if (sourceIndex < 0) {
    throw validationError("Active plan no longer contains the accepted planning Action.", {
      actionId: prepared.planningActionId,
      planPath: relativePlanPath
    });
  }

  const actionId = uniquePromotedActionId(prepared.fields.smallestFollowUpGoal, prepared.decisionId, actions);
  const title = promotedTitle(prepared.fields.smallestFollowUpGoal);
  const expectedArtifact = `Validated implementation Candidate for: ${title}`;
  const promotedAction: Record<string, unknown> = {
    id: actionId,
    title,
    status: "open",
    responsibility: "codex",
    effort: "session",
    next_action: prepared.fields.smallestFollowUpGoal,
    expected_artifact: expectedArtifact,
    clarification: "clarified",
    confidence: "high",
    source: marker,
    acceptance_criteria: [
      `The repository contains the accepted implementation slice: ${prepared.fields.smallestFollowUpGoal}`,
      `The accepted validation strategy is satisfied: ${prepared.fields.validationStrategy}`,
      `The change stays within the accepted repository impact and approval requirements: ${prepared.fields.repositoryImpact} ${prepared.fields.approvalRequirements}`
    ],
    depends_on: [prepared.planningActionId],
    decisions: [],
    references: ["PROJECT.md", prepared.planningArtifactPath, prepared.validationArtifactPath]
  };
  const updatedActions = actions.map((action, index) =>
    index === sourceIndex ? { ...action, status: "done" } : action
  );
  updatedActions.splice(sourceIndex + 1, 0, promotedAction);

  const updated = localDateStamp();
  const nextPlan = renderFrontmatter({
    ...planBlock.data,
    current_action: actionId,
    token_impact: "medium",
    token_budget: "Planning is complete. Use one bounded coding-agent build invocation for the promoted Action; keep document updates, packet preparation, and validation deterministic.",
    updated,
    actions: updatedActions
  }, planBlock.body);
  const nextProject = renderFrontmatter({
    ...projectBlock.data,
    current_action: actionId,
    updated
  }, projectBlock.body);

  assertManagedDocument(nextPlan, relativePlanPath, "plan");
  assertManagedDocument(nextProject, "PROJECT.md", "project");
  replaceTwoFilesAtomically({ planPath, projectPath, originalPlan, originalProject, nextPlan, nextProject });

  return {
    actionId,
    actionDocRef: actionDocRef(prepared.planSlug, actionId),
    planPath: relativePlanPath,
    projectPath,
    absolutePlanPath: planPath,
    originalProject,
    originalPlan,
    reused: false
  };
}

interface ProjectIdeaPromotionDocumentWrite {
  actionId: string;
  actionDocRef: string;
  planPath: string;
  projectPath: string;
  absolutePlanPath: string;
  originalProject: string;
  originalPlan: string;
  reused: boolean;
}

/** Restore only documents written by this attempt; pre-existing promotions are never undone. */
export function rollbackProjectIdeaPromotionDocuments(written: ProjectIdeaPromotionDocumentWrite): void {
  if (written.reused) return;
  replaceTwoFilesAtomically({
    planPath: written.absolutePlanPath,
    projectPath: written.projectPath,
    originalPlan: readRequiredFile(written.absolutePlanPath, "promoted plan document"),
    originalProject: readRequiredFile(written.projectPath, "promoted Project document"),
    nextPlan: written.originalPlan,
    nextProject: written.originalProject
  });
}

/** Sync the written Action and prepare its immutable build packet, never a Run. */
export function persistProjectIdeaPromotion(
  db: Database.Database,
  workspace: string,
  decision: ReviewItemSummary,
  prepared: ProjectIdeaPromotionPreparation,
  written: ReturnType<typeof writeProjectIdeaPromotionDocuments>
): ProjectIdeaPromotionReceipt {
  const project = getProject(db, prepared.projectId);
  if (!project) {
    throw validationError("Project disappeared before planning promotion.", { projectId: prepared.projectId });
  }
  const sync = syncProjectDocs(db, project, { apply: true });
  if (sync.errors.length > 0 || sync.rejected.length > 0 || sync.foreign.length > 0) {
    throw validationError("Promoted managed documents could not be synchronized.", {
      errors: sync.errors,
      rejected: sync.rejected,
      foreign: sync.foreign
    });
  }

  const promotedAction = getWorkItemByDocRef(db, written.actionDocRef);
  if (!promotedAction || promotedAction.project_id !== prepared.projectId) {
    throw validationError("Promoted build Action was not created from the authoritative plan.", {
      actionDocRef: written.actionDocRef
    });
  }

  const registries = loadPhase3Registries(workspace);
  validatePhase3Registries(registries);
  const selection = selectAgentProfileForWorkItem({
    profiles: registries.codingAgents.profiles,
    adapters: registries.providerAdapters,
    workItem: promotedAction,
    purpose: "build",
    requestedName: prepared.buildProfile,
    defaults: registries.codingAgents.defaults
  });
  const buildPlan = createExecutionPlan(db, {
    workItemId: promotedAction.id,
    summary: `Build the accepted planning Artifact for "${promotedAction.title}".`,
    steps: [{
      skillName: "codex_build",
      title: "Implement the accepted first build Action",
      command: null,
      executorType: "codex_build",
      safeToRun: false,
      needsOperator: "Run only through the explicit build trigger returned by planning acceptance."
    }]
  });
  if (!buildPlan) {
    throw validationError("Promoted build execution plan could not be created.", { actionId: promotedAction.id });
  }
  const packet = createCodexPacket({
    workspace,
    request: prepared.sourceIdea,
    resolved: promotionResolvedIntent(promotedAction, prepared),
    workItem: promotedAction,
    planId: buildPlan.id,
    projectContext: getProjectContext(db, prepared.projectId),
    agentProfile: selection.profile,
    agentConfiguration: selection.configuration,
    executionRequirement: selection.executionRequirement
  });
  const persisted = persistCodexPacketRecords(db, {
    packet,
    workItem: promotedAction,
    plan: buildPlan,
    planStepId: buildPlan.steps[0]?.id ?? null
  });
  const trigger = [
    "arcadia work run",
    promotedAction.id,
    "--plan",
    buildPlan.id,
    "--allow-codex-build",
    "--agent-profile",
    selection.profile.name
  ].join(" ");
  const receipt: ProjectIdeaPromotionReceipt = {
    actionId: promotedAction.id,
    actionDocRef: written.actionDocRef,
    planPath: written.planPath,
    sourceIdea: prepared.sourceIdea,
    repoPath: prepared.repoPath,
    planningArtifactId: prepared.planningArtifactId,
    planningArtifactPath: prepared.planningArtifactPath,
    validationArtifactId: prepared.validationArtifactId,
    validationArtifactPath: prepared.validationArtifactPath,
    acceptanceDecisionId: decision.id,
    buildProfile: selection.profile.name,
    buildPlanId: buildPlan.id,
    buildInvocationId: persisted.invocation.id,
    buildPacketArtifactId: persisted.packetArtifact.id,
    buildPacketPath: persisted.packetArtifact.path as string,
    buildPacketSha256: packetSha256(packet.promptPath),
    trigger,
    reused: written.reused
  };

  updateArtifact(db, prepared.planningArtifactId, { status: "ready" });
  mergeReviewItemContext(db, decision.id, { planningPromotion: receipt });
  updateReviewItemStatus(db, decision.id, {
    status: "approved",
    decisionNote: `Validated planning Artifact accepted and promoted to ${written.actionDocRef}. Build packet prepared; no Run started.`
  });
  return receipt;
}

export function existingProjectIdeaPromotion(decision: ReviewItemSummary): ProjectIdeaPromotionReceipt | null {
  const value = parseDecisionContext(decision).planningPromotion;
  return isPromotionReceipt(value) ? value : null;
}

function promotionResolvedIntent(
  workItem: WorkItemSummary,
  prepared: ProjectIdeaPromotionPreparation
): ResolvedIntent {
  return {
    intentId: "codex_build",
    matched: false,
    title: workItem.title,
    outputKind: "codex_build_packet",
    queue: workItem.queue,
    workClassification: workItem.work_classification,
    nextAction: workItem.next_action,
    expectedArtifact: workItem.expected_artifact,
    skillSequence: [{
      skillName: "codex_build",
      title: "Implement the accepted first build Action",
      command: null,
      executorType: "codex_build",
      safeToRun: false,
      needsOperator: "Use the explicit build trigger."
    }],
    approvalGates: [],
    templates: [],
    slots: {
      sourcePlanningArtifact: prepared.planningArtifactPath,
      planningValidationResult: prepared.validationArtifactPath,
      acceptanceDecision: prepared.decisionId
    },
    codexPurpose: "build"
  };
}

function promotionMarker(decisionId: string): string {
  return `[planning-promotion:${decisionId}]`;
}

function uniquePromotedActionId(goal: string, decisionId: string, actions: Array<Record<string, unknown>>): string {
  const base = slugify(goal);
  const ids = new Set(actions.map((action) => String(action.id ?? "")));
  if (!ids.has(base)) return base;
  return `${base.slice(0, 62)}-${slugify(decisionId).slice(-12)}`;
}

function promotedTitle(goal: string): string {
  const firstSentence = goal.trim().split(/(?<=[.!?])\s+/, 1)[0]?.replace(/[.!?]+$/, "") ?? goal.trim();
  return firstSentence.length <= 140 ? firstSentence : `${firstSentence.slice(0, 137).trimEnd()}...`;
}

function parseFrontmatter(content: string, relativePath: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(content);
  if (!match) throw validationError("Managed document has no YAML frontmatter.", { relativePath });
  const parsed: unknown = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("Managed document frontmatter is not a mapping.", { relativePath });
  }
  return { data: parsed as Record<string, unknown>, body: match[2] ?? "" };
}

function renderFrontmatter(data: Record<string, unknown>, body: string): string {
  return ["---", stringifyYaml(data, { lineWidth: 0 }).trimEnd(), "---", body].join("\n");
}

function assertManagedDocument(content: string, relativePath: string, type: "plan" | "project"): void {
  const parsed = parseDoc(relativePath, relativePath, content);
  if (!parsed.doc || parsed.doc.type !== type || parsed.errors.length > 0) {
    throw validationError("Planning promotion would write an invalid managed document.", {
      relativePath,
      errors: parsed.errors
    });
  }
}

function replaceTwoFilesAtomically(input: {
  planPath: string;
  projectPath: string;
  originalPlan: string;
  originalProject: string;
  nextPlan: string;
  nextProject: string;
}): void {
  const planTemp = `${input.planPath}.arcadia-promote-${process.pid}.tmp`;
  const projectTemp = `${input.projectPath}.arcadia-promote-${process.pid}.tmp`;
  writeFileSync(planTemp, input.nextPlan, "utf8");
  writeFileSync(projectTemp, input.nextProject, "utf8");
  let planMoved = false;
  try {
    renameSync(planTemp, input.planPath);
    planMoved = true;
    renameSync(projectTemp, input.projectPath);
  } catch (error) {
    if (planMoved) writeFileSync(input.planPath, input.originalPlan, "utf8");
    writeFileSync(input.projectPath, input.originalProject, "utf8");
    throw error;
  } finally {
    rmSync(planTemp, { force: true });
    rmSync(projectTemp, { force: true });
  }
}

function readRequiredFile(filePath: string, label: string): string {
  if (!existsSync(filePath)) throw validationError(`${label} is missing.`, { filePath });
  return readFileSync(filePath, "utf8");
}

function parseJsonObject(content: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to one stable validation error.
  }
  throw validationError(`${label} is not valid JSON.`);
}

function isPromotionReceipt(value: unknown): value is ProjectIdeaPromotionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [
    "actionId", "actionDocRef", "planPath", "sourceIdea", "repoPath",
    "planningArtifactId", "planningArtifactPath", "validationArtifactId", "validationArtifactPath",
    "acceptanceDecisionId", "buildProfile", "buildPlanId", "buildInvocationId",
    "buildPacketArtifactId", "buildPacketPath", "buildPacketSha256", "trigger"
  ].every((field) => typeof candidate[field] === "string");
}
