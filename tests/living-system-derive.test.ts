import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { serializeLivingSystem } from "../src/livingSystem/contract.js";
import { deriveLivingSystemModel } from "../src/livingSystem/derive.js";
import type { LivingSystemFreshnessReceipt, LivingSystemSourceReceipt } from "../src/livingSystem/types.js";

const FIXTURES = path.resolve("tests/fixtures/living-system");
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("living-system state derivation", () => {
  it("derives Arcadia Episodes, explicit history, impact provenance, gaps, and Signals byte-stably", () => {
    const root = governedFixture("arcadia");
    write(root, "PROJECT.md", projectDoc("arcadia", "main", "clarify"));
    write(root, "docs/plans/main.md", planDoc("arcadia", [
      action("capture", "Capture intent", "done", ["src/capture.ts"]),
      action("clarify", "Clarify intent", "in_progress", []),
      action("unmapped", "Record an unsupported historical Action", "done", [])
    ], "clarify"));
    write(root, "docs/decisions/0001-proof.md", decisionDoc("arcadia", "main", "clarify"));
    write(root, "MISSION_LOG.md", logDoc("arcadia", [
      logEntry("Captured intent", "main#capture", "The request became durable."),
      logEntry("Older context", null, "History remained visible without a guessed Action.")
    ]));

    const input = {
      repoRoot: root,
      projectSlug: "arcadia",
      actionEvidence: [{
        action: "main#clarify",
        changedPaths: ["src/clarification.ts"],
        source: source("git", "commit:abc", "2026-08-21T08:00:00.000Z")
      }],
      operationalSignals: [
        {
          id: "run:clarify",
          kind: "run" as const,
          summary: "Codex implemented clarification.",
          state: "completed",
          episodeId: "main#clarify",
          source: source("run", "run:clarify", "2026-08-21T08:01:00.000Z"),
          freshness: freshness("current"),
          uncertainty: null
        },
        {
          id: "validation:conflict",
          kind: "validation" as const,
          summary: "Local and remote validation disagree.",
          state: "conflicting",
          episodeId: "main#clarify",
          source: { ...source("validation", "ci:clarify", "2026-08-20T08:01:00.000Z"), availability: "conflicting" as const },
          freshness: freshness("stale"),
          uncertainty: "Remote receipt contradicts the local result."
        }
      ]
    };

    const first = deriveLivingSystemModel(input);
    const second = deriveLivingSystemModel(input);
    expect(first.errors).toEqual([]);
    expect(first.model?.currentEpisodeId).toBe("main#clarify");
    expect(first.model?.episodes.map((episode) => episode.id)).toEqual([
      "main#capture",
      "main#clarify",
      "main#unmapped"
    ]);
    expect(first.model?.episodes.find((episode) => episode.id === "main#capture")?.occurredOn).toBe("2026-08-21");
    expect(first.model?.episodes.find((episode) => episode.id === "main#unmapped")?.occurredOn).toBeNull();
    expect(first.model?.episodes.find((episode) => episode.id === "main#clarify")?.impacts.map((impact) => [impact.topicId, impact.kind])).toEqual([
      ["clarification", "observed"],
      ["governed-build", "downstream"]
    ]);
    expect(first.model?.episodes.find((episode) => episode.id === "main#unmapped")?.impacts).toEqual([
      expect.objectContaining({ topicId: null, kind: "unmapped" })
    ]);
    expect(first.model?.unlinkedHistory).toEqual([
      expect.objectContaining({ title: "Older context", summary: "History remained visible without a guessed Action." })
    ]);
    expect(first.model?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "current:main#clarify", kind: "current_pointer" }),
      expect.objectContaining({ id: "decision:0001", episodeId: "main#clarify" }),
      expect.objectContaining({ id: "missing-evidence:main#unmapped", state: "missing" }),
      expect.objectContaining({ id: "validation:conflict", uncertainty: "Remote receipt contradicts the local result." })
    ]));
    expect(first.model?.freshness.state).toBe("missing");
    expect(serializeLivingSystem(first.model)).toBe(serializeLivingSystem(second.model));
  });

  it("keeps Private Practice Now vocabulary and derives declared impact without a universal taxonomy", () => {
    const root = governedFixture("private-practice-now");
    write(root, "PROJECT.md", projectDoc("private-practice-now", "journey", "assemble-site"));
    write(root, "docs/plans/journey.md", planDoc("private-practice-now", [
      action("interview", "Interview the practitioner", "done", ["journeys/practitioner-listening.md"]),
      action("assemble-site", "Assemble the accepted site", "open", ["journeys/trusted-launch.md"])
    ], "assemble-site"));
    write(root, "MISSION_LOG.md", logDoc("private-practice-now", [
      logEntry("Interview accepted", "journey#interview", "The practitioner evidence is authoritative.")
    ]));

    const result = deriveLivingSystemModel({ repoRoot: root, projectSlug: "private-practice-now" });

    expect(result.errors).toEqual([]);
    expect(result.model?.topics.map((topic) => topic.id)).toContain("practitioner-listening");
    expect(result.model?.episodes.find((episode) => episode.id === "journey#interview")?.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ topicId: "practitioner-listening", kind: "declared" }),
      expect.objectContaining({ topicId: "authentic-profile", kind: "downstream" })
    ]));
    expect(result.model?.episodes.find((episode) => episode.id === "journey#assemble-site")?.impacts).toEqual([
      expect.objectContaining({ topicId: "trusted-launch", kind: "declared" })
    ]);
  });

  it("fails legibly when operational evidence names unknown Actions or unsafe changed paths", () => {
    const root = governedFixture("arcadia");
    write(root, "PROJECT.md", projectDoc("arcadia", "main", "capture"));
    write(root, "docs/plans/main.md", planDoc("arcadia", [
      action("capture", "Capture intent", "open", ["src/capture.ts"])
    ], "capture"));

    const result = deriveLivingSystemModel({
      repoRoot: root,
      projectSlug: "arcadia",
      actionEvidence: [{
        action: "main#missing",
        changedPaths: ["../outside.ts"],
        source: source("git", "commit:bad", "2026-08-21T08:00:00.000Z")
      }]
    });

    expect(result.model).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "actionEvidence[0].action", message: expect.stringMatching(/Unknown Action/) }),
      expect.objectContaining({ field: "actionEvidence[0].changedPaths[0]", message: expect.stringMatching(/repository-relative/) })
    ]));
  });
});

