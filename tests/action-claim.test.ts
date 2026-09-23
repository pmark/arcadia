import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { transitionActionPointer } from "../src/dispatch/pointer.js";
import {
  getActiveActionClaim,
  getActiveWorktreeReservation,
  releaseActionClaim,
  reserveAgentWorktree
} from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];
// Wall-clock, not a fixed instant: the pointer transition checks the claim with
// its own `new Date()`, so a fixed NOW expired every claim 24h after it was
// written and failed the settlement test forever after (Issue #524).
const NOW = new Date();

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(prefix = "arcadia-action-claim-"): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

/** A workspace database with the reservations table, and no repository fixture. */
function claimWorkspace(): string {
  const workspace = path.join(scratch(), "workspace");
  initWorkspace(workspace);
  return workspace;
}

describe("Action-scoped worktree claims", () => {
  it("refuses a second worktree claiming an Action a live worktree already holds", () => {
    withDatabase(claimWorkspace(), (db) => {
      const first = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/.claude/worktrees/first",
        branch: "claude/refresh-first",
        now: NOW,
        project: "arcadia",
        actionId: "refresh-managed-production-readiness"
      });
      expect(first.claim_generation).toBeTruthy();

      // The collision of 2026-09-22: a second, *different* worktree path
      // dispatched to the identical Action about two minutes later.
      expect(() => reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/.claude/worktrees/second",
        branch: "claude/refresh-second",
        now: new Date(NOW.getTime() + 120_000),
        project: "arcadia",
        actionId: "refresh-managed-production-readiness"
      })).toThrowError(/already claimed by a live worktree/);

      // One winner, and it is the first: the loser wrote nothing at all.
      const rows = db.prepare("SELECT worktree_path FROM agent_worktree_reservations").all() as Array<{ worktree_path: string }>;
      expect(rows.map((row) => row.worktree_path)).toEqual(["/repo/.claude/worktrees/first"]);
    });
  });

  it("enforces the worktree-path and Action-id constraints independently", () => {
    withDatabase(claimWorkspace(), (db) => {
      reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });

      // Same worktree path, *different* Action: the worktree-path guarantee
      // still holds (one row per path, replaced rather than duplicated), and
      // it is the Action-id constraint that has nothing to say here.
      reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-b"
      });
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_worktree_reservations WHERE worktree_path = ?")
        .get("/repo/wt-a") as { n: number }).n).toBe(1);
      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)).toBeNull();

      // Different worktree path, *same* Action: the Action-id constraint
      // refuses, which the worktree-path constraint alone would have allowed --
      // neither can be satisfied by breaking the other.
      expect(() => reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-b",
        branch: "claude/b",
        now: NOW,
        project: "arcadia",
        actionId: "action-b"
      })).toThrowError(/already claimed by a live worktree/);

      // And the database index stands behind the query, not only the query:
      // a direct insert that bypasses the conflict lookup is still refused.
      expect(() => db.prepare(`INSERT INTO agent_worktree_reservations
        (id, repository_path, worktree_path, branch, created_at, expires_at, project, action_id, claim_generation)
        VALUES ('raw', '/repo', '/repo/wt-c', 'claude/c', ?, ?, 'arcadia', 'action-b', 'gen-raw')`)
        .run(NOW.toISOString(), new Date(NOW.getTime() + 3_600_000).toISOString()))
        .toThrowError(/UNIQUE constraint failed/);

      // The worktree-path uniqueness is likewise still its own constraint.
      expect(() => db.prepare(`INSERT INTO agent_worktree_reservations
        (id, repository_path, worktree_path, branch, created_at, expires_at)
        VALUES ('raw2', '/repo', '/repo/wt-a', 'claude/a', ?, ?)`)
        .run(NOW.toISOString(), new Date(NOW.getTime() + 3_600_000).toISOString()))
        .toThrowError(/UNIQUE constraint failed/);
    });
  });

  it("filters expiry in the conflict query rather than trusting cleanup-on-insert", () => {
    withDatabase(claimWorkspace(), (db) => {
      reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });
      // A row a crashed cleanup path left behind: present, but expired.
      db.prepare("UPDATE agent_worktree_reservations SET expires_at = ?").run(NOW.toISOString());

      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)).toBeNull();
      // The same discipline the worktree-path lookup already applies.
      expect(getActiveWorktreeReservation(db, "/repo", "/repo/wt-a", NOW)).toBeNull();

      // So a legitimate re-dispatch is not blocked for the rest of the TTL.
      const reclaimed = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-b",
        branch: "claude/b",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });
      expect(reclaimed.worktree_path).toBe("/repo/wt-b");
    });
  });

  it("gives every claim a fresh generation rather than reusing one", () => {
    withDatabase(claimWorkspace(), (db) => {
      const first = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });
      const second = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });
      expect(second.claim_generation).toBeTruthy();
      expect(second.claim_generation).not.toBe(first.claim_generation);
    });
  });

  it("releases only on a matching generation, and is a no-op otherwise", () => {
    withDatabase(claimWorkspace(), (db) => {
      const first = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });

      expect(releaseActionClaim(db, {
        repositoryPath: "/repo",
        project: "arcadia",
        actionId: "action-a",
        generation: first.claim_generation!
      })).toBe(true);
      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)).toBeNull();

      // Releasing an already-released claim is a no-op, never an error, so a
      // retried settlement can safely repeat its release.
      expect(releaseActionClaim(db, {
        repositoryPath: "/repo",
        project: "arcadia",
        actionId: "action-a",
        generation: first.claim_generation!
      })).toBe(false);

      // A superseded generation must not delete the newer, actively-owned claim
      // out from under whoever now holds it.
      const second = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-b",
        branch: "claude/b",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });
      expect(releaseActionClaim(db, {
        repositoryPath: "/repo",
        project: "arcadia",
        actionId: "action-a",
        generation: first.claim_generation!
      })).toBe(false);
      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)?.claim_generation)
        .toBe(second.claim_generation);
    });
  });

  it("keeps the worktree reservation when only the claim is released", () => {
    withDatabase(claimWorkspace(), (db) => {
      const claimed = reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-a",
        branch: "claude/a",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      });

      expect(releaseActionClaim(db, {
        repositoryPath: "/repo",
        project: "arcadia",
        actionId: "action-a",
        generation: claimed.claim_generation!
      })).toBe(true);

      // The claim is gone, so the Action can be dispatched again...
      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)).toBeNull();
      // ...but the worktree is still on disk after a failed spawn, and its
      // reservation is what stops `tidy` retiring a clean handoff. The row
      // carries two guarantees; releasing one must not surrender the other.
      expect(getActiveWorktreeReservation(db, "/repo", "/repo/wt-a", NOW)?.branch).toBe("claude/a");

      // And the freed Action is genuinely claimable by another worktree.
      expect(reserveAgentWorktree(db, {
        repositoryPath: "/repo",
        worktreePath: "/repo/wt-b",
        branch: "claude/b",
        now: NOW,
        project: "arcadia",
        actionId: "action-a"
      }).worktree_path).toBe("/repo/wt-b");
    });
  });

  it("removes the claim when preparation fails inside the reserving transaction", () => {
    withDatabase(claimWorkspace(), (db) => {
      // `go` and `guardedLaunch` both reserve inside `beforeCreate`, within one
      // write transaction: a preparation that throws takes the claim with it,
      // rather than leaving the Action blocked for the TTL over work that
      // never started.
      expect(() => db.transaction(() => {
        reserveAgentWorktree(db, {
          repositoryPath: "/repo",
          worktreePath: "/repo/wt-a",
          branch: "claude/a",
          now: NOW,
          project: "arcadia",
          actionId: "action-a"
        });
        throw new Error("worktree preparation failed");
      })()).toThrowError(/worktree preparation failed/);

      expect(getActiveActionClaim(db, "/repo", "arcadia", "action-a", NOW)).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_worktree_reservations").get() as { n: number }).n).toBe(0);
    });
  });
});

