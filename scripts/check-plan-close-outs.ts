import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDoc } from "../src/docs/parse.js";
import { PLAN_SLUG, validateCloseOut } from "../src/plans/closeOut.js";

// Deterministic, read-only: validates every docs/plans/<slug>.close-out.json (schema, hash recomputation,
// Action ids exist in the Plan document, no duplicates). An optional argument is the repository root.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const plansDir = path.join(root, "docs", "plans");
const errors: string[] = [];
const files = existsSync(plansDir) ? readdirSync(plansDir).filter(name => name.endsWith(".close-out.json")).sort() : [];
for (const name of files) {
  const label = `docs/plans/${name}`;
  const slug = name.slice(0, -".close-out.json".length);
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(path.join(plansDir, name), "utf8"));
  } catch (error) {
    errors.push(`${label}: invalid JSON (${(error as Error).message})`);
    continue;
  }
  const planFile = path.join(plansDir, `${slug}.md`);
  let planIds: Set<string> | undefined;
  if (!PLAN_SLUG.test(slug)) errors.push(`${label}: file name must be <plan-slug>.close-out.json`);
  else if (!existsSync(planFile)) errors.push(`${label}: Plan document docs/plans/${slug}.md does not exist`);
  else {
    const parsed = parseDoc(`docs/plans/${slug}.md`, planFile, readFileSync(planFile, "utf8"));
    if (parsed.doc?.type === "plan") planIds = new Set(parsed.doc.actions.map(action => action.id));
    else errors.push(`${label}: docs/plans/${slug}.md is not a valid Plan`);
  }
  for (const problem of validateCloseOut(record, planIds)) errors.push(`${label}: ${problem}`);
  const recordedSlug = (record as { plan?: { slug?: unknown } } | null)?.plan?.slug;
  if (typeof recordedSlug === "string" && recordedSlug !== slug) errors.push(`${label}: plan.slug ${recordedSlug} does not match the file name`);
}
if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`plan close-out records valid (${files.length}): ${root}\n`);
