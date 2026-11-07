import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitForDiscord } from "../apps/discord-bot/src/digests/scheduler.js";
import { renderDigestBody } from "../src/commands/digest.js";
import { runOperatorInteractionRecordCommand } from "../src/commands/operatorInteraction.js";
import { openDatabase } from "../src/db/connection.js";
import {
  createMissionLog,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  setMissionLogDocRef,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { buildNarrativeDigestRequest } from "../src/digests/contract.js";
import { portfolioDigestSubject, previewDigest, projectDigestSubject } from "../src/digests/composer.js";
import { pressFromReceipt } from "../src/digests/operatorInteractions.js";
import { checkAiSummary, summaryFacts } from "../src/digests/report.js";
import type { DigestNarrator, DigestNeedsYou, DigestSummaryFacts, DigestWindow } from "../src/digests/types.js";
import { recordOperatorInteraction } from "../src/operatorInteractions/store.js";
import { ensureProductionPolicyTables } from "../src/production/policy.js";
import { ensureRedAlertTables } from "../src/production/redAlerts.js";
import { ensureWorkerMergeTable } from "../src/production/workerMerge.js";
import type { Project } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const WINDOW: DigestWindow = { period: "day", start: "2026-07-01T00:00:00.000Z", end: "2026-07-02T00:00:00.000Z" };
const NOW = new Date("2026-07-02T03:00:00.000Z");
const IN_WINDOW = "2026-07-01T10:00:00.000Z";
const NO_NEEDS: DigestNeedsYou = { items: [], unavailable: null, listLink: null };

const cleanup: string[] = [];
const open: Database.Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(names: string[] = ["Alpha"]): { db: Database.Database; workspace: string; projects: Project[] } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-digest-report-"));
  cleanup.push(workspace);
  initWorkspace(workspace);
  const db = openDatabase(workspace);
  open.push(db);
  ensureWorkerMergeTable(db);
  ensureRedAlertTables(db);
  ensureProductionPolicyTables(db);
  const projects = names.map((name) => upsertProject(db, {
    name,
    mission: `Ship ${name}.`,
    status: "active",
    currentMilestone: "Unused",
    nextAction: "Compose the digest",
    workClassification: "agent"
  }));
  return { db, workspace, projects };
}

function goal(db: Database.Database, project: Project, title: string, plan: string, status = "active"): string {
  const id = `milestone-${project.slug}-${plan}`;
  db.prepare(`INSERT INTO milestones (id, project_id, title, status, created_at, updated_at, doc_ref)
    VALUES (?, ?, ?, ?, '2026-06-01T00:00:00.000Z', ?, ?)`)
    .run(id, project.id, title, status, status === "completed" ? IN_WINDOW : "2026-06-01T00:00:00.000Z", `plan/${plan}`);
  return id;
}

