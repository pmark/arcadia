import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import {
  LIVING_SYSTEM_MANIFEST_PATH,
  parseLivingSystemManifest,
  serializeLivingSystem
} from "../src/livingSystem/contract.js";

const FIXTURES = path.resolve("tests/fixtures/living-system");
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("living-system v1 manifest", () => {
  it("normalizes Arcadia's Project-defined Topics, Relationships, and Views byte-stably", () => {
    const root = path.join(FIXTURES, "arcadia");
    const first = parseLivingSystemManifest(root, "arcadia");
    const second = parseLivingSystemManifest(root, "arcadia");

    expect(first.errors).toEqual([]);
    expect(first.manifest).not.toBeNull();
    expect(first.manifest?.topics.map((topic) => topic.id)).toEqual([
      "capture",
      "clarification",
      "governed-build"
    ]);
    expect(first.manifest?.relationships.map((relationship) => relationship.type)).toEqual([
      "hands-off-to",
      "authorizes"
    ]);
    expect(first.manifest?.views.find((view) => view.id === "whole-system")?.topicIds).toEqual([
      "capture",
      "clarification",
      "governed-build"
    ]);
    expect(first.manifest).not.toHaveProperty("episodes");
    expect(first.manifest).not.toHaveProperty("signals");
    expect(serializeLivingSystem(first.manifest)).toBe(serializeLivingSystem(second.manifest));
  });

  it("uses Private Practice Now's vocabulary and normalizes optional fields", () => {
    const result = parseLivingSystemManifest(path.join(FIXTURES, "private-practice-now"), "private-practice-now");

    expect(result.errors).toEqual([]);
    expect(result.manifest?.topics.map((topic) => topic.id)).toEqual([
      "authentic-profile",
      "practitioner-listening",
      "trusted-launch"
    ]);
    expect(result.manifest?.topics.find((topic) => topic.id === "practitioner-listening")?.tags).toEqual([]);
    expect(result.manifest?.relationships.every((relationship) => relationship.summary === null)).toBe(true);
    expect(result.manifest?.views.find((view) => view.id === "client-journey")?.topicIds).toEqual([
      "authentic-profile",
      "trusted-launch"
    ]);
  });

  const refusals: Array<{
    name: string;
    mutate: (manifest: Record<string, any>) => void;
    field: string;
    message: RegExp;
  }> = [
    {
      name: "unsupported versions",
      mutate: (manifest) => { manifest.arcadia_living_system = "v2"; },
      field: "arcadia_living_system",
      message: /Unsupported/
    },
    {
      name: "duplicate Topic ids",
      mutate: (manifest) => {
        manifest.topics.push({ ...manifest.topics[0] });
      },
      field: "topics[3].id",
      message: /Duplicate Topic/
    },
    {
      name: "duplicate View ids",
      mutate: (manifest) => { manifest.views.push({ ...manifest.views[0] }); },
      field: "views[2].id",
      message: /Duplicate View/
    },
    {
      name: "missing values",
      mutate: (manifest) => { delete manifest.purpose; },
      field: "purpose",
      message: /required/
    },
    {
      name: "dangling Relationship references",
      mutate: (manifest) => { manifest.relationships[0].to = "missing-topic"; },
      field: "relationships[0].to",
      message: /not a Topic id/
    },
    {
      name: "dangling View selectors",
      mutate: (manifest) => { manifest.views[0].selectors = [{ topic: "missing-topic" }]; },
      field: "views[0].selectors[0].topic",
      message: /missing Topic/
    },
    {
      name: "ambiguous selectors",
      mutate: (manifest) => { manifest.views[0].selectors = [{ topic: "capture", tag: "operator-loop" }]; },
      field: "views[0].selectors[0]",
      message: /ambiguous/
    },
    {
      name: "missing source paths",
      mutate: (manifest) => { manifest.topics[0].sources = ["src/missing.ts"]; },
      field: "topics[0].sources[0]",
      message: /does not exist/
    },
    {
      name: "absolute source paths",
      mutate: (manifest) => { manifest.topics[0].sources = ["/tmp/outside.ts"]; },
      field: "topics[0].sources[0]",
      message: /not absolute/
    },
    {
      name: "source traversal",
      mutate: (manifest) => { manifest.topics[0].sources = ["../outside.ts"]; },
      field: "topics[0].sources[0]",
      message: /traverse/
    },
    {
      name: "operational status or history fields",
      mutate: (manifest) => { manifest.status = "active"; manifest.episodes = []; },
      field: "manifest.episodes",
      message: /do not belong/
    }
  ];

  for (const refusal of refusals) {
    it(`rejects ${refusal.name}`, () => {
      const root = copiedFixture();
      const manifest = readManifest(root);
      refusal.mutate(manifest);
      writeManifest(root, manifest);

      const result = parseLivingSystemManifest(root, "arcadia");

      expect(result.manifest).toBeNull();
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: refusal.field, message: expect.stringMatching(refusal.message) })
      ]));
    });
  }

  it("rejects a Project-slug mismatch", () => {
    const result = parseLivingSystemManifest(path.join(FIXTURES, "arcadia"), "another-project");

    expect(result.manifest).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "project", message: expect.stringMatching(/does not match/) })
    ]));
  });

  it("rejects a source that escapes through a symlink", () => {
    const root = copiedFixture();
    const outside = scratch("arcadia-living-outside-");
    writeFileSync(path.join(outside, "secret.ts"), "outside\n", "utf8");
    symlinkSync(path.join(outside, "secret.ts"), path.join(root, "src", "escape.ts"));
    const manifest = readManifest(root);
    manifest.topics[0].sources = ["src/escape.ts"];
    writeManifest(root, manifest);

    const result = parseLivingSystemManifest(root, "arcadia");

    expect(result.manifest).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "topics[0].sources[0]", message: expect.stringMatching(/escapes.*symlink/) })
    ]));
  });
});

