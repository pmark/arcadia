import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { CreateArtifactInput } from "../domain/types.js";
import type { CompletionSupplementContract } from "./libraryContract.js";
import path from "node:path";
import type { NormalizedAgentAsk } from "../ask/agentAsk.js";
import { validationError } from "../cli/errors.js";
import { OperatorScriptContractError, validateOperatorScriptContract } from "./libraryContract.js";

let activeRunnerDescriptor: string | null = null;
/** Synchronous, in-process scope: a CLI flag or inherited environment cannot claim this. */
export function withinPlanAmendmentRunner<T>(descriptorPath: string, run: () => T): T {
  const previous = activeRunnerDescriptor;
  activeRunnerDescriptor = path.resolve(descriptorPath);
  try { return run(); } finally { activeRunnerDescriptor = previous; }
}

let activeSettlementDescriptor: string | null = null;
/** The same in-process scope for the shared pinned Agent Ask settlement runner. */
export function withinPinnedAskSettlementRunner<T>(descriptorPath: string, run: () => T): T {
  const previous = activeSettlementDescriptor;
  activeSettlementDescriptor = path.resolve(descriptorPath);
  try { return run(); } finally { activeSettlementDescriptor = previous; }
}

/** Called before previews, applies and replay returns in the canonical settlement path. */
export function assertOperatorSettlementContract(
  ask: NormalizedAgentAsk,
  settlement: { proposalId: string; disposition: string } | null = null
): void {
  const id = process.env.ARCADIA_OPERATOR_SCRIPT_ID;
  const descriptorPath = process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR;
  if (id === undefined && descriptorPath === undefined) return; // Ordinary manual/candidate CLI authority is unchanged.
  const next = "Prepare this operator action with the shared runner and pinned descriptor; do not clear its execution context or substitute a proposal.";
  const refuse = (reason: string, message: string): never => { throw validationError(message, { reason, next }); };
  if (!id || !descriptorPath) return refuse("INVALID_OPERATOR_CONTEXT", "Operator execution context is incomplete.");
  const file = path.resolve(descriptorPath);
  if (path.basename(file) !== `${id}.json`) refuse("INVALID_OPERATOR_CONTEXT", "Operator execution context does not match its descriptor.");
  let descriptor: ReturnType<typeof validateOperatorScriptContract>;
  try {
    descriptor = validateOperatorScriptContract(JSON.parse(readFileSync(file, "utf8")), id,
      readFileSync(path.join(path.dirname(file), `${id}.sh`), "utf8"));
  } catch (error) {
    return refuse(error instanceof OperatorScriptContractError ? error.reason : "INVALID_OPERATOR_CONTEXT",
      error instanceof Error ? error.message : String(error));
  }
  // An entry that names its Project settles only that Project's Asks, whatever scope it declares;
  // request ids alone are not Project-bound, and the card shows this Project's badge.
  if (descriptor.project !== undefined && ask.project !== descriptor.project) {
    refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", `This operator action belongs to Project ${descriptor.project}; it cannot settle a ${ask.project} Agent Ask.`);
  }
  if (descriptor.agentAskRejections) {
    // Rejection-only scope: exactly the pinned proposals, each only rejected. Checked before the
    // intent branches, so a pinned Plan-amendment Ask may be rejected but never accepted here.
    if (!settlement || settlement.disposition !== "rejected" || !descriptor.agentAskRejections.proposals.includes(settlement.proposalId)) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "This operator action may only reject the proposals its descriptor pins.");
    }
    return;
  }
  if (ask.intent === "plan" && ask.targetRef !== null) {
    const input = descriptor.planAmendment ?? descriptor.planActivation;
    if (activeRunnerDescriptor !== file || !input) {
      return refuse("PLAN_AMENDMENT_RUNNER_REQUIRED", "Operator-script Plan amendments must settle through the shared runner.");
    }
    if (ask.requestId !== input.ask.proposal || ask.project !== input.envelope.project || ask.targetRef !== `plan/${input.envelope.plan}`) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "The actual Plan amendment differs from the pinned operator action.");
    }
  } else {
    const declared = descriptor.agentAsk;
    if (!declared || ask.requestId !== declared.proposal || ask.intent !== declared.intent || ask.targetRef !== declared.targetRef) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "The actual Agent Ask differs from the operator descriptor's declared scope.");
    }
    const pinned = descriptor.agentAskSettlement;
    if (pinned) {
      if (activeSettlementDescriptor !== file) {
        refuse("AGENT_ASK_SETTLEMENT_RUNNER_REQUIRED", "A pinned Agent Ask settlement must settle through the shared runner.");
      }
      if (ask.project !== pinned.project || !settlement || settlement.disposition !== pinned.disposition) {
        refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "The actual settlement differs from the pinned Project or disposition.");
      }
    }
  }
}

