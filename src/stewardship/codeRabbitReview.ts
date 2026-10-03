// The CodeRabbit review loop an agent runs after pushing to a PR, as two
// commands under `arcadia pr`:
//
//   arcadia pr code-review <pr>              wait for CodeRabbit, return a verdict
//   arcadia pr decline-finding <thread> <why> reply on a thread and resolve it
//
// `code-review` blocks until CodeRabbit has finished reviewing the PR's pushed
// head, then returns `done`, `fix`, or `cap` (findings outlived
// MAX_FIX_ROUNDS pushes; hand them to the operator). A draft PR, an unpushed
// HEAD, a timeout, or a CodeRabbit failure is an error, never a verdict. So is
// a `success` status that is not a completed review -- CodeRabbit marks a
// paused, skipped or rate-limited head `success` too (#874, #892) -- which
// fails as CODE_REVIEW_NOT_COMPLETED naming why.
//
// Review evidence is bound to the head it was given on: only an APPROVED
// review by the CodeRabbit bot itself on the exact current head is approval.
// A push invalidates every earlier review, so an older approval never carries
// over to a changed head, and the head is re-read after the evidence is
// gathered so a push mid-read is re-evaluated rather than judged on stale data.
//
// The signals are the ones CodeRabbit already emits: a `CodeRabbit` commit
// status that goes pending -> success per head, review threads it resolves
// itself once a later commit fixes them, and — with `request_changes_workflow`
// in the repository's .coderabbit.yaml — an APPROVED review when nothing is
// left. So "done" is read, not guessed.
//
// Everything runs through `gh` in the repository's own checkout, so it needs
// only the `gh` auth the agent already pushes with, and no workspace.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { ArcadiaError, validationError } from "../cli/errors.js";

export const MAX_FIX_ROUNDS = 3;
const BOT = "coderabbitai";
// The exact login GitHub's REST API reports for the CodeRabbit app's bot. The
// `[bot]` suffix cannot belong to a user account, so it identifies the actual
// reviewer: only its reviews and its commit status are review evidence. `BOT`
// above is only the permissive prefix used to find threads that may block.
export const REVIEWER_LOGIN = "coderabbitai[bot]";
const POLL_MS = 30_000;

export interface Review {
  // The reviewer's login; only reviews by REVIEWER_LOGIN are review evidence.
  author: string;
  state: string;
  commitId: string;
  submittedAt: string;
  body: string;
}

export interface Thread {
  id: string;
  // The head CodeRabbit opened the thread on, which is what makes that head a
  // fix round whatever the review's state.
  commitId: string;
  isResolved: boolean;
  isOutdated: boolean;
  author: string;
  path: string;
  line: number | null;
  url: string;
  body: string;
}

export interface Finding {
  threadId: string;
  path: string;
  line: number | null;
  url: string;
  outdated: boolean;
  body: string;
}

export interface Verdict {
  verdict: "done" | "fix" | "cap";
  head: string;
  approved: boolean;
  // Every verdict comes from a completed review of `head` (anything else is an
  // error); this says whether that review approved `head` itself.
  reviewStatus: "approved" | "completed_not_approved";
  fixRound: number;
  maxFixRounds: number;
  findings: Finding[];
  // CodeRabbit puts findings on lines outside the diff in the review body,
  // with no thread to reply to or resolve. They appear only in `prompt`, and
  // they never block `done` on their own: a finding with no thread can never
  // be resolved, so blocking on it would strand a round that only declines.
  // When one matters, CodeRabbit's CHANGES_REQUESTED review is what blocks.
  outsideDiffFindings: boolean;
  prompt: string | null;
  note: string;
}