/** One Action on a goal; `doneAt` marks it done at that instant (the completion proxy is updated_at). */
function action(db: Database.Database, project: Project, milestoneId: string, plan: string, actionId: string, doneAt?: string): void {
  const { workItem } = createWorkItemWithOptionalArtifact(db, {
    projectId: project.id,
    title: `Action ${actionId}`,
    rawInput: actionId,
    queue: "work_queue",
    workClassification: "agent",
    nextAction: "Do it."
  });
  db.prepare("UPDATE work_items SET milestone_id = ?, doc_ref = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(milestoneId, `plan/${plan}#${actionId}`, doneAt ? "done" : "open", doneAt ?? "2026-06-01T00:00:00.000Z", workItem.id);
}

function merged(db: Database.Database, project: Project, actionId: string, at: string, pr: number): void {
  db.prepare(`INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, boundaries_json, updated_at)
    VALUES (?, 'session', ?, ?, 'abc123', 'merged', NULL, 'merged', '[]', ?)`)
    .run(`merge-${actionId}`, `${project.slug}/${actionId}`, `https://github.com/example/repo/pull/${pr}`, at);
}

function aiNarrator(summary: string): DigestNarrator {
  return vi.fn<DigestNarrator>(async () => ({ summary, jobId: "job-1" }));
}

async function page(input: Parameters<typeof previewDigest>[0]): Promise<{ body: string; result: Awaited<ReturnType<typeof previewDigest>> }> {
  const result = await previewDigest(input);
  return { body: renderDigestBody(input.subject.name, input.window, result.narrative, "digest_fixture"), result };
}

/** A busy day: two Projects, a goal moving fast, another reached, merges, a Decision and a refused dispatch. */
function busyDay(): { db: Database.Database; workspace: string; projects: Project[] } {
  const { db, workspace, projects } = fixture(["Alpha", "Beta"]);
  const [alpha, beta] = projects as [Project, Project];
  const pins = goal(db, alpha, "Pin every untested surface in unattended production", "pins");
  for (const [index, id] of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].entries()) {
    action(db, alpha, pins, "pins", id, index < 3 ? `2026-06-2${index + 5}T12:00:00.000Z` : index < 6 ? IN_WINDOW : undefined);
  }
  merged(db, alpha, "a4", "2026-07-01T10:05:00.000Z", 101);
  merged(db, alpha, "a5", "2026-07-01T11:05:00.000Z", 102);
  const docs = goal(db, beta, "Docs sync ingests a real project", "docs", "completed");
  action(db, beta, docs, "docs", "b1", "2026-06-20T00:00:00.000Z");
  action(db, beta, docs, "docs", "b2", "2026-07-01T09:00:00.000Z");
  const decision = createReviewItem(db, {
    projectId: beta.id,
    decisionNeeded: "Approve the bounded change?",
    sourceInput: "test",
    proposedAction: "Approve",
    resolvedIntent: "Approval",
    confidenceLabel: "high",
    confidence: 1
  });
  db.prepare("UPDATE review_items SET created_at = ?, updated_at = ? WHERE id = ?").run(IN_WINDOW, IN_WINDOW, decision.id);
  db.prepare(`INSERT INTO dispatch_events (id, occurred_at, local_date, command, project_id, project_slug, plan_slug,
      action_id, dispatchable, blocker_count, blocker_fields, operator_question)
    VALUES ('dispatch-1', ?, '2026-07-01', 'next', ?, ?, 'pins', NULL, 0, 1, '["agent_ask"]', 0)`)
    .run(IN_WINDOW, alpha.id, alpha.slug);
  return { db, workspace, projects };
}

