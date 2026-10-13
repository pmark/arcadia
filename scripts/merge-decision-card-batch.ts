import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBatchMerge, type BatchMergeGateway, type BatchPrFacts, type BatchReceipt } from "../src/decisions/batchMerge.js";
import { runBatchMergeGuard, systemGit } from "../src/decisions/batchMergeGuard.js";

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
// Anchor to this script's own checkout, never to wherever the descriptor claims to live.
const repoRoot = realpathSync(path.resolve(import.meta.dirname, ".."));
const guarded = runBatchMergeGuard({ repoRoot, descriptorPath, env: process.env, dryRun, git: systemGit(repoRoot) });
if (!guarded.ok) refuse(guarded.code, guarded.message);
const { spec, request } = guarded;

const REPO = spec.repo;
const receiptDir = path.join(path.resolve(runDirectory), "receipts", spec.cardId);
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

interface GhFileRow { filename: string; previous_filename?: string | null }

const gateway: BatchMergeGateway = {
  readPr(number): BatchPrFacts | null {
    const pr = JSON.parse(gh(["pr", "view", String(number), "--repo", REPO, "--json",
      "number,title,state,headRefOid,baseRefName,headRefName,author,reviews,statusCheckRollup"])) as {
      number: number; title: string; state: string; headRefOid: string; baseRefName: string; headRefName: string;
      author?: { login?: string };
      reviews: Array<{ state: string; author?: { login?: string }; commit?: { oid?: string } }>;
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
      author: pr.author?.login ?? null,
      reviews: pr.reviews.map((r) => ({ verdict: r.state, headSha: r.commit?.oid ?? "", author: r.author?.login ?? null })),
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
