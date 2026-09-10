// Throwaway prototype behind docs/flight-plan-report-spec.md. Not a supported
// command: it exists to prove the report's arithmetic against real data and to
// measure whether the deterministic pass needs caching. It does not.
//
//   node scripts/flight-plan-prototype.mjs <workspace-path>
import Database from "better-sqlite3";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const workspace = process.argv[2] ?? process.env.ARCADIA_WORKSPACE;
if (!workspace) {
  console.error("Usage: node scripts/flight-plan-prototype.mjs <workspace-path>");
  process.exit(2);
}
const db = new Database(join(workspace, "database", "arcadia.sqlite3"), { readonly: true });

// Low/high hour band per effort tier. Low = previous tier's ceiling, high = own
// ceiling, both taken from src/orientation/effort.ts. `project` has no honest
// length by design, so it is never given a number.
const BAND = {
  quick: [0, 0.25],
  short: [0.25, 1],
  session: [1, 3]
};

const projects = db.prepare(`
  SELECT p.id, p.name, p.status, pm.repo_path
  FROM projects p LEFT JOIN project_metadata pm ON pm.project_id = p.id
  WHERE p.status = 'active' ORDER BY p.name
`).all();

const actions = db.prepare(`
  SELECT w.id, w.project_id, w.title, w.status, w.effort, w.doc_ref,
         w.work_classification, w.clarification_status, m.title AS milestone_title,
         m.status AS milestone_status
  FROM work_items w LEFT JOIN milestones m ON m.id = w.milestone_id
  WHERE w.status != 'done'
`).all();

function readPlans(repoPath) {
  const dir = repoPath ? join(repoPath, "docs", "plans") : null;
  if (!dir || !existsSync(dir)) return new Map();
  const plans = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const field = (name) => {
      const m = fm[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
    };
    if (field("type") !== "plan") continue;
    plans.set(file.replace(/\.md$/, ""), {
      slug: file.replace(/\.md$/, ""),
      status: field("status"),
      tokenImpact: field("token_impact"),
      tokenBudget: field("token_budget"),
      milestone: field("milestone"),
      currentAction: field("current_action")
    });
  }
  return plans;
}

function bandFor(list) {
  let low = 0, high = 0, unbounded = 0, unsized = 0;
  for (const a of list) {
    if (a.effort && BAND[a.effort]) { low += BAND[a.effort][0]; high += BAND[a.effort][1]; }
    else if (a.effort === "project") unbounded++;
    else unsized++;
  }
  return { low, high, unbounded, unsized, count: list.length };
}

