import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import { BUNDLED_MODEL_TIERS } from "../src/codingAgents/modelTiers.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createCodexInvocation, createReviewItem, getWorkItemByDocRef, upsertProject, upsertProjectMetadata, updateReviewItemStatus } from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { getSession, type AgentSession, type TmuxAdapter } from "../src/sessions/index.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { applyModelRule, classifyModelRule, MODEL_RULE_LABEL, parseModelRuleChoice } from "../src/sessions/modelRule.js";
import { workItemInputRevision } from "../src/sessions/packetInputRevision.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0290 A: a production (standing-policy) build Session launches on
 * Opus high for source work and every review repair, and on Sonnet medium for
 * test, docs and config work, instead of the cheapest enabled binding the
 * packet bound. Plan production-runs-clean-by-itself-20261126, Action
 * launch-production-builds-on-the-plan-model-rule (Issue #3049).
 */

const roots: string[] = [];
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const claudeOnlyProfiles: CodingAgentProfile[] = [
  { name: "claude_build", provider: "claude-code-cli", package: "@anthropic-ai/claude-code", command: "claude", purpose: "build", sandbox: "workspace-write", args: [] }
];
const adapters = defaultAdapters as ProviderAdapterRegistry;

function withBinding(registry: ProviderAdapterRegistry, bindingId: string, changes: { enabled: boolean }): ProviderAdapterRegistry {
  return { ...registry, bindings: registry.bindings.map((binding) => (binding.id === bindingId ? { ...binding, ...changes } : binding)) };
}

class FakeTmux implements TmuxAdapter {
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return true; }
  hasSession(name: string) { return this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    this.launches.push(input);
    this.live.add(input.name);
  }
}

const action = (acceptanceCriteria: string[], references: string[] = []) => ({ acceptanceCriteria, references });

