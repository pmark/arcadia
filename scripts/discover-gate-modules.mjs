#!/usr/bin/env node
/**
 * Repeatable discovery of src modules that define or enforce an approval,
 * spend, review or merge gate (Action implement-a-classifier-coverage-audit,
 * Decision 0214 answer A). Plain node, no dependencies, read-only.
 *
 * Scans every non-test src/<any depth>/*.ts file (comments stripped) for the
 * gate symbols below. A module matching any pattern is a gate CANDIDATE: it
 * must be classified by classifyAuthorityPaths or carry a reasoned exclusion in
 * tests/fixtures/authority-classifier-exclusions.json. Patterns are
 * deliberately broad: a false positive costs one operator merge, a false
 * negative lets gate code merge unattended.
 *
 * Usage: node scripts/discover-gate-modules.mjs [--json] [--root <repo>]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
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

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(full);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIdx = process.argv.indexOf("--root");
  const root = rootIdx > 0 ? resolve(process.argv[rootIdx + 1]) : undefined;
  const hits = discoverGateModules(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(hits, null, 2));
  else for (const h of hits) console.log(`${h.path}\t${h.patterns.join(",")}`);
}
