import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { replayRetainedScout } from "../src/scout/isolationPreflight.js";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`required option: ${name} <path>`);
  return value;
}

try {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("offline preflight requires Node 22");
  const fixtureRoot = realpathSync(option("--fixture-root"));
  const workspace = realpathSync(option("--workspace"));
  if (workspace === fixtureRoot || !workspace.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error("workspace must be an explicit child of the fixture root");
  }
  const requestedOutput = path.resolve(option("--output"));
  const outputParent = realpathSync(path.dirname(requestedOutput));
  const output = path.join(outputParent, path.basename(requestedOutput));
  if (output === fixtureRoot || !output.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error("output must be inside the explicit fixture root");
  }
  if (existsSync(output)) throw new Error("refusing to overwrite an existing retained evidence file");
  const candidateRoot = fileURLToPath(new URL("../", import.meta.url));
  const dirtySource = execFileSync("git", ["-C", candidateRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  if (dirtySource.trim()) throw new Error("source checkout must be clean before recording an immutable revision");
  const sourceRevision = execFileSync("git", ["-C", candidateRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) throw new Error("could not pin immutable source revision");
  const manifestSha256 = option("--manifest-sha256");
  const pins = {
    sourceRevision, nodeVersion: process.version, model: "gpt-6-luna", effort: "low",
    fixtureRoot, workspace, fixtureRepo: workspace, liveWorkspacePath: "/unobserved-live-workspace", fixtureTrustPath: workspace
  };
  const report = replayRetainedScout(fixtureRoot, manifestSha256, pins);
  const receipt = {
    ...report,
    authority: "observation-only; grants no execution or admission",
    executionPins: { ...pins, requestedModel: pins.model, requestedEffort: pins.effort, modelInvocations: 0 }
  };
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, output, verdict: report.preflight.verdict, checks: report.evidenceIntegrity.checked })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