describe("classifyModelRule (Decision 0290 A)", () => {
  it("selects Opus high (heavy, e3_deep) for an Action whose acceptance or references name a src/, scripts/ or apps/ path", () => {
    for (const [criteria, references] of [
      [["src/sessions/launch.ts launches on the rule."], []],
      [["The launch works."], ["src/codex/packets.ts"]],
      [["`scripts/pre-pr.ts` passes."], []],
      [["The page renders."], ["apps/dashboard/app/page.tsx"]]
    ] as const) {
      const choice = classifyModelRule({ action: action([...criteria], [...references]), repair: false });
      expect(choice, JSON.stringify(criteria)).toMatchObject({ ruleClass: "source", tier: "heavy", effort: "e3_deep" });
      expect(choice.reason).toMatch(/src\/|scripts\/|apps\//);
    }
  });

  it("selects Opus high for four or more acceptance criteria even when no source path is named", () => {
    const choice = classifyModelRule({ action: action(["one", "two", "three", "four"], ["docs/x.md"]), repair: false });
    expect(choice).toMatchObject({ ruleClass: "source", tier: "heavy", effort: "e3_deep" });
    expect(choice.reason).toContain("4 acceptance criteria");
  });

  it("selects Sonnet medium (standard, e2_standard) for an Action naming only tests/, docs/ or config paths", () => {
    const choice = classifyModelRule({
      action: action(["tests/marker.test.ts passes.", "docs/guide.md names the flag."], ["config/defaults/provider-adapters.json", "docs/src/notes.md"]),
      repair: false
    });
    expect(choice).toMatchObject({ ruleClass: "non_source", tier: "standard", effort: "e2_standard" });
    expect(choice.reason).toContain("names no src/, scripts/ or apps/ path");
  });

  it("selects Opus high for every review repair, whatever the Action names", () => {
    const choice = classifyModelRule({ action: action(["docs/guide.md exists."]), repair: true });
    expect(choice).toMatchObject({ ruleClass: "repair", tier: "heavy", effort: "e3_deep" });
  });
});

describe("applyModelRule binding and departure", () => {
  const base = {
    agent: "claude" as const,
    provider: "claude-code-cli",
    profiles: claudeOnlyProfiles,
    registry: BUNDLED_MODEL_TIERS
  };

  it("uses the enabled Opus binding at high effort, never the review-only Opus binding", () => {
    const withReviewOnly: ProviderAdapterRegistry = {
      ...adapters,
      bindings: [{ ...adapters.bindings.find((b) => b.id === "claude-opus")!, id: "claude-review", agentProfiles: ["claude_planning"], reviewOnly: true }, ...adapters.bindings]
    };
    const choice = applyModelRule({ ...base, adapters: withReviewOnly, action: action(["src/a.ts changes."]), repair: false, fallback: { model: "sonnet", effort: "e2_standard" } });
    expect(choice).toMatchObject({ rule: MODEL_RULE_LABEL, used: { model: "opus", effort: "e3_deep", bindingId: "claude-opus" }, departure: null });
  });

  it("records the departure, the binding actually used and the reason when the Opus binding is not enabled, falling back to a weaker model", () => {
    const choice = applyModelRule({
      ...base,
      adapters: withBinding(adapters, "claude-opus", { enabled: false }),
      action: action(["src/a.ts changes."]),
      repair: false,
      fallback: { model: "sonnet", effort: "e2_standard", bindingId: "claude-sonnet" }
    });
    expect(choice.selected).toMatchObject({ model: "opus", effort: "e3_deep" });
    expect(choice.used).toEqual({ model: "sonnet", effort: "e2_standard", bindingId: "claude-sonnet" });
    expect(choice.departure).toContain("claude-opus");
    expect(choice.departure).toContain("not enabled");
    expect(choice.departure).toContain("sonnet");
  });

  it("caps the fallback's effort at the rule's effort", () => {
    const choice = applyModelRule({
      ...base,
      adapters: withBinding(adapters, "claude-sonnet", { enabled: false }),
      action: action(["docs/a.md exists."]),
      repair: false,
      fallback: { model: "sonnet", effort: "e4_rigorous", bindingId: "claude-sonnet" }
    });
    expect(choice.used).toMatchObject({ model: "sonnet", effort: "e2_standard" });
    expect(choice.departure).toContain("claude-sonnet");
  });

  it("refuses rather than fail open into a stronger model than the rule selects", () => {
    let caught: unknown;
    try {
      applyModelRule({
        ...base,
        adapters: withBinding(adapters, "claude-sonnet", { enabled: false }),
        action: action(["docs/a.md exists."]),
        repair: false,
        fallback: { model: "opus", effort: "e3_deep", bindingId: "claude-opus" }
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ArcadiaError);
    expect((caught as ArcadiaError).details).toMatchObject({ code: "model_rule_binding_unavailable" });
  });

  it("does not apply to a provider the Decision does not name", () => {
    expect(applyModelRule({ ...base, agent: "codex", provider: "codex-cli", adapters, action: action(["src/a.ts"]), repair: false, fallback: { model: "gpt-5.6-terra", effort: "e2_standard" } })).toBeNull();
  });
});

describe("a production build Session under a Claude-only activation", () => {
  it("launches source work on the Opus high binding and test/docs/config work on Sonnet medium, with the record and brief naming model, effort and rule", () => {
    const source = launchFixture({ criteria: ["src/sessions/launch.ts selects the rule's binding."], references: [] });
    expect(source.session).toMatchObject({ provider: "claude-code-cli", model: "opus", effort: "e3_deep" });
    expect(source.argv).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high"]));
    const sourceRecord = parseModelRuleChoice(source.stored.model_rule_json ?? null)!;
    expect(sourceRecord).toMatchObject({ rule: MODEL_RULE_LABEL, ruleClass: "source", used: { model: "opus", effort: "e3_deep", bindingId: "claude-opus" }, departure: null });
    expect(source.brief).toContain(`Model and effort (${MODEL_RULE_LABEL})`);
    expect(source.brief).toContain("Model: opus. Effort: e3_deep (high).");
    expect(source.brief).toContain("src/sessions/launch.ts");

    const docs = launchFixture({ criteria: ["tests/launch.test.ts passes.", "docs/guide.md names the rule."], references: ["config/defaults/provider-adapters.json"] });
    expect(docs.session).toMatchObject({ provider: "claude-code-cli", model: "sonnet", effort: "e2_standard" });
    expect(docs.argv).toEqual(expect.arrayContaining(["--model", "sonnet", "--effort", "medium"]));
    expect(parseModelRuleChoice(docs.stored.model_rule_json ?? null)).toMatchObject({ ruleClass: "non_source", used: { model: "sonnet", effort: "e2_standard", bindingId: "claude-sonnet" }, departure: null });
    expect(docs.brief).toContain("Model: sonnet. Effort: e2_standard (medium).");
  });

  it("records the departure with the binding actually used and the reason when the rule's binding is not enabled", () => {
    const logs: string[] = [];
    const fallback = launchFixture({
      criteria: ["src/sessions/launch.ts selects the rule's binding."],
      references: [],
      adapters: withBinding(adapters, "claude-opus", { enabled: false }),
      log: (line) => logs.push(line)
    });
    expect(fallback.session).toMatchObject({ model: "sonnet", effort: "e2_standard" });
    const record = parseModelRuleChoice(fallback.stored.model_rule_json ?? null)!;
    expect(record.selected).toMatchObject({ model: "opus", effort: "e3_deep" });
    expect(record.used).toEqual({ model: "sonnet", effort: "e2_standard", bindingId: "claude-sonnet" });
    expect(record.departure).toMatch(/claude-opus.*not enabled/);
    expect(fallback.brief).toContain("Departure from the rule:");
    expect(logs.join("\n")).toContain("departed");
  });

  it("refuses before any admission or process when only a stronger model than the rule's is available", () => {
    expect(() => launchFixture({
      criteria: ["docs/guide.md names the rule."],
      references: [],
      packet: { model: "opus", bindingId: "claude-opus" },
      adapters: withBinding(adapters, "claude-sonnet", { enabled: false })
    })).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "model_rule_binding_unavailable" }) }));
  });
});

