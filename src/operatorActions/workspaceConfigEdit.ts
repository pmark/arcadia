import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withReadOnlyDatabase } from "../db/connection.js";
import { readProductionPolicySafely } from "../production/policy.js";
import { loadWorkspaceConfig, unmeteredProviderSelector } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { resolveWorkspace } from "../workspace/resolve.js";
import { validateOperatorScriptContract } from "./libraryContract.js";
import type { WorkspaceConfigEditField, WorkspaceConfigEditInput } from "./workspaceConfigEditContract.js";
import type { PlanAmendmentResult } from "./planAmendment.js";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const INVERSE: Record<WorkspaceConfigEditField, string> = {
  "codingAgent.capacityGateEnabled":
    "Inverse (not built as a card): add \"capacityGateEnabled\": false back inside the \"codingAgent\" object of <workspace>/config/arcadia.json while production is Off. That exempts every configured provider from the capacity gate again (Decision 0123: operator-owned)."
};

export interface WorkspaceConfigEditReceipt extends PlanAmendmentResult {
  configEdit?: {
    workspace: string;
    configPath: string;
    field: WorkspaceConfigEditField;
    removedValue: false;
    beforeSha256: string;
    afterSha256: string;
    productionObserved: { desiredState: string; revision: number; observedAt: string };
    inverse: string;
  };
}

export interface RunWorkspaceConfigEditOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => Date;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

function atomic(file: string, content: string, mode?: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, content, mode === undefined ? undefined : { mode });
  renameSync(temporary, file);
}

class Refusal extends Error {
  constructor(public reason: string, message: string, public next: string) { super(message); }
}

