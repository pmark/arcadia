import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";
import { runTimelineCommand, runTimelineFollow } from "../src/commands/timeline.js";
import { collectRepositoryGit } from "../src/timeline/collectors/git.js";
import { collectGovernedRecords } from "../src/timeline/collectors/governed.js";
import { collectTimeline, pointInTime, type TimelineCollection, type TimelineEvent } from "../src/timeline/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

/**
 * Every collector against a temporary Project repository with a codex
 * worktree and a temporary workspace database seeded with one row of each
 * source. No live data: the fixture is built here.
 */

let root: string;
let workspace: string;
let repo: string;
let worktree: string;
let databaseFile: string;
let settleSha: string;
let agentSha: string;
let squashSha: string;
let window: { since: Date; until: Date };
let collection: TimelineCollection;

const OPERATOR_EMAIL = "operator@example.invalid";

/** Fixture Git ignores the developer's global and system config (signing, hooks, templates). */
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/**
 * Recent Git (2.55 on CI) has every commit start `git maintenance run --auto --detach`,
 * which runs `git worktree prune`. In the symlinked-admin test that prune
 * follows `.git/worktrees/linked` and deletes the fixture's `elsewhere/`
 * while the test is still building it (Issue #1154, Linux CI).
 */
function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "maintenance.auto=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...ISOLATED_GIT, ...env } }).trim();
}

const agentEnv = (name: string) => {
  const email = `${name.toLowerCase().replace(" ", ".")}@agents.arcadia.local`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
};

const plan = (a1: string, pointer: string) =>
  `---\narcadia: v1\ntype: plan\nslug: demo-plan\nproject: demo\nstatus: active\nactions:\n  - id: a1\n    title: First\n    status: ${a1}\n  - id: a2\n    title: Second\n    status: open\ncurrent_action: ${pointer}\n---\n\n# Demo plan\n`;
const project = (pointer: string) => `---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\nactive_plan: demo-plan\ncurrent_action: ${pointer}\n---\n\n# Demo\n`;

let counter = 0;
/** Inserts a row, filling NOT NULL columns the test does not care about with unique placeholders. */
function insert(db: Database.Database, table: string, values: Record<string, unknown>): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string; pk: number }>;
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name];
    else if ((column.notnull || column.pk) && column.dflt_value === null) row[column.name] = /INT/i.test(column.type) ? 1 : `${column.name}-${++counter}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`).run(row);
}

