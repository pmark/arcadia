import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { normalizeAgentAsk } from "../src/ask/agentAsk.js";
import { renderActionBrief, renderCallingInHelp } from "../src/sessions/actionBrief.js";
import { resolveAgentIdentity } from "../src/codingAgents/agentIdentity.js";
import { expectIdentityBlock } from "./helpers/identityBlock.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("renderActionBrief", () => {
  it("renders the authoritative Action brief for a Session", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "opencode",
      baseRevision: head(repo)
    });

    expect(brief).toContain("Project: test-project");
    expect(brief).toContain("Plan: copy-proof — docs/plans/copy-proof.md");
    expect(brief).toContain("Action: define-contract");
    expect(brief).toContain("Title: Define the contract");
    expect(brief).toContain("Candidate worktree: /worktrees/define-contract");
    expect(brief).toContain("Branch: opencode/define-contract");
    expect(brief).toContain("Define the bounded contract.");
  });

  describe("Calling in help", () => {
    const base = (agent: "codex" | "claude" | "opencode", model: string | null) => ({
      repoRoot: briefRepo(),
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: `${agent}/define-contract`,
      agent,
      baseRevision: "unused",
      model
    });
    const render = (agent: "codex" | "claude" | "opencode", model: string | null) => {
      const input = base(agent, model);
      return renderActionBrief({ ...input, baseRevision: head(input.repoRoot) });
    };

    it("tells Claude to spawn a subagent on the plan's model", () => {
      const brief = render("claude", "haiku");
      expect(brief).toContain("Calling in help");
      expect(brief).toContain("Started on: haiku. Escalation target: sonnet.");
      expect(brief).toContain('spawn a subagent with the Agent tool and `model: "sonnet"`');
      expect(brief).toContain("arcadia agent-ask draft");
    });

    it("tells Codex to use spawn_agent with the resolved model and never a nested codex exec", () => {
      const brief = render("codex", "gpt-6-luna");
      expect(brief).toContain("Escalation target: gpt-5.6-terra (standard tier).");
      expect(brief).toContain('`spawn_agent` with `model: "gpt-5.6-terra"`');
      expect(brief).toContain("Do not run a nested `codex exec`");
    });

    it("gives opencode only the honest stop-and-ask fallback", () => {
      const brief = render("opencode", "opencode-go/glm-5.3-flash");
      expect(brief).toContain("Escalation target: opencode-go/deepseek-v4.1-flash (standard tier).");
      expect(brief).not.toContain("In session:");
      expect(brief).toContain("asking for a relaunch at opencode-go/deepseek-v4.1-flash (standard tier)");
      expect(brief).toContain("`requested_authority: propose`");
    });

    it("maps a concrete Claude plan model to its Agent-tool alias and only offers the draft fallback", () => {
      const brief = render("claude", "haiku");
      expect(brief).not.toContain("`preview`");
      expect(brief).toContain("you started on haiku, a smaller model");
      const mapped = renderCallingInHelp({ agent: "claude", model: "haiku", escalation: { model: "claude-opus-4-7", tier: null } });
      expect(mapped.join("\n")).toContain('`model: "opus"`');
    });

    it("is absent when the Session already runs the plan's model or no model is given", () => {
      expect(render("claude", "sonnet")).not.toContain("Calling in help");
      expect(render("claude", null)).not.toContain("Calling in help");
    });
  });

  it.each([
    ["codex", "heavy", "builder"],
    ["claude", "standard", "builder"],
    ["opencode", "light", "critic"]
  ] as const)("carries one Identity block naming the %s %s %s identity the launch commits under", (agent, tier, role) => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: `${agent}/define-contract`,
      agent,
      baseRevision: head(repo),
      identity: resolveAgentIdentity(agent, tier, role),
      partners: [{ source: "session", actionId: "other", agent: "codex", identity: resolveAgentIdentity("codex", "light") }]
    });
    expectIdentityBlock(brief, agent, tier, role);
    expect(brief).toContain("partners on this Project, from live claims and Sessions, are: Cody Swift <cody.swift@agents.arcadia.local>");
  });

  it("still carries an Identity block, naming nobody, when no identity was supplied", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "codex/define-contract",
      agent: "codex",
      baseRevision: head(repo)
    });
    expect(brief.match(/^Identity:$/gm)).toHaveLength(1);
    expect(brief).not.toMatch(/^You are /m);
    expect(brief).toContain("arcadia identity resolve");
  });

  it("carries every acceptance criterion verbatim and in the plan's order", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "opencode",
      baseRevision: head(repo)
    });

    const first = brief.indexOf("The contract exists.");
    const second = brief.indexOf("The contract is published.");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(brief).toContain("Acceptance criteria (verbatim, in the plan's order):");
    expect(brief).toContain("  1. The contract exists.");
    expect(brief).toContain("  2. The contract is published.");
  });

  it("states the standing constraints and the exact completion protocol", () => {
    const repo = briefRepo();
    const brief = renderActionBrief({
      repoRoot: repo,
      projectSlug: "test-project",
      planSlug: "copy-proof",
      actionId: "define-contract",
      worktreePath: "/worktrees/define-contract",
      branch: "opencode/define-contract",
      agent: "codex",
      baseRevision: head(repo)
    });

    expect(brief).toContain("do not merge, deploy, publish, push to shared");
    expect(brief).toContain("Approval boundaries are hard stops.");
    expect(brief).toContain("Run the repository's declared validation and make it pass.");
    expect(brief).toContain("arcadia-preserve-broker-codex");
    expect(brief).toContain("Settle a `complete` Agent Ask with `candidate_revision` equal to this worktree's HEAD");
    expect(brief).toContain("`met` evidence entry per acceptance criterion above, verbatim and in order.");
    // Issue #981: a stray draft beside the settlement commit blocked integration forever.
    expect(brief).toContain("After you settle, `git status` must be clean: settlement archives the drafted Ask file into");
    expect(brief).toContain(".arcadia/asks/archive/ in its own commit, so never commit the draft or keep a copy of it.");
    expect(brief).toContain("If a draft of the Ask you just settled still remains in .arcadia/asks/, delete it.");
  });

  describe("draft-only completion recipe for Sessions that cannot commit", () => {
    const headless = (repo: string, agent: "claude" | "codex" | "opencode", isHeadless = true) => renderActionBrief({
      repoRoot: repo, projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
      worktreePath: repo, branch: `${agent}/define-contract`, agent, baseRevision: head(repo), headless: isHeadless
    });
    const draftCommand = (text: string): { dir: string; json: string } => {
      const match = /^ {5}arcadia agent-ask draft --dir '([^']*)' '(.*)'$/m.exec(text);
      if (!match) throw new Error(`no draft command in brief:\n${text}`);
      return { dir: match[1], json: match[2].replaceAll("'\\''", "'") };
    };

    it("replaces the generic steps 2-3 for headless Claude with the host-owned statement and one exact draft command", () => {
      const repo = briefRepo();
      const brief = headless(repo, "claude");
      const protocol = brief.slice(brief.indexOf("Completion protocol"));
      expect(protocol).toContain("git add, git commit, git push and arcadia-preserve-broker-claude are host-owned in this Session and");
      expect(protocol).toContain("will be refused. Do not run them or try to change permissions");
      expect(protocol).toContain("do not write Ask files by hand");
      expect(protocol).not.toContain("If your sandbox cannot commit");
      expect(protocol.split("arcadia agent-ask draft --dir").length - 1).toBe(1);
      const { dir, json } = draftCommand(protocol);
      expect(dir).toBe(repo);
      const ask = JSON.parse(json);
      expect(ask).toMatchObject({
        agent_ask: "v1", request_id: `complete-define-contract-${head(repo).slice(0, 12)}`, project: "test-project",
        intent: "complete", target_ref: "action/define-contract", candidate_revision: head(repo)
      });
      expect(ask.evidence.map((entry: { criterion: string; status: string }) => [entry.criterion, entry.status])).toEqual([
        ["The contract exists.", "met"], ["The contract is published.", "met"]
      ]);
      expect(ask.evidence[0].note).toContain("<REPLACE");
    });

    it("keeps Codex's broker step first, then the draft recipe when the broker refuses; skips interactive and opencode", () => {
      const repo = briefRepo();
      const codex = headless(repo, "codex");
      expect(codex).toContain("existing fixed launcher: arcadia-preserve-broker-codex");
      expect(codex).toContain("Do not run raw git add, git commit or git push");
      expect(codex).toContain("If the broker\n     refuses");
      expect(codex).not.toContain("host-owned in this Session");
      expect(codex.indexOf("arcadia-preserve-broker-codex")).toBeLessThan(codex.indexOf("arcadia agent-ask draft --dir"));
      expect(headless(repo, "claude", false)).toContain("arcadia-preserve-broker-claude");
      expect(headless(repo, "opencode")).toContain("arcadia-preserve-broker-opencode");
      expect(headless(repo, "opencode")).not.toContain("host-owned in this Session");
    });

    it("uses the completion request id the Action text names", () => {
      const repo = briefRepo();
      const planPath = path.join(repo, "docs", "plans", "copy-proof.md");
      writeFileSync(planPath, readFileSync(planPath, "utf8").replace(
        "next_action: Define the bounded contract.",
        "next_action: Define the bounded contract; record completion under the unused Agent Ask request id complete-define-contract-run7 and stop."
      ));
      expect(JSON.parse(draftCommand(headless(repo, "claude")).json).request_id).toBe("complete-define-contract-run7");
    });

    it("refuses the rendered command run verbatim, with its placeholders unfilled, and writes nothing", () => {
      const repo = briefRepo();
      const { dir, json } = draftCommand(headless(repo, "claude"));
      expect(() => runAgentAskDraftCommand({ request: json, dir, workspace: path.join(repo, "no-workspace") }))
        .toThrowError(/still contains the placeholder <REPLACE:.*Replace each note/);
      expect(existsSync(path.join(repo, ".arcadia", "asks"))).toBe(false);
    });

    it("takes only a canonical-charset id from the Action text: no trailing period, no uppercase or underscore", () => {
      const planPath = (repo: string) => path.join(repo, "docs", "plans", "copy-proof.md");
      const withText = (text: string) => {
        const repo = briefRepo();
        writeFileSync(planPath(repo), readFileSync(planPath(repo), "utf8").replace("next_action: Define the bounded contract.", `next_action: ${text}`));
        return JSON.parse(draftCommand(headless(repo, "claude")).json).request_id as string;
      };
      expect(withText("Record under the Agent Ask request id complete-x-run7.")).toBe("complete-x-run7");
      for (const bad of ["complete-X-run7", "complete-x_run7"]) {
        expect(withText(`Record under the Agent Ask request id ${bad} now.`)).toMatch(/^complete-define-contract-[0-9a-f]{12}$/);
      }
    });

    it("quotes a single quote in a criterion and in the worktree path so a POSIX shell parses the exact arguments back", () => {
      const repo = briefRepo();
      const planPath = path.join(repo, "docs", "plans", "copy-proof.md");
      writeFileSync(planPath, readFileSync(planPath, "utf8").replace("The contract exists.", "The contract doesn't exist yet."));
      const tricky = "/tmp/it's a 'worktree'";
      const brief = renderActionBrief({
        repoRoot: repo, projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
        worktreePath: tricky, branch: "claude/define-contract", agent: "claude", baseRevision: head(repo), headless: true
      });
      const line = /^ {5}arcadia agent-ask draft .*$/m.exec(brief)?.[0].trim();
      if (!line) throw new Error("no draft command");
      const out = execFileSync("sh", ["-c", `arcadia() { for a in "$@"; do printf '%s\\0' "$a"; done; }; ${line}`], { encoding: "utf8" });
      const args = out.split("\0").slice(0, -1);
      expect(args.slice(0, 3)).toEqual(["agent-ask", "draft", "--dir"]);
      expect(args[3]).toBe(tricky);
      expect(JSON.parse(args[4]).evidence[0].criterion).toBe("The contract doesn't exist yet.");
      expect(args).toHaveLength(5);
    });

    it("round-trips: the rendered Ask, with placeholders filled, validates and lands at the canonical draft path", () => {
      const repo = briefRepo();
      const { dir, json } = draftCommand(headless(repo, "claude"));
      const filled = json.replaceAll("<REPLACE: the command you ran and what you observed for this criterion>", "ran the validation; it passed");
      const drafted = runAgentAskDraftCommand({ request: filled, dir, workspace: path.join(repo, "no-workspace") });
      const canonical = path.join(repo, ".arcadia", "asks", `agent-ask-complete-define-contract-${head(repo).slice(0, 12)}.yaml`);
      expect(drafted.data.path).toBe(canonical);
      expect(drafted.data.written).toBe("created");
      expect(existsSync(canonical)).toBe(true);
      const normalized = normalizeAgentAsk({ request: readFileSync(canonical, "utf8") });
      expect(normalized.intent).toBe("complete");
      expect(normalized.evidence.map((entry) => [entry.criterion, entry.status])).toEqual([
        ["The contract exists.", "met"], ["The contract is published.", "met"]
      ]);
    });
  });

  it("names the provider's own fixed preservation launcher for every configured provider", () => {
    const repo = briefRepo();
    for (const [agent, launcher] of [["codex", "arcadia-preserve-broker-codex"], ["claude", "arcadia-preserve-broker-claude"], ["opencode", "arcadia-preserve-broker-opencode"]] as const) {
      const brief = renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "define-contract",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent,
        baseRevision: head(repo)
      });
      expect(brief).toContain(launcher);
    }
  });

  it("fails closed with a named error when the Action is missing", () => {
    const repo = briefRepo();
    expect(() =>
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "does-not-exist",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent: "opencode",
      baseRevision: head(repo)
      })
    ).toThrowError(/Action "does-not-exist" was not found in plan "copy-proof"/);
  });

  it("fails closed with a named error when the plan is missing", () => {
    const repo = briefRepo();
    try {
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "no-such-plan",
        actionId: "define-contract",
        worktreePath: "/worktrees/define-contract",
        branch: "opencode/define-contract",
        agent: "opencode",
      baseRevision: head(repo)
      });
      throw new Error("Expected ArcadiaError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      expect((error as ArcadiaError).code).toBe("VALIDATION_ERROR");
      expect((error as Error).message).toContain('plan "no-such-plan" was not found');
    }
  });

  it("embeds the Constitution committed at the base revision exactly once, with its fingerprint", () => {
    const repo = briefRepo();
    const rendered = brief(repo);
    expect(rendered).toMatch(/CONSTITUTION\.md \(sha256 [0-9a-f]{12}\) also binds this action/);
    expect(rendered.split("Approval boundaries are hard stops.").length - 1).toBe(1);
  });

  it("refuses to launch when the worktree's Constitution drifted from the base revision", () => {
    const repo = briefRepo();
    const base = head(repo);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# Constitution\n\n- Anything goes.\n");
    expect(() => brief(repo, base)).toThrow(/cannot launch: CONSTITUTION\.md in the worktree differs.*pinned to base revision/);
    rmSync(path.join(repo, "CONSTITUTION.md"));
    expect(() => brief(repo, base)).toThrow(/CONSTITUTION\.md in the worktree differs/);
  });

  it("refuses to launch when the Constitution is unreadable or the base revision is unknown", () => {
    const repo = briefRepo();
    const base = head(repo);
    rmSync(path.join(repo, "CONSTITUTION.md"));
    mkdirSync(path.join(repo, "CONSTITUTION.md"));
    expect(() => brief(repo, base)).toThrow(/cannot launch: .*could not be read/);
    expect(() => brief(repo, "0".repeat(40))).toThrow(/cannot be verified/);
  });

  it("does not mistake a checkout's CRLF conversion for a changed Constitution", () => {
    const repo = briefRepo();
    execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: repo });
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# Constitution\r\n\r\n## Authority\r\n\r\n- Approval boundaries are hard stops.\r\n");
    expect(brief(repo)).toContain("Approval boundaries are hard stops.");
  });

  it("fails closed when the Action declares no acceptance criteria", () => {
    const repo = briefRepo();
    try {
      renderActionBrief({
        repoRoot: repo,
        projectSlug: "test-project",
        planSlug: "copy-proof",
        actionId: "legacy-action",
        worktreePath: "/worktrees/legacy-action",
        branch: "opencode/legacy-action",
        agent: "opencode",
      baseRevision: head(repo)
      });
      throw new Error("Expected ArcadiaError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArcadiaError);
      expect((error as ArcadiaError).code).toBe("VALIDATION_ERROR");
      expect((error as Error).message).toContain('Action "legacy-action" declares no acceptance criteria');
    }
  });
});

function briefRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-brief-"));
  roots.push(root);
  mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(root, "CONSTITUTION.md"), "# Constitution\n\n## Authority\n\n- Approval boundaries are hard stops.\n");
  writeFileSync(path.join(root, "docs", "plans", "copy-proof.md"), `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the Session contract
current_action: define-contract
token_impact: medium
token_budget: One bounded Session.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-09-17
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
      - The contract is published.
  - id: legacy-action
    title: Legacy action
    status: open
    responsibility: agent
    next_action: Finish the legacy action.
    acceptance_criteria: []
---
`);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=brief@example.invalid", "-c", "user.name=Brief", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=brief@example.invalid", "-c", "user.name=Brief", "commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function head(repo: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

function brief(repo: string, baseRevision = head(repo)): string {
  return renderActionBrief({
    repoRoot: repo, projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
    worktreePath: "/worktrees/define-contract", branch: "opencode/define-contract", agent: "opencode", baseRevision
  });
}