describe("digest page rendering", () => {
  it("busy day: progress by goal first, relative activity, risks only when present", async () => {
    const { db, projects } = busyDay();
    const { body, result } = await page({
      db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS,
      narrator: aiNarrator("Pinning moved fastest: 3 more Actions done and 2 merged, now 6 of 8. Docs sync reached its goal. Nothing waits on you.")
    });
    expect(result.summary.source).toBe("ai");
    expect(body).toMatchSnapshot();
    // Detail is behind the link, never inline.
    expect(body).not.toContain("## Detail");
    expect(body.length).toBeLessThan(2000);
  });

  it("quiet day: says plainly that nothing moved, and makes no model call", async () => {
    const { db, projects } = fixture(["Alpha"]);
    const [alpha] = projects as [Project];
    const pins = goal(db, alpha, "Pin every untested surface", "pins");
    action(db, alpha, pins, "pins", "a1");
    const narrator = aiNarrator("A spectacular day.");
    const { body } = await page({ db, subject: projectDigestSubject(alpha), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS, narrator });
    expect(narrator).not.toHaveBeenCalled();
    expect(body).toMatchSnapshot();
  });

  it("blocked-on-operator day: ranked items with one action, the link and the cost of waiting", async () => {
    const { db, projects } = fixture(["Alpha"]);
    const [alpha] = projects as [Project];
    const pins = goal(db, alpha, "Pin every untested surface", "pins");
    action(db, alpha, pins, "pins", "a1", "2026-06-29T12:00:00.000Z");
    action(db, alpha, pins, "pins", "a2", "2026-06-30T12:00:00.000Z");
    action(db, alpha, pins, "pins", "a3");
    db.prepare(`INSERT INTO production_red_alerts (id, alert_key, project_slug, action_key, session_id, trigger, detail, evidence_path,
        status, episode, occurrences, first_seen_at, last_seen_at)
      VALUES ('alert-1', 'k1', ?, ?, NULL, 'repair_budget_repeat', 'detail', 'evidence', 'open', 1, 1, '2026-07-01T21:00:00.000Z', '2026-07-01T23:00:00.000Z')`)
      .run(alpha.slug, `${alpha.slug}/a3`);
    db.prepare(`INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
      VALUES (?, 'build_packet_approval_pending', 'The previewed Action is not ready to launch.', NULL, '2026-07-01T22:00:00.000Z', '2026-07-01T23:00:00.000Z')`)
      .run(`${alpha.slug}/a3`);
    const needsYou: DigestNeedsYou = {
      listLink: "https://dash.example.ts.net/todo",
      unavailable: null,
      items: [
        {
          key: `escalation:build_packet_approval_pending:${alpha.slug}/a3`,
          kind: "escalation:build_packet_approval_pending",
          project: alpha.slug,
          title: "a3: The previewed Action is not ready to launch.",
          action: "arcadia review approve review_1 --no-execute",
          link: `https://dash.example.ts.net/todo/escalation%3Abuild_packet_approval_pending/${alpha.slug}/a3`,
          consequence: "the Action cannot launch until you approve.",
          stopped: true,
          createdAt: "2026-07-01T22:00:00.000Z"
        },
        {
          key: `decision:${alpha.slug}/0042`,
          kind: "decision",
          project: alpha.slug,
          title: "Decide whether unattended runs continue after a failed batch",
          action: `arcadia decision approve 0042 --project ${alpha.slug} --answer "<answer>"`,
          link: `https://dash.example.ts.net/todo/decision/${alpha.slug}/0042`,
          consequence: "the work this Decision gates stays held.",
          stopped: false,
          createdAt: "2026-07-01T20:00:00.000Z"
        }
      ]
    };
    const { body } = await page({ db, subject: projectDigestSubject(alpha), projects, window: WINDOW, now: NOW, needsYou, narrator: aiNarrator("x") });
    expect(body).toMatchSnapshot();
    expect(body).toContain("**Risks and stalls**");
  });

  it("says when the to-do list could not be read instead of claiming nothing needs you", async () => {
    const { db, projects } = fixture(["Alpha"]);
    const { body } = await page({
      db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW,
      needsYou: { items: [], unavailable: "database is locked", listLink: null }
    });
    expect(body).toContain("Could not read the to-do list: database is locked");
    expect(body).not.toContain("**Needs you**\nNothing.");
  });
});