/** Runs one pinned edit and returns (and records) its durable receipt. Never throws for a refusal. */
export function runWorkspaceConfigEdit(descriptorPath: string, options: RunWorkspaceConfigEditOptions = {}): WorkspaceConfigEditReceipt {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const descriptorFile = path.resolve(descriptorPath);
  const library = path.dirname(descriptorFile);
  const id = path.basename(descriptorFile, ".json");
  const latest = path.join(library, "runs/receipts", `${id}.json`);
  const runDirectory = env.ARCADIA_OPERATOR_SCRIPT_RUN_DIRECTORY?.trim() ||
    path.join(library, "runs", `${now().toISOString().replace(/[-:.]/g, "")}-${process.pid}`);
  mkdirSync(runDirectory, { recursive: true });
  let descriptorSha256 = "";
  const base = { schema: "arcadia-plan-amendment-receipt-v1" as const, id, pid: process.pid, runDirectory };

  let receipt: WorkspaceConfigEditReceipt;
  try {
    if (!slug.test(id)) throw new Refusal("INVALID_OPERATOR_CONTRACT", "Operator action id must be a lowercase slug.", "Repair the library entry.");
    const descriptorBytes = readFileSync(descriptorFile);
    descriptorSha256 = sha256(descriptorBytes);
    const scriptText = readFileSync(path.join(library, `${id}.sh`), "utf8");
    let pin: WorkspaceConfigEditInput;
    try {
      const descriptor = validateOperatorScriptContract(JSON.parse(descriptorBytes.toString("utf8")), id, scriptText);
      if (!descriptor.workspaceConfigEdit) throw new Error("The descriptor declares no workspaceConfigEdit.");
      pin = descriptor.workspaceConfigEdit;
    } catch (error) {
      throw new Refusal("INVALID_OPERATOR_CONTRACT", error instanceof Error ? error.message : String(error), "Repair the library pair through a reviewed PR; nothing was changed.");
    }

    // One-shot: a recorded success is final, whatever the file reads now.
    if (existsSync(latest)) {
      let previous: Partial<PlanAmendmentResult> = {};
      try { previous = JSON.parse(readFileSync(latest, "utf8")); } catch { /* An unreadable journal is not a success. */ }
      if (previous.status === "succeeded") {
        throw new Refusal("ALREADY_APPLIED", `This one-shot edit already succeeded (run ${previous.runDirectory ?? "unknown"}); it never applies twice.`, "Nothing to do. Undoing it is a separate operator decision; see the inverse in the earlier receipt.");
      }
    }

    // Pin the exact workspace: resolve it the ordinary way and require the pinned path.
    let resolved: string | null;
    try { resolved = resolveWorkspace({ env, cwd: options.cwd }).workspacePath ?? null; }
    catch (error) { throw new Refusal("WORKSPACE_UNRESOLVED", error instanceof Error ? error.message : String(error), "Restore the host's workspace configuration; nothing was changed."); }
    const real = (p: string) => { try { return realpathSync(p); } catch { return null; } };
    if (!resolved || real(resolved) === null || real(resolved) !== real(pin.workspace)) {
      throw new Refusal("WORKSPACE_DRIFT", `The resolved workspace (${resolved ?? "none"}) is not the pinned workspace ${pin.workspace}.`, "Nothing was changed. Re-pin through a fresh reviewed library pair if the workspace really moved.");
    }
    const configPath = getWorkspacePaths(pin.workspace).configFile;

    // Precondition: canonical bytes, and the field holds exactly the pinned value.
    const beforeBytes = readFileSync(configPath, "utf8");
    const beforeSha256 = sha256(beforeBytes);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(beforeBytes); } catch { throw new Refusal("PRECONDITION_DRIFT", "The workspace config is not valid JSON.", "Nothing was changed; repair the config first."); }
    if (canonical(parsed) !== beforeBytes) {
      throw new Refusal("NONCANONICAL_CONFIG", "The workspace config is not in canonical two-space JSON form, so a minimal edit cannot be proven to preserve every other byte.", "Nothing was changed. Re-pin after the config is canonical.");
    }
    const [section, key] = pin.field.split(".") as [string, string];
    const container = parsed[section];
    const observed = container && typeof container === "object" && !Array.isArray(container) && Object.prototype.hasOwnProperty.call(container, key)
      ? (container as Record<string, unknown>)[key] : undefined;
    if (observed !== pin.expected) {
      throw new Refusal("PRECONDITION_DRIFT", `${pin.field} reads ${observed === undefined ? "absent" : JSON.stringify(observed)}, not the pinned ${JSON.stringify(pin.expected)}.`, "Nothing was changed. If it is already absent the gate is already on.");
    }

    // Freeze check: never while managed production is Active; fail closed when unreadable.
    const read = withReadOnlyDatabase(pin.workspace, (db) => readProductionPolicySafely(db));
    if (read.status !== "ok") {
      throw new Refusal("PRODUCTION_FREEZE_UNVERIFIED", `Production state could not be read: ${read.reason}.`, "Nothing was changed. Retry once production status reads normally on /production.");
    }
    if (read.policy.desiredState !== "inactive") {
      throw new Refusal("PRODUCTION_ACTIVE_FREEZE", `Managed production is ${read.policy.desiredState} (revision ${read.policy.revision}); the capacity gate is not changed under a live run.`, "Turn production Off on /production first, then press this card again.");
    }

    // Minimal edit: drop exactly one key; every other field keeps its order and value.
    const { [key]: _removed, ...rest } = container as Record<string, unknown>;
    const edited = { ...parsed, [section]: rest };
    const afterBytes = canonical(edited);
    const afterSha256 = sha256(afterBytes);
    const reread = readFileSync(configPath, "utf8");
    if (sha256(reread) !== beforeSha256) {
      throw new Refusal("PRECONDITION_DRIFT", "The workspace config changed while this run was checking it.", "Nothing was changed. Press again once nothing else is editing the config.");
    }
    const mode = statSync(configPath).mode & 0o777;
    atomic(configPath, afterBytes, mode);

    // Verify through the real loader: the gate now reads enforced for every provider.
    const written = readFileSync(configPath, "utf8");
    if (sha256(written) !== afterSha256) throw new Refusal("WRITE_UNVERIFIED", "The written config does not match the computed edit.", "Read the run directory's receipt; restore the before-image from it only by an operator decision.");
    const loaded = loadWorkspaceConfig(configPath);
    if (unmeteredProviderSelector(loaded.codingAgent) !== null) {
      throw new Refusal("WRITE_UNVERIFIED", "The written config still exempts a provider from the capacity gate.", "Read the receipt before doing anything else.");
    }
    writeFileSync(path.join(runDirectory, "config-before.json"), beforeBytes);
    writeFileSync(path.join(runDirectory, "config-after.json"), afterBytes);
    receipt = {
      ...base, descriptorSha256, status: "succeeded", reason: "APPLIED",
      message: `Removed ${pin.field}: false from ${configPath}. The capacity gate is on for every provider.`,
      next: "Claude launches are now admitted only on a fresh read-only usage reading; Codex/OpenCode without fresh readings are refused. Keep this receipt.",
      configEdit: {
        workspace: pin.workspace, configPath, field: pin.field, removedValue: false, beforeSha256, afterSha256,
        productionObserved: { desiredState: read.policy.desiredState, revision: read.policy.revision, observedAt: read.observedAt },
        inverse: INVERSE[pin.field]
      }
    };
  } catch (error) {
    const refusal = error instanceof Refusal ? error
      : new Refusal("RUNNER_ERROR", error instanceof Error ? error.message : String(error), "Preserve this receipt; nothing is retried automatically.");
    receipt = { ...base, descriptorSha256, status: "failed", reason: refusal.reason, message: refusal.message, next: refusal.next };
    writeFileSync(path.join(runDirectory, "failure-handoff.txt"), `${receipt.reason}: ${receipt.message}\nNext: ${receipt.next}\n`);
  }
  atomic(path.join(runDirectory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  // A refusal after a recorded success never overwrites that success.
  let keepPrevious = false;
  if (receipt.status !== "succeeded" && existsSync(latest)) {
    try { keepPrevious = JSON.parse(readFileSync(latest, "utf8")).status === "succeeded"; } catch { /* Replace an unreadable journal. */ }
  }
  if (!keepPrevious) atomic(latest, JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
