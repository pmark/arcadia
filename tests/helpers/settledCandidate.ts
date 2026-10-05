import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withDatabase } from "../../src/db/connection.js";

/**
 * A throwaway fixture candidate in the preserve-then-settle shape the
 * production tick writes: genesis Plan, the candidate's work, the preservation
 * commit (adds the Agent Ask), then `agent-ask settle --apply`'s completion
 * commit (archives the Ask, appends the Mission Log, marks the Action done and
 * moves both pointers). Every byte mirrors rehearsal run 1's real commits.
 */
export const PROJECT = "three-action-rehearsal";
export const PLAN = "docs/plans/autonomous-three-action-rehearsal.md";
export const ACTION = "write-start-marker";
export const NEXT_ACTION = "transform-start-marker";
export const ASK = `.arcadia/asks/agent-ask-complete-${ACTION}-2026-10-04.yaml`;

export function git(cwd: string, args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

export function commit(cwd: string, message: string): string {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

const action = (id: string, dependsOn: string[]) => [
  `  - id: ${id}`,
  `    title: Implement ${id}.`,
  "    status: open",
  "    responsibility: agent",
  "    effort: session",
  `    next_action: Implement ${id}.`,
  `    expected_artifact: ${id} evidence`,
  "    clarification: clarified",
  "    confidence: high",
  "    acceptance_criteria:",
  `      - ${id} is implemented.`,
  `    depends_on: [${dependsOn.join(", ")}]`,
  "    decisions: []"
];

const planText = () => [
  "---", "arcadia: v1", "type: plan", "slug: autonomous-three-action-rehearsal", `project: ${PROJECT}`, "status: active",
  "updated: 2026-10-04", "actions:", ...action(ACTION, []), ...action(NEXT_ACTION, [ACTION]),
  "questions: []", "decisions: []", `current_action: ${ACTION}`, "---", "", "# Autonomous three-Action rehearsal", ""
].join("\n");

const projectText = () => [
  "---", "arcadia: v1", "type: project", `slug: ${PROJECT}`, "status: active", "active_plan: autonomous-three-action-rehearsal",
  `current_action: ${ACTION}`, "updated: 2026-10-04", "---", "", "# Three Action Rehearsal", ""
].join("\n");

const askText = (candidateRevision: string, target = ACTION): string => JSON.stringify({
  agent_ask: "v1", request_id: `complete-${target}-2026-10-04`, project: PROJECT, intent: "complete", target_ref: `action/${target}`,
  candidate_revision: candidateRevision, evidence: [{ criterion: `${target} is implemented.`, status: "met" }], desired_result: `Mark ${target} complete.`
}) + "\n";

export const receiptLine = (receiptId: string) => `Written by \`arcadia agent-ask settle --apply\` (${receiptId}).`;
export const settlementMessage = (receiptId: string, action = ACTION) => [
  `chore(arcadia): settle auto-settle-${PROJECT}-${action}-4c1e5e3c1d39`,
  "",
  `- Marked Action ${PROJECT}/${action} done with accepted evidence for all 1 criteria.`,
  "",
  receiptLine(receiptId),
  "Arcadia writes and lands its own managed documents; it did not author the",
  "decision they record."
].join("\n");

/** Genesis, the candidate's work and its preservation commit. */
export function buildPreservedCandidate(repo: string): { base: string; work: string; receipt: string } {
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  writeFileSync(path.join(repo, PLAN), planText());
  writeFileSync(path.join(repo, "PROJECT.md"), projectText());
  const base = commit(repo, "Bootstrap three-Action rehearsal fixture");
  git(repo, ["checkout", "-q", "-b", `claude/${ACTION}-20261004T170245861Z`]);
  writeFileSync(path.join(repo, "MARKER.md"), "three-action rehearsal start\n");
  const work = commit(repo, "Add MARKER.md start marker");
  mkdirSync(path.join(repo, ".arcadia", "asks"), { recursive: true });
  writeFileSync(path.join(repo, ASK), askText(work));
  const receipt = commit(repo, `chore(candidate): preserve ${ACTION} candidate for handoff`);
  return { base, work, receipt };
}

export interface SettleOptions {
  receiptId: string;
  message?: string;
  /** Skip the Plan and pointer changes (a settlement that completes nothing). */
  completes?: boolean;
  /** Extra edits before committing, such as a code change. */
  extra?: (repo: string) => void;
}

/** The accepted-completion settlement commit, exactly as `agent-ask settle --apply` writes it. */
export function settle(repo: string, receiptCommit: string, options: SettleOptions): string {
  const target = ACTION;
  const next = NEXT_ACTION;
  mkdirSync(path.join(repo, ".arcadia", "asks", "archive"), { recursive: true });
  const archived = path.join(repo, ".arcadia", "asks", "archive", path.basename(ASK));
  renameSync(path.join(repo, ASK), archived);
  writeFileSync(archived, askText(receiptCommit));
  writeFileSync(path.join(repo, "MISSION_LOG.md"), `# Mission Log\n\n## 2026-10-04 settled ${target}\n\n- Marked ${target} done.\n`);
  if (options.completes !== false) {
    const plan = readFileSync(path.join(repo, PLAN), "utf8");
    const lines = plan.split("\n");
    const at = lines.indexOf(`  - id: ${target}`);
    if (at < 0) throw new Error(`no Action ${target}`);
    const status = lines.findIndex((line, index) => index > at && line === "    status: open");
    lines[status] = "    status: done";
    writeFileSync(path.join(repo, PLAN), lines.join("\n").replace(`current_action: ${target}`, `current_action: ${next}`));
    const project = readFileSync(path.join(repo, "PROJECT.md"), "utf8");
    writeFileSync(path.join(repo, "PROJECT.md"), project.replace(`current_action: ${target}`, `current_action: ${next}`));
  }
  options.extra?.(repo);
  return commit(repo, options.message ?? settlementMessage(options.receiptId));
}

export interface SeedSettlement {
  receiptId: string;
  receiptCommit: string;
  documentsCommit: string;
  action?: string;
  project?: string;
  disposition?: "accepted" | "rejected";
}

/** Records the settlement exactly as `agent-ask settle --apply` does: its receipt and its proposal. */
export function seedSettlement(workspace: string, seed: SeedSettlement): void {
  const action = seed.action ?? ACTION;
  const project = seed.project ?? PROJECT;
  const proposalId = `agentask_${seed.receiptId.slice(-12)}`;
  const requestId = `auto-settle-${project}-${action}-${seed.receiptId.slice(-6)}`;
  withDatabase(workspace, (db) => {
    // The capture envelope a real proposal references is not part of what G8 reads.
    db.pragma("foreign_keys = OFF");
    db.prepare(`INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at)
      VALUES (?, ?, ?, ?, 'strict', 'complete', ?, ?, '2026-10-04T17:04:12.974Z')`).run(proposalId, requestId, `capture_${seed.receiptId}`, "f".repeat(64), project, JSON.stringify({
      id: proposalId,
      normalized: { version: "v1", format: "strict", requestId, project, intent: "complete", targetRef: `action/${action}`, candidateRevision: seed.receiptCommit }
    }));
    db.prepare(`INSERT INTO agent_ask_settlements (id, proposal_id, request_id, operation_json, fingerprint, disposition, project_slug, effects_json, receipt_json, created_at)
      VALUES (?, ?, ?, '{}', ?, ?, ?, '[]', ?, '2026-10-04T17:04:27.941Z')`).run(seed.receiptId, proposalId, `settle-${requestId}`, "e".repeat(64), seed.disposition ?? "accepted", project, JSON.stringify({
      id: seed.receiptId, proposalId, proposalRequestId: requestId, disposition: seed.disposition ?? "accepted", projectSlug: project, intent: "complete",
      applied: true, documentsCommit: seed.documentsCommit
    }));
  });
}
