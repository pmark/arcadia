#!/usr/bin/env node
// A stand-in for the `claude` CLI, used only by tests/coordinator-relay-launch-proof.test.ts. It reads the exact
// argv the relay builds (--session-id <uuid>, --name, ... then the prompt as the last argument) and writes the
// transcript JSONL a real interactive session writes: Claude Code's project directory for the working directory,
// <session-id>.jsonl, with meta lines first and the prompt as the first main-chain user message.
//
// FAKE_CLAUDE_MODE selects how faithfully it delivers the prompt:
//   exact (default)  the prompt, verbatim, as a string and as the only text block
//   blocks           the prompt split across two text blocks, then a trailing system-reminder block (host context)
//   truncated        the prompt cut short (a paste that lost its tail)
//   prefixed         text added before the prompt
//   none             nothing is written (the session never started)
// FAKE_CLAUDE_MODEL / FAKE_CLAUDE_EFFORT, when set, make it write a first assistant reply stating that model (and an effort),
// as a real session does; the default replies as "claude-opus-fixture" with no effort stated. FAKE_CLAUDE_MODEL=none writes no reply.
// It records its own argv and the coordinator custody variables it inherited (never the token value) to
// $FAKE_CLAUDE_CAPTURE when set.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const sessionId = flag("--session-id");
const prompt = args.at(-1);
const mode = process.env.FAKE_CLAUDE_MODE ?? "exact";
const projects = process.env.FAKE_CLAUDE_PROJECTS;
// The same mapping Claude Code uses for a working directory (observed in probe P1).
const slug = process.cwd().replace(/[^A-Za-z0-9-]/g, "-");

if (process.env.FAKE_CLAUDE_CAPTURE) {
  appendFileSync(process.env.FAKE_CLAUDE_CAPTURE, `${JSON.stringify({
    args, cwd: process.cwd(),
    role: process.env.ARCADIA_COORDINATOR_ROLE ?? null,
    generation: process.env.ARCADIA_COORDINATOR_GENERATION ?? null,
    tokenSet: Boolean(process.env.ARCADIA_COORDINATOR_TOKEN)
  })}\n`);
}
if (mode === "none" || !sessionId || !projects) process.exit(0);

const lines = [
  { type: "summary", summary: "fixture" },
  { type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>fixture meta</local-command-caveat>" } },
  { type: "user", isSidechain: true, message: { role: "user", content: "a subagent prompt that must never be read as the first message" } }
];
const first = (content) => ({ type: "user", isSidechain: false, message: { role: "user", content } });
if (mode === "exact") lines.push(first(prompt), first([{ type: "text", text: prompt }]));
else if (mode === "blocks") {
  const cut = Math.floor(prompt.length / 2);
  lines.push(first([{ type: "text", text: prompt.slice(0, cut) }, { type: "text", text: prompt.slice(cut) }, { type: "text", text: "<system-reminder>host context</system-reminder>" }]));
} else if (mode === "truncated") lines.push(first(prompt.slice(0, prompt.length - 20)));
else if (mode === "prefixed") lines.push(first(`Hello. ${prompt}`));
const reply = process.env.FAKE_CLAUDE_MODEL ?? "claude-opus-fixture";
if (reply !== "none" && mode !== "none") {
  lines.push({ type: "assistant", isSidechain: false, ...(process.env.FAKE_CLAUDE_EFFORT ? { effort: process.env.FAKE_CLAUDE_EFFORT } : {}), message: { role: "assistant", model: reply, content: [{ type: "text", text: "hi" }] } });
}
const file = path.join(projects, slug, `${sessionId}.jsonl`);
mkdirSync(path.dirname(file), { recursive: true });
// Only the first main-chain user message counts for delivery; the exact mode also writes a second one to prove the rest is ignored.
writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
