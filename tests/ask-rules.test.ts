import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAskRoutingDecision,
  loadAskRuleRegistry,
  matchAskRule,
  validateAskRuleRegistry,
  type AskRuleDefinition
} from "../src/ask/rules.js";
import { runAskCommand } from "../src/commands/ask.js";
import { renderAskRuleTestSuccess, runAskRuleTestCommand } from "../src/commands/askRule.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, createProjectWithInitialWork, listProjects, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("Ask rules", () => {
  it("matches only the exact case-insensitive songbook selector at the beginning", () => {
    const fixture = initializedRuleWorkspace();
    const registry = withDatabase(fixture.workspace, (db) =>
      validateAskRuleRegistry(fixture.workspace, db, loadAskRuleRegistry(fixture.workspace))
    );

    for (const request of ["songbook", "songbook add Gimme Three Steps", "songbook: practice 20", "SONGBOOK routine"]) {
      expect(matchAskRule(request, registry)?.rule.id).toBe("songbook");
    }
    for (const request of [
      "Please update my songbook",
      "songbooks are useful",
      "https://example.com/songbook",
      "attachment songbook-demo.m4a"
    ]) {
      expect(matchAskRule(request, registry)).toBeNull();
    }
  });

  it("returns a stable no-write preview from the live matcher and extractor", () => {
    const fixture = initializedRuleWorkspace();
    const before = withDatabase(fixture.workspace, (db) => ({
      asks: countRows(db, "ask_requests"),
      work: countRows(db, "work_items")
    }));
    const first = runAskRuleTestCommand({
      workspace: fixture.workspace,
      request: "songbook: add https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fsong"
    });
    const second = runAskRuleTestCommand({
      workspace: fixture.workspace,
      request: "songbook: add https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fsong"
    });

    expect(first).toMatchObject({ ok: true, command: "ask-rule.test" });
    expect(first.data.writesPerformed).toBe(0);
    expect(first.data.receipt).toMatchObject({
      ruleId: "songbook",
      matchEvidence: { boundary: "colon", position: 0 },
      destination: { projectId: fixture.songbookId, projectName: "Living Songbook" },
      strippedPayload: "add https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fsong",
      canonicalLinkCandidates: [{ candidate: "https://example.com/song" }]
    });
    expect(first.data.normalizedRules).toBe(second.data.normalizedRules);
    expect(JSON.stringify(first.data.receipt)).toBe(JSON.stringify(second.data.receipt));
    expect(renderAskRuleTestSuccess(first)).toContain("Writes: None (test mode)");
    expect(withDatabase(fixture.workspace, (db) => ({
      asks: countRows(db, "ask_requests"),
      work: countRows(db, "work_items")
    }))).toEqual(before);
  });

  it("emits a live receipt when the selector is the whole message", () => {
    const fixture = initializedRuleWorkspace();
    const result = runAskCommand({ workspace: fixture.workspace, request: "songbook" });

    expect(result.data.processingReceipt).toMatchObject({
      ruleId: "songbook",
      matchEvidence: { boundary: "end" },
      originalText: "songbook",
      strippedPayload: ""
    });
    expect(result.data.ask).toBeNull();
  });

  it("keeps an explicit Arcadia destination ahead of the matched rule and mentioned Project", () => {
    const fixture = initializedRuleWorkspace();
    const request = "songbook Plan Living Songbook repertoire cleanup.";
    const result = runAskCommand({
      workspace: fixture.workspace,
      request,
      project: "arcadia"
    });

    expect(result.data.ask?.raw_request).toBe(request);
    expect(result.data.workItem?.project_id).toBe(fixture.arcadiaId);
    expect(result.data.processingReceipt).toMatchObject({
      ruleId: "songbook",
      strippedPayload: "Plan Living Songbook repertoire cleanup.",
      routing: {
        selected: { source: "explicit_destination", projectId: fixture.arcadiaId },
        ignored: expect.arrayContaining([
          expect.objectContaining({ source: "exact_prefix", projectId: fixture.songbookId, reason: "lower_precedence" })
        ])
      }
    });
  });

  it("makes every routing precedence level explicit and retains lower candidates", () => {
    const fixture = initializedRuleWorkspace();
    const [arcadia, songbook] = withDatabase(fixture.workspace, (db) => {
      const projects = listProjects(db);
      return [
        projects.find((project) => project.id === fixture.arcadiaId),
        projects.find((project) => project.id === fixture.songbookId)
      ];
    });
    if (!arcadia || !songbook) throw new Error("Expected fixture Projects.");

    const routing = buildAskRoutingDecision({
      explicit: arcadia,
      prefix: songbook,
      reply: arcadia,
      extracted: songbook,
      general: arcadia
    });

    expect(routing.selected?.source).toBe("explicit_destination");
    expect(routing.ignored.map((candidate) => candidate.source)).toEqual([
      "exact_prefix",
      "reply_context",
      "extracted_project",
      "general_intent_registry"
    ]);
    expect(routing.ignored.map((candidate) => candidate.reason)).toEqual([
      "lower_precedence",
      "same_destination",
      "lower_precedence",
      "same_destination"
    ]);
  });

  it.each([
    ["unsupported-version", (base: RuleFile) => ({ ...base, version: 2 })],
    ["malformed", (base: RuleFile) => ({ ...base, rules: [{ ...base.rules[0], enabled: "yes" }] })],
    ["duplicate", (base: RuleFile) => ({ ...base, rules: [...base.rules, { ...base.rules[0] }] })],
    ["ambiguous", (base: RuleFile) => ({ ...base, rules: [...base.rules, { ...base.rules[0], id: "songbook-entry", prefix: "songbook entry", examples: { matches: ["songbook entry"], misses: [] } }] })],
    ["stale-source", (base: RuleFile) => ({ ...base, rules: [{ ...base.rules[0], sourceRef: "docs/missing.md" }] })],
    ["unknown-Project", (base: RuleFile) => ({ ...base, rules: [{ ...base.rules[0], destinationProject: "missing" }] })],
    ["unknown-processing-profile", (base: RuleFile) => ({ ...base, rules: [{ ...base.rules[0], processingProfile: "missing-v1" }] })],
    ["unsupported-fields", (base: RuleFile) => ({ ...base, rules: [{ ...base.rules[0], regex: ".*" }] })]
  ])("rejects %s rules before capture writes", (_label, mutate) => {
    const fixture = initializedRuleWorkspace();
    const before = withDatabase(fixture.workspace, (db) => countRows(db, "ask_requests"));
    writeFileSync(path.join(fixture.workspace, "config", "ask-rules.json"), `${JSON.stringify(mutate(ruleFile()), null, 2)}\n`);

    expect(() => runAskCommand({ workspace: fixture.workspace, request: "Plan Arcadia cleanup." })).toThrow();
    expect(withDatabase(fixture.workspace, (db) => countRows(db, "ask_requests"))).toBe(before);
  });
});

