/**
 * Plan summaries (docs/generated/plan-summaries/README.md).
 *
 *   node --import tsx scripts/plan-summaries.ts check [--json] [--enforce]
 *     Read-only report of missing, stale and invalid summaries. --enforce exits 1 when any exist.
 *   node --import tsx scripts/plan-summaries.ts stamp <authored.json> [...]
 *     Writes docs/generated/plan-summaries/<plan>.json from authored text, adding current source fingerprints.
 *     The authored file carries the summary fields without fingerprints; Plan documents are never written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PLAN_SUMMARY_DIR, checkPlanSummaries, readPlanSources, stampPlanSummary } from "../src/docs/planSummaries.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const [command, ...args] = process.argv.slice(2);

if (command === "check") {
  const report = checkPlanSummaries(repoRoot);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const { counts, actions } = report;
    console.log(`Plan summaries: ${counts.fresh} fresh, ${counts.stale} stale, ${counts.missing} missing, ${counts.invalid} invalid of ${report.plans.length} Plans.`);
    console.log(`Action entries: ${actions.fresh} fresh, ${actions.stale} stale, ${actions.missing} missing of ${actions.total}.`);
    for (const plan of report.plans.filter(p => p.state !== "fresh")) {
      const stale = plan.actions.filter(a => a.state !== "fresh").map(a => `${a.id} (${a.state})`);
      console.log(`- ${plan.plan} [${plan.status ?? "no status"}]: ${plan.state}${stale.length && plan.state !== "missing" ? `; ${stale.join(", ")}` : ""}${plan.orphaned.length ? `; orphaned ${plan.orphaned.join(", ")}` : ""}`);
    }
  }
  const unhealthy = report.counts.stale + report.counts.missing + report.counts.invalid;
  process.exitCode = args.includes("--enforce") && unhealthy > 0 ? 1 : 0;
} else if (command === "stamp" && args.length) {
  const sources = new Map(readPlanSources(repoRoot).map(p => [p.slug, p]));
  for (const file of args) {
    const authored = JSON.parse(readFileSync(file, "utf8")) as Parameters<typeof stampPlanSummary>[1] & { plan: string };
    const plan = sources.get(authored.plan);
    if (!plan) throw new Error(`${file}: no type: plan record under docs/plans has slug "${authored.plan}".`);
    const { plan: _slug, ...text } = authored;
    const summary = stampPlanSummary(plan, text);
    writeFileSync(path.join(repoRoot, PLAN_SUMMARY_DIR, `${plan.slug}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote ${PLAN_SUMMARY_DIR}/${plan.slug}.json (${summary.actions.length} Actions).`);
  }
} else {
  console.error("Usage: plan-summaries.ts check [--json] [--enforce] | stamp <authored.json> [...]");
  process.exitCode = 2;
}
