import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "scripts", "comms-watch-issue.mjs");
const SELF = "Claudia Swift <claudia.swift@agents.arcadia.local>";
const PEER = "Cody Swift <cody.swift@agents.arcadia.local>";
const ROLE = "Comms (claude, s1):";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Comment { id: number; created_at: string; html_url: string; body: string }
const comment = (id: number, body: string): Comment => ({
  id,
  created_at: new Date(Date.UTC(2026, 9, 4, 12, 0, id % 60, id)).toISOString(),
  html_url: `https://github.com/pmark/arcadia/issues/944#issuecomment-${id}`,
  body
});
const mine = (id: number, text = "relaying") => comment(id, `${ROLE} ${text}\n\n— ${SELF}`);
const peer = (id: number, text = "question") => comment(id, `Comms (codex, k9): ${text}\n\n— ${PEER}`);

/**
 * A stand-in `gh` on PATH: poll N returns polls[min(N, last)] as `--jq @json`
 * lines, honoring a `since=` query like GitHub (updated_at, here created_at);
 * `rate_limit` returns rates[min(N, last)]; every argv is logged.
 */
function stubGh(input: { polls: Comment[][]; rates?: Array<[number, number]>; fail?: boolean }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-comms-watch-"));
  roots.push(root);
  const calls = path.join(root, "calls.jsonl");
  writeFileSync(path.join(root, "fixture.json"), JSON.stringify(input));
  writeFileSync(calls, "");
  const gh = path.join(root, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env node
const fs = require("node:fs");
const dir = ${JSON.stringify(root)};
const args = process.argv.slice(2);
fs.appendFileSync(dir + "/calls.jsonl", JSON.stringify(args) + "\\n");
const fixture = JSON.parse(fs.readFileSync(dir + "/fixture.json", "utf8"));
if (fixture.fail) { process.stderr.write("HTTP 502\\n"); process.exit(1); }
const count = (name) => { const f = dir + "/" + name; const n = fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0; fs.writeFileSync(f, String(n + 1)); return n; };
if (args.includes("rate_limit")) {
  const rates = fixture.rates ?? [[5000, 0]];
  const [remaining, reset] = rates[Math.min(count("rates"), rates.length - 1)];
  process.stdout.write(remaining + " " + reset + "\\n");
} else {
  const since = /[?&]since=([^&]+)/.exec(args.find((arg) => arg.includes("/comments")) || "");
  const floor = since ? Date.parse(decodeURIComponent(since[1])) : -Infinity;
  const poll = fixture.polls[Math.min(count("polls"), fixture.polls.length - 1)];
  for (const c of poll) if (Date.parse(c.created_at) >= floor) process.stdout.write(JSON.stringify(c) + "\\n");
}
`
  );
  chmodSync(gh, 0o755);
  return { root, calls };
}

/** Comment-expecting runs exit early; the long deadline only guards against a hang. */
function watch(root: string, extra: string[] = [], maxMinutes = "0.5") {
  const result = spawnSync(
    process.execPath,
    [script, "--repo", "pmark/arcadia", "--issue", "944", "--self-signature", SELF, "--self-first-line", ROLE, "--interval", "0.02", "--max-minutes", maxMinutes, ...extra],
    { encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` }, timeout: 60_000 }
  );
  const out = result.stdout.trim().split("\n").filter(Boolean);
  return { status: result.status, out, event: out.length === 1 ? (JSON.parse(out[0]) as Record<string, unknown>) : null };
}

const callsOf = (file: string) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);

