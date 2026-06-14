import type { IntakeConfidenceLabel } from "../src/intake/index.js";
import type { StewardshipExecutionPath, StewardshipIntentType } from "../src/stewardship/index.js";

export interface SeedProject {
  name: string;
  mission: string;
  goal?: string;
  aliases?: string[];
  activeMilestone?: string;
  nextAction?: string;
  repoPath?: string;
  validationCommands?: string[];
}

export interface SeedRecentActivity {
  project: string;
  title: string;
}

export interface StewardshipQualityFixture {
  name: string;
  input: string;
  seed: {
    projects: SeedProject[];
    recentActivity?: SeedRecentActivity[];
  };
  expect: {
    intentType: StewardshipIntentType;
    executionPath: StewardshipExecutionPath;
    confidenceLabel: IntakeConfidenceLabel;
    project: string | null;
    slots?: Record<string, string>;
    requestedWorkArtifactIncludes?: string[];
    requestedWorkArtifactExcludes?: string[];
    packetArtifactIncludes?: string[];
    packetArtifactExcludes?: string[];
    packetIncludes?: string[];
    packetCritiqueStatus?: string;
    askRawInputIncludes?: string[];
    packetExcludes?: string[];
    knownBadPhrasesAbsent?: string[];
    clarificationRequired?: boolean;
    reviewRequired?: boolean;
    planningRecommended?: boolean;
  };
}

export const defaultProjects: SeedProject[] = [
  {
    name: "Arcadia",
    mission: "Maintain momentum across creative projects.",
    goal: "Make ask the universal ingress router.",
    aliases: ["Arcadia"],
    activeMilestone: "Discord review workflow",
    nextAction: "Tighten stewardship review UX.",
    repoPath: "/Users/pmark/Dev/MR/Arcadia/arcadia",
    validationCommands: ["pnpm test"]
  },
  {
    name: "Rebuster",
    mission: "Help users turn product evidence into better shipping decisions.",
    goal: "Ship Pinterest publishing support.",
    aliases: ["Rebuster", "rebuster app"],
    activeMilestone: "Pinterest publishing support",
    nextAction: "Define Pinterest support boundaries.",
    repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
    validationCommands: ["pnpm test", "pnpm lint"]
  },
  {
    name: "MIDI Opener",
    mission: "Make MIDI files easy to preview.",
    goal: "Improve playback and release operations.",
    aliases: ["MIDI Opener", "midi opener app"],
    activeMilestone: "Focus Mode and MIDI IN reliability",
    nextAction: "Triage Focus Mode playback bugs.",
    repoPath: "/Users/pmark/Dev/MR/MIDIOpener",
    validationCommands: ["swift test"]
  }
];

