import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { applyPromotionAssignment, promotionAssignmentBlock, verifyMaterializedPromotion } from "../src/sessions/promotionAssignment.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function repo(root: string): string {
  mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(root, "PROJECT.md"), "old project\n");
  writeFileSync(path.join(root, "docs/plans/plan.md"), "old plan\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  return root;
}

it("isolates Git relocation and index variables while materializing a bound candidate", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-assignment-"))); roots.push(root);
  const source = repo(path.join(root, "source")); const foreign = repo(path.join(root, "foreign"));
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(path.join(source, "PROJECT.md"), "new project\n");
  writeFileSync(path.join(source, "docs/plans/plan.md"), "new plan\n");
  const block = promotionAssignmentBlock({ repo: source, plan: "docs/plans/plan.md", originalProject: "old project\n", originalPlan: "old plan\n" })!;
  const candidate = path.join(root, "candidate"); git(source, "worktree", "add", "-q", "-b", "candidate", candidate, base);
  const packet = path.join(root, "packet"); writeFileSync(packet, block);
  const foreignHead = git(foreign, "rev-parse", "HEAD");
  const foreignIndex = readFileSync(path.join(foreign, ".git", "index"));
  const foreignProject = readFileSync(path.join(foreign, "PROJECT.md"));
  const keys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_COUNT"] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.GIT_DIR = path.join(foreign, ".git"); process.env.GIT_WORK_TREE = foreign;
    process.env.GIT_INDEX_FILE = path.join(foreign, ".git", "index"); process.env.GIT_CONFIG_COUNT = "0";
    const revision = applyPromotionAssignment({ repo: source, candidate, packet, packetHash: sha(block), base,
      projectHash: sha("new project\n"), planHash: sha("new plan\n"), planPath: "docs/plans/plan.md", identityEnv: {} })!;
    verifyMaterializedPromotion({ repo: source, candidate, packet, packetHash: sha(block), revision });
  } finally { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
  expect(git(foreign, "rev-parse", "HEAD")).toBe(foreignHead);
  expect(readFileSync(path.join(foreign, ".git", "index"))).toEqual(foreignIndex);
  expect(readFileSync(path.join(foreign, "PROJECT.md"))).toEqual(foreignProject);
  expect(git(candidate, "show", "HEAD:PROJECT.md")).toBe("new project");
});

it("refuses null assignment JSON as an Arcadia error", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-assignment-"))); roots.push(root);
  const text = `<!-- arcadia-promotion-assignment-v1:${Buffer.from("null").toString("base64")} -->`;
  const packet = path.join(root, "packet"); writeFileSync(packet, text);
  expect(() => applyPromotionAssignment({ repo: root, candidate: root, packet, packetHash: sha(text), base: "base", projectHash: null, planHash: null, planPath: null, identityEnv: {} })).toThrow(ArcadiaError);
});
