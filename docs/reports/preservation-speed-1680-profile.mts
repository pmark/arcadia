/** Phase-only fixture benchmark; no workspace, provider, broker or production.
 * Run from repo root, serially:
 * node --import tsx docs/reports/preservation-speed-1680-profile.mts before /absolute/new-fixture.json /absolute/before.json
 * node --import tsx docs/reports/preservation-speed-1680-profile.mts after /absolute/new-fixture.json /absolute/after.json
 * Outputs are exclusive-create; choose fresh receipt paths to repeat. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { preservationStage, withPreservationProgress } from "../../src/sessions/preservationStages.js";

const baselineRevision = "fdc6d0548b4b6d51c81d7a4ce59654da3b75f67d";
const repository = path.resolve(import.meta.dirname, "../..");
const [label, fixtureFile, outputFile] = process.argv.slice(2);
if (!["before", "after"].includes(label) || !fixtureFile || !outputFile || !path.isAbsolute(fixtureFile) || !path.isAbsolute(outputFile)) {
  throw new Error("Usage: profile.mts before|after /absolute/new-fixture.json /absolute/new-output.json");
}
// Confine Git configuration and repository selection to this fixture process.
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete process.env[key];
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_ATTR_NOSYSTEM = "1";
const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
interface Fixture { root: string; repo: string; base: string; names: string[] }
let fixture: Fixture;
if (label === "before") {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-1680-speed-"));
  const repo = path.join(root, "repo"); mkdirSync(repo);
  git(repo, ["init", "--object-format=sha1", "-q"]);
  const names: string[] = [];
  for (let index = 0; index < 3000; index++) {
    const name = `file-${index}`; names.push(name);
    const bytes = Buffer.alloc(16656, index % 256); bytes.writeUInt32LE(index);
    writeFileSync(path.join(repo, name), bytes);
    if (index % 100 === 0) chmodSync(path.join(repo, name), 0o755);
  }
  symlinkSync("file-0", path.join(repo, "link"));
  git(repo, ["add", "-A"]); git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture"]);
  fixture = { root, repo, base: git(repo, ["rev-parse", "HEAD"]), names };
  writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2), { flag: "wx" });
} else fixture = JSON.parse(readFileSync(fixtureFile, "utf8")) as Fixture;
const { root, repo, base, names } = fixture;
const source = readFileSync(path.join(repository, "src/sessions/candidateSnapshot.ts"), "utf8");
let modulePath = path.join(repository, "src/sessions/candidateSnapshot.ts");
let measuredSource = source;
if (label === "before") {
  // Pin the former implementation; only rebind its unchanged helper imports.
  measuredSource = execFileSync("git", ["show", `${baselineRevision}:src/sessions/candidateSnapshot.ts`], { cwd: repository, env, encoding: "utf8" });
  const rebound = measuredSource
    .replace('"./preservationStages.js"', JSON.stringify(path.join(repository, "src/sessions/preservationStages.ts")))
    .replace('"../cli/errors.js"', JSON.stringify(path.join(repository, "src/cli/errors.ts")))
    .replace('"./goRequestProtocol.js"', JSON.stringify(path.join(repository, "src/sessions/goRequestProtocol.ts")));
  modulePath = path.join(root, "baseline.mts"); writeFileSync(modulePath, rebound, { flag: "wx" });
}
const { snapshotCandidate, materializeCandidateTree } = await import(pathToFileURL(modulePath).href) as typeof import("../../src/sessions/candidateSnapshot.js");
const state = () => ({ head: git(repo, ["rev-parse", "HEAD"]), index: readFileSync(path.join(repo, ".git/index")).toString("base64"), status: git(repo, ["--no-optional-locks", "status", "--porcelain=v1"]) });
const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const bin = path.join(root, "profile-bin"); mkdirSync(bin, { recursive: true });
const calls = path.join(root, "git-calls");
writeFileSync(path.join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$1" >> ${quote(calls)}\nexec ${quote(realGit)} "$@"\n`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
const counts = () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).reduce((result: Record<string, number>, name) => { result[name] = (result[name] ?? 0) + 1; return result; }, {});
const before = state(), loadBefore = loadavg(); writeFileSync(calls, "");
const start = Date.now();
const tree = withPreservationProgress(() => undefined, () => { preservationStage("profile.capture"); return snapshotCandidate(repo, base); });
const captureMs = Date.now() - start, captureCounts = counts(); writeFileSync(calls, "");
const destination = mkdtempSync(path.join(root, `${label}-materialized-`));
const materializeStart = Date.now();
withPreservationProgress(() => undefined, () => { preservationStage("profile.materialize"); materializeCandidateTree(repo, tree, destination); });
const materializeMs = Date.now() - materializeStart, materializeCounts = counts();
let bytes = 0;
const errors: string[] = [];
for (const name of names) {
  const expected = readFileSync(path.join(repo, name)), actual = readFileSync(path.join(destination, name)); bytes += expected.length;
  if (!expected.equals(actual)) errors.push(`${name}:bytes`);
  if ((lstatSync(path.join(repo, name)).mode & 0o111) !== (lstatSync(path.join(destination, name)).mode & 0o111)) errors.push(`${name}:mode`);
}
if (readlinkSync(path.join(destination, "link")) !== "file-0") errors.push("link:target");
const after = state();
const result = { label, baselineRevision, git: realGit, loadBefore, loadAfter: loadavg(), candidateHead: git(repository, ["rev-parse", "HEAD"]), sourceSha256: createHash("sha256").update(measuredSource).digest("hex"), tree, files: names.length + 1, bytes, captureMs, materializeMs, captureCounts, materializeCounts, sourcePreserved: JSON.stringify(before) === JSON.stringify(after), errors, fixtureFile, destination, node: process.version, date: new Date().toISOString(), loadNote: "Single serial sample; other host activity and warm caches are uncontrolled. Phase-only fixture, not full replay or installed-runtime proof." };
writeFileSync(outputFile, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result));
if (!result.sourcePreserved || errors.length) process.exitCode = 1;