describe("Action-linked Log convention", () => {
  it("accepts a validated plan-slug#action-id link and preserves absent links as null", () => {
    const root = docsRepo([
      logEntry("Linked history", "- **Action:** `main-plan#ship-it`"),
      logEntry("Unlinked history")
    ]);

    const discovered = discoverDocs(root);
    const log = discovered.docs.find((doc) => doc.type === "log");

    expect(discovered.errors).toEqual([]);
    expect(log?.type).toBe("log");
    if (log?.type !== "log") throw new Error("Expected Log fixture to parse.");
    expect(log.entries.map((entry) => entry.action)).toEqual(["main-plan#ship-it", null]);
  });

  it("rejects links to a missing plan or missing Action", () => {
    const missingPlan = docsRepo([logEntry("Wrong plan", "- **Action:** `ghost-plan#ship-it`")]);
    const missingAction = docsRepo([logEntry("Wrong Action", "- **Action:** `main-plan#ghost-action`")]);

    const planResult = discoverDocs(missingPlan);
    const actionResult = discoverDocs(missingAction);

    expect(planResult.rejected).toContain("MISSION_LOG.md");
    expect(planResult.errors.some((error) => error.message.includes("names no plan"))).toBe(true);
    expect(actionResult.rejected).toContain("MISSION_LOG.md");
    expect(actionResult.errors.some((error) => error.message.includes("names no Action"))).toBe(true);
  });
});

function copiedFixture(): string {
  const root = scratch("arcadia-living-contract-");
  cpSync(path.join(FIXTURES, "arcadia"), root, { recursive: true });
  return root;
}

function scratch(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporary.push(root);
  return root;
}

function readManifest(root: string): Record<string, any> {
  return parseYaml(readFileSync(path.join(root, LIVING_SYSTEM_MANIFEST_PATH), "utf8")) as Record<string, any>;
}

function writeManifest(root: string, manifest: Record<string, any>): void {
  writeFileSync(path.join(root, LIVING_SYSTEM_MANIFEST_PATH), stringifyYaml(manifest), "utf8");
}

function docsRepo(entries: string[]): string {
  const root = scratch("arcadia-living-log-");
  write(root, "docs/plans/main-plan.md", `---
arcadia: v1
type: plan
slug: main-plan
project: demo
status: active
milestone: Demonstrate explicit history
token_impact: none
token_budget: Parsing and link validation are deterministic.
recommended_model: gpt-5.6-terra
updated: 2026-08-21
actions:
  - id: ship-it
    title: Ship the contract
    status: done
    responsibility: codex
    clarification: clarified
    next_action: Record the accepted result.
    depends_on: []
---
`);
  write(root, "MISSION_LOG.md", `---
arcadia: v1
type: log
slug: demo-log
project: demo
updated: 2026-08-21
---

# Log: Demo

${entries.join("\n")}`);
  return root;
}

function logEntry(title: string, action?: string): string {
  return `## 2026-08-21 — ${title}

${action ? `${action}\n` : ""}- **Did:** Recorded what happened.
- **Result:** Preserved explicit history.
`;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}