describe("AI summary", () => {
  it("receives exactly the computed facts, and no raw record text", async () => {
    const { db, projects } = busyDay();
    const [alpha] = projects as [Project];
    const log = createMissionLog(db, {
      projectId: alpha.id,
      workPerformed: "SECRET-LOG-TEXT the parser rewrite.",
      result: "Focused tests passed.",
      nextAction: "Review it.",
      markdownPath: "MISSION_LOG.md"
    });
    setMissionLogDocRef(db, log.id, `log/${alpha.slug}#2026-07-01--parser`);
    const narrator = vi.fn<DigestNarrator>(async () => ({ summary: "Pinning moved.", jobId: null }));

    const { result } = await page({ db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS, narrator });

    expect(narrator).toHaveBeenCalledTimes(1);
    const sent = narrator.mock.calls[0][0].facts;
    expect(sent).toEqual(summaryFacts(result.report));
    const request = buildNarrativeDigestRequest({ subject: portfolioDigestSubject(), window: WINDOW, facts: sent });
    expect(Object.keys(request.input as object).sort()).toEqual(["facts", "instructions"]);
    expect((request.input as { facts: unknown }).facts).toEqual(sent);
    // The mission log text is a raw record; it reaches the page's detail, never the model.
    expect(JSON.stringify(request)).not.toContain("SECRET-LOG-TEXT");
    expect(result.facts.some((fact) => fact.summary.includes("SECRET-LOG-TEXT"))).toBe(true);
  });

  it("falls back to the computed summary, labelled, when the service is unavailable", async () => {
    const { db, projects } = busyDay();
    const narrator: DigestNarrator = async () => { throw new Error("Cannot reach the local model (LITELLM_UNAVAILABLE)"); };
    const { body, result } = await page({ db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS, narrator });
    expect(result.summary).toMatchObject({ source: "deterministic", fallbackReason: "Cannot reach the local model (LITELLM_UNAVAILABLE)" });
    expect(body).toContain("**Summary** · _Computed; AI summary unavailable_");
    expect(body).toContain("4 Actions finished and 2 merged across 2 goals.");
  });

  it("refuses a model summary that states a number the facts do not contain", async () => {
    const { db, projects } = busyDay();
    const { result } = await page({
      db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS,
      narrator: aiNarrator("Pinning finished 17 Actions.")
    });
    expect(result.summary.source).toBe("deterministic");
    expect(result.summary.fallbackReason).toContain("stated 17");
  });

  it("checks numbers against the facts only", () => {
    const facts = { totals: { completed: 3 }, windowLabel: "2026-07-01" } as unknown as DigestSummaryFacts;
    expect(checkAiSummary("3 Actions finished.", facts)).toEqual({ ok: true, text: "3 Actions finished." });
    expect(checkAiSummary("4 Actions finished.", facts)).toMatchObject({ ok: false });
    expect(checkAiSummary("   ", facts)).toMatchObject({ ok: false });
  });
});

