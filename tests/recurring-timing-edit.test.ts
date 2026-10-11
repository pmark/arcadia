import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { editRecurringScheduleTiming, recurringScheduleStatus, registerRecurringSchedule, setRecurringScheduleEnabled, tickRecurringSchedules } from "../src/recurring/scheduler.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const definition = { schema: "arcadia-recurring-schedule-v1", id: "notes", project: "demo", cadence: "daily", timezone: "America/Los_Angeles", time: "09:00", starts_at: "2026-10-01T16:00:00.000Z", desired_result: "Collect shipped evidence.", acceptance: ["Evidence checked."] };
function fixture() { const root = mkdtempSync(path.join(tmpdir(), "arcadia-retime-")); roots.push(root); initWorkspace(root); const db = openDatabase(root); upsertProject(db, { name: "Demo", mission: "Test timing", status: "active" }); registerRecurringSchedule(db, definition); return db; }
const at = (value: string) => new Date(value);
function state(db: ReturnType<typeof fixture>) { return recurringScheduleStatus(db, at("2026-10-12T18:00:00Z")).schedules[0]; }
function edit(db: ReturnType<typeof fixture>, timing: Record<string, unknown>, now = at("2026-10-12T18:00:00Z")) { return editRecurringScheduleTiming(db, "notes", { expected: state(db).fingerprint, ...timing }, now); }
function settle(db: ReturnType<typeof fixture>, proposal: string) { db.prepare(`INSERT INTO agent_ask_settlements(id,proposal_id,request_id,operation_json,fingerprint,disposition,project_slug,effects_json,receipt_json,created_at) VALUES ('fixture',?,'settled','{}','fixture','rejected','demo','[]','{}','2026-10-12')`).run(proposal); }
const newTiming = { cadence: "daily", timezone: "America/Los_Angeles", time: "08:00" };
describe("Clock timing edit", () => {
  it("keeps definition/receipts and stable identity across restart, refuses pending edits, and never backfills", () => {
    const db = fixture();
    try {
      setRecurringScheduleEnabled(db, "notes", true);
      const receipt = tickRecurringSchedules(db, at("2026-10-12T17:00:00Z"))[0];
      const original = db.prepare("SELECT definition_json FROM recurring_schedules").get();
      const ledger = db.prepare("SELECT * FROM recurring_schedule_occurrences").all();
      expect(() => edit(db, newTiming)).toThrow("pending");
      settle(db, receipt.proposalId!);
      edit(db, newTiming);
      expect(db.prepare("SELECT definition_json FROM recurring_schedules").get()).toEqual(original);
      expect(db.prepare("SELECT * FROM recurring_schedule_occurrences").all()).toEqual(ledger);
      expect(state(db)).toMatchObject({ enabled: true, definition: { id: "notes", time: "08:00", starts_at: "2026-10-13T15:00:00.000Z" } });
      expect(tickRecurringSchedules(db, at("2026-10-12T23:00:00Z"))).toEqual([]);
      const reopened = openDatabase(roots[roots.length - 1]);
      try { expect(tickRecurringSchedules(reopened, at("2026-10-13T15:00:00Z"))[0].status).toBe("submitted"); } finally { reopened.close(); }
      expect((db.prepare("SELECT COUNT(*) n FROM recurring_schedule_occurrences").get() as { n: number }).n).toBe(2);
      expect((db.prepare("SELECT COUNT(*) n FROM execution_runs").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });
  it("refuses stale timing and toggles under lock without partial writes", () => {
    const db = fixture(); try {
      const expected = state(db).fingerprint;
      setRecurringScheduleEnabled(db, "notes", true, expected);
      expect(() => editRecurringScheduleTiming(db, "notes", { expected, ...newTiming })).toThrow("changed");
      expect(() => setRecurringScheduleEnabled(db, "notes", false, expected)).toThrow("changed");
      expect(state(db).definition.time).toBe("09:00"); expect(state(db).enabled).toBe(true);
    } finally { db.close(); }
  });
  it("preserves paused state and no-op baseline, including an already due slot", () => {
    const db = fixture(); try {
      expect(edit(db, { ...newTiming, time: "09:00" }).changed).toBe(false);
      expect(state(db).definition.starts_at).toBe(definition.starts_at);
      edit(db, newTiming); expect(state(db).enabled).toBe(false);
      expect(tickRecurringSchedules(db, at("2026-10-13T16:00:00Z"))).toEqual([]);
    } finally { db.close(); }
  });
  it("retains same-date dedup when moving timing later", () => {
    const db = fixture(); try {
      setRecurringScheduleEnabled(db, "notes", true);
      const receipt = tickRecurringSchedules(db, at("2026-10-12T17:00:00Z"))[0]; settle(db, receipt.proposalId!);
      edit(db, { ...newTiming, time: "14:00" });
      expect(state(db).next.dueAt).toBe("2026-10-13T21:00:00.000Z");
      expect(tickRecurringSchedules(db, at("2026-10-12T21:00:00Z"))).toEqual([]);
      expect(tickRecurringSchedules(db, at("2026-10-13T21:00:00Z"))[0].status).toBe("submitted");
    } finally { db.close(); }
  });
  it("changes cadence and timezone across DST while preserving all receipt identity", () => {
    const db = fixture(); try {
      edit(db, { cadence: "weekly", weekday: 1, time: "09:00", timezone: "America/New_York" }, at("2026-10-31T14:00:00Z"));
      expect(state(db).definition).toMatchObject({ starts_at: "2026-11-02T14:00:00.000Z", cadence: "weekly", weekday: 1 });
      expect(state(db).definition.day).toBeUndefined();
      edit(db, { cadence: "monthly", day: 1, time: "09:00", timezone: "Asia/Kolkata" }, at("2026-11-03T14:00:00Z"));
      expect(state(db).definition).toMatchObject({ starts_at: "2026-12-01T03:30:00.000Z", cadence: "monthly", day: 1 });
      expect(state(db).definition.weekday).toBeUndefined();
    } finally { db.close(); }
  });
  it.each([{ ...newTiming, day: 31 }, { ...newTiming, timezone: "invalid/zone" }, { ...newTiming, time: "25:00" }, { ...newTiming, cadence: "weekly", weekday: 8 }, { ...newTiming, desired_result: "Replace work" }])("rejects invalid timing without mutation (%j)", (timing) => {
    const db = fixture(); try { const before = db.prepare("SELECT * FROM recurring_schedules").all(); expect(() => edit(db, timing)).toThrow(); expect(db.prepare("SELECT * FROM recurring_schedules").all()).toEqual(before); } finally { db.close(); }
  });
  it("rolls back an injected failure after the timing update without partial writes", () => {
    const db = fixture(); try {
      const before = db.prepare("SELECT * FROM recurring_schedules").all();
      const prepare = db.prepare.bind(db);
      vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
        const statement = prepare(sql);
        if (sql.startsWith("UPDATE recurring_schedules SET timing_json")) {
          const run = statement.run.bind(statement);
          vi.spyOn(statement, "run").mockImplementation((...args: unknown[]) => { run(...args); throw new Error("injected cutover failure"); });
        }
        return statement;
      });
      expect(() => edit(db, newTiming)).toThrow("injected cutover failure");
      vi.restoreAllMocks();
      expect(db.prepare("SELECT * FROM recurring_schedules").all()).toEqual(before);
    } finally { db.close(); }
  });
  it("preserves a future initial baseline when monthly time moves earlier", () => {
    const db = fixture(); try {
      registerRecurringSchedule(db, { ...definition, id: "essay", cadence: "monthly", day: 1, starts_at: "2026-11-01T17:00:00.000Z" });
      const expected = recurringScheduleStatus(db).schedules.find((row) => row.definition.id === "essay")!.fingerprint;
      editRecurringScheduleTiming(db, "essay", { expected, cadence: "monthly", day: 1, timezone: "America/Los_Angeles", time: "08:00" }, at("2026-10-12T18:00:00Z"));
      expect(recurringScheduleStatus(db, at("2026-10-12T18:00:00Z")).schedules.find((row) => row.definition.id === "essay")!.next.dueAt).toBe("2026-12-01T16:00:00.000Z");
    } finally { db.close(); }
  });
  it("refuses retiming failed retry receipts", () => {
    const db = fixture(); try {
      setRecurringScheduleEnabled(db, "notes", true); upsertProject(db, { name: "Demo", mission: "Paused", status: "paused" });
      expect(tickRecurringSchedules(db, at("2026-10-12T17:00:00Z"))[0].status).toBe("failed");
      expect(() => edit(db, newTiming)).toThrow("failed occurrence");
    } finally { db.close(); }
  });
});
