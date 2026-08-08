import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runQaQueueCommand,
  runQaSignOffCommand,
  runQaTargetSetCommand
} from "../src/commands/qa.js";
import { withDatabase } from "../src/db/connection.js";
import { getReviewItem, upsertProject } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspaceWithProjects(names: string[]): { workspace: string; projectIds: string[] } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-qa-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  const projectIds = withDatabase(workspace, (db) =>
    names.map((name) => upsertProject(db, {
      name,
      mission: `Ship ${name}.`,
      status: "active",
      currentMilestone: "Prove it",
      nextAction: "Test the Candidate",
      workClassification: "codex"
    }).id)
  );
  return { workspace, projectIds };
}

function declareCandidate(
  workspace: string,
  project: string,
  overrides: Partial<{ label: string; url: string; revision: string; pullRequest: string; procedure: string; summary: string; health: string }> = {}
) {
  return runQaTargetSetCommand({
    workspace,
    project,
    kind: "candidate",
    label: overrides.label ?? "River Copy Studio",
    url: overrides.url ?? "http://127.0.0.1:4321/river",
    revision: overrides.revision ?? "abc1234",
    pullRequest: overrides.pullRequest,
    procedure: overrides.procedure ?? "Open the studio, generate one draft, confirm it renders.",
    summary: overrides.summary,
    health: overrides.health
  }).data.target;
}

describe("proof target declaration", () => {
  it("declares a Candidate as unverified rather than assuming it is reachable", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now"]);
    const target = declareCandidate(workspace, projectIds[0]);

    expect(target.kind).toBe("candidate");
    expect(target.health_state).toBe("unverified");
    expect(target.health_checked_at).toBeNull();
  });

  it("updates the same row when a Candidate moves to a new revision", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now"]);
    const first = declareCandidate(workspace, projectIds[0]);
    const second = runQaTargetSetCommand({
      workspace,
      project: projectIds[0],
      kind: "candidate",
      label: "River Copy Studio",
      revision: "def5678"
    });

    expect(second.data.created).toBe(false);
    expect(second.data.target.id).toBe(first.id);
    expect(second.data.target.source_revision).toBe("def5678");
    // Untouched fields survive a partial update.
    expect(second.data.target.url).toBe(first.url);
  });

  it("refuses an unknown kind or verdict rather than guessing", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    expect(() => runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "production", label: "x"
    })).toThrow(/--kind must be one of/);
  });
});

describe("QA queue", () => {
  it("lists every active Project's Candidates and visibly separates them from Stable", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now", "Arcadia"]);
    declareCandidate(workspace, projectIds[0]);
    runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "stable", label: "PPN Stable",
      url: "http://192.168.86.38:3000", revision: "v1"
    });
    declareCandidate(workspace, projectIds[1], { label: "Arcadia Mission Control", url: "http://127.0.0.1:3020" });

    const snapshot = runQaQueueCommand({ workspace }).data.snapshot;

    expect(snapshot.projects.map((group) => group.projectName).sort()).toEqual([
      "Arcadia",
      "Private Practice Now"
    ]);
    const ppn = snapshot.projects.find((group) => group.projectName === "Private Practice Now")!;
    expect(ppn.candidates.map((row) => row.label)).toEqual(["River Copy Studio"]);
    expect(ppn.stable.map((row) => row.label)).toEqual(["PPN Stable"]);
    expect(snapshot.counts).toMatchObject({ candidates: 2, stable: 1 });
  });

  it("shows each Candidate's Project, revision, PR, link, procedure, and evidence state", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now"]);
    declareCandidate(workspace, projectIds[0], {
      pullRequest: "https://github.com/pmark/private-practice-now/pull/7",
      summary: "Adds the copy studio draft view."
    });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];

    expect(row).toMatchObject({
      projectName: "Private Practice Now",
      sourceRevision: "abc1234",
      pullRequestUrl: "https://github.com/pmark/private-practice-now/pull/7",
      url: "http://127.0.0.1:4321/river",
      changeSummary: "Adds the copy studio draft view.",
      evidenceFreshness: "none",
      primaryAction: "test-candidate"
    });
    expect(row.testProcedure).toContain("Open the studio");
    expect(row.statusLine).toContain("No QA verdict has been recorded");
  });

  it("reports an unconfigured target plainly instead of claiming a demo exists", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    runQaTargetSetCommand({ workspace, project: projectIds[0], kind: "candidate", label: "Unbuilt" });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];

    expect(row.testable).toBe(false);
    expect(row.url).toBeNull();
    expect(row.primaryAction).toBe("configure-target");
    expect(row.statusLine).toContain("nothing to demonstrate");
  });

  it("never claims reachability it has not recorded", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    declareCandidate(workspace, projectIds[0]);

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];

    expect(row.healthState).toBe("unverified");
    expect(row.healthCheckedAt).toBeNull();
    expect(row.statusLine).toContain("Reachability has not been verified");
  });

  it("routes a recorded-unreachable target to inspect-failure", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    declareCandidate(workspace, projectIds[0], { health: "unreachable" });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];

    expect(row.primaryAction).toBe("inspect-failure");
    expect(row.statusLine).toContain("unreachable");
  });

  it("orders the queue most urgent first, so it reads as a work order", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    declareCandidate(workspace, projectIds[0], { label: "Ready", revision: "r1" });
    declareCandidate(workspace, projectIds[0], { label: "Broken", revision: "r2", health: "unreachable" });
    runQaTargetSetCommand({ workspace, project: projectIds[0], kind: "candidate", label: "Unconfigured" });

    const labels = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates.map((row) => row.label);

    expect(labels).toEqual(["Unconfigured", "Broken", "Ready"]);
  });

  it("lists a Candidate for an incubating Project, since declaring it was the explicit act", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE projects SET status = 'incubating' WHERE id = ?").run(projectIds[0]);
    });
    declareCandidate(workspace, projectIds[0]);

    const snapshot = runQaQueueCommand({ workspace }).data.snapshot;
    expect(snapshot.projects[0].candidates.map((row) => row.label)).toEqual(["River Copy Studio"]);
  });

  it("treats Stable as the thing to show, never as something awaiting a verdict", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now"]);
    runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "stable", label: "PPN Stable",
      url: "http://192.168.86.38:3000", revision: "v1.4.0"
    });

    const snapshot = runQaQueueCommand({ workspace }).data.snapshot;
    const row = snapshot.projects[0].stable[0];
    expect(row.primaryAction).toBe("show-stable");
    expect(row.statusLine).toContain("not waiting on a QA verdict");
    expect(snapshot.counts.awaitingSignOff).toBe(0);
  });

  it("omits a retired target", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    declareCandidate(workspace, projectIds[0]);
    runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "candidate", label: "River Copy Studio", retire: true
    });

    expect(runQaQueueCommand({ workspace }).data.snapshot.projects).toEqual([]);
  });
});

