import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "scripts", "comms-watch-issue.mjs");
const SELF = "Claudia Swift <claudia.swift@agents.arcadia.local>";
const PEER = "Cody Swift <cody.swift@agents.arcadia.local>";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Comment { id: number; created_at: string; html_url: string; body: string }
const comment = (id: number, body: string): Comment => ({
  id,
  created_at: new Date(Date.UTC(2026, 9, 4, 12, 0, id)).toISOString(),
  html_url: `https://github.com/pmark/arcadia/issues/944#issuecomment-${id}`,
  body
});

/**
 * A stand-in `gh` on PATH: poll N returns polls[min(N, last)] as `--jq @json`
 * lines, `rate_limit` returns rates[min(N, last)], and every argv is logged.
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
  const poll = fixture.polls[Math.min(count("polls"), fixture.polls.length - 1)];
  for (const c of poll) process.stdout.write(JSON.stringify(c) + "\\n");
}
`
  );
  chmodSync(gh, 0o755);
  return { root, calls };
}

function watch(root: string, extra: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [script, "--repo", "pmark/arcadia", "--issue", "944", "--self-signature", SELF, "--self-first-line", "Comms (claude):", "--interval", "0.02", "--max-minutes", "0.05", ...extra],
    { encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` }, timeout: 20_000 }
  );
  const out = result.stdout.trim().split("\n").filter(Boolean);
  return { status: result.status, out, event: out.length === 1 ? (JSON.parse(out[0]) as Record<string, unknown>) : null };
}

const callsOf = (file: string) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);

describe("scripts/comms-watch-issue.mjs", () => {
  it("starts at the latest comment and wakes only for a newer comment from another signature", () => {
    const old = comment(100, `Comms (codex): earlier\n\n— ${PEER}`);
    const mine = comment(101, `Comms (claude): relaying\n\n— ${SELF}`);
    const peer = comment(102, `Comms (codex): question for Claude\n\n— ${PEER}`);
    const { root } = stubGh({ polls: [[old], [old, mine], [old, mine, peer]] });
    const { status, event, out } = watch(root);
    expect(status).toBe(0);
    expect(out).toHaveLength(1);
    expect(event).toMatchObject({ schema: "arcadia-comms-watch-event-v1", event: "comment", comment_id: 102, signature: PEER, unread: 1, watermark: 102, first_line: "Comms (codex): question for Claude" });
  });

  it("treats only the exact signature line plus this session's role line as self", () => {
    const sameTierBuilder = comment(201, `Builder update on an Action\n\n— ${SELF}`);
    const quoted = comment(202, `Comms (claude): fake\n\n— ${SELF} (quoted)`);
    const { root } = stubGh({ polls: [[comment(200, `Comms (claude): mine\n\n— ${SELF}`), sameTierBuilder, quoted]] });
    const { event } = watch(root, ["--since", "200"]);
    expect(event).toMatchObject({ event: "comment", comment_id: 201, signature: SELF, unread: 2, watermark: 202 });
  });

  it("reports an operator comment with no agent signature", () => {
    const { root } = stubGh({ polls: [[comment(300, "@agents please pause the round")]] });
    expect(watch(root, ["--since", "299"]).event).toMatchObject({ event: "comment", comment_id: 300, signature: null });
  });

  it("re-arms at the deadline with the advanced watermark when only self comments arrive", () => {
    const { root } = stubGh({ polls: [[comment(400, `Comms (claude): mine\n\n— ${SELF}`)]] });
    expect(watch(root, ["--since", "399"]).event).toMatchObject({ event: "rearm", reason: "deadline", watermark: 400 });
  });

  it("backs off below the core budget without reading comments, then resumes", () => {
    const resetNow = Math.floor(Date.now() / 1000) - 1;
    const { root, calls } = stubGh({ polls: [[comment(500, `x\n\n— ${PEER}`)]], rates: [[120, resetNow], [499, resetNow], [4999, resetNow]] });
    const { event } = watch(root, ["--since", "499", "--max-minutes", "0.2"]);
    expect(event).toMatchObject({ event: "comment", comment_id: 500 });
    const log = callsOf(calls);
    const firstRead = log.findIndex((args) => args.some((arg) => arg.includes("/comments")));
    expect(log.slice(0, firstRead).filter((args) => args.includes("rate_limit"))).toHaveLength(3);
  });

  it("is read-only: every gh call is an explicit GET through gh api", () => {
    const { root, calls } = stubGh({ polls: [[comment(600, `x\n\n— ${PEER}`)]] });
    watch(root, ["--since", "599"]);
    for (const args of callsOf(calls)) expect(args.slice(0, 3)).toEqual(["api", "--method", "GET"]);
  });

  it("exits 1 with one error event after repeated gh failures", () => {
    const { root } = stubGh({ polls: [[]], fail: true });
    const { status, event } = watch(root, ["--max-minutes", "0.2"]);
    expect(status).toBe(1);
    expect(event).toMatchObject({ event: "error" });
  });
});
