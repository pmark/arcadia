#!/usr/bin/env node
/**
 * Repeatable discovery of src modules that define or enforce an approval,
 * spend, review or merge gate (Action implement-a-classifier-coverage-audit,
 * Decision 0214 answer A). Plain node, no dependencies, read-only.
 *
 * Scans every non-test src/<any depth>/*.ts file (comments stripped) for the
 * gate symbols below. A module matching any pattern is a gate CANDIDATE: it
 * must be classified by classifyAuthorityPaths or carry a reasoned entry in the
 * unclassified-src inventory (below). Patterns are
 * deliberately broad: a false positive costs one operator merge, a false
 * negative lets gate code merge unattended.
 *
 * Default-deny inventory (--inventory): every src module classifyAuthorityPaths
 * leaves unclassified is listed in tests/fixtures/authority-unclassified-src-inventory.json
 * with a reason; tests/authority-classifier-coverage.test.ts fails on any
 * unclassified file missing from it, so a new file forces a decision.
 * --inventory rewrites that file (keeping existing per-file reasons), --check
 * prints drift without writing.
 *
 * Usage: node scripts/discover-gate-modules.mjs [--json] [--root <repo>] [--inventory [--check]]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Gate pattern name -> regex run against comment-stripped source. */
export const GATE_PATTERNS = {
  approval: /\b(?:isApproved|requireApproval|approvalRequired|approvedBy|operatorApproval|approval(?:Gate|Check|Proof|Receipt)|assertApproved|OperatorApproval)\b/,
  grant: /\b(?:hasGrant|requireGrant|dailyGrant|criticalPathGrant|grantAuthority|GrantScope|GrantRecord)\b/,
  paid_usage: /\b(?:approvedPaidUsage\w*|APPROVED_PAID_USAGE\w*|paidUsage\w*|paidRoute\w*|noSpend|no-spend)\b/i,
  spend: /\b(?:spendCheck|spendGate|spendReceipt|SpendReceipt|spend-check|paidFallback|budgetGuard|allowedModels?|modelAllowlist|allowlist)\b/i,
  review: /(?:reviewProof|independentReview|requireReview|reviewGate|reviewerVerdict|reviewPassed|approvedReview\w*|ReviewScope|review[-_]proof|(?:Review|review)(?:Verdict|Outcome)\w*|Verdict(?:Kind|Result)|verdict[-_]marker|Independent review, head)/,
  merge: /\b(?:mergeThroughPullRequest|mergePullRequest|mergePr|mergeGate|mergeAuthority|canMerge|autoMerge|workerMerge|batchMerge|merge_commit)\b|gh pr merge/,
  authority: /\b(?:operatorAuthority|requireOperator|assertOperator|operator_acceptance|deterministic_proof|authorityBoundary|requireAuthority|assertAuthority|requestedAuthority|requested_authority)\b/,
  decision: /\b(?:answerDecision|decisionAnswer|recordDecisionAnswer|applyDecisionAnswer|decision_answer|decisionGate|requireDecision|unresolvedDecision)\b/,
  start_gate: /\b(?:START_APPROVAL|startApproval|productionStart|usageGate|admissionGate)\b/,
};

const COMMENT_RE = /\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g;

export function stripComments(text) {
  return text.replace(COMMENT_RE, (m, lead) => (lead === undefined ? " " : lead));
}

function walk(dir, out, includeData = false) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out, includeData);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(full);
    else if (includeData && (name.endsWith(".md") || name.endsWith(".json"))) out.push(full);
  }
  return out;
}