// Pure: everything the loop decides, given what GitHub reported for `head`.
export function decide(head: string, reviews: Review[], threads: Thread[]): Verdict {
  // CodeRabbit posts each reply to a thread as its own empty COMMENTED
  // review (seen live on pmark/arcadia#324). Counting those would let a reply
  // mask a real CHANGES_REQUESTED review, and its missing prompt would hide
  // the actual one, so only reviews that say something count. And only the
  // CodeRabbit bot's own reviews are evidence at all: anyone else's review --
  // even from a look-alike login -- can neither approve nor clear a head.
  const bot = reviews
    .filter((review) => review.author === REVIEWER_LOGIN)
    .filter((review) => review.state !== "PENDING")
    .filter((review) => review.state !== "COMMENTED" || review.body.trim() !== "")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const onHead = bot.filter((review) => review.commitId === head);
  const latestOnHead = onHead.at(-1);

  const findings: Finding[] = threads
    .filter((thread) => thread.author.startsWith(BOT) && !thread.isResolved)
    .map((thread) => ({
      threadId: thread.id,
      path: thread.path,
      line: thread.line,
      url: thread.url,
      outdated: thread.isOutdated,
      body: condense(thread.body)
    }));

  // A round is one reviewed head that came back with something to fix: a head
  // CodeRabbit opened a thread on, or requested changes on. Review state alone
  // cannot say: without request_changes_workflow every review is COMMENTED,
  // including ones that only list findings outside the diff.
  const roundHeads = new Set([
    ...bot.filter((review) => review.state === "CHANGES_REQUESTED").map((review) => review.commitId),
    ...threads.filter((thread) => thread.author.startsWith(BOT)).map((thread) => thread.commitId)
  ]);
  const prompt = extractPrompt(latestOnHead?.body ?? "");
  const outsideDiffFindings = hasOutsideDiffFindings(prompt ?? "");
  // Approval is evidence about one head, from one reviewer: the latest review
  // must be the CodeRabbit bot's own APPROVED review of exactly this head, with
  // nothing left open. CodeRabbit may leave an earlier approval standing when
  // it finds a later push clean (pmark/arcadia#325), and GitHub's
  // reviewDecision keeps showing it, but that approval reviewed a different
  // head: a push invalidates it (#874).
  const latest = bot.at(-1);
  const approved =
    latest?.state === "APPROVED" && latest.commitId === head && findings.length === 0;
  const earlierApproval = !approved && bot.some((review) => review.state === "APPROVED" && review.commitId !== head);
  if (findings.length > 0) roundHeads.add(head);
  const fixRound = roundHeads.size;
  const outsideNote = outsideDiffFindings
    ? " CodeRabbit also listed findings outside the diff in `prompt`; they have no thread, so fix them or name any you decline in the handoff."
    : "";

  const reviewStatus: Verdict["reviewStatus"] = approved ? "approved" : "completed_not_approved";
  const base = { head, approved, reviewStatus, fixRound, maxFixRounds: MAX_FIX_ROUNDS, findings, outsideDiffFindings, prompt };

  if (approved) return { ...base, verdict: "done", note: `CodeRabbit approved this head.${outsideNote}` };
  if (findings.length === 0 && latestOnHead?.state !== "CHANGES_REQUESTED") {
    const earlierNote = earlierApproval ? " CodeRabbit approved an earlier head, which does not approve this one." : "";
    return {
      ...base,
      verdict: "done",
      note: `CodeRabbit completed its review of this head with no unresolved threads, but gave no approval on this head; report that rather than claiming approval.${earlierNote}${outsideNote}`
    };
  }
  if (fixRound > MAX_FIX_ROUNDS) {
    return {
      ...base,
      verdict: "cap",
      note: `Findings remain after ${MAX_FIX_ROUNDS} fix rounds. Stop and put the remaining findings to the operator.`
    };
  }
  return {
    ...base,
    verdict: "fix",
    note: `Fix round ${fixRound} of ${MAX_FIX_ROUNDS}. Fix valid findings, decline wrong ones with 'arcadia pr decline-finding', push, and run 'arcadia pr code-review' again.${outsideNote}`
  };
}