export const stewardshipQualityFixtures: StewardshipQualityFixture[] = [
  {
    name: "normalizes pnpm arcadia ask wrapper before planning stewardship",
    input: "pnpm arcadia ask \"Plan and implement Publishing support for Pinterest for Rebuster project\"",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Planning Request",
      executionPath: "Plan First",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        purpose: "publishing support"
      },
      requestedWorkArtifactIncludes: [
        "Pinterest publishing plan for Rebuster",
        "ordered phases",
        "risks/open questions",
        "approval requirements",
        "recommended next action"
      ],
      requestedWorkArtifactExcludes: ["Goal stewardship plan", "generic project execution plan"],
      packetArtifactIncludes: [
        "Pinterest publishing plan for Rebuster",
        "ordered phases",
        "risks/open questions",
        "approval requirements",
        "recommended next action"
      ],
      packetArtifactExcludes: ["Goal stewardship plan", "generic project execution plan"],
      packetExcludes: ["pnpm arcadia ask"],
      askRawInputIncludes: ["pnpm arcadia ask"],
      knownBadPhrasesAbsent: [
        "the relevant project",
        "Goal stewardship plan"
      ],
      packetCritiqueStatus: "approved",
      reviewRequired: false,
      planningRecommended: true
    }
  },
  {
    name: "normalizes arcadia ask single quote wrapper before planning stewardship",
    input: "arcadia ask 'Plan and implement Publishing support for Pinterest for Rebuster project'",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Planning Request",
      executionPath: "Plan First",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        purpose: "publishing support"
      },
      requestedWorkArtifactIncludes: [
        "Pinterest publishing plan for Rebuster",
        "ordered phases",
        "risks/open questions",
        "approval requirements",
        "recommended next action"
      ],
      packetArtifactIncludes: ["Pinterest publishing plan for Rebuster"],
      packetExcludes: ["arcadia ask"],
      askRawInputIncludes: ["arcadia ask"],
      packetCritiqueStatus: "approved",
      reviewRequired: false,
      planningRecommended: true
    }
  },
  {
    name: "planning packet names Pinterest publishing plan artifact",
    input: "Plan and implement Publishing support for Pinterest for Rebuster.",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Planning Request",
      executionPath: "Plan First",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        purpose: "publishing support"
      },
      requestedWorkArtifactIncludes: [
        "Pinterest publishing plan for Rebuster",
        "ordered phases",
        "risks/open questions",
        "approval requirements",
        "recommended next action"
      ],
      requestedWorkArtifactExcludes: ["Goal stewardship plan"],
      packetArtifactIncludes: [
        "Pinterest publishing plan for Rebuster",
        "ordered phases",
        "risks/open questions",
        "approval requirements",
        "recommended next action"
      ],
      packetArtifactExcludes: ["Goal stewardship plan"],
      knownBadPhrasesAbsent: [
        "Publishing support for Pinterest for Rebuster",
        "the relevant project",
        "Goal stewardship plan"
      ],
      packetCritiqueStatus: "approved",
      reviewRequired: false,
      planningRecommended: true
    }
  },
  {
    name: "build packet names Pinterest publishing support artifact",
    input: "Implement Rebuster publishing support for Pinterest.",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        requestedAction: "implement publishing support"
      },
      requestedWorkArtifactIncludes: [
        "Pinterest publishing support for Rebuster",
        "safe repository changes",
        "docs/tests if applicable"
      ],
      requestedWorkArtifactExcludes: ["Codex build packet"],
      packetArtifactIncludes: [
        "Pinterest publishing support for Rebuster",
        "safe repository changes",
        "docs/tests if applicable"
      ],
      packetArtifactExcludes: ["Codex build packet"],
      packetIncludes: [
        "destructive_filesystem_changes",
        "publication",
        "send_email_or_messages",
        "Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."
      ],
      knownBadPhrasesAbsent: [
        "Publishing support for Pinterest for Rebuster",
        "the relevant project",
        "Codex build packet"
      ],
      packetCritiqueStatus: "approved",
      reviewRequired: true,
      planningRecommended: true
    }
  },
  {
    name: "resolves Rebuster and treats Pinterest as platform",
    input: "Implement Pinterest publishing support for Rebuster",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        action: "Pinterest publishing support"
      },
      requestedWorkArtifactIncludes: ["Pinterest", "publishing", "Rebuster"],
      knownBadPhrasesAbsent: ["Codex build packet", "relevant project"],
      reviewRequired: true,
      planningRecommended: true
    }
  },
  {
    name: "known failure keeps Rebuster project when Pinterest trails",
    input: "Implement Rebuster publishing support for Pinterest",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        requestedAction: "implement publishing support"
      },
      requestedWorkArtifactIncludes: ["Pinterest", "publishing", "Rebuster"],
      knownBadPhrasesAbsent: ["Codex build packet", "relevant project"],
      reviewRequired: true,
      planningRecommended: true
    }
  },
  {
    name: "resolves Discord as Arcadia feature channel",
    input: "Add the Discord thing to Arcadia",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "Arcadia",
      slots: {
        project: "Arcadia",
        channel: "Discord",
        feature: "Discord thing"
      },
      requestedWorkArtifactIncludes: ["Discord", "Arcadia"],
      knownBadPhrasesAbsent: ["relevant project"],
      reviewRequired: true
    }
  },
  {
    name: "resolves MIDI Opener possessive feature",
    input: "Improve MIDI Opener’s Focus Mode",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "MIDI Opener",
      slots: {
        project: "MIDI Opener",
        feature: "Focus Mode"
      },
      requestedWorkArtifactIncludes: ["Focus Mode", "MIDI Opener"],
      knownBadPhrasesAbsent: ["relevant project"],
      reviewRequired: true
    }
  },
  {
    name: "uses active milestone as conservative recent context",
    input: "Keep going on the Pinterest thing",
    seed: {
      projects: defaultProjects,
      recentActivity: [
        {
          project: "Rebuster",
          title: "Pinterest publishing support"
        }
      ]
    },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "medium",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest",
        contextSource: "recent_context"
      },
      requestedWorkArtifactIncludes: ["Pinterest", "Rebuster"],
      reviewRequired: true
    }
  },
  {
    name: "refuses to guess vague continuation",
    input: "Keep going on the thing",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Clarify First",
      confidenceLabel: "medium",
      project: null,
      clarificationRequired: true,
      reviewRequired: false,
      knownBadPhrasesAbsent: ["Execute Directly"]
    }
  },
  {
    name: "mission update stores clean value",
    input: "Change Rebuster project description/mission to Help creators publish evidence-backed posts.",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Execute Directly",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        attribute: "mission",
        value: "Help creators publish evidence-backed posts"
      },
      requestedWorkArtifactIncludes: ["Project mission update"],
      knownBadPhrasesAbsent: ["Change Rebuster mission to", "Change Rebuster project description/mission to"]
    }
  },
  {
    name: "approval boundaries for production publishing",
    input: "Publish Rebuster posts to Pinterest using production credentials",
    seed: { projects: defaultProjects },
    expect: {
      intentType: "Project Work",
      executionPath: "Requires Review",
      confidenceLabel: "high",
      project: "Rebuster",
      slots: {
        project: "Rebuster",
        platform: "Pinterest"
      },
      requestedWorkArtifactIncludes: ["Pinterest", "Rebuster"],
      packetIncludes: [
        "credentials_required",
        "publication",
        "production_data_access",
        "send_email_or_messages",
        "Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages."
      ],
      reviewRequired: true,
      planningRecommended: true
    }
  }
];
