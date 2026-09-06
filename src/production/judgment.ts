import { validationError } from "../cli/errors.js";

/**
 * Activation delegates mechanics, not judgment. When production reaches
 * something genuinely judgment-shaped it must interrupt — and contract 17 is
 * specific about the shape of that interruption: the affected objective, the
 * current evidence, and two or more meaningful options each carrying its own
 * consequence, with one recommended.
 *
 * This constructor refuses to build anything less. A "judgment" with one
 * option is a notification, and a consequence-free option list is a menu the
 * operator has to reconstruct themselves — which is the attention cost the
 * rule exists to prevent.
 */

export interface JudgmentOption {
  label: string;
  consequence: string;
  recommended?: boolean;
}

export interface JudgmentRequestInput {
  objective: string;
  evidence: string[];
  options: JudgmentOption[];
  recommendation: string;
  actionKey?: string | null;
}

export interface JudgmentRequest {
  objective: string;
  evidence: string[];
  options: Array<Required<Pick<JudgmentOption, "label" | "consequence">> & { recommended: boolean }>;
  recommendation: string;
  actionKey: string | null;
}

export function buildJudgmentRequest(input: JudgmentRequestInput): JudgmentRequest {
  const objective = input.objective.trim();
  if (!objective) {
    throw validationError("A judgment request must name the affected objective.", {
      field: "objective"
    });
  }

  const evidence = input.evidence.map((line) => line.trim()).filter(Boolean);
  if (evidence.length === 0) {
    throw validationError("A judgment request must carry the current evidence.", {
      field: "evidence"
    });
  }

  if (input.options.length < 2) {
    throw validationError("A judgment request must offer two or more meaningful options.", {
      field: "options",
      offered: input.options.length
    });
  }

  const options = input.options.map((option, index) => {
    const label = option.label.trim();
    const consequence = option.consequence.trim();
    if (!label) {
      throw validationError("Every option needs a label.", { field: `options[${index}].label` });
    }
    if (!consequence) {
      throw validationError(`Option "${label}" needs its consequence stated.`, {
        field: `options[${index}].consequence`
      });
    }
    return { label, consequence, recommended: option.recommended === true };
  });

  const recommendedCount = options.filter((option) => option.recommended).length;
  if (recommendedCount > 1) {
    throw validationError("A judgment request may recommend at most one option.", {
      field: "options",
      recommended: recommendedCount
    });
  }

  const recommendation = input.recommendation.trim();
  if (!recommendation) {
    throw validationError("A judgment request must state a recommendation.", {
      field: "recommendation"
    });
  }

  return { objective, evidence, options, recommendation, actionKey: input.actionKey ?? null };
}
