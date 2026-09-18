#!/usr/bin/env node
// One step of the CodeRabbit review loop an agent runs after pushing to a PR.
//
//   node scripts/coderabbit-loop.ts wait <pr> [--timeout-min 20]
//   node scripts/coderabbit-loop.ts decline <thread-id> "<reason>"
//
// `wait` blocks until CodeRabbit has finished reviewing the PR's current head,
// then prints one JSON verdict and exits with its code:
//
//   0  done   — CodeRabbit approved this head, or left nothing unresolved
//   1  fix    — unresolved findings; address them, push, and run `wait` again
//   3  cap    — findings remain after MAX_FIX_ROUNDS pushes; stop, ask the operator
//   2  error  — timeout, draft PR, unpushed HEAD, or CodeRabbit reported a failure
//
// The signals are the ones CodeRabbit already emits here: a `CodeRabbit`
// commit status that goes pending -> success per head, review threads it
// resolves itself once a later commit fixes them, and — with
// `request_changes_workflow` in .coderabbit.yaml — an APPROVED review when
// nothing is left. So "done" is read, not guessed.
//
// `decline` is for a finding the agent judges wrong: it replies on the thread
// with the reason and resolves it, so the thread stops blocking approval
// without being silently ignored.
//
// Runs under the pinned Node directly (type stripping), and shells out to
// `gh`, so it needs whatever `gh` auth the agent already pushes with.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
  // with no thread to reply to or resolve. They appear only in `prompt`.
  outsideDiffFindings: boolean;
  prompt: string | null;
  note: string;
}

// Pure: everything the loop decides, given what GitHub reported for `head`.
export function decide(head: string, reviews: Review[], threads: Thread[]): Verdict {
  const bot = reviews
    .filter((review) => review.state !== "PENDING")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const onHead = bot.filter((review) => review.commitId === head);
  const latestOnHead = onHead.at(-1);
  const approved = latestOnHead?.state === "APPROVED";

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

  // A round is one reviewed head that came back with something to fix.
  const roundHeads = new Set(
    bot.filter((review) => review.state !== "APPROVED").map((review) => review.commitId)
  );
  const outsideDiffFindings = hasOutsideDiffFindings(latestOnHead?.body ?? "");
  if (findings.length > 0 || outsideDiffFindings) roundHeads.add(head);
  const fixRound = roundHeads.size;

  const prompt = extractPrompt(latestOnHead?.body ?? "");
  const base = { head, approved, fixRound, maxFixRounds: MAX_FIX_ROUNDS, findings, outsideDiffFindings, prompt };

  if (approved) return { ...base, verdict: "done", note: "CodeRabbit approved this head." };
  if (findings.length === 0 && !outsideDiffFindings && latestOnHead?.state !== "CHANGES_REQUESTED") {
    return {
      ...base,
      verdict: "done",
      note: "No unresolved CodeRabbit threads, but no approval on this head either; report that rather than claiming approval."
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
    note:
      `Fix round ${fixRound} of ${MAX_FIX_ROUNDS}. Fix valid findings, decline wrong ones with a reason, push, run wait again.` +
      (outsideDiffFindings
        ? " Some findings are outside the diff and listed only in `prompt`; they have no thread, so name any you decline in the handoff instead."
        : "")
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

export function hasOutsideDiffFindings(body: string): boolean {
  return /<summary>[^<]*outside diff range[^<]*<\/summary>/i.test(body);
}

export function extractPrompt(body: string): string | null {
  const match = /<summary>🤖 Prompt[^<]*<\/summary>\s*```\n?([\s\S]*?)```/.exec(body);
  return match ? match[1].trim() : null;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(gh(args)) as T;
}

function fail(message: string): never {
  process.stderr.write(`coderabbit-loop: ${message}\n`);
  process.exit(2);
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
    nodes: { author: { login: string } | null; path: string; line: number | null; url: string; body: string }[];
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

function fetchReviews(repo: string, pr: number): Review[] {
  const lines = gh([
    "api",
    "--paginate",
    `repos/${repo}/pulls/${pr}/reviews`,
    "--jq",
    `.[] | select(.user.login | startswith("${BOT}")) | {state, commitId: .commit_id, submittedAt: (.submitted_at // ""), body}`
  ]);
  return lines
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Review);
}

function fetchThreads(repo: string, pr: number): Thread[] {
  const [owner, name] = repo.split("/");
  const query = `query($owner:String!,$name:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:1){nodes{author{login} path line url body}}}}}}}`;
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

async function wait(pr: number, timeoutMin: number): Promise<void> {
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const deadline = Date.now() + timeoutMin * 60_000;

  for (;;) {
    const pull = ghJson<PullState>(["pr", "view", String(pr), "--json", "headRefOid,isDraft,state"]);
    if (pull.state !== "OPEN") fail(`PR #${pr} is ${pull.state}; nothing to wait for.`);
    if (pull.isDraft) fail(`PR #${pr} is a draft, and CodeRabbit does not review drafts. Mark it ready first.`);

    const local = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (local !== pull.headRefOid) {
      fail(`local HEAD ${local.slice(0, 8)} is not the PR head ${pull.headRefOid.slice(0, 8)}; push first.`);
    }

    const status = ghJson<CombinedStatus>(["api", `repos/${repo}/commits/${pull.headRefOid}/status`]);
    const coderabbit = status.statuses.find((entry) => entry.context === "CodeRabbit");
    if (coderabbit && (coderabbit.state === "failure" || coderabbit.state === "error")) {
      fail(`CodeRabbit reported ${coderabbit.state}: ${coderabbit.description ?? "no description"}`);
    }
    if (coderabbit?.state === "success") {
      const verdict = decide(pull.headRefOid, fetchReviews(repo, pr), fetchThreads(repo, pr));
      process.stdout.write(`${JSON.stringify({ pr, status: coderabbit.description, ...verdict }, null, 2)}\n`);
      process.exit({ done: 0, fix: 1, cap: 3 }[verdict.verdict]);
    }

    if (Date.now() > deadline) {
      fail(`no finished CodeRabbit review on ${pull.headRefOid.slice(0, 8)} after ${timeoutMin} min (status: ${coderabbit?.description ?? "none yet"}).`);
    }
    process.stderr.write(`coderabbit-loop: waiting on ${pull.headRefOid.slice(0, 8)} (${coderabbit?.description ?? "no status yet"})\n`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function decline(threadId: string, reason: string): void {
  const reply = `mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}`;
  const resolve = `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`;
  gh(["api", "graphql", "-f", `query=${reply}`, "-f", `id=${threadId}`, "-f", `body=Declined: ${reason}`]);
  gh(["api", "graphql", "-f", `query=${resolve}`, "-f", `id=${threadId}`]);
  process.stdout.write(`declined and resolved ${threadId}\n`);
}

async function main(argv: string[]): Promise<void> {
  const [command, target, ...rest] = argv;
  if (command === "wait" && target && /^\d+$/.test(target)) {
    const flag = rest.indexOf("--timeout-min");
    const timeoutMin = flag >= 0 ? Number(rest[flag + 1]) : 20;
    if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) fail("--timeout-min needs a positive number.");
    await wait(Number(target), timeoutMin);
    return;
  }
  if (command === "decline" && target && rest.join(" ").trim() !== "") {
    decline(target, rest.join(" ").trim());
    return;
  }
  fail('usage: coderabbit-loop.ts wait <pr> [--timeout-min 20] | decline <thread-id> "<reason>"');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Exit 1 means "fix", so a thrown gh/git/JSON failure must not fall through
  // to Node's default exit code 1 and read as a verdict.
  await main(process.argv.slice(2)).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
