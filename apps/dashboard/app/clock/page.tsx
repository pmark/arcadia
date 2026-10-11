"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import type { ClockSchedule, ClockStatus, ClockTiming } from "../../lib/clock-types";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const button = "min-h-11 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50";
const field = "mt-1 block min-h-11 w-full rounded-md border border-line bg-panel px-3 py-2";
export default function ClockPage() {
  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClockSchedule | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await read()); setError(null); }
    catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function change(schedule: ClockSchedule, action: "enable" | "pause" | "edit", timing?: ClockTiming) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id: schedule.definition.id, expected: schedule.fingerprint, ...(timing ? { timing } : {}) }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setStatus(await read()); setEditing(null); }
        throw new Error(body.error ?? "Schedule change failed.");
      }
      setStatus(body as ClockStatus); setEditing(null);
      setNotice(action === "edit" ? "Timing saved. Future occurrences use the new timing." : action === "enable" ? "Schedule enabled." : "Schedule paused.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <MobileShell>
    <div className="mb-5 flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Clock</h1><button className={button} disabled={loading || busy} onClick={() => void load()}>Refresh</button></div>
    <p className="mb-5 text-sm text-muted">Recurring schedules propose Actions through the existing worker. Review proposals in <Link href="/todo" className="underline">To-do</Link>.</p>
    {error ? <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
    {notice ? <p role="status" className="mb-4 rounded-md border border-moss/30 p-3 text-sm">{notice}</p> : null}
    {loading && !status ? <p role="status">Loading schedules…</p> : null}
    {status && !status.available ? <p className="rounded-md border border-line p-4">Scheduler data is unavailable. The live runtime needs the scheduler update.</p> : null}
    {status?.available && status.schedules.length === 0 ? <p className="rounded-md border border-line p-4">No recurring schedules are registered yet.</p> : null}
    <div className="grid gap-4">{status?.schedules.map((schedule) => <article key={schedule.definition.id} className="min-w-0 rounded-xl border border-line bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-words text-lg font-semibold">{schedule.definition.id.replaceAll("-", " ")}</h2><span className="rounded-full bg-canvas px-2 py-1 text-xs font-semibold">{schedule.enabled ? "Enabled" : "Paused"}</span></div>
      <p className="mt-1 text-xs text-muted">Project: {schedule.definition.project}</p>
      <p className="mt-3 text-sm font-medium">{humanTiming(schedule.definition)}</p>
      <p className="mt-1 break-words text-sm text-muted">{schedule.definition.timezone}</p>
      <dl className="mt-3 grid gap-2 text-sm"><div><dt className="text-muted">Next scheduled time</dt><dd>{date(schedule.next.dueAt, schedule.definition.timezone)}</dd></div><div><dt className="text-muted">Last occurrence</dt><dd>{schedule.last ? `${schedule.last.status === "submitted" ? "Proposal submitted" : "Failed"} · ${date(schedule.last.due_at, schedule.definition.timezone)}` : "No occurrences yet"}</dd></div></dl>
      {schedule.due ? <p className="mt-3 text-sm">Due; waiting for the worker.</p> : null}
      {schedule.pending ? <p className="mt-3 break-words text-sm">{schedule.pending.status === "submitted" ? <>Waiting for <Link className="underline" href={`/todo/agent_ask/${encodeURIComponent(schedule.definition.project)}/${encodeURIComponent(schedule.pending.request_id)}`}>proposal review</Link>.</> : <>Occurrence failed: {schedule.pending.last_error}. Resolve it before editing timing.</>}</p> : null}
      {!schedule.enabled ? <p className="mt-2 text-xs text-muted">Paused; the scheduled time does not trigger a proposal.</p> : schedule.pending ? <p className="mt-2 text-xs text-muted">Further proposals wait until this occurrence is resolved.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void change(schedule, schedule.enabled ? "pause" : "enable")}>{schedule.enabled ? "Pause" : "Enable"}</button><button className={button} disabled={busy || Boolean(schedule.pending)} onClick={() => { setEditing(schedule); setError(null); }}>Edit timing</button></div>
      {editing?.definition.id === schedule.definition.id ? <TimingForm schedule={editing} busy={busy} onSave={(timing) => void change(editing, "edit", timing)} onCancel={() => setEditing(null)} /> : null}
    </article>)}</div>
  </MobileShell>;
}
function TimingForm({ schedule, busy, onSave, onCancel }: { schedule: ClockSchedule; busy: boolean; onSave: (timing: ClockTiming) => void; onCancel: () => void }) {
  const [timing, setTiming] = useState<ClockTiming>({ cadence: schedule.definition.cadence, time: schedule.definition.time, timezone: schedule.definition.timezone, ...(schedule.definition.weekday ? { weekday: schedule.definition.weekday } : {}), ...(schedule.definition.day ? { day: schedule.definition.day } : {}) });
  return <form className="mt-4 grid gap-3 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); onSave(timing); }}>
    <h3 className="font-semibold">Edit timing</h3>
    <label className="text-sm">Repeat<select className={field} value={timing.cadence} onChange={(event) => { const cadence = event.target.value as ClockTiming["cadence"]; setTiming({ cadence, time: timing.time, timezone: timing.timezone, ...(cadence === "weekly" ? { weekday: 1 } : {}), ...(cadence === "monthly" ? { day: 1 } : {}) }); }}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
    {timing.cadence === "weekly" ? <label className="text-sm">Weekday<select className={field} value={timing.weekday} onChange={(event) => setTiming({ ...timing, weekday: Number(event.target.value) })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label> : null}
    {timing.cadence === "monthly" ? <label className="text-sm">Day of month (1–28)<input className={field} type="number" min={1} max={28} required value={timing.day} onChange={(event) => setTiming({ ...timing, day: Number(event.target.value) })} /></label> : null}
    <label className="text-sm">Time<input className={field} type="time" required value={timing.time} onChange={(event) => setTiming({ ...timing, time: event.target.value })} /></label>
    <label className="text-sm">Time zone<input className={field} required maxLength={100} placeholder="America/Los_Angeles" value={timing.timezone} onChange={(event) => setTiming({ ...timing, timezone: event.target.value })} /></label>
    <p className="text-xs text-muted">Schedule starts {date(schedule.definition.starts_at, schedule.definition.timezone)} ({schedule.definition.timezone}). Saving uses future scheduled times after that start, keeps occurrence history and never proposes work retroactively. Enabled or paused state stays the same.</p>
    <div className="flex gap-2"><button className={button} type="submit" disabled={busy}>{busy ? "Saving…" : "Save timing"}</button><button className={button} type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
function humanTiming(timing: ClockTiming) { return `${timing.cadence === "daily" ? "Every day" : timing.cadence === "weekly" ? `Every ${weekdays[(timing.weekday ?? 1) - 1]}` : `Day ${timing.day} of each month`} at ${timing.time}`; }
function date(value: string, timezone: string) { return new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function read(): Promise<ClockStatus> { const response = await fetch("/api/clock", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load schedules."); return body as ClockStatus; }
