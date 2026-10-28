import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";
import { withDatabase } from "../../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../../src/db/repositories.js";
import { arrangeActionOrder } from "../../src/dispatch/order.js";
import { discoverDocs } from "../../src/docs/discover.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { QA_PR_REVIEW_CRITERIA, type QaPrReviewDependencies } from "../../src/qa/prReview.js";
import type { SelectedCodingAgentConfiguration } from "../../src/codingAgents/providerAdapters.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

export function createDirectionFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-direction-"))); roots.push(root);
  const workspace = path.join(root, "workspace"); const repo = path.join(root, "repo");
  initWorkspace(workspace); mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true }); writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "");
  writeFileSync(path.join(repo, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: Prove directions\nactive_plan: work\ncurrent_action: first\nupdated: 2026-10-28\n---\n");
  writeFileSync(path.join(repo, "docs/plans/work.md"), "---\narcadia: v1\ntype: plan\nslug: work\nproject: demo\nstatus: active\nmilestone: Prove receipts\ntoken_impact: medium\ntoken_budget: One fixture\nrecommended_model: gpt-5.6-terra\ncurrent_action: first\nupdated: 2026-10-28\nactions:\n  - id: first\n    title: Write proof\n    status: open\n    responsibility: agent\n    clarification: clarified\n    next_action: Write proof\n    acceptance_criteria: [Proof exists.]\n    depends_on: []\n  - id: second\n    title: Check proof\n    status: open\n    responsibility: agent\n    clarification: clarified\n    next_action: Check proof\n    acceptance_criteria: [The proof is checked.]\n    depends_on: [first]\n---\n");
  expect(discoverDocs(repo).errors).toEqual([]);
  const env = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-qm", "Fixture");
  const head = git("rev-parse", "HEAD");
  const project = withDatabase(workspace, db => {
    const p = upsertProject(db, { name: "Demo", mission: "Prove directions", status: "active" });
    upsertProjectMetadata(db, { projectId: p.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: ["demo/first", "demo/second"], order: ["demo/first", "demo/second"], requestId: "order", apply: true });
    return p;
  });
  return { root, workspace, repo, head, git, project };
}

export function directionQaDependencies(head: string, base: string): QaPrReviewDependencies {
  const success = (stdout = "") => ({ status: 0, stdout, stderr: "", error: null });
  const reviewer: SelectedCodingAgentConfiguration = { mappingId: "fixture-qa-mapping", bindingId: "fixture-qa-binding",
    profile: { name: "fixture_qa", provider: "codex-cli", package: "fixture", command: "codex", purpose: "planning", sandbox: "read-only", args: ["exec"] },
    provider: "codex-cli", model: "fixture-model", capability: "c2_integrated", effort: "e2_standard", args: ["--model", "fixture-model"], costRank: 1 };
  return { selectReviewer: () => reviewer, runCommand: ({ command, args }) => {
    if (command === "git") return success("https://github.com/pmark/arcadia.git\n");
    if (command === "gh" && args[0] === "api") return success("diff --git a/proof.ts b/proof.ts\n+proof\n");
    if (command === "gh" && args[1] === "view") return success(JSON.stringify({ number: 54, title: "Proof", url: "https://github.com/pmark/arcadia/pull/54", state: "OPEN", isDraft: false,
      mergeStateStatus: "CLEAN", headRefName: "candidate", headRefOid: head, baseRefName: "main", baseRefOid: base, body: "## QA plan\nCheck the proof.",
      files: [{ path: "proof.ts", additions: 1, deletions: 0, changeType: "ADDED" }],
      statusCheckRollup: [{ name: "tests", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.invalid/proof", workflowName: "CI" }] }));
    if (command === "/bin/zsh") return success("host-home-readable\nhost-repository-readable\nhost-network-reachable\n");
    if (command === "codex" && args[0] === "sandbox") return success("sandbox-evidence-readable\nsandbox-home-denied\nsandbox-repository-denied\nsandbox-network-denied\n");
    if (command === "codex") {
      writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ verdict: "pass", summary: "Fixture independent acceptance passed.", findings: [], residualRisks: [],
        checks: QA_PR_REVIEW_CRITERIA.map(criterion => ({ criterion: criterion.id, name: criterion.name, status: "pass", evidence: "Fixture acceptance evidence." })) }));
      return success();
    }
    throw new Error(`Unexpected fixture command ${command}`);
  } };
}
