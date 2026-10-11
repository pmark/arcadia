import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, openReadOnlyDatabase } from "../src/db/connection.js";
import * as repositories from "../src/db/repositories.js";
import * as scheduler from "../src/recurring/scheduler.js";
import { upsertProject } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { latestOccurrence, nextOccurrence } from "../src/recurring/calendar.js";
import { parseRecurringSchedule, recurringScheduleStatus, registerRecurringSchedule, retryRecurringOccurrence, setRecurringScheduleEnabled, tickRecurringSchedules } from "../src/recurring/scheduler.js";
import { cleanupTrackedPaths, runCli } from "./cli-response-fixture.js";
import { runWorkerIteration } from "../src/commands/worker.js";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); cleanupTrackedPaths(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const definition = { schema: "arcadia-recurring-schedule-v1", id: "field-notes", project: "demo", cadence: "weekly", weekday: 1, timezone: "America/Los_Angeles", time: "09:00", starts_at: "2026-10-12T16:00:00.000Z", desired_result: "Collect shipped work between {{period_start}} and {{period_end}} for {{due_at}}.", acceptance: ["Evidence receipts exist."] };
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-recurring-")); roots.push(root); initWorkspace(root);
  const db = openDatabase(root);
  upsertProject(db, { name: "Demo", mission: "Prove scheduled intake", status: "active" });
  return { root, db };
}
const at = (date: string) => new Date(date);

describe("timezone calendar", () => {
  it("returns the completed Monday-to-Monday window and next weekly local time across DST", () => {
    const occurrence = latestOccurrence(parseRecurringSchedule(definition), at("2026-11-02T18:00:00Z"));
    expect(occurrence).toEqual({ key: "2026-11-02", dueAt: "2026-11-02T17:00:00.000Z", periodStart: "2026-10-26T07:00:00.000Z", periodEnd: "2026-11-02T08:00:00.000Z" });
    expect(nextOccurrence(parseRecurringSchedule(definition), at("2026-10-26T16:00:00Z")).dueAt).toBe("2026-11-02T17:00:00.000Z");
  });
  it("shifts a spring gap forward, restores configured time tomorrow, and fires fall overlap once", () => {
    const daily = { cadence: "daily" as const, timezone: "America/Los_Angeles", time: "02:30" };
    expect(latestOccurrence(daily, at("2026-03-08T10:30:00Z")).dueAt).toBe("2026-03-08T10:30:00.000Z");
    expect(nextOccurrence(daily, at("2026-03-08T10:30:00Z")).dueAt).toBe("2026-03-09T09:30:00.000Z");
    expect(latestOccurrence({ ...daily, time: "01:30" }, at("2026-11-01T09:30:00Z")).dueAt).toBe("2026-11-01T08:30:00.000Z");
  });
  it("rolls monthly schedules across year boundaries, with a completed calendar month", () => {
    const monthly = { cadence: "monthly" as const, day: 1, timezone: "Asia/Kolkata", time: "09:00" };
    expect(latestOccurrence(monthly, at("2027-01-01T03:30:00Z"))).toEqual({ key: "2027-01-01", dueAt: "2027-01-01T03:30:00.000Z", periodStart: "2026-11-30T18:30:00.000Z", periodEnd: "2026-12-31T18:30:00.000Z" });
    expect(nextOccurrence(monthly, at("2026-12-31T12:00:00Z")).key).toBe("2027-01-01");
  });
});

