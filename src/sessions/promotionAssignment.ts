import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isolatedGitEnvironment } from "../git/isolatedGitEnvironment.js";
import { preservationProcessLimits, PRESERVATION_GIT_TIMEOUT_MS } from "./preservationStages.js";
import { parseDoc } from "../docs/parse.js";
import { validationError } from "../cli/errors.js";
import { commitTreeAt } from "./candidateSnapshot.js";

const marker = "<!-- arcadia-promotion-assignment-v1:";
interface Assignment { base: string; project: string; plan: string; projectText: string; planText: string; }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const git = (cwd: string, args: string[]) => execFileSync("git", args, { timeout: PRESERVATION_GIT_TIMEOUT_MS, ...preservationProcessLimits("git", args), env: isolatedGitEnvironment(), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function regular(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split("/").some(part => !part || part === "." || part === "..")) throw validationError("Invalid promotion assignment path.");
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw validationError("Promotion assignment requires regular files without symlinks.");
  }
  return readFileSync(current, "utf8");
}

/** Freeze only the two files produced by accepted planning promotion. */
export function promotionAssignmentBlock(input: { repo: string; plan: string; originalProject: string; originalPlan: string }): string | null {
  let base: string;
  try { base = git(input.repo, ["rev-parse", "HEAD"]).trim(); } catch { return null; }
  const project = "PROJECT.md";
  if (![project, input.plan].every(file => /^100(?:644|755) blob [0-9a-f]+\t/.test(git(input.repo, ["ls-tree", base, "--", file]))) ||
      git(input.repo, ["show", `${base}:${project}`]) !== input.originalProject || git(input.repo, ["show", `${base}:${input.plan}`]) !== input.originalPlan) {
    throw validationError("Planning promotion requires unmodified base Project and Plan records before freezing its assignment.");
  }
  const status = git(input.repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  if (status.some(line => ![" M " + project, " M " + input.plan].includes(line))) throw validationError("Unrelated or staged source changes prevent promotion assignment.");
  const assignment: Assignment = { base, project, plan: input.plan, projectText: regular(input.repo, project), planText: regular(input.repo, input.plan) };
  return `\n${marker}${Buffer.from(JSON.stringify(assignment)).toString("base64")} -->\n`;
}

/** Verify the packet-bound assignment against the preview and materialize it on a fresh candidate. */
export function applyPromotionAssignment(input: { repo: string; candidate: string; packet: string; packetHash: string; base: string; projectHash: string | null; planHash: string | null; planPath: string | null; identityEnv: Record<string, string> }): string | null {
  const text = readFileSync(input.packet, "utf8");
  if (hash(text) !== input.packetHash) throw validationError("The immutable build packet changed before launch.");
  const blocks = [...text.matchAll(/<!-- arcadia-promotion-assignment-v1:([A-Za-z0-9+/=]+) -->/g)];
  if (blocks.length === 0) {
    if (text.includes(marker)) throw validationError("Invalid promotion assignment block.");
    return null;
  }
  if (blocks.length !== 1) throw validationError("Invalid promotion assignment block.");
  let a: Assignment;
  try { a = JSON.parse(Buffer.from(blocks[0][1], "base64").toString("utf8")) as Assignment; } catch { throw validationError("Invalid promotion assignment block."); }
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).sort().join(",") !== "base,plan,planText,project,projectText" || a.base !== input.base || a.project !== "PROJECT.md" || a.plan !== input.planPath || typeof a.projectText !== "string" || typeof a.planText !== "string" || hash(a.projectText) !== input.projectHash || hash(a.planText) !== input.planHash) throw validationError("The promotion assignment no longer matches the approved preview.");
  if (regular(input.repo, a.project) !== a.projectText || regular(input.repo, a.plan) !== a.planText) throw validationError("The source promotion records changed before launch.");
  const status = git(input.repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  if (status.some(line => ![" M " + a.project, " M " + a.plan].includes(line))) throw validationError("Unrelated or staged source changes prevent promotion assignment.");
  if (git(input.candidate, ["status", "--porcelain=v1"]).trim()) throw validationError("The fresh candidate changed before promotion assignment.");
  regular(input.candidate, a.project); regular(input.candidate, a.plan);
  writeFileSync(path.join(input.candidate, a.project), a.projectText);
  writeFileSync(path.join(input.candidate, a.plan), a.planText);
  git(input.candidate, ["-c", "core.hooksPath=/dev/null", "add", "--", a.project, a.plan]);
  const tree = git(input.candidate, ["write-tree"]).trim();
  const revision = commitTreeAt(input.candidate, tree, input.base, { message: "arcadia: materialize accepted planning assignment", env: input.identityEnv });
  git(input.candidate, ["update-ref", "HEAD", revision, input.base]);
  return revision;
}

