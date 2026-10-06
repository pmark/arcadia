// Action 2 shape (Issue #986): run 5's PR #6 at 69eb7d62, simulated without the #987 base mismatch:
// GitHub's main at f68ec48 (Action 1 integrated and pushed), so the PR's base, files and patch are
// f68ec48..69eb7d62, the same range the host plan was rendered from. Only the Operator QA plan section of the
// published body is replaced by the candidate renderer's output; the validation-evidence section is kept.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const W = "/Users/pmark/.claude/worktrees/fix-qa-plan-check-wording-20261006T070618976Z/arcadia";
const { operatorQaPlanSource, renderOperatorQaPlan } = await import(`${W}/src/sessions/operatorQaPlan.ts`);
const S = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const FIX = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
const git = (args: string[]) => { try { return execFileSync("git", ["-C", FIX, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const rec = JSON.parse(readFileSync("/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/preservation/session_f5d47474761d48a9ba/check-JcIXqZ/validation.json", "utf8"));
const b = rec.binding;
const commitSha = "69eb7d6283447270a9a16e540f7d4f5f2e3427fc";
const base = "f68ec48ed4ff95772fee108258d401158c26a54d";
if (b.base !== base || b.action !== "transform-start-marker") throw new Error(`unexpected binding ${b.base} ${b.action}`);
const plan = operatorQaPlanSource({ actionKey: `${b.project}/${b.action}`, action: b.actionDefinition, validationCommands: b.commands });
const out = git(["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "-z", base, commitSha])!;
const f = out.split("\0").filter(Boolean); const changedFiles: any[] = []; for (let i = 0; i < f.length; i += 2) changedFiles.push({ status: f[i], path: f[i + 1] });
const r = renderOperatorQaPlan(plan, { branch: b.branch, baseBranch: "main", baseRevision: base, commitSha, changedFiles,
  pathExists: (p: string) => !p.startsWith("-") && git(["cat-file", "-e", `${commitSha}:${p}`]) !== null });
if (r.status !== "rendered") throw new Error("refused: " + r.reason);
const pr = JSON.parse(readFileSync(`${S}/pr6-evidence-published.json`, "utf8"));
const published: string = pr.body;
const cut = published.indexOf("\n\n### Validation evidence");
const oldLines = published.slice(0, cut).split("\n"), newLines = r.body.split("\n");
console.log(JSON.stringify({ sameLineCount: oldLines.length === newLines.length, differingLines: oldLines.map((l, i) => l === newLines[i] ? null : { i, old: l, new: newLines[i] }).filter(Boolean) }, null, 1));
const numstat = git(["diff", "--numstat", "--no-renames", base, commitSha])!.trim().split("\n").map((l) => l.split("\t"));
const type: Record<string, string> = { A: "ADDED", M: "MODIFIED", D: "DELETED" };
pr.baseRefOid = base;
pr.files = changedFiles.map((file) => { const n = numstat.find((row) => row[2] === file.path)!; return { path: file.path, additions: Number(n[0]), deletions: Number(n[1]), changeType: type[file.status[0]] }; });
pr.body = r.body + published.slice(cut);
writeFileSync(`${S}/pr6-stacked-evidence.json`, JSON.stringify(pr, null, 2));
console.log(JSON.stringify(pr.files));