const fmtH = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
function fmtBand(b) {
  if (b.low === 0 && b.high === 0) return "not estimable";
  return `${fmtH(b.low)}–${fmtH(b.high)}h`;
}
function caveat(b) {
  const bits = [];
  if (b.unbounded) bits.push(`+${b.unbounded} unbounded`);
  if (b.unsized) bits.push(`+${b.unsized} unsized`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

const BUCKETS = { committed: [], queued: [], adrift: [] };
const out = [];

for (const project of projects) {
  const plans = readPlans(project.repo_path);
  const mine = actions.filter((a) => a.project_id === project.id);
  const byPlan = new Map();
  const orphans = [];
  for (const a of mine) {
    const slug = a.doc_ref?.startsWith("plan/") ? a.doc_ref.slice(5).split("#")[0] : null;
    if (!slug) { orphans.push(a); continue; }
    if (!byPlan.has(slug)) byPlan.set(slug, []);
    byPlan.get(slug).push(a);
  }
  const rows = [];
  for (const [slug, list] of byPlan) {
    const plan = plans.get(slug);
    const b = bandFor(list);
    const status = plan?.status ?? "(no plan document)";
    const bucket =
      status === "active" ? "committed"
      : status === "draft" || status === "proposed" ? "queued"
      : "adrift";
    rows.push({ slug, plan, status, band: b, bucket, list });
    BUCKETS[bucket].push({ project: project.name, slug, plan, band: b });
  }
  rows.sort((a, b) => b.band.high - a.band.high);
  out.push({ project, rows, orphans, plans });
}

const L = [];
const push = (s = "") => L.push(s);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const totals = { committed: bandFor([]), queued: bandFor([]), adrift: bandFor([]) };
for (const [name, list] of Object.entries(BUCKETS)) {
  for (const r of list) {
    totals[name].low += r.band.low; totals[name].high += r.band.high;
    totals[name].unbounded += r.band.unbounded; totals[name].unsized += r.band.unsized;
    totals[name].count += r.band.count;
  }
}
const unplanned = bandFor(out.flatMap((o) => o.orphans));

const capacityRow = db.prepare("SELECT * FROM orientation_daily_capacity ORDER BY rowid DESC LIMIT 1").get();

push("FLIGHT PLAN — portfolio, all active Projects");
push(`Generated ${new Date().toISOString().slice(0, 10)} · hours are continuous building only — no review, QA, or feedback time`);
push();
push("ETA TO CLEAR THE BOARD");
push(`  Committed   active plans          ${fmtBand(totals.committed).padEnd(13)} ${plural(totals.committed.count, "Action").padEnd(11)}${caveat(totals.committed)}`);
push(`  Queued      draft/proposed plans  ${fmtBand(totals.queued).padEnd(13)} ${plural(totals.queued.count, "Action").padEnd(11)}${caveat(totals.queued)}`);
push(`  Adrift      complete/superseded   ${fmtBand(totals.adrift).padEnd(13)} ${plural(totals.adrift.count, "Action").padEnd(11)}${caveat(totals.adrift)}`);
push(`  Unplanned   captured, no plan     ${fmtBand(unplanned).padEnd(13)} ${plural(unplanned.count, "Action").padEnd(11)}${caveat(unplanned)}`);
push();
if (capacityRow) {
  push(`  At stated capacity: see \`arcadia orientation capacity\`.`);
} else {
  push("  No stated build capacity in this workspace, so hours cannot become weeks.");
  push("  Set one with `arcadia orientation capacity set` to get a delivery date.");
}
push();

push("FUEL — token exposure of committed work");
const fuel = new Map();
for (const r of BUCKETS.committed) {
  const k = r.plan?.tokenImpact ?? "unstated";
  if (!fuel.has(k)) fuel.set(k, []);
  fuel.get(k).push(r);
}
for (const tier of ["xlarge", "large", "medium", "small", "none", "unstated"]) {
  const group = fuel.get(tier);
  if (!group) continue;
  push(`  ${tier.padEnd(9)} ${plural(group.length, "plan").padEnd(9)} ${group.map((g) => g.slug.slice(0, 28)).join(", ")}`);
}
push("  Token Impact is relative exposure, not a forecast. Three xlarge plans running");
push("  at once is the signal here — not a number of tokens.");
push();

out.sort((a, b) => {
  const hi = (o) => o.rows.filter((r) => r.bucket === "committed").reduce((n, r) => n + r.band.high, 0);
  return hi(b) - hi(a);
});

for (const { project, rows, orphans } of out) {
  const all = bandFor(rows.flatMap((r) => r.list).concat(orphans));
  push("─".repeat(78));
  push(`${project.name.toUpperCase()} — ${plural(all.count, "open Action")} · ${fmtBand(all)}${caveat(all)}`);
  if (!project.repo_path) push("  (no repo path — plan documents unreadable)");
  push();
  for (const label of ["committed", "queued", "adrift"]) {
    const group = rows.filter((r) => r.bucket === label);
    if (!group.length) continue;
    const heading = { committed: "COMMITTED", queued: "QUEUED", adrift: "ADRIFT" }[label];
    push(`  ${heading}`);
    for (const r of group) {
      const ms = r.plan?.milestone ?? r.list[0]?.milestone_title ?? "(no milestone)";
      push(`    ${ms.length > 66 ? ms.slice(0, 63) + "..." : ms}`);
      push(`      plan/${r.slug}  [${r.status}]  tokens: ${r.plan?.tokenImpact ?? "?"}`);
      push(`      ${plural(r.band.count, "Action")} · ${fmtBand(r.band)}${caveat(r.band)}`);
      if (r.plan?.currentAction) push(`      current: ${r.plan.currentAction}`);
      if (label === "adrift") {
        const msStatus = r.list[0]?.milestone_status;
        push(`      ! plan is ${r.status}${msStatus ? `, milestone is ${msStatus}` : ""} — unreachable through the pointer chain`);
      }
      push();
    }
  }
  if (orphans.length) {
    const b = bandFor(orphans);
    push(`  UNPLANNED — ${plural(orphans.length, "captured Action")}, no plan document${caveat(b)}`);
    push();
  }
}

push("─".repeat(78));
push("SIZING COVERAGE — the report is only as good as this");
for (const { project, rows, orphans } of out) {
  const all = bandFor(rows.flatMap((r) => r.list).concat(orphans));
  const sized = all.count - all.unsized;
  const pct = all.count ? Math.round((sized / all.count) * 100) : 0;
  push(`  ${project.name.padEnd(24)} ${String(pct).padStart(3)}% sized  (${sized}/${all.count})${all.unbounded ? ` · ${all.unbounded} need breakdown` : ""}`);
}

console.log(L.join("\n"));