describe("scripts/comms-watch-issue.mjs", () => {
  it("starts at the latest comment and wakes only for a newer comment from someone else", () => {
    const old = peer(100, "earlier");
    const { root, calls } = stubGh({ polls: [[old], [old, mine(101)], [old, mine(101), peer(102)]] });
    const { status, event, out } = watch(root);
    expect(status).toBe(0);
    expect(out).toHaveLength(1);
    expect(event).toMatchObject({
      schema: "arcadia-comms-watch-event-v1", event: "comment", comment_id: 102, signature: PEER,
      comms: { platform: "codex", session: "k9" }, unread: 1, watermark: 102, first_line: "Comms (codex, k9): question"
    });
    // After the bootstrap read the watcher asks GitHub only for comments since its watermark.
    expect(callsOf(calls).filter((args) => args.some((arg) => arg.includes("since=")))).not.toHaveLength(0);
  });

  it("requires this session's role line: a same-tier builder or a second Comms session is not self", () => {
    const builder = comment(201, `Builder update on an Action\n\n— ${SELF}`);
    const secondComms = comment(202, `Comms (claude, s2): also here\n\n— ${SELF}`);
    const { root } = stubGh({ polls: [[mine(200), builder, secondComms]] });
    expect(watch(root, ["--since", "199"]).event).toMatchObject({ event: "comment", comment_id: 201, signature: SELF, comms: null, unread: 2, watermark: 202 });
    const { root: second } = stubGh({ polls: [[mine(210), { ...secondComms, id: 211 }]] });
    expect(watch(second, ["--since", "209"]).event).toMatchObject({ comment_id: 211, comms: { platform: "claude", session: "s2" } });
  });

  it("does not treat a mid-body copy of the signature as self when another signature closes the comment", () => {
    const spoof = comment(250, `${ROLE} not really\n\n— ${SELF}\n\n— ${PEER}`);
    expect(watch(stubGh({ polls: [[spoof]] }).root, ["--since", "249"]).event).toMatchObject({ comment_id: 250, signature: PEER });
  });

  it("accepts CRLF bodies and trailing whitespace on its own comments", () => {
    const crlf = comment(260, `${ROLE} windows line endings\r\n\r\n— ${SELF}  \r\n`);
    expect(watch(stubGh({ polls: [[crlf, peer(261)]] }).root, ["--since", "259"]).event).toMatchObject({ comment_id: 261, unread: 1 });
  });

  it("does not treat a literal backslash-n body as a signed comment", () => {
    const literal = comment(270, `${ROLE} posted with --body\\n\\n— ${SELF}`);
    expect(watch(stubGh({ polls: [[literal]] }).root, ["--since", "269"]).event).toMatchObject({ comment_id: 270, signature: null });
  });

  it("reports an operator comment with no agent signature", () => {
    const { root } = stubGh({ polls: [[comment(300, "@agents please pause the round")]] });
    expect(watch(root, ["--since", "299"]).event).toMatchObject({ event: "comment", comment_id: 300, signature: null, comms: null });
  });

  it("re-arms at the deadline with the advanced watermark when only its own comments arrive", () => {
    const { root } = stubGh({ polls: [[mine(400)]] });
    expect(watch(root, ["--since", "399"], "0.05").event).toMatchObject({ event: "rearm", reason: "deadline", watermark: 400 });
  });

  it("reads once before any rate-limit wait under --since latest, so a re-arm never carries null", () => {
    const farReset = Math.floor(Date.now() / 1000) + 3600;
    const { root, calls } = stubGh({ polls: [[peer(700)]], rates: [[100, farReset]] });
    const { status, event } = watch(root, [], "0.05");
    expect(status).toBe(0);
    expect(event).toMatchObject({ event: "rearm", reason: "rate_limited", watermark: 700 });
    expect(callsOf(calls)[0].some((arg) => arg.includes("/comments"))).toBe(true);
  });

  it("emits latest, never null, when no read ever succeeded", () => {
    const { status, event } = watch(stubGh({ polls: [[]], fail: true }).root);
    expect(status).toBe(1);
    expect(event).toMatchObject({ event: "error", watermark: "latest" });
  });

  it("backs off below the core budget without reading comments, then resumes", () => {
    const resetNow = Math.floor(Date.now() / 1000) - 1;
    const { root, calls } = stubGh({ polls: [[peer(500)]], rates: [[120, resetNow], [499, resetNow], [4999, resetNow]] });
    expect(watch(root, ["--since", "499"]).event).toMatchObject({ event: "comment", comment_id: 500 });
    const log = callsOf(calls);
    const firstRead = log.findIndex((args) => args.some((arg) => arg.includes("/comments")));
    expect(log.slice(0, firstRead).filter((args) => args.includes("rate_limit"))).toHaveLength(3);
  });

  it("is read-only: every gh call is an explicit GET through gh api", () => {
    const { root, calls } = stubGh({ polls: [[peer(600)]] });
    watch(root, ["--since", "599"]);
    for (const args of callsOf(calls)) expect(args.slice(0, 3)).toEqual(["api", "--method", "GET"]);
  });

  it("exits 2 on invalid arguments, including a role line without a session discriminator", () => {
    const { root } = stubGh({ polls: [[]] });
    const result = spawnSync(process.execPath, [script, "--repo", "pmark/arcadia", "--issue", "944", "--self-signature", SELF, "--self-first-line", "Comms (claude):"], {
      encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` }
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("<session>");
  });
});