describe("operator interactions", () => {
  function receipt(root: string, card: string, run: string, body: Record<string, unknown>): void {
    const dir = path.join(root, "artifacts", "generated", "operator-scripts", "runs", card, run);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "receipt.json"), JSON.stringify({ id: card, runId: run, ...body }));
  }

  it("counts operator presses, dashboard Offs and recorded words; never delegated presses or preflights", async () => {
    const { db, workspace, projects } = busyDay();
    const [alpha] = projects as [Project];
    const repo = mkdtempSync(path.join(tmpdir(), "arcadia-digest-repo-"));
    cleanup.push(repo);
    upsertProjectMetadata(db, { projectId: alpha.id, repoPath: repo });
    receipt(repo, "day-grant-a", "r1", {
      schema: "arcadia-day-grant-receipt-v1", mode: "run", outcome: "approved", startedAt: "2026-07-01T06:00:00Z",
      record: { project: alpha.slug, plan: "pins", windowClosesAt: "2026-07-02T06:00:00.000Z", authority: "The operator's own press" }
    });
    receipt(repo, "day-grant-a", "r0", { schema: "arcadia-day-grant-receipt-v1", mode: "preflight", outcome: "preflight_ok", startedAt: "2026-07-01T05:59:00Z", record: { project: alpha.slug } });
    receipt(repo, "start-run-b2", "r2", {
      schema: "arcadia-start-run-receipt-v1", mode: "run", outcome: "succeeded", startedAt: "2026-07-01T09:00:00Z",
      record: { project: alpha.slug, plan: "pins", actionIds: ["a4", "a5"], delegation: { decision: "0173" }, authority: "Rowan's delegated press" }
    });
    receipt(repo, "start-run-b3", "r3", {
      schema: "arcadia-start-run-receipt-v1", mode: "run", outcome: "refused", reason: "stale preview", startedAt: "2026-07-01T12:00:00Z",
      record: { project: alpha.slug }
    });
    receipt(repo, "start-run-old", "r4", { schema: "arcadia-start-run-receipt-v1", mode: "run", outcome: "succeeded", startedAt: "2026-06-20T12:00:00Z", record: { project: alpha.slug } });
    db.prepare(`INSERT INTO production_policy_receipts (id, request_id, transition, revision_before, revision_after, epoch_after, receipt_json, created_at)
      VALUES ('p1', 'dashboard-toggle-1', 'deactivate', 1, 2, 1, '{}', '2026-07-01T13:00:00.000Z'),
             ('p2', 'rowan-off-batch', 'deactivate', 2, 3, 1, '{}', '2026-07-01T14:00:00.000Z')`).run();
    expect(workspace).toBeTruthy();
    runOperatorInteractionRecordCommand({
      workspace, words: "Yes merge them", unlocked: "merge of PRs #101 and #102", required: true,
      ref: "#101", project: alpha.slug, at: "2026-07-01T10:00:00.000Z", waitingSince: "2026-07-01T09:30:00.000Z", now: NOW
    });

    const { body, result } = await page({ db, subject: portfolioDigestSubject(), projects, window: WINDOW, now: NOW, needsYou: NO_NEEDS });
    const interactions = result.report.operatorInteractions;
    expect(interactions.items.map((item) => [item.source, item.necessity, item.ref])).toEqual([
      ["card_press", "required", "day-grant-a/r1"],
      ["recorded", "required", "#101"],
      ["card_press", "avoidable", "start-run-b3/r3"],
      ["production_off", "required", "dashboard-toggle-1"]
    ]);
    expect(interactions).toMatchObject({ count: 4, required: 3, avoidable: 1, perMerged: 2, waitedMinutes: 30 });
    expect(body).toContain("**Operator interactions** · 4 (3 required, 1 avoidable)");
    expect(body).toContain("2 per merged Action · work waited on you 30m in total");
    expect(result.report.operatorInteractions.limitations.join(" ")).toContain("GitHub merges are not counted from GitHub");
  });

  it("reads a press receipt as the operator's only when it carries no delegation", () => {
    expect(pressFromReceipt({ schema: "arcadia-start-run-receipt-v1", mode: "run", outcome: "succeeded", startedAt: IN_WINDOW, record: {} }))
      .toMatchObject({ necessity: "required", source: "card_press" });
    expect(pressFromReceipt({ schema: "arcadia-start-run-receipt-v1", mode: "run", startedAt: IN_WINDOW, record: { authority: "Rowan's delegated press" } })).toBeNull();
    expect(pressFromReceipt({ schema: "arcadia-start-run-receipt-v1", mode: "preflight", startedAt: IN_WINDOW })).toBeNull();
    expect(pressFromReceipt({ schema: "arcadia-agent-ask-settlement-receipt-v1", startedAt: IN_WINDOW })).toBeNull();
  });

  it("records append-only: a replay returns the same row, and bad input is refused", () => {
    const { db } = fixture(["Alpha"]);
    const first = recordOperatorInteraction(db, { words: "1A", unlocked: "Decision 0181 answered", necessity: "required", at: IN_WINDOW, now: NOW });
    const replay = recordOperatorInteraction(db, { words: "1A", unlocked: "something else", necessity: "avoidable", at: IN_WINDOW, now: NOW });
    expect(first.created).toBe(true);
    expect(replay).toEqual({ interaction: first.interaction, created: false });
    expect(() => recordOperatorInteraction(db, { words: " ", unlocked: "x", necessity: "required", now: NOW })).toThrow(/exact words/);
    expect(() => recordOperatorInteraction(db, { words: "ok", unlocked: "x", necessity: "maybe", now: NOW })).toThrow(/required/);
    expect(() => recordOperatorInteraction(db, { words: "ok", unlocked: "x", necessity: "required", at: "2026-07-01T10:00:00Z", waitingSince: "2026-07-01T11:00:00Z", now: NOW })).toThrow(/waiting-since/);
  });
});

describe("Discord delivery of a long page", () => {
  it("splits between sections, never inside one, and keeps every part under the limit", () => {
    const section = (name: string, lines: number) =>
      [`**${name}**`, ...Array.from({ length: lines }, (_, i) => `${name} line ${i} ${"x".repeat(60)}`)].join("\n");
    const body = [section("Summary", 2), section("Needs you", 14), section("Operator interactions", 10), section("Where activity happened", 6)].join("\n\n");
    const parts = splitForDiscord(body, "digest_fixture");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(parts.join("\n\n")).toBe(body);
    expect(splitForDiscord("short", "digest_fixture")).toEqual(["short"]);
  });
});
