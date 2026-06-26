import type { IntakeClassification } from "../src/domain/types.js";
import type { IntakeIntent } from "../src/intake/index.js";

export type GoldenRoutingOutcome = "requires_review" | "captured" | "acted";

export interface GoldenRequestExample {
  name: string;
  input: string;
  expectedClassification: IntakeClassification;
  expectedIntent: IntakeIntent;
  expectedProject: string | null;
  expectedRoutingOutcome: GoldenRoutingOutcome;
  expectedBackBurner: boolean;
}

export const goldenRequestExamples: GoldenRequestExample[] = [
  {
    name: "project-first Pinterest implementation",
    input: "Implement Rebuster Pinterest publishing",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "capability-first Pinterest support",
    input: "Add Pinterest support to Rebuster",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "Arcadia UX build request",
    input: "Build the Arcadia Discord review UX",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Arcadia",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "weekly project update",
    input: "Prepare weekly Rebuster update",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "bug-fix command for MIDI Opener",
    input: "Fix MIDI Opener loop desynchronization",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "MIDI Opener",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "new Rebuster experiment",
    input: "Create a new Rebuster experiment",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "Rebuster Studio bridge work",
    input: "Build Rebuster Studio support",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "Rebuster candidate overlap review",
    input: "Improve Rebuster candidate overlap review",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "strict Rebuster spec",
    input: "Create a strict Rebuster spec workflow",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "MIDI Opener release notes",
    input: "Write release notes for MIDI Opener 5.5",
    expectedClassification: "ExecutionRequest",
    expectedIntent: "CreateWork",
    expectedProject: "MIDI Opener",
    expectedRoutingOutcome: "requires_review",
    expectedBackBurner: false
  },
  {
    name: "speculative Rebuster thought",
    input: "Pinterest might help Rebuster.",
    expectedClassification: "Idea",
    expectedIntent: "CaptureThought",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "captured",
    expectedBackBurner: true
  },
  {
    name: "vague improvement thought",
    input: "Improve the Rebuster candidate review flow.",
    expectedClassification: "IncubatingThought",
    expectedIntent: "CaptureThought",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "captured",
    expectedBackBurner: true
  },
  {
    name: "question remains non-execution",
    input: "Should Rebuster try Pinterest?",
    expectedClassification: "Question",
    expectedIntent: "CaptureThought",
    expectedProject: "Rebuster",
    expectedRoutingOutcome: "captured",
    expectedBackBurner: true
  },
  {
    name: "Arcadia feedback remains protected",
    input: "Arcadia review noise is too high.",
    expectedClassification: "ArcadiaFeedback",
    expectedIntent: "CaptureThought",
    expectedProject: "Arcadia",
    expectedRoutingOutcome: "captured",
    expectedBackBurner: true
  }
];
