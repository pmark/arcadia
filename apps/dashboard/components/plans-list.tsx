import type { PlanRow } from "../lib/plans-types";

/**
 * Puts the plan the operator most needs to see first: the active pointer,
 * then anything already underway, then everything else in file order. Used
 * by both the Project detail brief and the full Plans page so "top 4" and
 * "everything" agree on what "top" means.
 */
export function orderPlans(plans: PlanRow[]): PlanRow[] {
  const rank = (plan: PlanRow): number => {
    if (plan.isActivePlan) return 0;
    if (plan.status === "active") return 1;
    if (plan.status === "draft") return 2;
    return 3;
  };
  return [...plans].sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug));
}

function statusStyle(plan: PlanRow): string {
  if (plan.isActivePlan) return "border-moss/40 bg-moss/10 text-moss";
  if (!plan.governed) return "border-gold/40 bg-gold/10 text-gold";
  if (plan.status === "complete") return "border-line bg-canvas text-muted";
  return "border-steel/30 bg-steel/10 text-steel";
}

function statusLabel(plan: PlanRow): string {
  if (plan.isActivePlan) return "active plan";
  return plan.governed ? plan.status : `${plan.status} · ungoverned`;
}

export function PlanListRow({ plan, detailed }: { plan: PlanRow; detailed: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-panel p-3 text-sm shadow-soft">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink">{plan.slug}</span>
        <span className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-semibold ${statusStyle(plan)}`}>
          {statusLabel(plan)}
        </span>
      </div>
      {plan.milestone ? <p className="mt-1 break-words text-muted">{plan.milestone}</p> : null}
      {plan.actionCounts ? (
        <p className="mt-1 text-xs text-muted">
          {plan.actionCounts.open} open · {plan.actionCounts.in_progress} in progress · {plan.actionCounts.blocked} blocked · {plan.actionCounts.done} done
        </p>
      ) : null}
      {!plan.governed && detailed ? (
        <p className="mt-2 rounded-md border border-gold/30 bg-gold/5 px-2 py-1.5 text-xs text-ink">
          <span className="font-semibold text-gold">Becomes current when: </span>
          {plan.activationNote ?? `Not stated in ${plan.relativePath} — add an "If not now, then when?" trigger.`}
        </p>
      ) : null}
      {detailed ? <p className="mt-2 truncate text-xs text-muted">{plan.relativePath}</p> : null}
    </div>
  );
}
