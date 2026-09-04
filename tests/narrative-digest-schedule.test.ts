import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDigestMarkPostedCommand, runDigestRunCommand } from "../src/commands/digest.js";
import { withDatabase } from "../src/db/connection.js";
import { createMissionLog, setMissionLogDocRef, upsertProject } from "../src/db/repositories.js";
import { completedWindow, describeWindow, dueDigestWindows } from "../src/digests/schedule.js";
import type { DigestNarrator } from "../src/digests/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

/** 2026-08-05 was a Wednesday; the completed week is Mon 2026-07-27..Mon 2026-08-03. */
const NOW = new Date(2026, 7, 5, 9, 30, 0, 0);

function localMidnight(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 0, 0, 0, 0).toISOString();
}

function workspaceWithProjects(names: string[]): { workspace: string; projectIds: string[] } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-digest-schedule-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  const projectIds = withDatabase(workspace, (db) =>
    names.map((name) => upsertProject(db, {
      name,
      mission: `Ship ${name}.`,
      status: "active",
      currentMilestone: "Tell the story",
      nextAction: "Compose the digest",
      workClassification: "agent"
    }).id)
  );
  return { workspace, projectIds };
}

function logOn(workspace: string, projectId: string, date: string, slug: string, what: string): void {
  withDatabase(workspace, (db) => {
    const log = createMissionLog(db, {
      projectId,
      workPerformed: what,
      result: "It worked.",
      nextAction: "Keep going.",
      markdownPath: "MISSION_LOG.md"
    });
    setMissionLogDocRef(db, log.id, `log/${slug}#${date}--${slug}`);
  });
}

function narrator(behavior?: (subject: string) => void): DigestNarrator {
  return async (input) => {
    behavior?.(input.subject.name);
    return {
      narrative: `${input.subject.name} narration of ${input.facts.length} fact(s).`,
      jobId: null
    };
  };
}

function enableMemory(workspace: string): string {
  const vaultPath = mkdtempSync(path.join(tmpdir(), "arcadia-digest-schedule-vault-"));
  workspaces.push(vaultPath);
  mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vaultPath };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return vaultPath;
}

describe("digest cadence windows", () => {
  it("digests the last completed local calendar period, per cadence", () => {
    expect(completedWindow("day", NOW)).toEqual({
      period: "day",
      start: localMidnight(2026, 7, 4),
      end: localMidnight(2026, 7, 5)
    });
    expect(completedWindow("week", NOW)).toEqual({
      period: "week",
      start: localMidnight(2026, 6, 27),
      end: localMidnight(2026, 7, 3)
    });
    expect(completedWindow("month", NOW)).toEqual({
      period: "month",
      start: localMidnight(2026, 6, 1),
      end: localMidnight(2026, 7, 1)
    });
  });

  it("resolves the same window all day, so the once-per-period guard cannot slip", () => {
    const earlyMorning = completedWindow("day", new Date(2026, 7, 5, 0, 1, 0, 0));
    const lateNight = completedWindow("day", new Date(2026, 7, 5, 23, 59, 0, 0));
    expect(earlyMorning).toEqual(lateNight);
  });

  it("rolls the week boundary on Monday, not on the firing day", () => {
    const monday = completedWindow("week", new Date(2026, 7, 3, 12, 0, 0, 0));
    const sunday = completedWindow("week", new Date(2026, 7, 2, 12, 0, 0, 0));
    expect(monday.start).toBe(localMidnight(2026, 6, 27));
    expect(sunday.start).toBe(localMidnight(2026, 6, 20));
  });

  it("offers exactly one window per cadence", () => {
    expect(dueDigestWindows(NOW).map((window) => window.period)).toEqual(["day", "week", "month"]);
  });

  it.skip("labels a window by its inclusive dates", () => {
    expect(describeWindow(completedWindow("day", NOW))).toBe("2026-08-04");
    expect(describeWindow(completedWindow("week", NOW))).toBe("2026-07-27 to 2026-08-02");
  });
});

