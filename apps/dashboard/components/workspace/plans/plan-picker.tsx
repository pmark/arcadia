"use client";

import { useMemo, useState } from "react";
import { useRead } from "../use-read";
import { RouteLink } from "../routes/route-parts";
import "../routes/routes.css";
import "./plan-picker.css";
import type { AllPlansResponse } from "../../../lib/plans-types";
import { workspaceHref } from "../../../lib/workspace-scope";
import {
  DEFAULT_FILTERS, PLAN_STATUSES, duplicatesByPlan, filterPlans, groupPlans, sortPlans, toPickerPlans,
  type PickerFilters, type PickerPlan, type PlanGroup, type PlanSort, type DuplicatePair
} from "../../../lib/plan-picker";

const SORTS: Array<[PlanSort, string]> = [["updated", "Last update"], ["progress", "Progress"], ["queue", "Queue position"]];
const GROUPS: Array<[PlanGroup, string]> = [["none", "No grouping"], ["status", "Status"], ["project", "Project"], ["stale", "Staleness"]];

const short = (text: string) => (text.length > 90 ? `${text.slice(0, 87)}...` : text);

function percent(progress: number | null): string {
  return progress === null ? "no Actions counted" : `${Math.round(progress * 100)}% done`;
}

function PlanItem({ plan, dupes, titles }: { plan: PickerPlan; dupes: DuplicatePair[]; titles: Map<string, string> }) {
  const others = dupes.map(d => ({ slug: d.a === plan.row.slug ? d.b : d.a, score: d.score }));
  return <li className="plan-picker-item" data-status={plan.row.status}>
    <RouteLink href={workspaceHref({ project: plan.project.slug, plan: plan.row.slug })} className="plan-picker-title">{plan.title}</RouteLink>
    <p className="plan-picker-meta">
      <span className="plan-picker-status">{plan.row.status}</span>
      {plan.row.isActivePlan && <span className="plan-picker-flag active">Active Plan</span>}
      <span>{plan.project.name}</span>
      <span>{percent(plan.progress)}</span>
      <span>{plan.ageDays === null ? "no update date" : `updated ${plan.ageDays} day${plan.ageDays === 1 ? "" : "s"} ago`}</span>
    </p>
    {plan.doneButNotClosed && <p className="plan-picker-flag done" role="note">Done but not closed: every Action is done or deferred, yet the Plan is still {plan.row.status}.</p>}
    {others.length > 0 && <p className="plan-picker-flag dup" role="note">Likely duplicate of {others.map(o => `${short(titles.get(o.slug) ?? o.slug)} (similarity ${o.score.toFixed(2)})`).join("; ")}</p>}
  </li>;
}

/** Every Project's Plans from one `/api/plans` read. Display only: nothing here writes, queues or asks a model. */
export function PlanPicker({ initial }: { initial?: { filters?: Partial<PickerFilters>; sort?: PlanSort; group?: PlanGroup } } = {}) {
  const [revision, setRevision] = useState(0);
  // The only read the picker makes: one /api/plans answer, however many Plans it holds.
  const read = useRead<AllPlansResponse>("/api/plans", revision);
  const [filters, setFilters] = useState<PickerFilters>({ ...DEFAULT_FILTERS, ...initial?.filters });
  const [sort, setSort] = useState<PlanSort>(initial?.sort ?? "updated");
  const [group, setGroup] = useState<PlanGroup>(initial?.group ?? "none");
  const data = read.kind === "ready" ? read.data : null;
  const all = useMemo(() => (data ? toPickerPlans(data) : []), [data]);
  const dupes = useMemo(() => duplicatesByPlan(all), [all]);
  const titles = useMemo(() => new Map(all.map(p => [p.row.slug, p.title])), [all]);
  const shown = useMemo(() => groupPlans(sortPlans(filterPlans(all, filters), sort), group), [all, filters, sort, group]);
  const count = shown.reduce((n, g) => n + g.plans.length, 0);
  const unreadable = data?.projects.filter(p => p.error) ?? [];

  return <main className="workspace-main route-main">
    <nav aria-label="Selected context" className="workspace-breadcrumbs route-crumbs"><RouteLink href="/workspace">Portfolio</RouteLink><span aria-hidden="true">/</span><span aria-current="page">Plans</span></nav>
    <section className="route-subject" aria-labelledby="workspace-title">
      <div className="route-card" id="workspace-context" tabIndex={-1}>
        <button type="button" className="route-refresh" onClick={() => setRevision(v => v + 1)}>Refresh</button>
        <p className="route-kind">Plans · every Project</p>
        <h1 id="workspace-title" className="route-title">Choose a Plan</h1>
        <p className="route-source">Read-only. Flags are computed from the Plan documents, not by a model.</p>
        {read.kind === "loading" && <p className="route-note" role="status">Reading Plans…</p>}
        {read.kind === "error" && <div className="route-problem" role="alert"><h2>Plans unavailable</h2><p>{read.message}</p><p>Refresh to try again.</p></div>}
        {unreadable.length > 0 && <p className="route-note" role="status">Couldn&apos;t read: {unreadable.map(p => p.name).join(", ")}.</p>}
        {data && <>
          <form className="plan-picker-controls" onSubmit={e => e.preventDefault()} aria-label="Filter, sort and group Plans">
            <label>Status<select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value as PickerFilters["status"] })}>
              <option value="all">All</option>{PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Project<select value={filters.project} onChange={e => setFilters({ ...filters, project: e.target.value })}>
              <option value="all">All</option>{data.projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
            <label>Progress<select value={filters.progress} onChange={e => setFilters({ ...filters, progress: e.target.value as PickerFilters["progress"] })}>
              <option value="any">Any</option><option value="none">Not started</option><option value="partial">In progress</option><option value="done">All done</option></select></label>
            <label>Sort<select value={sort} onChange={e => setSort(e.target.value as PlanSort)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>Group<select value={group} onChange={e => setGroup(e.target.value as PlanGroup)}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </form>
          <p className="route-note" role="status">{count} of {all.length} Plans</p>
          {count === 0 && <p className="route-empty">No Plan matches these filters.</p>}
          {shown.filter(g => g.plans.length > 0).map(g => <section key={g.key} className="plan-picker-group" aria-label={g.label}>
            {group !== "none" && <h2 className="plan-picker-group-title">{g.label} <span>({g.plans.length})</span></h2>}
            <ul className="plan-picker-list">{g.plans.map(p => <PlanItem key={`${p.project.slug}/${p.row.slug}`} plan={p} dupes={dupes.get(`${p.project.slug}/${p.row.slug}`) ?? []} titles={titles} />)}</ul>
          </section>)}
        </>}
      </div>
    </section>
  </main>;
}