export const COMPLETION_SUPPLEMENT_ARTIFACT = "session_completion_validation_supplement_v1";
export const supplementDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface CompletionSupplementOperator {
  contract: CompletionSupplementContract;
  executor: { revision: string; moduleSha256: string; sourceDirty: boolean };
  descriptor: { ref: string; sha256: string };
  run: { ref: string; runId: string; scriptId: string; pid: number; startedAt: string };
}
/** Bounded, non-symlink host JSON. Never reads provider output or an arbitrary log. */
export function readSupplementJson(file: string, root: string): { value: unknown; sha256: string } {
  const canonical = realpathSync(root);
  const relative = path.relative(canonical, path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Supplement file escapes its canonical root.");
  let current = canonical;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Supplement file contains a symlink.");
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Supplement file is not bounded regular JSON.");
    const bytes = readFileSync(fd);
    if (bytes.length > 65536) throw new Error("Supplement file grew beyond its bound.");
    return { value: JSON.parse(bytes.toString("utf8")), sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { closeSync(fd); }
}
/** This checks the actual dashboard runner's current receipt and parent process,
 * not a caller-supplied reference or an inherited environment label alone. */
export function completionSupplementOperator(descriptorPath: string, now = new Date()): CompletionSupplementOperator {
  const file = realpathSync(descriptorPath);
  const library = path.dirname(file);
  const id = path.basename(file, ".json");
  const repository = realpathSync(path.resolve(library, "../../.."));
  if (library !== path.join(repository, "artifacts/generated/operator-scripts") ||
      process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR !== file || process.env.ARCADIA_OPERATOR_SCRIPT_ID !== id) {
    throw new Error("A canonical operator action is required for a completion supplement.");
  }
  const raw = readSupplementJson(file, library);
  const descriptor = validateOperatorScriptContract(raw.value, id, readFileSync(path.join(library, `${id}.sh`), "utf8"));
  const contract = descriptor.completionSupplement;
  if (!contract || !descriptor.expires_at || Date.parse(descriptor.expires_at) <= now.getTime() || realpathSync(contract.repository) !== repository) {
    throw new Error("The completion supplement action is expired or belongs to another repository.");
  }
  const runId = process.env.ARCADIA_OPERATOR_SCRIPT_RUN_ID ?? "";
  if (!/^[0-9]+-[a-f0-9-]{36}$/.test(runId)) throw new Error("An actual operator action run receipt is required.");
  const directory = path.join(library, "runs/operator", id, runId);
  const snapshot = path.join(directory, "descriptor.json");
  if (process.env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY !== directory || process.env.ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR !== snapshot) {
    throw new Error("The operator run does not bind the canonical receipt directory.");
  }
  const executedDescriptor = readSupplementJson(snapshot, library);
  if (supplementDigest(executedDescriptor.value) !== supplementDigest(raw.value)) throw new Error("The executed descriptor differs from the operator snapshot.");
  const ref = path.join(directory, "run.json");
  const run = readSupplementJson(ref, library).value as Record<string, unknown>;
  if (run.schema !== "arcadia-operator-script-run-v1" || run.runId !== runId || run.scriptId !== id || run.status !== "running" ||
      run.pid !== process.ppid || typeof run.startedAt !== "string" || !Number.isFinite(Date.parse(run.startedAt)) || Date.parse(run.startedAt) > now.getTime()) {
    throw new Error("The operator action is not the running parent of this host operation.");
  }
  const command = execFileSync("ps", ["-ww", "-p", String(process.ppid), "-o", "command="], { encoding: "utf8", timeout: 2000, maxBuffer: 65536 });
  const executable = command.trimStart().split(" -e ")[0];
  const argv = [path.join(library, `${id}.sh`), ref, path.join(library, "runs/state", `${id}.json`),
    path.join(library, "runs/state", `${id}.lock`), directory, runId, snapshot];
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  if (path.basename(executable) !== "node" || normalize(command) !== normalize(`${executable} -e ${operatorScriptRunnerSource} ${argv.join(" ")}`)) {
    throw new Error("The parent process is not the exact canonical operator script runner and argv.");
  }
  const loadedRoot = path.resolve(import.meta.dirname, "../..");
  const revision = execFileSync("git", ["-C", loadedRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 2000 }).trim();
  const sourceDirty = Boolean(execFileSync("git", ["-C", loadedRoot, "status", "--porcelain", "--", "src", "scripts/supplement-completion-validation.ts"], { encoding: "utf8", timeout: 2000 }).trim());
  const executor = { revision, sourceDirty, moduleSha256: createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex") };
  return { contract, executor, descriptor: { ref: snapshot, sha256: executedDescriptor.sha256 }, run: { ref, runId, scriptId: id, pid: process.ppid, startedAt: run.startedAt } };
}
let supplementRegistration: CreateArtifactInput | null = null;
/** The validated host producer scopes exactly one immutable registration. */
export function registerCompletionSupplementArtifact<T>(operator: CompletionSupplementOperator, artifact: CreateArtifactInput, register: () => T): T {
  const current = completionSupplementOperator(process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR ?? "");
  if (operator.contract.phase !== "produce" || supplementDigest(current) !== supplementDigest(operator)) throw new Error("Reserved Artifact registration requires its current producer action.");
  const previous = supplementRegistration;
  supplementRegistration = artifact;
  try { return register(); } finally { supplementRegistration = previous; }
}
export function assertCompletionSupplementRegistration(input: CreateArtifactInput): void {
  if (supplementRegistration !== input) throw new Error("Reserved completion supplement kind requires the canonical host producer.");
}

/** Shared verbatim source used by the dashboard and host parent verification. */
export const operatorScriptRunnerSource = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(1);
const [scriptPath, firstStatePath, secondStatePath, lockPath, runDirectoryArg, runId, descriptorPath] = args;
const runRecordPath = args.length >= 7 ? firstStatePath : firstStatePath;
const latestStatePath = args.length >= 7 ? secondStatePath : firstStatePath;
const runDirectory = runDirectoryArg || path.dirname(runRecordPath);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
};
const writeState = (value) => {
  writeJson(latestStatePath, { ...value, ...(runId ? { runId } : {}) });
  if (runRecordPath !== latestStatePath) {
    const existing = fs.existsSync(runRecordPath) ? JSON.parse(fs.readFileSync(runRecordPath, "utf8")) : {};
    writeJson(runRecordPath, { ...existing, ...value, ...(runId ? { runId } : {}) });
  }
};
fs.mkdirSync(runDirectory, { recursive: true });
const stdout = fs.openSync(path.join(runDirectory, "stdout.log"), "a");
const stderr = fs.openSync(path.join(runDirectory, "stderr.log"), "a");
const startedAt = new Date().toISOString();
writeState({ status: "running", pid: process.pid, startedAt });
const env = { ...process.env };
env.ARCADIA_OPERATOR_SCRIPT_ID = path.basename(scriptPath, ".sh");
env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR = scriptPath.replace(/\.sh$/, ".json");
env.ARCADIA_OPERATOR_SCRIPT_RUN_ID = runId || "legacy";
env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY = runDirectory;
if (descriptorPath) env.ARCADIA_OPERATOR_SCRIPT_RUN_DESCRIPTOR = descriptorPath;
delete env.NODE_ENV;
for (const key of Object.keys(env)) {
  if (key.startsWith("NEXT_") || key.startsWith("__NEXT_")) delete env[key];
}
const child = spawn(scriptPath, ["run"], { stdio: ["ignore", stdout, stderr], env });
let settled = false;
const finish = (status, exitCode, message) => {
  if (settled) return;
  settled = true;
  writeState({ status, startedAt, finishedAt: new Date().toISOString(), exitCode, ...(message ? { message } : {}) });
  try { fs.closeSync(stdout); } catch {}
  try { fs.closeSync(stderr); } catch {}
  try { fs.unlinkSync(lockPath); } catch {}
  process.exit(exitCode ?? 1);
};
child.once("error", (error) => finish("failed", null, error.message));
child.once("close", (code) => finish(code === 0 ? "succeeded" : "failed", code, null));
`;
