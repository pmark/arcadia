import { resolvedIntentForStewardship, resolvedIntentFromIntake } from "../commands/ask.js";
import { normalizeAskInput } from "../intake/normalization.js";
import { resolveIntake, type IntakeResult, type IntakeWorkspaceContext } from "../intake/index.js";
import { parseReviewResponse } from "../review/responseParser.js";
import {
  stewardIntent,
  type GoalStewardshipResult,
  type StewardshipExecutionPath,
  type StewardshipRelatedProject
} from "../stewardship/index.js";
import { memoStandsDown, type AskMemo } from "./corrections.js";
import type { AskHeardType } from "./heard.js";

/**
 * Replays one Ask text through the pure routing functions only (intake patterns, the memo and stewardship), with no
 * workspace, no database writes and no model: the same decisions `arcadia ask` makes for an operator Ask under
 * `ask.routing.v2`, ending in the type the receipt's `Heard:` line would say. The golden-set test uses it, and
 * `tests/ask-golden.test.ts` also runs every case through the real `arcadia ask` to prove the two agree.
 *
 * Not covered, by design: Ask rules (a workspace file), the workspace's intent-registry fallback, suppression
 * (acknowledgements and open duplicates) and agent-sourced Asks, none of which are pure functions of the text.
 */
export interface ReplayDeps {
  /** The Projects intake knows about. */
  context: IntakeWorkspaceContext;
  /** The operator memo for exactly this text, or null. Wraps `findAskMemo` over a seeded database in the test. */
  memo: (text: string) => AskMemo | null;
}

export interface ReplayResult {
  /** What the Ask is heard as. */
  type: AskHeardType;
  /** The execution path the stewardship recommends for the route actually taken. */
  path: StewardshipExecutionPath;
  /** True when an operator memo routed it. */
  memo: boolean;
  intake: IntakeResult;
  stewardship: GoalStewardshipResult;
}

export function replayAsk(rawText: string, deps: ReplayDeps): ReplayResult {
  const request = normalizeAskInput(rawText).askText;
  const parsed = parseReviewResponse(request, {});
  const intake = resolveIntake(request, deps.context, { operatorPhrasings: true });

  const derive = (approved: boolean, selectedProject: StewardshipRelatedProject | null): GoalStewardshipResult => {
    const input = {
      rawInput: request,
      intake,
      workspaceContext: deps.context,
      approvedFromReview: approved,
      reviewResponseHasReference: parsed.hasReviewReference,
      reviewResponseHasResponse: parsed.hasResponse,
      selectedProject,
      routingV2: true
    };
    const preliminary = stewardIntent({ ...input, resolved: resolvedIntentFromIntake(intake, approved) });
    return stewardIntent({ ...input, resolved: resolvedIntentForStewardship(intake, preliminary, approved) });
  };

  // The memo stage, exactly as `arcadia ask` runs it: never for a reply naming a Decision; it stands down when the
  // Project it remembers is not one intake knows, when the ordinary route needs Requires Review or is Blocked, or when the intake needs review and is unsafe.
  let memo = parsed.hasReviewReference ? null : deps.memo(request);
  if (memo?.projectId && !deps.context.projects.some((project) => project.id === memo?.projectId)) memo = null;
  if (memo && memoStandsDown(derive(false, null).recommendedExecutionPath, intake)) memo = null;

  const route = memo?.type;
  const remembered = memo?.projectId ? deps.context.projects.find((project) => project.id === memo?.projectId) : undefined;
  const selected: StewardshipRelatedProject | null = remembered ? { id: remembered.id, name: remembered.name } : null;
  const computed = derive(route === "work", selected);
  const stewardship: GoalStewardshipResult =
    route === "idea" ? { ...computed, recommendedExecutionPath: "Back Burner" } : computed;
  return { type: heardType(route, parsed.hasReviewReference, intake, stewardship), path: stewardship.recommendedExecutionPath, memo: memo !== null, intake, stewardship };
}

function heardType(
  route: AskMemo["type"] | undefined,
  repliesToDecision: boolean,
  intake: IntakeResult,
  stewardship: GoalStewardshipResult
): AskHeardType {
  if (route) return route;
  if (repliesToDecision) return "answer";
  // The direct answer routes `arcadia ask` takes before stewardship decides anything, when intake is sure.
  if (intake.confidenceLabel === "high") {
    if (["show_status", "show_review", "show_project", "list_projects"].includes(intake.action.kind)) return "status";
    if (intake.action.kind === "create_project" && intake.action.projectName) return "work";
  }
  if (stewardship.recommendedExecutionPath === "Back Burner") return "idea";
  if (stewardship.recommendedExecutionPath === "Clarify First") return "unclear";
  return "work";
}
