import type { ClarifyVerdict } from "../src/clarify/types.js";

export interface ClarifyGoldenExample {
  name: string;
  /** Raw model output, exactly as it would come back from the job result. */
  rawResult: Record<string, unknown>;
  /** What `normalizeVerdict` must make of it. */
  expected: ClarifyVerdict;
  /** What the Action should look like after `--apply`. */
  expectedAfterApply: {
    clarification_status: "clarified" | "question_open";
    gap_type: string | null;
    work_classification?: string;
    queue?: string;
  };
}

/**
 * One example per rubric outcome: a YES plus each of the four gap types. These
 * drive the orchestrator against a stubbed job so the suite stays deterministic
 * and offline — no local model, no network.
 */
export const clarifyGoldenExamples: ClarifyGoldenExample[] = [
  {
    name: "YES verdict routed to a coding agent",
    rawResult: {
      verdict: "clarified",
      nextAction: "Add a per-batch retry to the nightly sync and log partial failures",
      actor: "coding-agent",
      source: "Action detail: 'sync dies halfway and we lose the batch'",
      confidence: "high"
    },
    expected: {
      verdict: "clarified",
      nextAction: "Add a per-batch retry to the nightly sync and log partial failures",
      actor: "coding-agent",
      source: "Action detail: 'sync dies halfway and we lose the batch'",
      confidence: "high"
    },
    expectedAfterApply: {
      clarification_status: "clarified",
      gap_type: null,
      work_classification: "agent",
      queue: "work_queue"
    }
  },
  {
    name: "YES verdict routed to the operator",
    rawResult: {
      verdict: "clarified",
      nextAction: "Call the accountant and confirm which quarter the filing covers",
      actor: "operator",
      source: "Action title",
      confidence: "medium"
    },
    expected: {
      verdict: "clarified",
      nextAction: "Call the accountant and confirm which quarter the filing covers",
      actor: "operator",
      source: "Action title",
      confidence: "medium"
    },
    expectedAfterApply: {
      clarification_status: "clarified",
      gap_type: null,
      work_classification: "requires_review",
      queue: "requires_review"
    }
  },
  {
    name: "missing-decision",
    rawResult: {
      verdict: "question_open",
      gapType: "missing-decision",
      question: "Should the nightly sync retry on partial failure, or fail the whole run?",
      criteria: ["Rollback cost", "Data consistency", "On-call noise"],
      confidence: "medium"
    },
    expected: {
      verdict: "question_open",
      gapType: "missing-decision",
      question: "Should the nightly sync retry on partial failure, or fail the whole run?",
      criteria: ["Rollback cost", "Data consistency", "On-call noise"],
      decomposition: undefined,
      draftAsk: undefined,
      confidence: "medium"
    },
    expectedAfterApply: { clarification_status: "question_open", gap_type: "missing-decision" }
  },
  {
    name: "missing-external-input",
    rawResult: {
      verdict: "question_open",
      gapType: "missing-external-input",
      question: "Which contract version did legal actually approve?",
      draftAsk: "Hi — could you confirm which version of the MSA you signed off on?"
    },
    expected: {
      verdict: "question_open",
      gapType: "missing-external-input",
      question: "Which contract version did legal actually approve?",
      criteria: undefined,
      decomposition: undefined,
      draftAsk: "Hi — could you confirm which version of the MSA you signed off on?",
      confidence: undefined
    },
    expectedAfterApply: { clarification_status: "question_open", gap_type: "missing-external-input" }
  },
  {
    name: "missing-definition",
    rawResult: {
      verdict: "question_open",
      gapType: "missing-definition",
      question: "Which step of onboarding is actually losing people?",
      decomposition: [
        "Instrument the email verification screen",
        "Pull drop-off numbers for the last 30 days",
        "Draft a fallback email"
      ]
    },
    expected: {
      verdict: "question_open",
      gapType: "missing-definition",
      question: "Which step of onboarding is actually losing people?",
      criteria: undefined,
      decomposition: [
        "Instrument the email verification screen",
        "Pull drop-off numbers for the last 30 days",
        "Draft a fallback email"
      ],
      draftAsk: undefined,
      confidence: undefined
    },
    expectedAfterApply: { clarification_status: "question_open", gap_type: "missing-definition" }
  },
  {
    name: "missing-success-criteria",
    rawResult: {
      verdict: "question_open",
      gapType: "missing-success-criteria",
      question: "What page-load number would count as 'fast enough' to close this out?"
    },
    expected: {
      verdict: "question_open",
      gapType: "missing-success-criteria",
      question: "What page-load number would count as 'fast enough' to close this out?",
      criteria: undefined,
      decomposition: undefined,
      draftAsk: undefined,
      confidence: undefined
    },
    expectedAfterApply: { clarification_status: "question_open", gap_type: "missing-success-criteria" }
  }
];
