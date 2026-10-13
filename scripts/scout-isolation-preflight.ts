import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { evaluateBoundedScoutIsolation, replayRetainedScout, reserveBoundedScoutAttempt, type ScoutPins } from "../src/scout/isolationPreflight.js";

const SUPERVISOR_LEDGER_PATH = "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/scout-evidence/bounded-luna-hello-world-0128/goal-budget.json";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`required option: ${name} <path>`);
  return value;
}

try {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("offline preflight requires Node 22");
  const attemptMode = process.argv.includes("--attempt");
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
  const candidateRoot = execFileSync("git", ["-C", path.dirname(fileURLToPath(import.meta.url)), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const dirtySource = execFileSync("git", ["-C", candidateRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  if (dirtySource.trim()) throw new Error("source checkout must be clean before recording an immutable revision");
  const sourceRevision = execFileSync("git", ["-C", candidateRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) throw new Error("could not pin immutable source revision");
  if (attemptMode) {
    const pins = JSON.parse(readFileSync(option("--pins"), "utf8")) as ScoutPins;
    const before = JSON.parse(readFileSync(option("--before"), "utf8"));
    const after = JSON.parse(readFileSync(option("--after"), "utf8"));
    if (pins.sourceRevision !== sourceRevision || pins.nodeVersion !== process.version || pins.model !== "gpt-6-luna" || pins.effort !== "low"
      || pins.fixtureRoot !== fixtureRoot || pins.workspace !== workspace) throw new Error("attempt pins must match the clean candidate, Node runtime, Luna low, and explicit fixture paths");
    const decisionPath = "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md";
    const decision = readFileSync(path.join(candidateRoot, decisionPath), "utf8");
    const report = evaluateBoundedScoutIsolation({ pins, before, after, decision: { text: decision, canonicalPath: decisionPath } });
    if (report.verdict !== "isolated") throw new Error(`bounded isolation check blocked: ${report.reasons.join("; ")}`);
    const reservation = reserveBoundedScoutAttempt({ ledgerPath: SUPERVISOR_LEDGER_PATH, trustedLedgerPath: SUPERVISOR_LEDGER_PATH, sourceRevision, fixtureRoot });
    if (!reservation.ok || !reservation.ledger) throw new Error(`attempt budget blocked: ${reservation.reason ?? "unknown reservation failure"}`);
    const receipt = { ...report, authority: "Decision 0128 bounded fixture isolation and budget reservation only; this receipt does not authorize execution", budget: reservation.ledger,
      reservation: { attemptNumber: reservation.attemptNumber, consumedBeforeLaunch: true }, modelInvocations: 0 };
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ok: true, output, verdict: report.verdict, attemptNumber: reservation.attemptNumber })}\n`);
    process.exit(0);
  }
  const manifestSha256 = option("--manifest-sha256");
  const before = JSON.parse(readFileSync(path.join(fixtureRoot, "arcadia-luna-scout-before.json"), "utf8")) as { liveWorkspace?: { path?: unknown } };
  const liveWorkspacePath = typeof before.liveWorkspace?.path === "string" ? before.liveWorkspace.path : "";
  const pins = {
    sourceRevision, nodeVersion: process.version, model: "gpt-6-luna", effort: "low",
    fixtureRoot, workspace, fixtureRepo: workspace, liveWorkspacePath, fixtureTrustPath: workspace
  };
  const report = replayRetainedScout(fixtureRoot, manifestSha256, pins);
  const receipt = {
    ...report,
    authority: "observation-only; grants no execution or admission",
    executionPins: {
      sourceRevision, nodeVersion: process.version,
      requestedModel: pins.model, requestedEffort: pins.effort, modelInvocations: 0,
      fixtureRoot, workspace
    }
  };
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, output, verdict: report.preflight.verdict, checks: report.evidenceIntegrity.checked })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
