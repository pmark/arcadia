import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertBatchExecutionContext, parseBatchMergeRequest, runBatchMerge, validateBatchMergeSpec,
  type BatchMergeGateway, type BatchPrFacts, type BatchReceipt
} from "../src/decisions/batchMerge.js";

// Entry point for the operator action whose id is a batch card id (descriptor built by
// buildBatchMergeDescriptor; the pinned spec lives in the descriptor's `batchMerge` and the
// exact button request in `batchMergeRequest`, both reviewed and merged before this runs).
// usage: merge-decision-card-batch.ts <descriptor.json> <run-directory> (--dry-run | --apply)
// Merges only through `gh pr merge --repo <spec.repo> --match-head-commit <pinned sha>`; one
// receipt per PR in <run-directory>/receipts/<cardId>/. Never run by an agent. Exit 0: merged,
// nothing to merge, or dry run. 1: refused, stopped or failed (the receipts say why). 2: usage.
const usage = "usage: merge-decision-card-batch.ts <descriptor.json> <run-directory> (--dry-run | --apply)\n";
const [descriptorArg, runDirectory, modeArg] = process.argv.slice(2);
if (!descriptorArg || !runDirectory || (modeArg !== "--dry-run" && modeArg !== "--apply")) { process.stderr.write(usage); process.exit(2); }
const dryRun = modeArg === "--dry-run";
function refuse(code: string, message: string): never {
  process.stderr.write(`Refused: ${code}: ${message}\n`);
  process.exit(1);
}

const descriptorPath = path.resolve(descriptorArg);
const repoRoot = realpathSync(path.resolve(path.dirname(descriptorPath), "../../.."));
const scriptId = path.basename(descriptorPath, ".json");
const git = (args: string[]): string | null => {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
};
const TRACKED = [
  `artifacts/generated/operator-scripts/${scriptId}.json`,
  `artifacts/generated/operator-scripts/${scriptId}.sh`,
  "scripts/merge-decision-card-batch.ts",
  "src/decisions/batchMerge.ts",
  "src/decisions/card.ts"
];
const envDescriptor = process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR;
if (!dryRun) git(["fetch", "origin", "main"]);
const guard = assertBatchExecutionContext({
  scriptId,
  descriptorPath,
  env: { ...process.env, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: envDescriptor ? path.resolve(envDescriptor) : undefined },
  allTracked: TRACKED.every((file) => git(["ls-files", "--error-unmatch", file]) !== null),
  modifiedLocally: git(["diff", "--quiet", "HEAD", "--", ...TRACKED]) === null,
  differsFromOriginMain: git(["diff", "--quiet", "origin/main", "--", ...TRACKED]) === null,
  dryRun
});
if (guard) refuse(guard.code, guard.message);

const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as { id?: unknown; batchMerge?: unknown; batchMergeRequest?: unknown };
const parsedSpec = validateBatchMergeSpec(descriptor.batchMerge);
if (!parsedSpec.ok) refuse(parsedSpec.refusal.code, parsedSpec.refusal.message);
const spec = parsedSpec.spec;
if (descriptor.id !== scriptId || spec.cardId !== scriptId) refuse("card_id_mismatch", "The descriptor id, file name and pinned card id must be one value.");
// The request is what the published card's button posts; it is read from the descriptor, never rebuilt from the spec.
const parsedRequest = parseBatchMergeRequest(descriptor.batchMergeRequest);
if (!parsedRequest.ok) refuse(parsedRequest.refusal.code, parsedRequest.refusal.message);
const request = parsedRequest.request;

const REPO = spec.repo;
const receiptDir = path.join(path.resolve(runDirectory), "receipts", spec.cardId);
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

interface GhFileRow { filename: string; previous_filename?: string | null }

const gateway: BatchMergeGateway = {
  readPr(number): BatchPrFacts | null {
    const pr = JSON.parse(gh(["pr", "view", String(number), "--repo", REPO, "--json",
      "number,title,state,headRefOid,baseRefName,headRefName,reviews,statusCheckRollup"])) as {
      number: number; title: string; state: string; headRefOid: string; baseRefName: string; headRefName: string;
      reviews: Array<{ state: string; commit?: { oid?: string } }>;
      statusCheckRollup: Array<{ name?: string; context?: string; conclusion?: string; state?: string }>;
    };
    // The REST file list names renames' old paths too and is paginated; any page error throws and
    // refuses the batch. The PR's own changed_files count is compared by the card's gate.
    const meta = JSON.parse(gh(["api", `repos/${REPO}/pulls/${number}`])) as { changed_files?: number };
    const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${REPO}/pulls/${number}/files`])) as GhFileRow[][];
    const files = pages.flat().map((row) => ({ filename: row.filename, previous_filename: row.previous_filename ?? null }));
    const required = JSON.parse(gh(["pr", "checks", String(number), "--repo", REPO, "--required", "--json", "name"])) as Array<{ name: string }>;
    return {
      number: pr.number, title: pr.title, headSha: pr.headRefOid, baseRef: pr.baseRefName, headRef: pr.headRefName,
      files, changedFiles: meta.changed_files ?? null, why: "", decisions: [],
      reviews: pr.reviews.map((r) => ({ verdict: r.state, headSha: r.commit?.oid ?? "" })),
      checks: pr.statusCheckRollup.map((c) => ({ name: c.name ?? c.context ?? "", conclusion: c.conclusion ?? c.state })),
      requiredChecks: required.map((c) => c.name),
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
      // A merged PR's head ref oid is the head it was merged at.
      mergedHeadSha: pr.state === "MERGED" ? pr.headRefOid : null
    };
  },
  readReceipt(cardId, number) {
    const file = path.join(receiptDir, `pr-${number}.json`);
    if (!existsSync(file)) return null;
    try {
      const r = JSON.parse(readFileSync(file, "utf8")) as BatchReceipt;
      return r.cardId === cardId ? r : null;
    } catch (error) {
      // The runner treats a throw as an unreadable receipt and refuses before merging anything.
      throw new Error(`corrupt receipt ${file}`, { cause: error });
    }
  },
  writeReceipt(receipt) {
    if (dryRun) return;
    mkdirSync(receiptDir, { recursive: true });
    const file = path.join(receiptDir, `pr-${receipt.number}.json`);
    // A merged receipt is final; never replace it with a later refusal.
    if (existsSync(file)) {
      try {
        if ((JSON.parse(readFileSync(file, "utf8")) as BatchReceipt).outcome === "merged") return;
      } catch { /* an unreadable older receipt is replaced by this one */ }
    }
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  },
  merge(number, headSha) {
    if (dryRun) throw new Error("dry run must not merge");
    gh(["pr", "merge", String(number), "--repo", REPO, "--squash", "--match-head-commit", headSha]);
  }
};

const result = runBatchMerge(spec, request, gateway, new Date(), { dryRun });
process.stdout.write(`${JSON.stringify({ schema: "arcadia-batch-merge-run-v1", cardId: spec.cardId, mode: modeArg, ...result }, null, 2)}\n`);
process.exit(result.outcome === "merged" || result.outcome === "nothing_to_merge" || result.outcome === "dry_run" ? 0 : 1);