describe("durable recurring proposal intake", () => {
  it("starts paused, rejects changed definitions, honors baseline, and never creates execution work", () => {
    const { db } = fixture();
    try {
      expect(registerRecurringSchedule(db, definition).enabled).toBe(false);
      expect(registerRecurringSchedule(db, { ...definition }).replayed).toBe(true);
      expect(() => registerRecurringSchedule(db, { ...definition, time: "10:00" })).toThrow("different definition");
      expect(tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))).toEqual([]);
      setRecurringScheduleEnabled(db, definition.id, true);
      expect(tickRecurringSchedules(db, at("2026-10-12T15:59:59Z"))).toEqual([]);
      const receipt = tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))[0];
      expect(receipt.status).toBe("submitted");
      expect(recurringScheduleStatus(db, at("2026-10-12T16:00:00Z")).schedules[0]).toMatchObject({ due: null, pending: { status: "submitted" } });
      const stored = db.prepare("SELECT proposal_json FROM agent_ask_proposals").get() as { proposal_json: string };
      const proposal = JSON.parse(stored.proposal_json);
      expect(proposal.normalized.desiredResult).toContain("2026-10-05T07:00:00.000Z and 2026-10-12T07:00:00.000Z");
      expect(proposal.queueConsequence).toBe("none_until_accepted");
      for (const table of ["work_items", "review_items", "execution_runs"]) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it.each(["paused", "completed", "incubating"] as const)("refuses registration for a %s Project", (status) => {
    const { db } = fixture();
    try {
      upsertProject(db, { name: "Demo", mission: "Unavailable", status });
      expect(() => registerRecurringSchedule(db, definition)).toThrow("active Project");
      expect((db.prepare("SELECT COUNT(*) AS n FROM recurring_schedules").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it.each(["completed", "incubating"] as const)("blocks delivery when the destination becomes %s after registration", (status) => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      upsertProject(db, { name: "Demo", mission: "No longer active", status });
      expect(tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))[0]).toMatchObject({ status: "failed", error: "Schedule destination must be a configured active Project." });
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it("deduplicates across connections/restarts and holds the next period while its Ask is unsettled", () => {
    const { db, root } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      const first = tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))[0];
      const other = openDatabase(root);
      try {
        expect(tickRecurringSchedules(other, at("2026-11-23T17:00:00Z"))[0]).toMatchObject({ status: "waiting", proposalId: first.proposalId });
        expect((other.prepare("SELECT COUNT(*) AS n FROM recurring_schedule_occurrences").get() as { n: number }).n).toBe(1);
      } finally { other.close(); }
      setRecurringScheduleEnabled(db, definition.id, false);
      expect(tickRecurringSchedules(db, at("2026-11-23T17:00:00Z"))).toEqual([]);
    } finally { db.close(); }
  });
  it("coalesces downtime into the latest eligible slot, without an old-period burst", () => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      expect(tickRecurringSchedules(db, at("2026-11-23T17:00:00Z"))).toMatchObject([{ status: "submitted", occurrence: "2026-11-23" }]);
    } finally { db.close(); }
  });
  it("isolates a failing destination, applies backoff and a three-attempt cap, and supports explicit retry", () => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      upsertProject(db, { name: "Other", mission: "Unaffected", status: "active" });
      registerRecurringSchedule(db, { ...definition, id: "other", project: "other" }); setRecurringScheduleEnabled(db, "other", true);
      upsertProject(db, { name: "Demo", mission: "Paused", status: "paused" });
      expect(tickRecurringSchedules(db, at("2026-10-12T16:00:00Z")).map((r) => r.status)).toEqual(["failed", "submitted"]);
      expect(tickRecurringSchedules(db, at("2026-10-12T16:01:00Z"))[0].status).toBe("waiting");
      expect(tickRecurringSchedules(db, at("2026-10-12T16:05:00Z"))[0].status).toBe("failed");
      expect(tickRecurringSchedules(db, at("2026-10-12T16:10:00Z"))[0].status).toBe("failed");
      expect(tickRecurringSchedules(db, at("2026-10-12T17:00:00Z"))[0].status).toBe("waiting");
      upsertProject(db, { name: "Demo", mission: "Restored", status: "active" });
      retryRecurringOccurrence(db, definition.id, "2026-10-12");
      expect(tickRecurringSchedules(db, at("2026-10-12T17:00:00Z"))[0].status).toBe("submitted");
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals").get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });
  it.each(["{broken json", JSON.stringify({ ...definition, timezone: "retired/zone" })])("isolates an unreadable stored definition from healthy triggers (%s)", (corrupt) => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      registerRecurringSchedule(db, { ...definition, id: "other" }); setRecurringScheduleEnabled(db, "other", true);
      db.prepare("UPDATE recurring_schedules SET definition_json = ? WHERE id = ?").run(corrupt, definition.id);
      const receipts = tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"));
      expect(receipts[0]).toMatchObject({ id: definition.id, status: "failed" });
      expect(receipts[0].occurrence).toBeUndefined();
      expect(receipts[0].error).toBeTruthy();
      expect(receipts[1]).toMatchObject({ id: "other", status: "submitted" });
      expect((db.prepare("SELECT COUNT(*) AS n FROM recurring_schedule_occurrences").get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });
  it("stops further intake attempts after shared database contention instead of waiting for each schedule", () => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      registerRecurringSchedule(db, { ...definition, id: "other" }); setRecurringScheduleEnabled(db, "other", true);
      const prepare = db.prepare.bind(db);
      let lookups = 0;
      vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
        if (sql.includes("FROM recurring_schedules WHERE id = ? AND enabled = 1")) {
          lookups++;
          throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
        }
        return prepare(sql);
      });
      expect(tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))).toMatchObject([{ id: definition.id, status: "failed", error: "database is locked" }]);
      expect(lookups).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it("logs a global intake failure and still reaches the worker's normal Run claim", () => {
    const { db, root } = fixture();
    try {
      vi.stubEnv("CODEX_SANDBOX", "test");
      const intake = vi.spyOn(scheduler, "tickRecurringSchedules").mockImplementation(() => { throw new Error("SQLITE_BUSY: scheduler intake unavailable"); });
      const claim = vi.spyOn(repositories, "claimNextPendingRun");
      const logfile = path.join(root, "worker.log");
      expect(runWorkerIteration(db, root, process.pid, logfile)).toBeNull();
      expect(claim).toHaveBeenCalledWith(db, process.pid);
      expect(readFileSync(logfile, "utf8")).toContain("[recurring-schedule] Tick error: SQLITE_BUSY");
      runWorkerIteration(db, root, process.pid, logfile);
      expect(claim).toHaveBeenCalledTimes(2);
      expect(readFileSync(logfile, "utf8").match(/Tick error/g)).toHaveLength(1);
      intake.mockReturnValue([]);
      runWorkerIteration(db, root, process.pid, logfile);
      intake.mockImplementation(() => { throw new Error("SQLITE_BUSY: scheduler intake unavailable"); });
      runWorkerIteration(db, root, process.pid, logfile);
      expect(readFileSync(logfile, "utf8").match(/Tick error/g)).toHaveLength(2);
    } finally { db.close(); }
  });
  it("submits only once when two actual processes tick together", async () => {
    const { db, root } = fixture();
    registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true); db.close();
    const script = path.join(root, "competing-ticks.mjs");
    const connection = new URL("../src/db/connection.ts", import.meta.url).href;
    const scheduler = new URL("../src/recurring/scheduler.ts", import.meta.url).href;
    writeFileSync(script, `import { openDatabase } from ${JSON.stringify(connection)}; import { tickRecurringSchedules } from ${JSON.stringify(scheduler)}; const db = openDatabase(${JSON.stringify(root)}); try { tickRecurringSchedules(db, new Date('2026-10-12T16:00:00Z')); } finally { db.close(); }`);
    const launch = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), script], { stdio: ["ignore", "ignore", "pipe"] });
      let error = ""; child.stderr.on("data", (chunk) => { error += String(chunk); });
      child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error)));
    });
    await Promise.all([launch(), launch()]);
    const verify = openDatabase(root);
    try {
      for (const table of ["agent_ask_proposals", "recurring_schedule_occurrences"]) expect((verify.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(1);
    } finally { verify.close(); }
  });
  it("retains settled receipts and permits the latest new occurrence without recapturing the old one", () => {
    const { db } = fixture();
    try {
      registerRecurringSchedule(db, definition); setRecurringScheduleEnabled(db, definition.id, true);
      const receipt = tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))[0];
      db.prepare(`INSERT INTO agent_ask_settlements(id,proposal_id,request_id,operation_json,fingerprint,disposition,project_slug,effects_json,receipt_json,created_at) VALUES ('fixture',?,'fixture-settlement','{}','fixture','rejected','demo','[]','{}','2026-10-12')`).run(receipt.proposalId);
      expect(tickRecurringSchedules(db, at("2026-10-12T16:00:00Z"))).toEqual([]);
      expect(tickRecurringSchedules(db, at("2026-11-23T17:00:00Z"))[0]).toMatchObject({ status: "submitted", occurrence: "2026-11-23" });
      expect((db.prepare("SELECT COUNT(*) AS n FROM recurring_schedule_occurrences").get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });
  it("exposes register, read, enable, tick and pause through the real CLI JSON envelopes", () => {
    const { db, root } = fixture(); db.close();
    const file = path.join(root, "schedule.json");
    writeFileSync(file, JSON.stringify({ ...definition, starts_at: "2020-01-01T00:00:00.000Z" }));
    const call = (args: string[]) => {
      const result = runCli(["schedule", ...args, "--workspace", root, "--json"]);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      return JSON.parse(result.stdout);
    };
    expect(call(["register", "--file", file]).data.enabled).toBe(false);
    expect(call(["recurring"]).data.schedules).toHaveLength(1);
    expect(call(["enable", definition.id]).data.enabled).toBe(true);
    expect(call(["tick"]).data.receipts[0].status).toBe("submitted");
    expect(call(["tick"]).data.receipts[0].status).toBe("waiting");
    expect(call(["pause", definition.id]).data.enabled).toBe(false);
  }, 30_000);
  it("status reads a pre-migration workspace without creating tables", () => {
    const { db, root } = fixture(); db.exec("DROP TABLE recurring_schedule_occurrences; DROP TABLE recurring_schedules;"); db.close();
    const readonly = openReadOnlyDatabase(root);
    try { expect(recurringScheduleStatus(readonly)).toEqual({ available: false, schedules: [] }); }
    finally { readonly.close(); }
  });
  it("existing worker ticks submit proposals with production inactive", () => {
    const { db, root } = fixture();
    try {
      vi.stubEnv("CODEX_SANDBOX", "test");
      registerRecurringSchedule(db, { ...definition, starts_at: "2020-01-01T00:00:00.000Z" }); setRecurringScheduleEnabled(db, definition.id, true);
      expect(runWorkerIteration(db, root, process.pid, path.join(root, ".arcadia", "worker.log"))).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals").get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });
  it.each([{ day: 31 }, { weekday: 8 }, { timezone: "imaginary/zone" }, { time: "25:00" }, { command: "publish" }, { acceptance: [] }, { desired_result: "{{arbitrary_command}}" }])("refuses invalid or executable definitions %j", (change) => {
    expect(() => parseRecurringSchedule({ ...definition, ...change })).toThrow();
  });
});