/** Sorted [{ path, patterns }] for every src module matching at least one gate pattern. */
export function discoverGateModules(root = resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  const hits = [];
  for (const file of walk(join(root, "src"), [])) {
    const code = stripComments(readFileSync(file, "utf8"));
    const patterns = Object.entries(GATE_PATTERNS)
      .filter(([, re]) => re.test(code))
      .map(([name]) => name);
    if (patterns.length > 0) hits.push({ path: relative(root, file).split(sep).join("/"), patterns });
  }
  return hits.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export const INVENTORY_PATH = "tests/fixtures/authority-unclassified-src-inventory.json";

/** Longest-prefix reason for an unclassified file that carries no per-file reason. */
const GROUP_REASONS = [
  ["src/commands/", "CLI command wrapper judged read-only, reporting or capture; state changes and gates run in classified modules (src/ask, src/decisions, src/sessions, src/dispatch, src/spend)."],
  ["src/timeline/", "Read-only projection of existing records for display."],
  ["src/orientation/", "Read-only orientation and status text."],
  ["src/digests/", "Digest composition and rendering; read-only until a classified messaging path sends it."],
  ["src/markdown/", "Markdown rendering of existing records; no gate logic."],
  ["src/reports/", "Read-only reports and ledgers."],
  ["src/journey/", "Read-only journey derivation for display."],
  ["src/northStar/", "North Star computation and narrative; read-only (document.ts is classified)."],
  ["src/activity/", "Activity feed projection; read-only."],
  ["src/design/", "Design record helpers; no gate logic."],
  ["src/intelligence/speech/", "Speech and audio helpers behind the Intelligence service; no gate logic."],
  ["src/intelligence/", "Intelligence plumbing (storage, validation, artifacts); routing, config and spend gates live in classified src/intelligence/{config,routing,...}."],
  ["src/intake/", "Intake normalization to propose-only Ask payloads; grants nothing."],
  ["src/proofTargets/", "Read-only proof-target checks and display."],
  ["src/livingSystem/", "Derived living-system projection; project.ts and sync.ts are classified."],
  ["src/clarify/", "Clarification linting and types; no gate decisions (grader, contract and engine are classified)."],
  ["src/dashboard/", "Dashboard display helpers; mutating routes are classified under apps/dashboard."],
  ["src/utils/", "Generic helpers."],
  ["src/db/", "Database connection plumbing; schema.ts and repositories.ts are classified."],
  ["src/memory/", "Obsidian memory export; no gate logic."],
  ["src/prompts/", "Prompt text; enforces nothing."],
  ["src/agentRoles/", "Brief text for roles; the registry is classified."],
  ["src/agentWatch/", "Watch helpers; classify.ts and contract.ts are classified."],
  ["src/fixtures/", "Rehearsal fixture builder; not on a production code path."],
  ["src/soak/", "Rehearsal soak harness; not a production gate."],
  ["src/codex/", "Provider-specific invocation helpers without gate logic."],
  ["src/", "Unreviewed: needs an explicit classify or exclude decision."],
];

function reasonFor(path) {
  let best = null;
  for (const [prefix, reason] of GROUP_REASONS) if (path.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, reason];
  return best ? best[1] : "Unreviewed.";
}

/** Every non-test src/**.ts path plus src .md and .json files (installed instructions, data), repo-relative, sorted. */
export function listSourceFiles(root = resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  return walk(join(root, "src"), [], true).map((f) => relative(root, f).split(sep).join("/")).sort();
}

/** Paths classifyAuthorityPaths leaves unclassified, via a tsx child so the TS classifier stays the single source. */
export function listUnclassifiedSourceFiles(root) {
  const code = `import { classifyAuthorityPaths } from "./src/decisions/batchMerge.ts"; const p = JSON.parse(process.argv[1]); console.log(JSON.stringify(p.filter((f) => classifyAuthorityPaths([f]).length === 0)));`;
  const out = execFileSync("pnpm", ["exec", "tsx", "--eval", code, JSON.stringify(listSourceFiles(root))], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim().split("\n").pop());
}

export function buildInventory(unclassified, existing = {}, scanHits = []) {
  const hitMap = new Map(scanHits.map((h) => [h.path, h.patterns]));
  const entries = {};
  for (const path of unclassified) {
    const prev = existing[path];
    entries[path] = {
      reason: prev?.reason ?? (reasonFor(path)),
      gateScanPatterns: hitMap.get(path) ?? [],
    };
  }
  return entries;
}

if (process.argv.includes("--inventory") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIdx = process.argv.indexOf("--root");
  const root = rootIdx > 0 ? resolve(process.argv[rootIdx + 1]) : resolve(fileURLToPath(new URL("..", import.meta.url)));
  const file = join(root, INVENTORY_PATH);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).entries ?? {} : {};
  const unclassified = listUnclassifiedSourceFiles(root);
  const entries = buildInventory(unclassified, existing, discoverGateModules(root));
  const doc = {
    comment: "Default-deny inventory: every src module classifyAuthorityPaths leaves unclassified, each with a reason. Regenerate with node scripts/discover-gate-modules.mjs --inventory. tests/authority-classifier-coverage.test.ts fails on a missing, stale or newly classified entry.",
    entries,
  };
  if (process.argv.includes("--check")) {
    const drift = JSON.stringify(Object.keys(existing)) !== JSON.stringify(Object.keys(entries));
    console.log(drift ? "inventory drift" : "inventory current");
    process.exit(drift ? 1 : 0);
  }
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${Object.keys(entries).length} entries to ${INVENTORY_PATH}`);
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIdx = process.argv.indexOf("--root");
  const root = rootIdx > 0 ? resolve(process.argv[rootIdx + 1]) : undefined;
  const hits = discoverGateModules(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(hits, null, 2));
  else for (const h of hits) console.log(`${h.path}\t${h.patterns.join(",")}`);
}