describe("QA sign-off", () => {
  it("binds the verdict to the exact revision and records it as a resolved Decision", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Private Practice Now"]);
    const target = declareCandidate(workspace, projectIds[0]);

    const result = runQaSignOffCommand({
      workspace, targetId: target.id, verdict: "pass", note: "Draft rendered correctly."
    }).data;

    expect(result.signOff.source_revision).toBe("abc1234");
    expect(result.signOff.verdict).toBe("pass");
    withDatabase(workspace, (db) => {
      const review = getReviewItem(db, result.reviewItemId)!;
      expect(review.status).toBe("approved");
      expect(review.decision_note).toBe("Draft rendered correctly.");
      expect(review.decision_needed).toContain("abc1234");
      expect(JSON.parse(review.context_json)).toMatchObject({
        proofTargetId: target.id,
        sourceRevision: "abc1234",
        verdict: "pass"
      });
    });
  });

  it("maps fail and follow-up onto rejected and deferred Decisions", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const failing = declareCandidate(workspace, projectIds[0], { label: "A" });
    const pending = declareCandidate(workspace, projectIds[0], { label: "B" });

    const failed = runQaSignOffCommand({ workspace, targetId: failing.id, verdict: "fail" }).data;
    const deferred = runQaSignOffCommand({ workspace, targetId: pending.id, verdict: "follow-up" }).data;

    withDatabase(workspace, (db) => {
      expect(getReviewItem(db, failed.reviewItemId)!.status).toBe("rejected");
      expect(getReviewItem(db, deferred.reviewItemId)!.status).toBe("deferred");
    });
    expect(deferred.signOff.verdict).toBe("follow_up");
  });

  it("treats a verdict as current only for the revision it judged", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const target = declareCandidate(workspace, projectIds[0]);
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "pass" });

    const signedOff = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];
    expect(signedOff.evidenceFreshness).toBe("current");
    expect(signedOff.primaryAction).toBe("signed-off");

    // A new Candidate revision lands; the old pass must not carry over.
    runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "candidate", label: "River Copy Studio", revision: "def5678"
    });

    const moved = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];
    expect(moved.evidenceFreshness).toBe("stale");
    expect(moved.primaryAction).toBe("test-candidate");
    expect(moved.statusLine).toContain("does not carry over");
  });

  it("refuses to tie a verdict to a revision when neither side records one", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const target = runQaTargetSetCommand({
      workspace, project: projectIds[0], kind: "candidate", label: "Unversioned", url: "http://127.0.0.1:9999"
    }).data.target;
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "pass" });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];
    expect(row.evidenceFreshness).toBe("revision-unknown");
    expect(row.primaryAction).toBe("test-candidate");
    expect(row.statusLine).toContain("cannot be tied to what is deployed now");
  });

  it("surfaces a failing verdict as inspect-failure with the note", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const target = declareCandidate(workspace, projectIds[0]);
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "fail", note: "Draft view 500s." });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];
    expect(row.primaryAction).toBe("inspect-failure");
    expect(row.statusLine).toContain("Draft view 500s.");
    expect(runQaQueueCommand({ workspace }).data.snapshot.counts.failing).toBe(1);
  });

  it("keeps the newest verdict when a revision is judged more than once", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const target = declareCandidate(workspace, projectIds[0]);
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "fail", note: "First look." });
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "pass", note: "Fixed and re-checked." });

    const row = runQaQueueCommand({ workspace }).data.snapshot.projects[0].candidates[0];
    expect(row.latestSignOff?.verdict).toBe("pass");
    expect(row.primaryAction).toBe("signed-off");
  });

  it("does not merge, deploy, promote to Stable, or mark anything delivered", () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const target = declareCandidate(workspace, projectIds[0]);
    runQaSignOffCommand({ workspace, targetId: target.id, verdict: "pass" });

    withDatabase(workspace, (db) => {
      // The Candidate is still a Candidate; no Stable target appeared.
      const kinds = (db.prepare("SELECT kind FROM proof_targets").all() as Array<{ kind: string }>).map((row) => row.kind);
      expect(kinds).toEqual(["candidate"]);
      // Nothing was queued for execution off the back of a verdict.
      expect(db.prepare("SELECT COUNT(*) AS c FROM execution_runs").get()).toEqual({ c: 0 });
    });
  });

  it("refuses an unknown target", () => {
    const { workspace } = workspaceWithProjects(["Alpha"]);
    expect(() => runQaSignOffCommand({ workspace, targetId: "missing", verdict: "pass" }))
      .toThrow(/Proof target was not found/);
  });
});