function fingerprint(): Record<string, string> {
  const files: Record<string, string> = {};
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else files[full] = `${stat.mtimeMs}:${hash(full)}`;
    }
  };
  walk(path.join(workspace, "database"));
  walk(path.join(repo, ".git"));
  // SQLite's WAL index is written by every reader, read-only ones included; a read-only open with no
  // other connection leaves an empty -wal and a -shm behind. The database itself must not change.
  for (const file of Object.keys(files)) {
    if (file.endsWith("-shm")) delete files[file];
    if (file.endsWith("-wal")) {
      expect(statSync(file).size, "a read-only reader never writes WAL frames").toBe(0);
      delete files[file];
    }
  }
  return files;
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-timeline-")));
  workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  databaseFile = getWorkspacePaths(workspace).databaseFile;

  repo = path.join(root, "demo");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Operator"]);
  git(repo, ["config", "user.email", OPERATOR_EMAIL]);
  writeFileSync(path.join(repo, "PROJECT.md"), project("a1"));
  writeFileSync(path.join(repo, "docs", "plans", "demo-plan.md"), plan("open", "a1"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: seed demo"]);

  worktree = path.join(root, "home", ".codex", "worktrees", "a2-20261006T010203000Z", "demo");
  mkdirSync(path.dirname(worktree), { recursive: true });
  git(repo, ["worktree", "add", "-q", "-b", "codex/a2-20261006T010203000Z", worktree, "main"], agentEnv("Cody Mason"));
  writeFileSync(path.join(worktree, "feature.txt"), "work\n");
  git(worktree, ["add", "feature.txt"]);
  git(worktree, ["commit", "-q", "-m", "feat: build a2"], agentEnv("Cody Mason"));
  agentSha = git(worktree, ["rev-parse", "HEAD"]);

  writeFileSync(path.join(repo, "PROJECT.md"), project("a2"));
  writeFileSync(path.join(repo, "docs", "plans", "demo-plan.md"), plan("done", "a2"));
  git(repo, ["commit", "-q", "-am", "chore(arcadia): settle complete-a1"]);
  settleSha = git(repo, ["rev-parse", "HEAD"]);

  writeFileSync(path.join(repo, "squashed.txt"), "squash\n");
  git(repo, ["add", "squashed.txt"]);
  git(repo, ["commit", "-q", "-m", "feat: land a2 (#12)", "-m", "Co-authored-by: Claudia Atlas <claudia.atlas@agents.arcadia.local>"], {
    GIT_AUTHOR_NAME: "Operator",
    GIT_AUTHOR_EMAIL: "operator-github@example.invalid",
    GIT_COMMITTER_NAME: "GitHub",
    GIT_COMMITTER_EMAIL: "noreply@github.com"
  });
  squashSha = git(repo, ["rev-parse", "HEAD"]);

  const runs = path.join(repo, "artifacts", "generated", "operator-scripts", "runs", "20261006T010000Z-1");
  mkdirSync(runs, { recursive: true });
  const now = new Date();
  const at = (offsetSeconds: number) => new Date(now.getTime() + offsetSeconds * 1000).toISOString();
  writeFileSync(path.join(runs, "receipt.json"), JSON.stringify({ schema: "arcadia-operator-run-receipt-v1", id: "grant-demo", runId: "20261006T010000Z-1", startedAt: at(-50), finishedAt: at(-40), outcome: "succeeded", stage: "complete" }));
  // A second, later run of the same script is its own event and is not linked to the policy receipt.
  const rerun = path.join(repo, "artifacts", "generated", "operator-scripts", "runs", "20261006T010500Z-2");
  mkdirSync(rerun, { recursive: true });
  writeFileSync(path.join(rerun, "receipt.json"), JSON.stringify({ schema: "arcadia-operator-run-receipt-v1", id: "grant-demo", runId: "20261006T010500Z-2", startedAt: at(-30), finishedAt: at(-20), outcome: "succeeded", stage: "complete" }));

  const db = new Database(databaseFile);
  // The fixture seeds one row per source without the rows those reference.
  db.pragma("foreign_keys = OFF");
  try {
    insert(db, "projects", { id: "proj_demo", slug: "demo", name: "Demo", mission: "m", status: "active", created_at: at(-3600), updated_at: at(-3600) });
    insert(db, "project_metadata", { project_id: "proj_demo", repo_path: repo, created_at: at(-3600), updated_at: at(-3600) });
    insert(db, "projects", { id: "proj_broken", slug: "broken", name: "Broken", mission: "m", status: "active", created_at: at(-3600), updated_at: at(-3600) });
    const notGit = path.join(root, "not-a-repo");
    mkdirSync(notGit);
    insert(db, "project_metadata", { project_id: "proj_broken", repo_path: notGit, created_at: at(-3600), updated_at: at(-3600) });
    insert(db, "agent_sessions", {
      id: "session_1", project_id: "proj_demo", project_slug: "demo", plan_slug: "demo-plan", action_id: "a2", provider: "claude-code-cli", model: "unregistered-model", effort: "e2_standard",
      branch: "claude/a2-20261006T010203000Z", worktree_path: "/h/.claude/worktrees/a2-20261006T010203000Z/demo", display_name: "x", terminal_transport: "tmux", status: "completed",
      prepared_at: at(-600), started_at: at(-590), ended_at: at(-300), created_at: at(-600), updated_at: at(-300)
    });
    insert(db, "session_role_attempts", { id: "role_1", requirement_id: "demo/demo-plan/a2", input_revision: "r", role: "qa", ordinal: 1, request_id: "role-req-1", actor_id: "qa-reviewer:codex-terra", mutation_owner: 0, status: "failed", created_at: at(-280), updated_at: at(-270) });
    insert(db, "agent_ask_proposals", { id: "proposal_1", request_id: "complete-a1", capture_id: "capture_1", fingerprint: "f", format: "strict", intent_kind: "complete", project_ref: "demo", proposal_json: "{}", created_at: at(-200) });
    insert(db, "agent_ask_settlements", {
      id: "settlement_1", proposal_id: "proposal_1", request_id: "settle-complete-a1", operation_json: "{}", fingerprint: "f", disposition: "accepted", project_slug: "demo",
      effects_json: JSON.stringify(["Marked Action demo/a1 done with accepted evidence."]), queue_action_key: "demo/a1", notification_status: "sent", notified_at: at(-150),
      receipt_json: JSON.stringify({ intent: "complete", documentsCommit: settleSha, authority: { kind: "operator_acceptance" } }), created_at: at(-190)
    });
    insert(db, "review_items", { id: "review_1", slug: "R1", project_id: "proj_demo", status: "open", decision_needed: "Should demo ship?", source_input: "s", proposed_action: "p", resolved_intent: "r", confidence_label: "high", confidence: 1, created_at: at(-180), updated_at: at(-180) });
    // Opened inside the window, decided after its end: only the opening may stream.
    insert(db, "review_items", { id: "review_2", slug: "R2", project_id: "proj_demo", status: "approved", decision_needed: "Later?", source_input: "s", proposed_action: "p", resolved_intent: "r", confidence_label: "high", confidence: 1, created_at: at(-170), updated_at: at(7200), decided_at: at(7200) });
    insert(db, "candidate_preservation_receipts", { id: "presv_1", request_id: "presv-req-1", repository_path: repo, candidate_worktree_path: worktree, branch: "codex/a2-20261006T010203000Z", base_branch: "main", base_revision: "b", action_id: "a2", packet_sha256: "p", policy_epoch: 1, policy_revision: 1, candidate_fingerprint: "f", commit_sha: agentSha, preservation_state: "PUSHED", receipt_json: "{}", created_at: at(-60) });
    insert(db, "events", { id: "event_1", event_type: "managed_production.base_branch_advanced", source_module: "managed_production_tick", project_id: "proj_demo", payload_json: JSON.stringify({ projectSlug: "demo", baseBranch: "main", newSha: settleSha }), created_at: at(-170) });
    insert(db, "production_policy_receipts", { id: "policy_1", request_id: "policy-req-1", transition: "activate", revision_before: 1, revision_after: 2, epoch_after: 3, receipt_json: JSON.stringify({ authority: { grantedBy: "The Operator", requestId: "grant-demo" } }), created_at: at(-45) });
    insert(db, "production_operator_escalations", { action_key: "demo/a2", kind: "independent_verdict_failed", message: "QA failed.", first_detected_at: at(-260), last_seen_at: at(-100) });
    insert(db, "operator_pings", { id: "ping_1", message: "Look at PR 12", kind: "look", agent: "Claudia Atlas", status: "sent", created_at: at(-120), sent_at: at(-119) });
    insert(db, "action_queue_pointer_receipts", { id: "pointer_1", request_id: "make-next-a2", action_key: "demo/a2", fingerprint: "f", queue_revision: 2, repo_root: repo, head_before: settleSha, receipt_json: JSON.stringify({ previousAction: "a1", planPath: "docs/plans/demo-plan.md" }), created_at: at(-110) });
  } finally {
    db.close();
  }

  window = { since: new Date(now.getTime() - 3_600_000), until: new Date(now.getTime() + 3_600_000) };
  const before = fingerprint();
  collection = await collectTimeline({ workspacePath: workspace, window, now });
  // Strictly read-only: neither the workspace database files nor the repository's Git directory changed.
  expect(fingerprint()).toEqual(before);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const find = (predicate: (event: TimelineEvent) => boolean) => collection.events.find(predicate);
const byKind = (kind: string) => collection.raw.filter((event) => event.kind === kind);

describe("timeline collectors on a fixture workspace", () => {
  it("reads every source and reports each one's timing", () => {
    const sources = new Set(collection.sources.map((source) => source.source));
    for (const source of ["git", "governed-records", "sessions", "asks", "decisions", "events", "production", "queue", "pings", "operator-scripts"]) {
      expect(sources, source).toContain(source);
    }
    expect(collection.sources.every((source) => source.durationMs >= 0)).toBe(true);
  });

  it("git: attributes a worktree commit to its tool and identity through the worktree reflog", () => {
    const commit = find((event) => event.subjects.commit === agentSha && event.kind === "git.commit");
    expect(commit?.actor).toMatchObject({ tool: "codex", name: "Cody Mason", tier: "standard", confidence: "high" });
    expect(commit?.subjects).toMatchObject({ project: "demo", worktree: worktree, branch: "codex/a2-20261006T010203000Z", action: "a2" });
    expect(commit?.provenance.worktree).toContain("reflog");
    expect(byKind("git.worktree.created")).toContainEqual(expect.objectContaining({ subjects: expect.objectContaining({ worktree }) }));
  });

  it("git: reads a GitHub squash merge as integrate, actor from the co-author trailer, account kept separate", () => {
    const squash = find((event) => event.subjects.commit === squashSha);
    expect(squash).toMatchObject({ kind: "git.merge", workKind: "integrate" });
    expect(squash?.actor).toMatchObject({ tool: "claude-code", name: "Claudia Atlas", confidence: "medium" });
    expect(squash?.actor.account).toContain("withheld");
    expect(squash?.subjects.pullRequest).toBe("#12");
  });

  it("governed records: derives Action done and the pointer move from the settle commit", () => {
    const facts = collection.raw.filter((event) => event.source === "governed-records" && event.subjects.commit === settleSha);
    expect(facts.map((event) => event.kind).sort()).toEqual(["record.action.done", "record.plan.pointer_moved", "record.project.pointer_moved"]);
    const seed = collection.raw.filter((event) => event.source === "governed-records" && event.subjects.commit !== settleSha);
    expect(seed.map((event) => event.kind).sort()).toEqual([
      "record.action.created", "record.action.created", "record.plan.created", "record.project.plan_activated", "record.project.pointer_moved"
    ]);
  });

  it("de-duplicates the settlement, its commit, its facts, the worker's observation and the notification into one event", () => {
    const settled = find((event) => event.kind === "ask.settled");
    expect(settled).toBeDefined();
    const aliases = settled?.alsoSeenAs.map((alias) => alias.kind) ?? [];
    expect(aliases).toEqual(expect.arrayContaining(["ask.proposed", "git.commit", "record.action.done", "event.base_branch_advanced", "notification.settlement_sent"]));
    expect(collection.events.filter((event) => event.subjects.commit === settleSha && event.kind === "git.commit")).toEqual([]);
    expect(settled?.actor).toMatchObject({ tool: "operator", confidence: "low" });
    expect(settled?.subjects).toMatchObject({ project: "demo", action: "a1", ask: "complete-a1", commit: settleSha });
  });

  it("sessions: recovers tool, tier and name from the Session row; role attempts carry their role", () => {
    const started = find((event) => event.kind === "session.started");
    expect(started?.actor).toMatchObject({ tool: "claude-code", name: "Claudia Mason", tier: "standard" });
    expect(find((event) => event.kind === "session.prepared")?.actor.tool).toBe("host-worker");
    const qa = collection.raw.filter((event) => event.kind === "role.qa");
    expect(qa.map((event) => event.summary)).toEqual(expect.arrayContaining(["QA failed on a2"]));
    expect(qa.find((event) => event.summary === "QA failed on a2")).toMatchObject({ workKind: "verify", attention: true, actor: expect.objectContaining({ tool: "codex" }) });
  });

  it("decisions, production, queue, pings and operator scripts each contribute their events", () => {
    expect(find((event) => event.kind === "decision.review_item.opened")).toMatchObject({ attention: true, subjects: expect.objectContaining({ project: "demo", decision: "R1" }) });
    expect(find((event) => event.kind === "production.escalation")).toMatchObject({ attention: true, workKind: "operate" });
    const grant = find((event) => event.kind === "operator-script.run");
    expect(grant?.actor.tool).toBe("operator");
    expect(grant?.alsoSeenAs.map((alias) => alias.kind)).toContain("production.policy.activate");
    expect(find((event) => event.kind === "ping.created")?.actor).toMatchObject({ tool: "claude-code", name: "Claudia Atlas" });
    const pointer = collection.events.find((event) => event.alsoSeenAs.some((alias) => alias.kind === "queue.pointer_moved") || event.kind === "queue.pointer_moved");
    expect(pointer).toBeDefined();
  });

  it("never puts a human's email address into the stream", () => {
    const text = JSON.stringify(collection.events);
    expect(text).not.toContain("operator-github@example.invalid");
    expect(text).not.toContain(OPERATOR_EMAIL);
    expect(text).not.toContain("The Operator");
  });

  it("skips a symlinked worktree admin directory and a FIFO where a reflog should be", () => {
    const other = path.join(root, "other");
    mkdirSync(other);
    git(other, ["init", "-q", "-b", "main"]);
    git(other, ["commit", "-q", "--allow-empty", "-m", "seed"], agentEnv("Owen Mason"));
    const admin = path.join(other, ".git", "worktrees");
    mkdirSync(admin, { recursive: true });
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(path.join(elsewhere, "logs"), { recursive: true });
    writeFileSync(path.join(elsewhere, "gitdir"), `${path.join(root, "nowhere", ".git")}\n`);
    symlinkSync(elsewhere, path.join(admin, "linked"));
    execFileSync("mkfifo", [path.join(elsewhere, "logs", "HEAD")]);
    rmSync(path.join(other, ".git", "logs", "HEAD"));
    execFileSync("mkfifo", [path.join(other, ".git", "logs", "HEAD")]);
    const context = { workspacePath: workspace, db: null, repositories: [], projectSlugById: new Map(), operatorEmails: new Set<string>(), window, maxPerSource: 100, now: new Date(), git: (cwd: string, args: string[]) => ({ ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8" }), stderr: "" }), includePullRequests: false, gh: () => ({ ok: false, stdout: "", stderr: "offline" }) };
    const events = collectRepositoryGit({ projectSlug: "other", projectId: "proj_other", path: other }, context);
    expect(events.some((event) => event.subjects.worktree?.includes("nowhere"))).toBe(false);
    expect(events.filter((event) => event.kind === "git.commit")).toHaveLength(1);
  });

  it("streams only events inside the window, even when a row has a stage outside it", () => {
    expect(find((event) => event.id === "decisions:review:review_2:opened")).toMatchObject({ attention: true });
    expect(collection.raw.find((event) => event.id === "decisions:review:review_2:decided")).toBeUndefined();
    for (const event of collection.raw) {
      if (event.kind === "source_error") continue;
      expect(event.time >= window.since.toISOString() && event.time <= window.until.toISOString(), event.id).toBe(true);
    }
  });

  it("keeps each operator-script run, linking only the first succeeded run to its Grant's policy receipt", () => {
    const runs = collection.events.filter((event) => event.kind === "operator-script.run");
    expect(runs.map((event) => event.id).sort()).toEqual(["operator-scripts:demo:20261006T010000Z-1", "operator-scripts:demo:20261006T010500Z-2"]);
    expect(runs.find((event) => event.id.endsWith("Z-1"))?.alsoSeenAs.map((alias) => alias.kind)).toEqual(["production.policy.activate"]);
    expect(runs.find((event) => event.id.endsWith("Z-2"))?.alsoSeenAs).toEqual([]);
  });

  it("keeps a preservation receipt and the agent's commit as separate facts", () => {
    expect(find((event) => event.kind === "production.preservation")).toMatchObject({ subjects: expect.objectContaining({ commit: agentSha }), alsoSeenAs: [] });
    expect(find((event) => event.kind === "git.commit" && event.subjects.commit === agentSha)).toBeDefined();
  });

  it("says so when a source hits its cap", async () => {
    const capped = await collectTimeline({ workspacePath: workspace, window, maxPerSource: 1 });
    const notices = capped.events.filter((event) => event.kind === "source.truncated");
    expect(notices.map((event) => event.summary)).toEqual(expect.arrayContaining([expect.stringContaining("review_items")]));
  });

  it("keeps streaming the database sources when the repository list cannot be read", async () => {
    const odd = path.join(root, "odd-workspace");
    mkdirSync(path.dirname(getWorkspacePaths(odd).databaseFile), { recursive: true });
    const db = new Database(getWorkspacePaths(odd).databaseFile);
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE operator_pings (id TEXT, message TEXT, kind TEXT, channel TEXT, agent TEXT, status TEXT, created_at TEXT, sent_at TEXT)");
    db.prepare("INSERT INTO operator_pings VALUES ('p1', 'hello', 'fyi', NULL, NULL, 'sent', ?, NULL)").run(new Date().toISOString());
    db.close();
    const result = await collectTimeline({ workspacePath: odd, window });
    expect(result.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["source_error", "ping.created"]));
    expect(result.sources.find((source) => source.describe === "project repositories")?.error).toBeTruthy();
  });

  it("turns an unreadable source into a source_error event and keeps streaming", () => {
    const error = find((event) => event.kind === "source_error" && event.summary.includes("broken"));
    expect(error).toMatchObject({ source: "timeline", workKind: "observe" });
    expect(collection.sources.find((source) => source.describe.startsWith("git broken"))?.error).toContain("Not a readable Git repository");
    expect(collection.events.length).toBeGreaterThan(10);
  });

  it("orders the stream deterministically and gives every event provenance", () => {
    const times = collection.events.map((event) => event.time);
    expect([...times].sort()).toEqual(times);
    for (const event of collection.events) expect(event.provenance.event, event.id).toBeTruthy();
  });

  it("rewinds to a past time from the same events", () => {
    const asOf = new Date(new Date(find((event) => event.kind === "session.started")?.time ?? 0).getTime() + 1000);
    const view = pointInTime(collection, asOf);
    expect(view.activeSessions).toEqual([expect.objectContaining({ session: "session_1", tool: "claude-code" })]);
    expect(view.production.state).toBe("unknown");
  });

  it("filters by window, project, tool and kind", async () => {
    const narrow = await collectTimeline({ workspacePath: workspace, window: { since: window.until, until: new Date(window.until.getTime() + 1000) } });
    expect(narrow.events.filter((event) => event.kind !== "source_error")).toEqual([]);
    const codex = await collectTimeline({ workspacePath: workspace, window, filters: { tool: "codex" } });
    expect(codex.events.every((event) => event.actor.tool === "codex" || event.kind === "source_error")).toBe(true);
    expect(codex.events.length).toBeGreaterThan(0);
    const verify = await collectTimeline({ workspacePath: workspace, window, filters: { kind: "verify", project: "demo" } });
    expect(verify.events.filter((event) => event.kind !== "source_error").every((event) => event.workKind === "verify" && event.subjects.project === "demo")).toBe(true);
    expect(verify.sources.some((source) => source.describe.startsWith("git broken"))).toBe(false);
  });

  it("reports a missing workspace database as a source_error, not a crash", async () => {
    const empty = path.join(root, "empty-workspace");
    mkdirSync(empty);
    const result = await collectTimeline({ workspacePath: empty, window });
    expect(result.events).toEqual([expect.objectContaining({ kind: "source_error" })]);
  });

  it("collectors stand alone with injected runners", () => {
    const context = { workspacePath: workspace, db: null, repositories: [], projectSlugById: new Map(), operatorEmails: new Set([OPERATOR_EMAIL]), window, maxPerSource: 1, now: new Date(), git: (cwd: string, args: string[]) => {
      const result = execFileSync("git", args, { cwd, encoding: "utf8" });
      return { ok: true, stdout: result, stderr: "" };
    }, includePullRequests: false, gh: () => ({ ok: false, stdout: "", stderr: "offline" }) };
    const repository = { projectSlug: "demo", projectId: "proj_demo", path: repo };
    const events = collectRepositoryGit(repository, context);
    expect(events.filter((event) => event.kind === "source.truncated")).toHaveLength(1);
    expect(collectGovernedRecords(repository, { ...context, maxPerSource: 100 }).length).toBe(8);
  });
});

describe("arcadia timeline command", () => {
  async function runCli(args: string[]): Promise<string> {
    let out = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
    try {
      await buildProgram().parseAsync(["node", "arcadia", ...args]);
    } finally {
      write.mockRestore();
      process.exitCode = undefined;
    }
    return out;
  }

  it("emits the CLI envelope with --json", async () => {
    const out = await runCli(["timeline", "--workspace", workspace, "--since", "2h", "--json"]);
    const parsed = JSON.parse(out) as { ok: boolean; command: string; data: { events: TimelineEvent[]; sources: unknown[]; total: number; window: { since: string } } };
    expect(parsed).toMatchObject({ ok: true, command: "timeline" });
    expect(parsed.data.events.length).toBe(parsed.data.total);
    expect(parsed.data.events[0]).toMatchObject({ schema: "arcadia-timeline-event-v1" });
  });

  it("emits one event per line with --ndjson, and honours --limit", async () => {
    const out = await runCli(["timeline", "--workspace", workspace, "--since", "2h", "--ndjson", "--limit", "3"]);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ schema: "arcadia-timeline-event-v1" });
  });

  it("refuses an unknown --tool or --kind", async () => {
    await expect(runTimelineCommand({ workspace, tool: "vim" })).rejects.toThrow(/--tool must be one of/);
    await expect(runTimelineCommand({ workspace, kind: "dance" })).rejects.toThrow(/--kind must be one of/);
  });

  it("adds the rewind view with --as-of", async () => {
    const response = await runTimelineCommand({ workspace, asOf: new Date().toISOString(), since: "2h" });
    expect(response.data.view).toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ project: "demo" })]) });
  });

  it("--ndjson reports a failure as one JSON line", async () => {
    const out = await runCli(["timeline", "--workspace", workspace, "--tool", "vim", "--ndjson"]);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ ok: false, command: "timeline", error: expect.objectContaining({ message: expect.stringContaining("--tool") }) });
  });

  it("--ndjson prints nothing at all for an empty window", async () => {
    const out = await runCli(["timeline", "--workspace", workspace, "--since", "2020-01-01T00:00Z", "--until", "2020-01-01T00:01Z", "--project", "nobody", "--ndjson"]);
    expect(out).toBe("");
  });

  it("--follow refuses --until and --as-of", async () => {
    const io = { json: true, signal: new AbortController().signal, write: () => undefined, maxPolls: 1, sleep: () => Promise.resolve() };
    await expect(runTimelineFollow({ workspace, until: "1h" }, io)).rejects.toThrow(/--follow/);
    await expect(runTimelineFollow({ workspace, asOf: "1h" }, io)).rejects.toThrow(/--follow/);
  });

  it("--follow streams NDJSON and stops on abort", async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    const result = await runTimelineFollow({ workspace, since: "2h" }, {
      json: true,
      signal: controller.signal,
      write: (line) => lines.push(line),
      maxPolls: 2,
      sleep: () => Promise.resolve()
    });
    expect(result.polls).toBe(2);
    expect(lines.length).toBe(result.emitted);
    expect(new Set(lines.map((line) => (JSON.parse(line) as TimelineEvent).id)).size).toBe(lines.length);
  });
});
