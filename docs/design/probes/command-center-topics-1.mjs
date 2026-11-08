// Probe command-center-topics-1 (docs/design/operator-command-center.md, section 1). Throwaway; not production code.
//
// How do deterministic subject keys cluster real operator-timeline events into topics, and what share is material?
// Read-only: it reads a saved timeline file and prints counts only (no titles, because this repository is public).
//
//   arcadia timeline --since 48h --limit 5000 --pull-requests --json > timeline.json
//   node docs/design/probes/command-center-topics-1.mjs timeline.json
import { readFileSync } from "node:fs";

const events = JSON.parse(readFileSync(process.argv[2], "utf8")).data.events;
const JOIN_KEYS = ["action", "pullRequest", "branch", "session", "ask", "decision"];
// The design's material list, as timeline kind names seen in the probe window; the 15% share depends on this list.
const MATERIAL = /^(pr\.merged|pr\.closed|record\.action\.done|record\.decision\.(raised|answered)|production\.(policy\.|escalation)|event\.managed_production\.scope_complete)/;

const parent = new Map();
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const join = (a, b) => { for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n); parent.set(find(a), find(b)); };

events.forEach((event, i) => {
  const id = `e${i}`; parent.set(id, id);
  const s = event.subjects ?? {};
  for (const key of JOIN_KEYS) {
    const value = s[key];
    if (!value || (key === "branch" && /^(main|master|HEAD)$/.test(value))) continue;
    join(id, `${key}:${s.project ?? "?"}/${value}`);
  }
});
const groups = new Map();
events.forEach((event, i) => { const root = find(`e${i}`); groups.set(root, [...(groups.get(root) ?? []), event]); });

// The Plan is a label, not a join key: groups that carry the same Plan form one Plan topic.
const planTopics = new Map();
const offPlan = [];
const loose = [];
for (const group of groups.values()) {
  const carrier = group.find(e => e.subjects.plan);
  const plan = carrier ? `${carrier.subjects.project ?? "?"}/${carrier.subjects.plan}` : null;
  if (plan) planTopics.set(plan, (planTopics.get(plan) ?? 0) + group.length);
  else if (group.length >= 2) offPlan.push(group);
  else loose.push(...group);
}
const projectsWithOther = new Set(offPlan.map(g => g[0].subjects.project).filter(Boolean));
const material = events.filter(e => e.attention || MATERIAL.test(e.kind)).length;
const looseKinds = {};
for (const e of loose) looseKinds[e.kind] = (looseKinds[e.kind] ?? 0) + 1;

console.log(JSON.stringify({
  events: events.length,
  planTopics: [...planTopics.values()].sort((a, b) => b - a),
  offPlanThreads: offPlan.length,
  offPlanThreadsOf3OrMore: offPlan.filter(g => g.length >= 3).length,
  offPlanReviewItemPairs: offPlan.filter(g => g.every(e => e.kind.startsWith("decision.review_item"))).length,
  projectsWithOtherWork: projectsWithOther.size,
  topicsOnPage: planTopics.size + projectsWithOther.size,
  looseEvents: loose.length,
  looseAttention: loose.filter(e => e.attention).length,
  looseTopKinds: Object.entries(looseKinds).sort((a, b) => b[1] - a[1]).slice(0, 4),
  materialShare: `${(100 * material / events.length).toFixed(1)}%`
}, null, 1));