// CodeRabbit comment bodies carry long <details> analysis chains and HTML
// markers; the finding itself is the text outside them.
export function condense(body: string): string {
  return body
    .replace(/<details>[\s\S]*?<\/details>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The review body's own heading for these has changed shape across CodeRabbit
// releases; the agent prompt's section label is the stable marker.
export function hasOutsideDiffFindings(prompt: string): boolean {
  return /^Outside diff (range )?comments:/im.test(prompt);
}

export type CodeRabbitStatus =
  | { kind: "waiting" }
  | { kind: "failed" }
  | { kind: "completed" }
  | { kind: "not_reviewed"; reason: "paused" | "skipped" | "rate_limited" | "unrecognized" | "unverified_reporter" };

// CodeRabbit's commit status is `success` for far more than a finished review:
// a paused review, a skipped one and a rate-limited head are all green (#874,
// #892). Only the description says which, so only "Review completed" counts as
// a review; any other success, including wording this code has never seen,
// fails closed as not reviewed rather than passing as done. A status context
// named "CodeRabbit" can be posted by anyone with write access, so one not
// created by the CodeRabbit bot itself is not review evidence in any state.
export function classifyCodeRabbitStatus(entry: StatusEntry | undefined): CodeRabbitStatus {
  if (!entry) return { kind: "waiting" };
  if (entry.creator !== REVIEWER_LOGIN) return { kind: "not_reviewed", reason: "unverified_reporter" };
  if (entry.state === "pending") return { kind: "waiting" };
  if (entry.state === "failure" || entry.state === "error") return { kind: "failed" };
  if (entry.state !== "success") return { kind: "waiting" };
  const description = entry.description ?? "";
  if (/^\s*review completed\b/i.test(description)) return { kind: "completed" };
  if (/paused/i.test(description)) return { kind: "not_reviewed", reason: "paused" };
  if (/skipped/i.test(description)) return { kind: "not_reviewed", reason: "skipped" };
  if (/rate[ -]?limit/i.test(description)) return { kind: "not_reviewed", reason: "rate_limited" };
  return { kind: "not_reviewed", reason: "unrecognized" };
}

const NOT_REVIEWED_REMEDY: Record<Extract<CodeRabbitStatus, { kind: "not_reviewed" }>["reason"], string> = {
  paused: "CodeRabbit paused reviews on this PR. A completed review of this head is still required: request one (an `@coderabbitai review` comment, where this session has authority to post one) and rerun, or report the paused review in the handoff.",
  skipped: "CodeRabbit skipped this head. A completed review of this head is still required: request one (an `@coderabbitai review` comment, where this session has authority to post one) and rerun, or report the skipped review in the handoff.",
  rate_limited: "CodeRabbit hit its rate limit and did not review this head. Wait for the limit to reset, then request a review and rerun; reviews past the plan's limit are billed, which is the operator's spending decision. Report it rather than treating the loop as satisfied.",
  unverified_reporter: "The latest `CodeRabbit` commit status on this head was not posted by the CodeRabbit bot (coderabbitai[bot]), so it is not review evidence. Check who posted it and report it rather than treating the loop as satisfied.",
  unrecognized: "This CodeRabbit status is not a recognized completed review, so it is not treated as one. Check the status on the PR and report it rather than treating the loop as satisfied."
};

export function extractPrompt(body: string): string | null {
  const match = /<summary>🤖 Prompt[^<]*<\/summary>\s*```\n?([\s\S]*?)```/.exec(body);
  return match ? match[1].trim() : null;
}

export interface CodeRabbitReviewResult extends Verdict {
  pr: number;
  repository: string;
  status: string | null;
}

export interface CodeRabbitReviewOptions {
  repo: string;
  pr: number;
  timeoutMin: number;
}

export async function waitForCodeRabbitReview(options: CodeRabbitReviewOptions): Promise<CodeRabbitReviewResult> {
  const { repo, pr, timeoutMin } = options;
  const gh = (args: string[]): string => runGh(repo, args, { maxBuffer: 32 * 1024 * 1024 });
  const ghJson = <T>(args: string[]): T => JSON.parse(gh(args)) as T;
  const repository = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const deadline = Date.now() + timeoutMin * 60_000;

  for (;;) {
    const pull = ghJson<PullState>(["pr", "view", String(pr), "--json", "headRefOid,isDraft,state"]);
    if (pull.state !== "OPEN") throw validationError(`PR #${pr} is ${pull.state}; nothing to review.`, { pr });
    if (pull.isDraft) throw validationError(`PR #${pr} is a draft, and CodeRabbit does not review drafts. Mark it ready first.`, { pr });

    const local = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    if (local !== pull.headRefOid) {
      throw validationError(`Local HEAD ${local.slice(0, 8)} is not the PR head ${pull.headRefOid.slice(0, 8)}; push first.`, { pr });
    }

    const coderabbit = fetchCodeRabbitStatus(gh, repository, pull.headRefOid);
    const classified = classifyCodeRabbitStatus(coderabbit);
    if (classified.kind === "failed") {
      throw new ArcadiaError("UNEXPECTED_ERROR", `CodeRabbit reported ${coderabbit?.state}: ${coderabbit?.description ?? "no description"}`, 1, { pr });
    }
    if (classified.kind === "not_reviewed") {
      throw new ArcadiaError(
        "CODE_REVIEW_NOT_COMPLETED",
        `CodeRabbit did not complete a review of ${pull.headRefOid.slice(0, 8)} (status: ${coderabbit?.description ?? "no description"}). This is not a completed review and never a done verdict.`,
        1,
        {
          pr,
          head: pull.headRefOid,
          status: coderabbit?.description ?? null,
          reporter: coderabbit?.creator ?? null,
          reason: classified.reason,
          remedy: NOT_REVIEWED_REMEDY[classified.reason]
        }
      );
    }
    if (classified.kind === "completed") {
      const reviews = fetchReviews(gh, repository, pr);
      const threads = fetchThreads(ghJson, repository, pr);
      // A push while the evidence was read makes all of it stale: judge the
      // new head instead, from its own status, rather than return a verdict
      // the PR's current head never earned.
      const after = ghJson<PullState>(["pr", "view", String(pr), "--json", "headRefOid,isDraft,state"]);
      if (after.headRefOid === pull.headRefOid) {
        const verdict = decide(pull.headRefOid, reviews, threads);
        return { pr, repository, status: coderabbit?.description ?? null, ...verdict };
      }
      process.stderr.write(`PR head moved from ${pull.headRefOid.slice(0, 8)} to ${after.headRefOid.slice(0, 8)} while reading the review; re-reading.\n`);
      continue;
    }

    if (Date.now() > deadline) {
      throw new ArcadiaError(
        "UNEXPECTED_ERROR",
        `No finished CodeRabbit review on ${pull.headRefOid.slice(0, 8)} after ${timeoutMin} min (status: ${coderabbit?.description ?? "none"}). Is CodeRabbit installed on ${repository}?`,
        1,
        { pr }
      );
    }
    process.stderr.write(`Waiting on CodeRabbit for ${pull.headRefOid.slice(0, 8)} (${coderabbit?.description ?? "no status yet"})\n`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export interface DeclineFindingResult {
  threadId: string;
  replyUrl: string | null;
  resolved: boolean;
}

// For a finding the agent judges wrong: reply with the reason and resolve the
// thread, so it stops blocking approval without being silently ignored.
export function declineCodeRabbitFinding(repo: string, threadId: string, reason: string): DeclineFindingResult {
  const gh = (args: string[]): string => runGh(repo, args);
  const reply = `mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}`;
  const resolve = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`;
  const replied = JSON.parse(gh(["api", "graphql", "-f", `query=${reply}`, "-f", `id=${threadId}`, "-f", `body=Declined: ${reason}`])) as {
    data: { addPullRequestReviewThreadReply: { comment: { url: string } | null } };
  };
  const resolved = JSON.parse(gh(["api", "graphql", "-f", `query=${resolve}`, "-f", `id=${threadId}`])) as {
    data: { resolveReviewThread: { thread: { isResolved: boolean } } };
  };
  return {
    threadId,
    replyUrl: replied.data.addPullRequestReviewThreadReply.comment?.url ?? null,
    resolved: resolved.data.resolveReviewThread.thread.isResolved
  };
}

/**
 * Every `gh` invocation in this file goes through here so a missing binary
 * fails with one clear, named remedy instead of a raw `spawnSync gh ENOENT`
 * surfacing as an opaque UNEXPECTED_ERROR (Issue #517). Environments that
 * only carry MCP-based GitHub access (no `gh` on PATH, as in a Claude Code
 * Remote/cloud session) hit this on the very first call.
 *
 * `repo` (the child process's `cwd`) is validated first: a missing or
 * non-directory `cwd` also makes `execFileSync` throw ENOENT, and reporting
 * that as "gh is not installed" would misdirect a caller whose repository
 * path is simply wrong. The upfront check handles the common case; `repo`
 * is checked again inside the ENOENT branch below to close the (much
 * smaller) window where it is removed between that check and the spawn.
 */
function runGh(repo: string, args: string[], options?: { maxBuffer?: number }): string {
  if (!isExistingDirectory(repo)) {
    throw validationError("The repository path does not exist.", { path: repo });
  }
  try {
    return execFileSync("gh", args, { cwd: repo, encoding: "utf8", maxBuffer: options?.maxBuffer });
  } catch (error) {
    if (isEnoent(error)) {
      if (!isExistingDirectory(repo)) {
        throw validationError("The repository path does not exist.", { path: repo, cause: (error as Error).message });
      }
      throw validationError(
        "The `gh` CLI is not installed or not on PATH, so this command cannot run.",
        {
          remedy: "Install the GitHub CLI (https://cli.github.com) and authenticate it, or run this command from an environment that has `gh` on PATH — for example a local checkout, rather than a session whose GitHub access is MCP-only.",
          cause: (error as Error).message
        }
      );
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isExistingDirectory(repo: string): boolean {
  return existsSync(repo) && statSync(repo).isDirectory();
}

interface PullState {
  headRefOid: string;
  isDraft: boolean;
  state: string;
}

export interface StatusEntry {
  state: string;
  description: string | null;
  // Login of whoever posted the status; null when GitHub reports none.
  creator: string | null;
}

// The combined-status endpoint (`commits/<sha>/status`) omits who posted each
// status, so read the per-commit status list instead, which carries `creator`
// and is newest first: its first "CodeRabbit" entry is the one the combined
// status shows.
function fetchCodeRabbitStatus(gh: (args: string[]) => string, repository: string, sha: string): StatusEntry | undefined {
  const first = gh([
    "api",
    "--paginate",
    `repos/${repository}/commits/${sha}/statuses?per_page=100`,
    "--jq",
    `.[] | select(.context == "CodeRabbit") | {state, description, creator: .creator.login}`
  ])
    .split("\n")
    .find((line) => line.trim() !== "");
  return first ? (JSON.parse(first) as StatusEntry) : undefined;
}

interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: {
    nodes: { author: { login: string } | null; path: string; line: number | null; url: string; body: string; originalCommit: { oid: string } | null }[];
  };
}

interface ThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ThreadNode[] };
      };
    };
  };
}

function fetchReviews(gh: (args: string[]) => string, repository: string, pr: number): Review[] {
  const lines = gh([
    "api",
    "--paginate",
    `repos/${repository}/pulls/${pr}/reviews`,
    "--jq",
    `.[] | select(.user.login == "${REVIEWER_LOGIN}") | {author: .user.login, state, commitId: .commit_id, submittedAt: (.submitted_at // ""), body}`
  ]);
  return lines
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Review);
}

function fetchThreads(ghJson: <T>(args: string[]) => T, repository: string, pr: number): Thread[] {
  const [owner, name] = repository.split("/");
  const query = `query($owner:String!,$name:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:1){nodes{author{login} path line url body originalCommit{oid}}}}}}}}`;
  const nodes: ThreadNode[] = [];
  let after: string | null = null;
  do {
    const args = ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `pr=${pr}`];
    if (after) args.push("-f", `after=${after}`);
    const page = ghJson<ThreadsResponse>(args).data.repository.pullRequest.reviewThreads;
    nodes.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return nodes.flatMap((node) => {
    const first = node.comments.nodes[0];
    if (!first) return [];
    return [
      {
        id: node.id,
        commitId: first.originalCommit?.oid ?? "",
        isResolved: node.isResolved,
        isOutdated: node.isOutdated,
        author: first.author?.login ?? "",
        path: first.path,
        line: first.line,
        url: first.url,
        body: first.body
      }
    ];
  });
}