function governedFixture(slug: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `arcadia-living-${slug}-`));
  temporary.push(root);
  cpSync(path.join(FIXTURES, slug), root, { recursive: true });
  return root;
}

function projectDoc(slug: string, activePlan: string, currentAction: string): string {
  return `---
arcadia: v1
type: project
slug: ${slug}
name: ${slug}
status: active
goal: Explain this Project truthfully.
outcome: A fresh reader can follow the system story.
milestone: Living system v1
active_plan: ${activePlan}
current_action: ${currentAction}
updated: 2026-08-21
---
`;
}

function planDoc(project: string, actions: string[], currentAction: string): string {
  return `---
arcadia: v1
type: plan
slug: ${project === "arcadia" ? "main" : "journey"}
project: ${project}
status: active
milestone: Living system v1
current_action: ${currentAction}
token_impact: none
token_budget: Derivation is deterministic and makes no model calls.
updated: 2026-08-21
actions:
${actions.join("\n")}
questions: []
decisions: []
---
`;
}

function action(id: string, title: string, status: string, references: string[]): string {
  return `  - id: ${id}
    title: ${title}
    status: ${status}
    responsibility: codex
    next_action: Continue the governed journey.
    expected_artifact: Deterministic proof
    clarification: clarified
    confidence: high
    source: Fixture evidence
    acceptance_criteria:
      - The result is observable.
    depends_on: []
    decisions: []
    references: [${references.map((reference) => JSON.stringify(reference)).join(", ")}]
`;
}

function decisionDoc(project: string, plan: string, actionId: string): string {
  return `---
arcadia: v1
type: decision
id: "0001"
slug: proof
project: ${project}
plan: ${plan}
action: ${actionId}
status: approved
question: Is the proof accepted?
answer: Yes.
decided: 2026-08-21
updated: 2026-08-21
---
`;
}

function logDoc(project: string, entries: string[]): string {
  return `---
arcadia: v1
type: log
slug: mission-log
project: ${project}
updated: 2026-08-21
---

# Log

${entries.join("\n")}`;
}

function logEntry(title: string, actionRef: string | null, result: string): string {
  return `## 2026-08-21 — ${title}

${actionRef ? `- **Action:** \`${actionRef}\`\n` : ""}- **Did:** Performed the governed Action.
- **Result:** ${result}
- **Next:** Continue the story.
`;
}

function source(kind: LivingSystemSourceReceipt["kind"], reference: string, observedAt: string): LivingSystemSourceReceipt {
  return { kind, reference, observedAt, contentHash: "abc", availability: "present" };
}

function freshness(state: LivingSystemFreshnessReceipt["state"]): LivingSystemFreshnessReceipt {
  return {
    observedAt: "2026-08-21T08:01:00.000Z",
    sourceUpdatedAt: "2026-08-21T08:00:00.000Z",
    state,
    reason: state === "current" ? null : `${state} fixture`
  };
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}
