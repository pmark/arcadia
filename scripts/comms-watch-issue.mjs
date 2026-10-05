#!/usr/bin/env node
// Interim Comms watcher: wait on a GitHub coordination Issue in a shell, not in
// a model turn (docs/agent-guidance/agent-comms.md, "Waiting costs no model
// tokens"). It polls the Issue's comments read-only through `gh api`, keeps a
// comment-id watermark, skips the Comms session's own comments, backs off when
// the core rate limit runs low, and exits with exactly one JSON line:
//
//   {"event":"comment",...}  a comment newer than the watermark from anyone else
//   {"event":"rearm",...}    the deadline (default 110 min, under the 2-hour
//                            background limit) passed; re-arm with `watermark`
//   {"event":"error",...}    gh failed repeatedly; exit status 1
//
// It never posts, edits or reacts. `arcadia agents watch --until-event`
// (Action implement-agent-peer-watch-reader) replaces it once that ships.
//
// Usage:
//   node scripts/comms-watch-issue.mjs --repo pmark/arcadia --issue 944 \
//     --self-signature "Claudia Swift <claudia.swift@agents.arcadia.local>" \
//     --self-first-line "Comms (claude):" [--since <comment-id>|latest] \
//     [--interval 60] [--max-minutes 110] [--min-remaining 500]
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const SCHEMA = "arcadia-comms-watch-event-v1";
const AGENT_SIGNATURE_LINE = /^— (.+ <[^<>\s]+@agents\.arcadia\.local>)$/;
const MAX_CONSECUTIVE_FAILURES = 3;

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    issue: { type: "string" },
    "self-signature": { type: "string" },
    "self-first-line": { type: "string" },
    since: { type: "string", default: "latest" },
    interval: { type: "string", default: "60" },
    "max-minutes": { type: "string", default: "110" },
    "min-remaining": { type: "string", default: "500" }
  }
});

function emit(event, exitCode = 0) {
  process.stdout.write(`${JSON.stringify({ schema: SCHEMA, ...event })}\n`);
  process.exit(exitCode);
}

function usage(message) {
  process.stderr.write(`comms-watch-issue: ${message}\n`);
  process.exit(2);
}

const repo = values.repo ?? "";
const issue = values.issue ?? "";
const selfSignature = values["self-signature"]?.trim() ?? "";
const selfFirstLine = values["self-first-line"]?.trim() ?? "";
const intervalMs = Number(values.interval) * 1000;
const deadline = Date.now() + Number(values["max-minutes"]) * 60_000;
const minRemaining = Number(values["min-remaining"]);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) usage("--repo owner/name is required");
if (!/^\d+$/.test(issue)) usage("--issue <number> is required");
if (!selfSignature) usage("--self-signature (the `signature` from `arcadia identity resolve --json`) is required");
if (!selfFirstLine) usage("--self-first-line (this session's role line prefix, e.g. \"Comms (claude):\") is required");
if (values.since !== "latest" && !/^\d+$/.test(values.since)) usage("--since must be a comment id or latest");
if (!(intervalMs >= 0) || !(deadline > Date.now()) || !(minRemaining >= 0)) usage("--interval, --max-minutes and --min-remaining must be numbers");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const ghRead = (args) => execFileSync("gh", ["api", "--method", "GET", ...args], { encoding: "utf8", timeout: 60_000 });

const lines = (body) => body.replace(/\r/g, "").split("\n").map((line) => line.trim());

/** Self means: the exact signature line `— <signature>` AND this session's role line first. */
function isSelf(body) {
  const all = lines(body);
  const first = all.find((line) => line.length > 0) ?? "";
  return all.includes(`— ${selfSignature}`) && first.startsWith(selfFirstLine);
}

function signatureOf(body) {
  const matches = lines(body).map((line) => AGENT_SIGNATURE_LINE.exec(line)?.[1]).filter(Boolean);
  return matches.at(-1) ?? null;
}

/** Wait out a low core budget; false when the deadline arrives first. */
async function respectRateLimit() {
  for (;;) {
    const [remaining, reset] = ghRead(["rate_limit", "--jq", '.resources.core | "\\(.remaining) \\(.reset)"']).trim().split(/\s+/).map(Number);
    if (!Number.isFinite(remaining) || remaining >= minRemaining) return true;
    const wakeAt = Math.min(deadline, Number.isFinite(reset) ? reset * 1000 + 1000 : Date.now() + 60_000);
    if (wakeAt >= deadline) return false;
    await sleep(wakeAt - Date.now());
  }
}

function readComments(sinceTime) {
  const query = `per_page=100${sinceTime ? `&since=${encodeURIComponent(sinceTime)}` : ""}`;
  return ghRead([
    "--paginate",
    `repos/${repo}/issues/${issue}/comments?${query}`,
    "--jq",
    ".[] | {id, created_at, html_url, body} | @json"
  ]).split("\n").filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id);
}

let watermark = values.since === "latest" ? null : Number(values.since);
let sinceTime = null;
let failures = 0;

for (;;) {
  try {
    if (!(await respectRateLimit())) emit({ event: "rearm", reason: "rate_limited", repo, issue: Number(issue), watermark });
    const comments = readComments(sinceTime);
    failures = 0;
    if (watermark === null) {
      watermark = comments.at(-1)?.id ?? 0;
    } else {
      const fresh = comments.filter((comment) => comment.id > watermark);
      const others = fresh.filter((comment) => !isSelf(comment.body ?? ""));
      if (fresh.length > 0) watermark = fresh.at(-1).id;
      if (others.length > 0) {
        const first = others[0];
        emit({
          event: "comment",
          repo,
          issue: Number(issue),
          comment_id: first.id,
          created_at: first.created_at,
          url: first.html_url,
          signature: signatureOf(first.body ?? ""),
          first_line: lines(first.body ?? "").find((line) => line.length > 0)?.slice(0, 200) ?? "",
          unread: others.length,
          watermark
        });
      }
    }
    const marker = comments.find((comment) => comment.id === watermark);
    if (marker) sinceTime = marker.created_at;
  } catch (error) {
    failures += 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      emit({ event: "error", repo, issue: Number(issue), watermark, message: String(error?.message ?? error).slice(0, 500) }, 1);
    }
  }
  if (Date.now() + intervalMs >= deadline) emit({ event: "rearm", reason: "deadline", repo, issue: Number(issue), watermark });
  await sleep(intervalMs);
}