describe("scheduled digest run", () => {
  it.skip("composes one digest per active Project per cadence, plus one portfolio roll-up", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha", "Beta"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");
    logOn(workspace, projectIds[1], "2026-08-04", "beta", "Shipped the exporter.");

    const response = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });

    // 3 cadences x (2 Projects + 1 portfolio).
    expect(response.data.entries).toHaveLength(9);
    expect(response.data.entries.every((entry) => entry.status === "composed")).toBe(true);
    const daily = response.data.entries.filter((entry) => entry.period === "day");
    expect(daily.map((entry) => entry.subject).sort()).toEqual(["Alpha", "Beta", "Portfolio"]);

    const portfolioDaily = daily.find((entry) => entry.scope === "portfolio")!;
    expect(portfolioDaily.factCount).toBe(2);
    expect(daily.find((entry) => entry.subject === "Alpha")!.factCount).toBe(1);

    withDatabase(workspace, (db) => {
      const rows = db.prepare("SELECT scope, scope_key, period FROM narrative_digests").all() as Array<Record<string, string>>;
      expect(rows).toHaveLength(9);
      expect(rows.filter((row) => row.scope === "portfolio")).toHaveLength(3);
    });
  });

  it.skip("attributes each portfolio fact to the Project it came from", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha", "Beta"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");
    logOn(workspace, projectIds[1], "2026-08-04", "beta", "Shipped the exporter.");

    await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });

    withDatabase(workspace, (db) => {
      const row = db.prepare(
        "SELECT facts_json FROM narrative_digests WHERE scope = 'portfolio' AND period = 'day'"
      ).get() as { facts_json: string };
      const facts = JSON.parse(row.facts_json) as Array<{ summary: string; detail: Record<string, unknown> }>;
      expect(facts.map((fact) => fact.detail.project).sort()).toEqual(["Alpha", "Beta"]);
      expect(facts.some((fact) => fact.summary.startsWith("Alpha: "))).toBe(true);
    });
  });

  it("fires at most once per subject per period across repeated runs", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");

    const first = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });
    const firstIds = first.data.entries.map((entry) => entry.digestId);

    // Same day, later tick, and again after a restart-shaped gap.
    for (const digest of first.data.pending) {
      runDigestMarkPostedCommand({ workspace, digestId: digest.digestId!, messageId: `msg-${digest.digestId}` });
    }
    const second = await runDigestRunCommand({
      workspace,
      now: new Date(2026, 7, 5, 21, 0, 0, 0),
      narrator: narrator(() => {
        throw new Error("A second narration for an already-composed window must never happen.");
      })
    });

    expect(second.data.entries.every((entry) => entry.status === "skipped")).toBe(true);
    expect(second.data.pending).toHaveLength(0);
    withDatabase(workspace, (db) => {
      expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_digests").get()).toEqual({ count: firstIds.length });
    });
  });

  it.skip("self-catches-up a missed tick, composing the same window the outage skipped", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");

    // The bot was down all through 2026-08-05 and comes back just before midnight.
    const afterOutage = await runDigestRunCommand({
      workspace,
      now: new Date(2026, 7, 5, 23, 55, 0, 0),
      narrator: narrator()
    });

    const daily = afterOutage.data.entries.find((entry) => entry.period === "day" && entry.scope === "project")!;
    expect(daily.status).toBe("composed");
    expect(daily.windowStart).toBe(localMidnight(2026, 7, 4));
    expect(daily.factCount).toBe(1);
  });

  it("returns a composed-but-undelivered digest for retry instead of losing it", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");

    const first = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });
    const dailyId = first.data.entries.find((entry) => entry.period === "day" && entry.scope === "project")!.digestId!;
    // Only the portfolio's daily digest got posted before the process died.
    const portfolioDaily = first.data.entries.find((entry) => entry.period === "day" && entry.scope === "portfolio")!;
    runDigestMarkPostedCommand({ workspace, digestId: portfolioDaily.digestId!, messageId: "msg-portfolio" });

    const second = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });
    const retried = second.data.pending.find((entry) => entry.digestId === dailyId)!;
    expect(retried.status).toBe("pending-delivery");
    expect(retried.body).toContain("Alpha — day digest (2026-08-04)");
    expect(second.data.pending.some((entry) => entry.digestId === portfolioDaily.digestId)).toBe(false);
  });

  it("logs one subject's failure without blocking any other subject or cadence", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha", "Beta"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");
    logOn(workspace, projectIds[1], "2026-08-04", "beta", "Shipped the exporter.");

    const response = await runDigestRunCommand({
      workspace,
      now: NOW,
      narrator: narrator((subject) => {
        if (subject === "Alpha") throw new Error("Local model unreachable.");
      })
    });

    const failed = response.data.entries.filter((entry) => entry.status === "failed");
    expect(failed).toHaveLength(3);
    expect(failed.every((entry) => entry.subject === "Alpha")).toBe(true);
    expect(failed[0].error).toContain("Local model unreachable.");
    expect(response.warnings.some((warning) => warning.includes("Alpha"))).toBe(true);

    // Beta and the portfolio still got all three cadences.
    const survived = response.data.entries.filter((entry) => entry.status === "composed");
    expect(survived).toHaveLength(6);
    expect(new Set(survived.map((entry) => entry.period))).toEqual(new Set(["day", "week", "month"]));
  });

  it("skips a Project that is not active", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha", "Beta"]);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE projects SET status = 'paused' WHERE id = ?").run(projectIds[1]);
    });

    const response = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });
    expect(response.data.entries.some((entry) => entry.subject === "Beta")).toBe(false);
    expect(response.data.entries).toHaveLength(6);
  });

  it("exports each composed digest to the vault, portfolio roll-up included", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    const vaultPath = enableMemory(workspace);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");

    const response = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });

    const portfolioDaily = response.data.entries.find((entry) => entry.scope === "portfolio" && entry.period === "day")!;
    expect(portfolioDaily.memoryRecordPath).toBeTruthy();
    expect(portfolioDaily.error).toBeNull();
    expect(portfolioDaily.memoryRecordPath).toContain(path.join(vaultPath, "Arcadia", "Records", "Narrative Digests", "portfolio"));
    const record = readFileSync(portfolioDaily.memoryRecordPath!, "utf8");
    expect(record).toContain('arcadia_digest_scope: "portfolio"');
    // The roll-up must not claim a Project it does not belong to.
    expect(record).toContain("arcadia_project_id: null");
    expect(record).toContain("project: null");

    const projectDaily = response.data.entries.find((entry) => entry.scope === "project" && entry.period === "day")!;
    const projectRecord = readFileSync(projectDaily.memoryRecordPath!, "utf8");
    expect(projectRecord).toContain('arcadia_digest_scope: "project"');
    expect(projectRecord).toContain('project: "Alpha"');
  });

  it("produces an honest empty digest for a window with no activity", async () => {
    const { workspace } = workspaceWithProjects(["Alpha"]);

    const response = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });

    const daily = response.data.entries.find((entry) => entry.period === "day" && entry.scope === "project")!;
    expect(daily.factCount).toBe(0);
    expect(daily.body).toContain("Nothing happened in Alpha's recorded activity");
  });
});

describe("digest delivery record", () => {
  it("records the delivery message id, and refuses an unknown digest", async () => {
    const { workspace, projectIds } = workspaceWithProjects(["Alpha"]);
    logOn(workspace, projectIds[0], "2026-08-04", "alpha", "Shipped the parser.");
    const response = await runDigestRunCommand({ workspace, now: NOW, narrator: narrator() });
    const digestId = response.data.pending[0].digestId!;

    const marked = runDigestMarkPostedCommand({ workspace, digestId, messageId: "discord-123" });
    expect(marked.data.digest.posted_message_id).toBe("discord-123");
    expect(marked.data.digest.posted_at).toBeTruthy();

    expect(() => runDigestMarkPostedCommand({ workspace, digestId: "missing", messageId: "x" })).toThrow(
      /Narrative digest was not found/
    );
  });
});