describe("a review repair Session", () => {
  it("launches on Opus high even when the Action it repairs ran on Sonnet medium", () => {
    const rehearsal = new Rehearsal({ independentReviewers: "tick" });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    expect(a).toMatchObject({ model: "sonnet", effort: "e2_standard" });
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`]);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.github.verdict = (role, pr) => (role === "code-review" && pr?.branch === a.branch ? "fail" : "pass");
    rehearsal.github.failCriteria = ["correctness"];
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    rehearsal.tick();
    rehearsal.tick();
    const repair = rehearsal.lease()!;
    expect(repair.id).not.toBe(a.id);
    expect(repair).toMatchObject({ model: "opus", effort: "e3_deep" });
    expect(parseModelRuleChoice(repair.model_rule_json ?? null)).toMatchObject({ ruleClass: "repair", used: { model: "opus", effort: "e3_deep" }, departure: null });
    const argv = rehearsal.tmux.launches.at(-1)!.args;
    expect(argv).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high"]));
    expect(argv.at(-1)).toContain("Model: opus. Effort: e3_deep (high).");
  });
});

/* ------------------------------------------------------------------------ */

const NOW = new Date("2026-08-30T12:34:56.000Z");

function capacity(): ProviderCapacityObservation {
  return {
    generatedAt: NOW.toISOString(),
    providers: [{
      providerId: "claude-code-cli", admitted: true, code: null, reason: "fixture allowance", unattendedProof: true, retryAfter: null, refreshRequired: false,
      receipt: {
        version: 1, providerId: "claude-code-cli", providerLabel: "claude-code-cli", profiles: [], accountScope: "test", source: "codex_app_server",
        evidence: "simulated", unattended: true, observedAt: NOW.toISOString(), observedAgeMs: 0, expiresAt: null, confidence: "observed",
        freshness: "fresh", usagePolicy: "included", usagePolicyReason: "test fixture",
        windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
        nextResetAt: null, unsupported: [], availability: "available", telemetry: "test fixture"
      }
    }]
  };
}

function launchFixture(input: {
  criteria: string[];
  references: string[];
  adapters?: ProviderAdapterRegistry;
  packet?: { model: string; bindingId: string };
  log?: (line: string) => void;
}): { session: AgentSession; stored: AgentSession; argv: string[]; brief: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-model-rule-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), PROJECT);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument(input.criteria, input.references));
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), DECISION);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_model_rule_fixture";
  const packet = input.packet ?? { model: "sonnet", bindingId: "claude-sonnet" };
  const mappingId = adapters.mappingId;
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove the model rule.", goal: "Prove the model rule.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error(`fixture docs did not sync: ${JSON.stringify(sync.errors)}`);
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), JSON.stringify({
      invocationId: packetId,
      workItemId: workItem.id,
      actionInputRevision: workItemInputRevision(workItem),
      promptPath,
      baseRevision: git(repo, ["rev-parse", "HEAD"]).trim(),
      providerSelection: { provider: "claude-code-cli", model: packet.model, mappingId, bindingId: packet.bindingId, effort: "e2_standard" }
    }));
    createCodexInvocation(db, {
      id: packetId, purpose: "build", agentProfile: "claude_build", workspaceScope: repo, command: "claude", promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`, finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created", workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: mappingId, providerBindingId: packet.bindingId
    });
    const approval = createReviewItem(db, {
      workItemId: workItem.id, projectId: project.id, codexInvocationId: packetId, decisionNeeded: "Approve the promoted build packet.",
      sourceInput: "fixture", proposedAction: "Launch the fixture Session.", resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high", confidence: 1, missingFields: [],
      context: { planningPromotion: { actionId: "define-contract", actionDocRef: "plan/copy-proof#define-contract", repoPath: repo, buildProfile: "claude_build",
        buildInvocationId: packetId, buildPacketPath: promptPath, buildPacketSha256: packetSha256(path.join(workspace, promptPath)) } }
    });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
    // Claude-only activation: the standing policy permits only claude-code-cli.
    const scope = normalizeProductionScope({
      intent: "Prove the model rule.", projects: ["test-project"], plans: ["test-project/copy-proof"], actions: ["test-project/define-contract"],
      providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: []
    });
    activateProduction(db, { requestId: "policy-grant-1", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
  });
  const tmux = new FakeTmux();
  const result = withDatabase(workspace, (db) => launchGuardedHostSession({
    db, workspace, repoRoot: repo, projectSlug: "test-project", requestId: "policy-req-1", standingPolicy: true,
    profiles: claudeOnlyProfiles, adapters: input.adapters ?? adapters, now: NOW, tmux,
    agentWorktreeRoot: path.join(root, "worktrees"), capacityObservation: capacity(), log: input.log
  }));
  const stored = withReadOnlyDatabase(workspace, (db) => getSession(db, result.session.id))!;
  const argv = tmux.launches[0].args;
  return { session: result.session, stored, argv, brief: argv.at(-1)! };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const yamlList = (items: string[]) => (items.length ? items.map((item) => `\n      - ${JSON.stringify(item)}`).join("") : " []");

function planDocument(criteria: string[], references: string[]): string {
  return `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the model rule
current_action: define-contract
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: medium
updated: 2026-08-30
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:${yamlList(criteria)}
    references:${yamlList(references)}
    decisions: ["0001"]
---

# Copy proof
`;
}

const PROJECT = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove the model rule.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-30
---

# Test Project
`;

const DECISION = `---
arcadia: v1
type: decision
id: "0001"
slug: authorize
project: test-project
status: approved
question: Authorize this fixture?
answer: Yes.
decided: 2026-08-30
updated: 2026-08-30
---

# Decision
`;
