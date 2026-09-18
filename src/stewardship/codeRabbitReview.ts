// The CodeRabbit review loop an agent runs after pushing to a PR, as two
// commands under `arcadia pr`:
//
//   arcadia pr code-review <pr>              wait for CodeRabbit, return a verdict
//   arcadia pr decline-finding <thread> <why> reply on a thread and resolve it
//
// `code-review` blocks until CodeRabbit has finished reviewing the PR's pushed
// head, then returns `done`, `fix`, or `cap` (findings outlived
// MAX_FIX_ROUNDS pushes; hand them to the operator). A draft PR, an unpushed
// HEAD, a timeout, or a CodeRabbit failure is an error, never a verdict.
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
import { ArcadiaError, validationError } from "../cli/errors.js";

export const MAX_FIX_ROUNDS = 3;
const BOT = "coderabbitai";
const POLL_MS = 30_000;

export interface Review {
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
  // the actual one, so only reviews that say something count.
  const bot = reviews
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
  // CodeRabbit does not re-approve a head it found clean: its earlier approval
  // simply stands, exactly as GitHub's reviewDecision shows. A later review
  // requesting changes would supersede it as the latest, so the latest review
  // being an approval, with nothing left open, is approval of this head.
  const approved = bot.at(-1)?.state === "APPROVED" && findings.length === 0;
  if (findings.length > 0) roundHeads.add(head);
  const fixRound = roundHeads.size;
  const outsideNote = outsideDiffFindings
    ? " CodeRabbit also listed findings outside the diff in `prompt`; they have no thread, so fix them or name any you decline in the handoff."
    : "";

  const base = { head, approved, fixRound, maxFixRounds: MAX_FIX_ROUNDS, findings, outsideDiffFindings, prompt };

  if (approved) return { ...base, verdict: "done", note: `CodeRabbit approved this head.${outsideNote}` };
  if (findings.length === 0 && latestOnHead?.state !== "CHANGES_REQUESTED") {
    return {
      ...base,
      verdict: "done",
      note: `No unresolved CodeRabbit threads, but no approval on this head either; report that rather than claiming approval.${outsideNote}`
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
  const gh = (args: string[]): string => execFileSync("gh", args, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
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

    const status = ghJson<CombinedStatus>(["api", `repos/${repository}/commits/${pull.headRefOid}/status`]);
    const coderabbit = status.statuses.find((entry) => entry.context === "CodeRabbit");
    if (coderabbit && (coderabbit.state === "failure" || coderabbit.state === "error")) {
      throw new ArcadiaError("UNEXPECTED_ERROR", `CodeRabbit reported ${coderabbit.state}: ${coderabbit.description ?? "no description"}`, 1, { pr });
    }
    if (coderabbit?.state === "success") {
      const verdict = decide(pull.headRefOid, fetchReviews(gh, repository, pr), fetchThreads(ghJson, repository, pr));
      return { pr, repository, status: coderabbit.description, ...verdict };
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
  const gh = (args: string[]): string => execFileSync("gh", args, { cwd: repo, encoding: "utf8" });
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

interface PullState {
  headRefOid: string;
  isDraft: boolean;
  state: string;
}

interface CombinedStatus {
  statuses: { context: string; state: string; description: string | null }[];
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
    `.[] | select(.user.login | startswith("${BOT}")) | {state, commitId: .commit_id, submittedAt: (.submitted_at // ""), body}`
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