interface PointerFixture {
  repo: string;
  workspace: string;
}

function pointerFixture(): PointerFixture {
  const repo = scratch("arcadia-claim-pointer-");
  writeDoc(repo, "PROJECT.md", [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    "status: active",
    "goal: Exercise Action claims.",
    "milestone: Claim milestone",
    "active_plan: claim-plan",
    "current_action: alpha",
    "updated: 2026-09-22",
    "---",
    "",
    "# Demo",
    ""
  ].join("\n"));
  writeDoc(repo, "docs/plans/claim-plan.md", [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: claim-plan",
    "project: demo",
    "status: active",
    "milestone: Claim milestone",
    "token_impact: small",
    "token_budget: One bounded implementation pass.",
    "recommended_model: gpt-5.6-terra",
    "current_action: alpha",
    "updated: 2026-09-22",
    "actions:",
    "  - id: alpha",
    "    title: First Action",
    "    status: open",
    "    responsibility: agent",
    "    next_action: Implement the first Action.",
    "    expected_artifact: A first Artifact",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The first Action is done.",
    "    depends_on: []",
    "  - id: beta",
    "    title: Second Action",
    "    status: open",
    "    responsibility: agent",
    "    next_action: Implement the second Action.",
    "    expected_artifact: A second Artifact",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The second Action is done.",
    "    depends_on: []",
    "---",
    "",
    "# Claim plan",
    ""
  ].join("\n"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "claim-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Claim Test"], { cwd: repo });
  execFileSync("git", ["add", "PROJECT.md", "docs/plans/claim-plan.md"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add claim fixture"], { cwd: repo });

  const workspace = path.join(scratch(), "workspace");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise Action claims.",
      status: "active",
      currentMilestone: "Claim milestone",
      nextAction: "Implement the first Action.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
  });
  return { repo, workspace };
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

/** Preview, then apply the same transition, carrying `claim` through both. */
function applyTransition(
  db: Database.Database,
  fixture: PointerFixture,
  requestId: string,
  claim?: Parameters<typeof transitionActionPointer>[1]["claim"]
) {
  const base = {
    repoRoot: fixture.repo,
    projectSlug: "demo",
    actionId: "beta",
    actionKey: "demo/beta",
    queueRevision: 1,
    requestId
  };
  const preview = transitionActionPointer(db, base);
  return transitionActionPointer(db, {
    ...base,
    apply: true,
    previewFingerprint: preview.previewFingerprint,
    claim
  });
}

describe("Action claims fenced through the pointer transition", () => {
  it("releases the claim in the same transaction that applies the settlement", () => {
    const fixture = pointerFixture();
    withDatabase(fixture.workspace, (db) => {
      const claimed = reserveAgentWorktree(db, {
        repositoryPath: fixture.repo,
        worktreePath: path.join(fixture.repo, ".claude/worktrees/alpha"),
        branch: "claude/alpha",
        now: NOW,
        project: "demo",
        actionId: "alpha"
      });

      const receipt = applyTransition(db, fixture, "settle-alpha", {
        repositoryPath: fixture.repo,
        project: "demo",
        actionId: "alpha",
        generation: claimed.claim_generation!,
        release: true
      });

      expect(receipt.applied).toBe(true);
      expect(receipt.commitError ?? null).toBeNull();
      expect(readFileSync(path.join(fixture.repo, "PROJECT.md"), "utf8")).toContain("current_action: beta");
      // Released by the settlement itself, not by the 24-hour TTL.
      expect(getActiveActionClaim(db, fixture.repo, "demo", "alpha", NOW)).toBeNull();
    });
  });

  it("refuses a stale-generation settlement and writes nothing", () => {
    const fixture = pointerFixture();
    withDatabase(fixture.workspace, (db) => {
      const first = reserveAgentWorktree(db, {
        repositoryPath: fixture.repo,
        worktreePath: path.join(fixture.repo, ".claude/worktrees/alpha-1"),
        branch: "claude/alpha-1",
        now: NOW,
        project: "demo",
        actionId: "alpha"
      });
      // The first session's claim lapses and a second session reclaims the
      // Action and does genuinely new work; the first session, still alive and
      // merely slow, then tries to settle against the generation it started
      // with.
      db.prepare("UPDATE agent_worktree_reservations SET expires_at = ?").run(NOW.toISOString());
      const second = reserveAgentWorktree(db, {
        repositoryPath: fixture.repo,
        worktreePath: path.join(fixture.repo, ".claude/worktrees/alpha-2"),
        branch: "claude/alpha-2",
        now: NOW,
        project: "demo",
        actionId: "alpha"
      });

      const projectBefore = readFileSync(path.join(fixture.repo, "PROJECT.md"), "utf8");
      const planBefore = readFileSync(path.join(fixture.repo, "docs/plans/claim-plan.md"), "utf8");

      expect(() => applyTransition(db, fixture, "settle-stale", {
        repositoryPath: fixture.repo,
        project: "demo",
        actionId: "alpha",
        generation: first.claim_generation!,
        release: true
      })).toThrowError(/no longer the one this settlement started with/);

      // Nothing written: not the documents, not a receipt, and not the newer
      // session's claim, which is still exactly where it was.
      expect(readFileSync(path.join(fixture.repo, "PROJECT.md"), "utf8")).toBe(projectBefore);
      expect(readFileSync(path.join(fixture.repo, "docs/plans/claim-plan.md"), "utf8")).toBe(planBefore);
      expect((db.prepare("SELECT COUNT(*) AS n FROM action_queue_pointer_receipts").get() as { n: number }).n).toBe(0);
      expect(getActiveActionClaim(db, fixture.repo, "demo", "alpha", NOW)?.claim_generation)
        .toBe(second.claim_generation);
    });
  });
});