/** Recheck the packet, source and immutable assignment immediately before any provider starts, including recovery. */
export function verifyMaterializedPromotion(input: { repo: string; candidate: string; packet: string; packetHash: string; revision: string }): void {
  const text = readFileSync(input.packet, "utf8");
  if (hash(text) !== input.packetHash) throw validationError("The immutable build packet changed before launch.");
  const blocks = [...text.matchAll(/<!-- arcadia-promotion-assignment-v1:([A-Za-z0-9+/=]+) -->/g)];
  if (!blocks.length) {
    if (text.includes(marker)) throw validationError("Invalid promotion assignment block.");
    return;
  }
  if (blocks.length !== 1) throw validationError("Invalid promotion assignment block.");
  let a: Assignment;
  try { a = JSON.parse(Buffer.from(blocks[0][1], "base64").toString("utf8")) as Assignment; } catch { throw validationError("Invalid promotion assignment block."); }
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).sort().join(",") !== "base,plan,planText,project,projectText" || a.project !== "PROJECT.md" || typeof a.base !== "string" || typeof a.plan !== "string" || typeof a.projectText !== "string" || typeof a.planText !== "string") throw validationError("Invalid promotion assignment block.");
  if (!matchesPromotionBase({ packet: input.packet, packetHash: input.packetHash, candidate: input.candidate,
      revision: input.revision, base: a.base, projectHash: hash(a.projectText), planHash: hash(a.planText), planPath: a.plan })) throw validationError("The immutable promotion tree changed before launch.");
  if (regular(input.repo, a.project) !== a.projectText || regular(input.repo, a.plan) !== a.planText ||
      regular(input.candidate, a.project) !== a.projectText || regular(input.candidate, a.plan) !== a.planText ||
      git(input.candidate, ["show", `${input.revision}:${a.project}`]) !== a.projectText ||
      git(input.candidate, ["show", `${input.revision}:${a.plan}`]) !== a.planText ||
      git(input.candidate, ["rev-parse", `${input.revision}^`]).trim() !== a.base) throw validationError("The frozen promotion assignment changed before launch.");
  const status = git(input.repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  if (status.some(line => ![" M " + a.project, " M " + a.plan].includes(line)) || git(input.candidate, ["status", "--porcelain=v1"]).trim()) throw validationError("The promotion assignment or source changed before launch.");
}

/** Match a recovered lease to the exact approved packet and immutable assignment tree. */
export function matchesPromotionBase(input: { packet: string; packetHash: string; candidate: string; revision: string; base: string | null; projectHash: string | null; planHash: string | null; planPath: string | null }): boolean {
  try {
    const text = readFileSync(input.packet, "utf8");
    if (hash(text) !== input.packetHash) return false;
    const blocks = [...text.matchAll(/<!-- arcadia-promotion-assignment-v1:([A-Za-z0-9+/=]+) -->/g)];
    if (!blocks.length) return true;
    if (blocks.length !== 1) return false;
    const a = JSON.parse(Buffer.from(blocks[0][1], "base64").toString("utf8")) as Assignment;
    if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).sort().join(",") !== "base,plan,planText,project,projectText" || a.base !== input.base || a.project !== "PROJECT.md" || a.plan !== input.planPath || typeof a.projectText !== "string" || typeof a.planText !== "string" || hash(a.projectText) !== input.projectHash || hash(a.planText) !== input.planHash) return false;
    if (git(input.candidate, ["rev-parse", `${input.revision}^`]).trim() !== a.base || git(input.candidate, ["show", `${input.revision}:${a.project}`]) !== a.projectText || git(input.candidate, ["show", `${input.revision}:${a.plan}`]) !== a.planText) return false;
    if (![a.project, a.plan].every(file => /^100(?:644|755) blob [0-9a-f]+\t/.test(git(input.candidate, ["ls-tree", input.revision, "--", file])))) return false;
    const changed = git(input.candidate, ["diff-tree", "--no-commit-id", "--name-only", "-r", input.revision]).trim().split("\n").sort();
    return changed.join("\0") === [a.project, a.plan].sort().join("\0");
  } catch { return false; }
}

/** A legacy packet needs no overlay when its current governed records are already committed. */
export function hasCommittedPromotionAssignment(input: { repo: string; planSlug: string; actionId: string }): boolean {
  try {
    const planPath = `docs/plans/${input.planSlug}.md`;
    const projectText = regular(input.repo, "PROJECT.md");
    const planText = regular(input.repo, planPath);
    const base = git(input.repo, ["rev-parse", "HEAD"]).trim();
    if (!["PROJECT.md", planPath].every(file => /^100(?:644|755) blob [0-9a-f]+\t/.test(git(input.repo, ["ls-tree", base, "--", file])))) return false;
    if (git(input.repo, ["show", `${base}:PROJECT.md`]) !== projectText || git(input.repo, ["show", `${base}:${planPath}`]) !== planText) return false;
    const project = parseDoc("PROJECT.md", path.join(input.repo, "PROJECT.md"), projectText);
    const plan = parseDoc(planPath, path.join(input.repo, planPath), planText);
    if (project.errors.length || plan.errors.length || project.doc?.type !== "project" || plan.doc?.type !== "plan") return false;
    return project.doc.activePlan === input.planSlug && project.doc.currentAction === input.actionId &&
      plan.doc.project === project.doc.slug && plan.doc.slug === input.planSlug && plan.doc.currentAction === input.actionId &&
      plan.doc.actions.some(action => action.id === input.actionId && action.acceptanceCriteria.length > 0);
  } catch { return false; }
}