type RuleFile = { version: number; rules: Array<AskRuleDefinition & Record<string, unknown>> };

function initializedRuleWorkspace(): { workspace: string; arcadiaId: string; songbookId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ask-rules-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  const repos = path.join(workspace, "project-repositories");
  const arcadiaRepo = path.join(repos, "arcadia");
  const songbookRepo = path.join(repos, "living-songbook");
  mkdirSync(path.join(arcadiaRepo, "docs"), { recursive: true });
  mkdirSync(path.join(songbookRepo, "docs"), { recursive: true });
  writeFileSync(path.join(arcadiaRepo, "docs", "ask-processing.md"), "# Arcadia Ask processing\n");
  writeFileSync(path.join(songbookRepo, "docs", "ask-processing.md"), "# Living Songbook Ask processing\n");

  const created = withDatabase(workspace, (db) => {
    const arcadia = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Turn intent into governed work.",
      goal: "Make Ask trustworthy.",
      status: "active",
      currentMilestone: "Visible routing",
      nextAction: "Test Ask routing.",
      workClassification: "codex"
    });
    const songbook = createProjectWithInitialWork(db, {
      name: "Living Songbook",
      mission: "Make practice evidence useful.",
      goal: "Build a living repertoire.",
      status: "active",
      currentMilestone: "Ask dogfood",
      nextAction: "Capture a source.",
      workClassification: "autonomous"
    });
    upsertProjectMetadata(db, { projectId: arcadia.project.id, aliases: ["Arcadia"], repoPath: arcadiaRepo });
    upsertProjectMetadata(db, { projectId: songbook.project.id, aliases: ["Songbook"], repoPath: songbookRepo });
    return { arcadiaId: arcadia.project.id, songbookId: songbook.project.id };
  });
  writeFileSync(path.join(workspace, "config", "ask-rules.json"), `${JSON.stringify(ruleFile(), null, 2)}\n`);
  return { workspace, ...created };
}

function ruleFile(): RuleFile {
  return {
    version: 1,
    rules: [{
      id: "songbook",
      enabled: true,
      prefix: "songbook",
      boundaries: ["colon", "whitespace", "end"],
      destinationProject: "living-songbook",
      processingProfile: "living-songbook-v1",
      sourceRef: "docs/ask-processing.md",
      examples: {
        matches: ["songbook", "songbook repertoire", "songbook: practice 20", "SONGBOOK routine"],
        misses: ["Please update my songbook", "songbooks", "https://example.com/songbook"]
      }
    }]
  };
}
