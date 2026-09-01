import { projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  buildAskProcessingReceipt,
  buildAskRoutingDecision,
  loadAskRuleRegistry,
  matchAskRule,
  renderAskProcessingPreview,
  resolveGeneralProjectReference,
  resolveProjectReference,
  validateAskRuleRegistry,
  type AskProcessingReceipt
} from "../ask/rules.js";
import { withDatabase } from "../db/connection.js";
import { normalizeAskInput } from "../intake/normalization.js";
import { resolveIntake } from "../intake/index.js";
import { buildIntakeContext, projectIdFromIntake } from "./ask.js";

export interface AskRuleTestOptions {
  workspace: string;
  request: string;
  project?: string;
}

export interface AskRuleTestData {
  matched: boolean;
  receipt: AskProcessingReceipt | null;
  normalizedRules: string;
  preview: string[];
  writesPerformed: 0;
}

export function runAskRuleTestCommand(options: AskRuleTestOptions): CommandSuccess<AskRuleTestData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const request = normalizeAskInput(options.request).askText;
  const registry = loadAskRuleRegistry(workspacePath);
  const prepared = withDatabase(workspacePath, (db) => {
    const validated = validateAskRuleRegistry(workspacePath, db, registry);
    const match = matchAskRule(request, validated);
    const explicit = resolveProjectReference(db, options.project);
    if (options.project && !explicit) throw projectNotFound(options.project);
    const processingPayload = match?.payload ?? request;
    const intake = resolveIntake(processingPayload, buildIntakeContext(db));
    const extracted = resolveProjectReference(db, projectIdFromIntake(intake) ?? intake.project?.id);
    const general = resolveGeneralProjectReference(db, processingPayload);
    const routing = buildAskRoutingDecision({
      explicit,
      prefix: match?.rule.destination,
      extracted,
      general
    });
    const receipt = match
      ? buildAskProcessingReceipt({
          match,
          routing,
          originalRequest: request,
          extractedFields: intake.extractedFields
        })
      : null;
    return { validated, receipt };
  });
  const preview = renderAskProcessingPreview(prepared.receipt);
  return createSuccess({
    command: "ask-rule.test",
    workspace: workspacePath,
    data: {
      matched: Boolean(prepared.receipt),
      receipt: prepared.receipt,
      normalizedRules: prepared.validated.normalized,
      preview,
      writesPerformed: 0
    }
  });
}

export function renderAskRuleTestSuccess(response: CommandSuccess<AskRuleTestData>): string[] {
  return ["Ask rule processing preview", ...response.data.preview];
}
