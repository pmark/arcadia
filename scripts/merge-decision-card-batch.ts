import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  requestFromSpec, runBatchMerge, validateBatchMergeSpec,
  type BatchMergeGateway, type BatchPrFacts, type BatchReceipt
} from "../src/decisions/batchMerge.js";

// Entry point for the operator action merge-decision-card-batch (descriptor built by
// buildBatchMergeDescriptor; the pinned spec lives in the descriptor's `batchMerge`).
// usage: merge-decision-card-batch.ts <descriptor.json> <run-directory> (--dry-run | --apply)
// Merges only through `gh pr merge --match-head-commit <pinned sha>`; one receipt per PR in
// <run-directory>/receipts/<cardId>/. Never run by an agent. Exit 0 merged or nothing to do,
// 1 refused or failed (the receipts say why), 2 usage.
const usage = "usage: merge-decision-card-batch.ts <descriptor.json> <run-directory> (--dry-run | --apply)\n";
const [descriptorArg, runDirectory, modeArg] = process.argv.slice(2);
if (!descriptorArg || !runDirectory || (modeArg !== "--dry-run" && modeArg !== "--apply")) { process.stderr.write(usage); process.exit(2); }
const dryRun = modeArg === "--dry-run";
const descriptor = JSON.parse(readFileSync(path.resolve(descriptorArg), "utf8")) as { batchMerge?: unknown };
const parsed = validateBatchMergeSpec(descriptor.batchMerge);
if (!parsed.ok) { process.stderr.write(`Refused: ${parsed.refusal.code}: ${parsed.refusal.message}\n`); process.exit(1); }
const spec = parsed.spec;
const receiptDir = path.join(path.resolve(runDirectory), "receipts", spec.cardId);
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const gateway: BatchMergeGateway = {
  readPr(number): BatchPrFacts | null {
    const pr = JSON.parse(gh(["pr", "view", String(number), "--json",
      "number,title,state,headRefOid,baseRefName,headRefName,files,reviews,statusCheckRollup,mergeCommit"])) as {
      number: number; title: string; state: string; headRefOid: string; baseRefName: string; headRefName: string;
      files: Array<{ path: string }>;
      reviews: Array<{ state: string; commit?: { oid?: string } }>;
      statusCheckRollup: Array<{ name?: string; context?: string; conclusion?: string; state?: string }>;
    };
    const required = gh(["pr", "checks", String(number), "--required", "--json", "name"]);
    return {
      number: pr.number, title: pr.title, headSha: pr.headRefOid, baseRef: pr.baseRefName, headRef: pr.headRefName,
      files: pr.files.map((f) => f.path), why: "", decisions: [],
      reviews: pr.reviews.map((r) => ({ verdict: r.state, headSha: r.commit?.oid ?? "" })),
      checks: pr.statusCheckRollup.map((c) => ({ name: c.name ?? c.context ?? "", conclusion: c.conclusion ?? c.state })),
      requiredChecks: (JSON.parse(required) as Array<{ name: string }>).map((c) => c.name),
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
      // gh does not expose the merged head; the head ref oid of a merged PR is the merged head.
      mergedHeadSha: pr.state === "MERGED" ? pr.headRefOid : null
    };
  },
  readReceipt(cardId, number) {
    const file = path.join(receiptDir, `pr-${number}.json`);
    if (!existsSync(file)) return null;
    const r = JSON.parse(readFileSync(file, "utf8")) as BatchReceipt;
    return r.cardId === cardId ? r : null;
  },
  writeReceipt(receipt) {
    if (dryRun) return;
    mkdirSync(receiptDir, { recursive: true });
    const file = path.join(receiptDir, `pr-${receipt.number}.json`);
    // A merged receipt is final; never replace it with a later refusal.
    if (existsSync(file)) {
      const prior = JSON.parse(readFileSync(file, "utf8")) as BatchReceipt;
      if (prior.outcome === "merged") return;
    }
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  },
  merge(number, headSha) {
    if (dryRun) return;
    gh(["pr", "merge", String(number), "--squash", "--match-head-commit", headSha]);
  }
};

const result = runBatchMerge(spec, requestFromSpec(spec), gateway, new Date());
process.stdout.write(`${JSON.stringify({ schema: "arcadia-batch-merge-run-v1", cardId: spec.cardId, mode: modeArg, ...result }, null, 2)}\n`);
process.exit(result.outcome === "merged" || result.outcome === "nothing_to_merge" ? 0 : 1);
