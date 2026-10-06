// Builds run-8 PR #9 evidence: real renderOperatorQaPlan from main's src over the run-8 simulated repo; validation-evidence section
// taken from run 7's published PR #9 body with the candidate commit/tree/record-binding values replaced.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const SRC = process.env.SMOKE_SRC!;
const { operatorQaPlanSource, renderOperatorQaPlan } = await import(`${SRC}/sessions/operatorQaPlan.ts`);
const N = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const R = `${N}/repo`;
const git = (args: string[]) => { try { return execFileSync("git", ["-C", R, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const base = readFileSync(`${N}/base.sha`, "utf8").trim();
const head = readFileSync(`${N}/head.sha`, "utf8").trim();
const tree = readFileSync(`${N}/head.tree`, "utf8").trim();
const run7 = JSON.parse(readFileSync("/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/qa/pull-requests/pmark-arcadia-three-action-rehearsal-20261004/9/8e362475887c3c7c25d1dc594e48a5c8f586ce0f/attempts/2026-10-06T17-46-14-630Z-12b11b5759a7/evidence.json", "utf8"));
const rec = JSON.parse(readFileSync("/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/preservation/session_c8e62cb3fb1f4e9393/check-Bho0D3/validation.json", "utf8"));
const b = rec.binding;
// Action definition as the run-8 plan states it (parsed from the rendered Plan, only fields the renderer uses)
const plan = readFileSync(`${R}/docs/plans/autonomous-three-action-rehearsal.md`, "utf8");
const first = plan.split("\n  - id: transform-start-marker")[0];
const title = /title: (.*)/.exec(first)![1];
const crit = [...first.matchAll(/^      - (.*)$/gm)].map((m) => m[1]);
const branch = "claude/write-start-marker-20261006T190000000Z";
const src = operatorQaPlanSource({ actionKey: "three-action-rehearsal/write-start-marker", action: { title, acceptanceCriteria: crit }, validationCommands: b.commands });
const out = git(["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "-z", base, head])!;
const f = out.split("\0").filter(Boolean); const changedFiles: any[] = []; for (let i = 0; i < f.length; i += 2) changedFiles.push({ status: f[i], path: f[i + 1] });
const r = renderOperatorQaPlan(src, { branch, baseBranch: "main", baseRevision: base, commitSha: head, changedFiles,
  pathExists: (p: string) => !p.startsWith("-") && git(["cat-file", "-e", `${head}:${p}`]) !== null });
if (r.status !== "rendered") throw new Error("refused: " + r.reason);
const published: string = run7.body;
const cut = published.indexOf("\n\n### Validation evidence");
let tail = published.slice(cut);
tail = tail.replaceAll("c6f102cf48b16bc7275b35366e9aa46fd6c59978", tree).replaceAll("c6f102cf48b1", tree.slice(0, 12)).replaceAll("8e362475887c3c7c25d1dc594e48a5c8f586ce0f", head);
const numstat = git(["diff", "--numstat", "--no-renames", base, head])!.trim().split("\n").map((l) => l.split("\t"));
const type: Record<string, string> = { A: "ADDED", M: "MODIFIED", D: "DELETED" };
const pr = { ...run7 };
pr.baseRefOid = base; pr.headRefOid = head; pr.headRefName = branch;
pr.files = changedFiles.map((file) => { const n = numstat.find((row) => row[2] === file.path)!; return { path: file.path, additions: Number(n[0]), deletions: Number(n[1]), changeType: type[file.status[0]] }; });
pr.body = r.body + tail;
writeFileSync(`${N}/pr9-run8-evidence.json`, JSON.stringify(pr, null, 2));
const oldLines = published.slice(0, cut).split("\n"), newLines = r.body.split("\n");
console.log(JSON.stringify({ sameLineCount: oldLines.length === newLines.length, nDiff: oldLines.map((l, i) => l === newLines[i] ? null : i).filter((x) => x !== null).length }));
console.log(r.body.split("\n").filter((l) => /three|nine|Action/i.test(l)).join("\n"));
