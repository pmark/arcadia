// Re-render run 5 PR #5's Operator QA plan with the candidate renderer and substitute it into the published body.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const W = "/Users/pmark/.claude/worktrees/fix-qa-plan-check-wording-20261006T070618976Z/arcadia";
const { operatorQaPlanSource, renderOperatorQaPlan } = await import(`${W}/src/sessions/operatorQaPlan.ts`);
const S = path_dirname();
function path_dirname() { return new URL(".", import.meta.url).pathname.replace(/\/$/, ""); }
const FIX = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
const git = (args: string[]) => { try { return execFileSync("git", ["-C", FIX, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const rec = JSON.parse(readFileSync("/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/preservation/session_c52dba6db8224593b5/check-FfJBHd/validation.json", "utf8"));
const b = rec.binding;
const commitSha = "f68ec48ed4ff95772fee108258d401158c26a54d";
const plan = operatorQaPlanSource({ actionKey: `${b.project}/${b.action}`, action: b.actionDefinition, validationCommands: b.commands });
const out = git(["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "-z", b.base, commitSha])!;
const f = out.split("\0").filter(Boolean); const changedFiles: any[] = []; for (let i = 0; i < f.length; i += 2) changedFiles.push({ status: f[i], path: f[i + 1] });
const r = renderOperatorQaPlan(plan, { branch: b.branch, baseBranch: "main", baseRevision: b.base, commitSha, changedFiles,
  pathExists: (p: string) => !p.startsWith("-") && git(["cat-file", "-e", `${commitSha}:${p}`]) !== null });
if (r.status !== "rendered") throw new Error("refused: " + r.reason);
const pr = JSON.parse(readFileSync(`${S}/pr5-evidence-attempt1.json`, "utf8"));
const published: string = pr.body;
const cut = published.indexOf("\n\n### Validation evidence");
const oldPlan = published.slice(0, cut);
const newBody = r.body + published.slice(cut);
const oldLines = oldPlan.split("\n"), newLines = r.body.split("\n");
const diff = oldLines.map((l, i) => l === newLines[i] ? null : { i, old: l, new: newLines[i] }).filter(Boolean);
console.log(JSON.stringify({ sameLineCount: oldLines.length === newLines.length, differingLines: diff }, null, 1));
writeFileSync(`${S}/pr5-new-plan.md`, r.body);
writeFileSync(`${S}/pr5-new-body.md`, newBody);
