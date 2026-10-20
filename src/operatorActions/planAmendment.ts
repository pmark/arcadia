import type Database from "better-sqlite3";
import { equal, fieldsMatch, hash, pinnedFieldsMatch, Refusal, refuse, validatePlanActivationInput, validatePlanAmendmentInput, type PlanActivationInput, type PlanAmendmentInput } from "./planAmendmentContract.js";
import { withinPlanAmendmentRunner } from "./operatorExecution.js";
import { claimRunnerLock } from "./runnerLock.js";
export type { PlanActivationInput, PlanAmendmentInput } from "./planAmendmentContract.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildAgentQueue } from "../dispatch/queue.js";
import { ArcadiaError, normalizeError } from "../cli/errors.js";
import { refuseInExperimentWorkspace } from "../workspace/experimentGuard.js";
import { normalizeAgentAsk, type AgentAskProposal } from "../ask/agentAsk.js";
import type { AgentAskSettlementReceipt } from "../ask/settlement.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { runAgentAskSettleCommand } from "../commands/agentAsk.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";

export interface PlanAmendmentResult {
  schema: "arcadia-plan-amendment-receipt-v1";
  id: string;
  pid: number;
  status: "running" | "succeeded" | "failed";
  reason: string;
  message: string;
  next: string;
  runDirectory: string;
  descriptorSha256: string;
  settlement?: AgentAskSettlementReceipt;
}
function atomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, file);
}
/** Preserve unknown fields too: a new schema field is never silently discarded. */
export function documentState(content: string): { fields: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) refuse("TARGET_STATE_DRIFT", "Managed document frontmatter is missing.");
  return { fields: parseYaml(match[1]) as Record<string, unknown>, body: match[2] };
}
function targetAction(fields: Record<string, unknown>, actionId: string): Record<string, unknown> {
  const actions = fields.actions as Record<string, unknown>[];
  const matches = Array.isArray(actions) ? actions.filter((action) => action.id === actionId) : [];
  if (matches.length !== 1) refuse("TARGET_STATE_DRIFT", `Action ${actionId} is missing or duplicated.`);
  return matches[0];
}
type DocumentEffects = NonNullable<AgentAskSettlementReceipt["review"]>["documents"];
/** The canonical settlement moves the exact pinned Ask bytes to its archive and nothing else. */
function isAskArchival(input: PlanAmendmentInput | PlanActivationInput, document: DocumentEffects[number]): boolean {
  const askArchive = `.arcadia/asks/archive/${path.basename(input.ask.path)}`;
  if (document.path === input.ask.path && document.after === null && document.before !== null && hash(document.before) === input.ask.sha256) return true;
  return document.path === askArchive && document.before === null && document.after !== null && hash(document.after) === input.ask.sha256;
}
function validDate(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) refuse("UNEXPECTED_EFFECTS", "Invalid managed document update date.");
}
function validateDocuments(input: PlanAmendmentInput, documents: DocumentEffects): void {
  const e = input.envelope;
  const planPath = `docs/plans/${e.plan}.md`;
  const planChanges = documents.filter((change) => change.path === planPath);
  if (planChanges.length !== 1) refuse("UNEXPECTED_EFFECTS", "Preview must amend exactly the pinned Plan.");
  const change = planChanges[0];
  if (!change.before || !change.after) refuse("UNEXPECTED_EFFECTS", "Preview creates or deletes the Plan.");
  const before = documentState(change.before);
  const after = documentState(change.after);
  fieldsMatch(before.fields, e.planUnchanged, "Plan");
  equal(targetAction(before.fields, e.action), e.actionBefore, "TARGET_STATE_DRIFT", "Pinned Action before");
  const expected = structuredClone(before);
  expected.fields.actions = (expected.fields.actions as Record<string, unknown>[]).map((action) => action.id === e.action ? e.actionAfter : action);
  // The canonical settlement stamps only Plan.updated in addition to the pinned Action.
  validDate(after.fields.updated);
  expected.fields.updated = after.fields.updated;
  equal(after, expected, "UNEXPECTED_EFFECTS", "Preview document effects");
  for (const document of documents.filter((item) => item.path !== planPath)) {
    if (!isAskArchival(input, document)) refuse("UNEXPECTED_EFFECTS", `Preview changes unauthorized document ${document.path}.`);
  }
}
/** Each managed document equals its before-image with only the pinned after-image and update date applied. */
function validateActivationDocuments(input: PlanActivationInput, documents: DocumentEffects): void {
  const e = input.envelope;
  const managed: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
    ["PROJECT.md", e.projectBefore, e.projectAfter, "Project"],
    [`docs/plans/${e.plan}.md`, e.planBefore, e.planAfter, "Plan"],
    [`docs/plans/${e.previousPlan}.md`, e.previousPlanBefore, e.previousPlanAfter, "Previous Plan"]
  ];
  for (const [file, pinnedBefore, pinnedAfter, label] of managed) {
    const changes = documents.filter((change) => change.path === file);
    if (changes.length !== 1 || !changes[0].before || !changes[0].after) refuse("UNEXPECTED_EFFECTS", `Preview must change ${label} ${file} exactly once.`);
    const before = documentState(changes[0].before);
    const after = documentState(changes[0].after);
    pinnedFieldsMatch(before.fields, pinnedBefore, `${label} before`);
    const expected = structuredClone(before);
    for (const [key, value] of Object.entries(pinnedAfter)) {
      if (value === null) delete expected.fields[key]; else expected.fields[key] = value;
    }
    validDate(after.fields.updated);
    expected.fields.updated = after.fields.updated;
    equal(after, expected, "UNEXPECTED_EFFECTS", `${label} after`);
  }
  const plan = documentState(documents.find((change) => change.path === `docs/plans/${e.plan}.md`)!.before!);
  const actions = Array.isArray(plan.fields.actions) ? plan.fields.actions as Record<string, unknown>[] : [];
  const first = actions.filter((action) => action.id === e.action);
  if (first.length !== 1) refuse("TARGET_STATE_DRIFT", `Action ${e.action} is missing or duplicated.`);
  pinnedFieldsMatch(first[0], e.actionUnchanged, "First Action");
  const logs = documents.filter((change) => change.path === e.log);
  if (logs.length !== 1 || logs[0].after === null) refuse("UNEXPECTED_EFFECTS", `Preview must append exactly one ${e.log} entry.`);
  // The canonical append also restamps the log's own `updated`; every other frontmatter field and the prior body stay.
  let appended = logs[0].after;
  if (logs[0].before !== null) {
    const before = documentState(logs[0].before);
    const after = documentState(logs[0].after);
    validDate(after.fields.updated);
    equal(after.fields, { ...before.fields, updated: after.fields.updated }, "UNEXPECTED_EFFECTS", `${e.log} frontmatter`);
    const prior = before.body.trimEnd();
    if (!after.body.startsWith(prior)) refuse("UNEXPECTED_EFFECTS", `${e.log} must only append this activation's entry.`);
    appended = after.body.slice(prior.length);
  }
  if (!appended.includes(`Agent Ask ${input.ask.proposal}`) || !appended.includes(`Activated ${e.plan} at ${e.action}.`)) {
    refuse("UNEXPECTED_EFFECTS", `${e.log} must only append this activation's entry.`);
  }
  const pinnedPaths = new Set([...managed.map(([file]) => file), e.log]);
  for (const document of documents.filter((item) => !pinnedPaths.has(item.path))) {
    if (!isAskArchival(input, document)) refuse("UNEXPECTED_EFFECTS", `Preview changes unauthorized document ${document.path}.`);
  }
}

/** The live documents carry every pinned after-image of this activation. */
function activationSettled(repo: string, input: PlanActivationInput): void {
  const e = input.envelope;
  const read = (file: string) => documentState(readFileSync(path.join(repo, file), "utf8")).fields;
  pinnedFieldsMatch(read("PROJECT.md"), { slug: e.project, ...e.projectAfter }, "Settled Project");
  pinnedFieldsMatch(read(`docs/plans/${e.plan}.md`), { slug: e.plan, ...e.planAfter }, "Settled Plan");
  pinnedFieldsMatch(read(`docs/plans/${e.previousPlan}.md`), { slug: e.previousPlan, ...e.previousPlanAfter }, "Settled previous Plan");
}

/** All settlement decisions live here. Generated scripts only identify their descriptor. */
export function runPlanAmendment(descriptorPath: string): PlanAmendmentResult {
  const library = path.dirname(path.resolve(descriptorPath));
  const id = path.basename(descriptorPath, ".json");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid operator action id.");
  const runDirectory = path.join(library, "runs", `${new Date().toISOString().replace(/[-:.]/g, "")}-${process.pid}`);
  mkdirSync(runDirectory, { recursive: true });
  const latest = path.join(library, "runs", "receipts", `${id}.json`);
  const lock = path.join(library, "runs", "receipts", `${id}.lock`);
  const result: PlanAmendmentResult = { schema: "arcadia-plan-amendment-receipt-v1", id, pid: process.pid, status: "running", reason: "STARTED", message: "Validating the pinned amendment.", next: "Wait for the durable result.", runDirectory, descriptorSha256: "" };
  let locked = false;
  const save = () => { atomic(path.join(runDirectory, "receipt.json"), result); if (locked) atomic(latest, result); };
  let repo = "";
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trimEnd();
  try {
    claimRunnerLock(lock);
    locked = true;
    const descriptorBytes = readFileSync(descriptorPath);
    result.descriptorSha256 = hash(descriptorBytes);
    const descriptor = JSON.parse(descriptorBytes.toString()) as { schema: string; id: string; script: string; planAmendment?: PlanAmendmentInput; planActivation?: PlanActivationInput };
    equal([descriptor.schema, descriptor.id, descriptor.script], ["arcadia-operator-script-v1", id, `${id}.sh`], "INVALID_CONTRACT", "Descriptor identity");
    if ((descriptor.planAmendment === undefined) === (descriptor.planActivation === undefined)) refuse("INVALID_CONTRACT", "The descriptor must pin exactly one of planAmendment or planActivation.");
    // Exactly one variant: an activation never amends Actions, and an amendment never activates.
    const activation = descriptor.planActivation;
    const amendment = descriptor.planAmendment;
    const input: PlanAmendmentInput | PlanActivationInput = activation ?? amendment!;
    if (activation) validatePlanActivationInput(activation); else validatePlanAmendmentInput(amendment!);
    save();
    repo = realpathSync(input.checkout.path);
    equal(repo, realpathSync(path.resolve(library, "../../..")), "WRONG_CHECKOUT", "Library checkout");
    equal(git(["rev-parse", "--show-toplevel"]), repo, "WRONG_CHECKOUT", "Git root");
    equal(realpathSync(path.resolve(repo, git(["rev-parse", "--git-common-dir"]))), path.join(repo, ".git"), "WRONG_CHECKOUT", "Primary checkout");
    equal(git(["remote", "get-url", "origin"]), input.checkout.origin, "WRONG_CHECKOUT", "Repository origin");
    equal(git(["branch", "--show-current"]), input.checkout.branch, "WRONG_CHECKOUT", "Branch");
    if (git(["status", "--porcelain"])) refuse("DIRTY_CHECKOUT", "Checkout has uncommitted changes.", "Preserve or commit the unrelated files, then retry this same action.");
    git(["merge-base", "--is-ancestor", input.checkout.reviewedBase, "HEAD"]);
    const pinnedAskPath = `.arcadia/asks/agent-ask-${input.ask.proposal}.yaml`;
    equal(input.ask.path, pinnedAskPath, "INVALID_CONTRACT", "Ask source path");
    const archived = path.join(repo, ".arcadia/asks/archive", path.basename(input.ask.path));
    const source = path.join(repo, input.ask.path);
    if (!existsSync(source) && !existsSync(archived)) refuse("CHANGED_ASK", "Pinned Ask source and archive are missing.");
    const ask = readFileSync(existsSync(source) ? source : archived, "utf8");
    equal(hash(ask), input.ask.sha256, "CHANGED_ASK", "Ask bytes");
    const normalized = normalizeAgentAsk({ request: ask });
    equal([normalized.requestId, normalized.project, normalized.intent, normalized.targetRef],
      [input.ask.proposal, input.envelope.project, "plan", `plan/${input.envelope.plan}`], "ANOTHER_PROPOSAL", "Ask target");
    const readProjectBefore = readFileSync(path.join(repo, "PROJECT.md"), "utf8");
    const project = documentState(readProjectBefore);
    const currentPlan = documentState(readFileSync(path.join(repo, `docs/plans/${input.envelope.plan}.md`), "utf8"));
    if (activation) {
      equal([normalized.actions.length, normalized.planMetadata ?? null], [0, null], "ANOTHER_PROPOSAL", "Ask activation shape");
      // Before settlement every image must match its before-image; a replay finds the after-images instead.
      // Preview decides which, and both paths then validate the exact document effects.
      const e = activation.envelope;
      const previousPlan = documentState(readFileSync(path.join(repo, `docs/plans/${e.previousPlan}.md`), "utf8"));
      try {
        pinnedFieldsMatch(project.fields, e.projectBefore, "Project");
        pinnedFieldsMatch(currentPlan.fields, e.planBefore, "Plan");
        pinnedFieldsMatch(previousPlan.fields, e.previousPlanBefore, "Previous Plan");
      } catch (error) {
        try { activationSettled(repo, activation); } catch { throw error; }
      }
      const actions = Array.isArray(currentPlan.fields.actions) ? currentPlan.fields.actions as Record<string, unknown>[] : [];
      pinnedFieldsMatch(actions.find((action) => action.id === e.action) ?? {}, e.actionUnchanged, "First Action");
    } else {
      const e = amendment!.envelope;
      equal(normalized.actions.length, 1, "ANOTHER_PROPOSAL", "Ask Action count");
      equal(normalized.actions[0].targetRef, `action/${e.action}`, "ANOTHER_PROPOSAL", "Ask Action");
      fieldsMatch(project.fields, e.projectUnchanged, "Project");
      fieldsMatch(currentPlan.fields, e.planUnchanged, "Plan");
    }
    let workspace: string;
    try { workspace = resolveReadyWorkspace(process.env.ARCADIA_WORKSPACE).workspacePath; }
    catch { refuse("WORKSPACE_UNAVAILABLE", "The configured workspace cannot be opened.", "Restore the configured workspace and retry; no alternative workspace or proposal will be selected."); }
    try { refuseInExperimentWorkspace("operator-script.run", workspace); }
    catch (error) {
      const details = error instanceof ArcadiaError ? error.details : {};
      refuse("EXPERIMENT_WORKSPACE", error instanceof Error ? error.message : String(error), String(details.alternative ?? "Run operator scripts only against the live workspace."));
    }
    // Do not invoke broad Ask discovery: only this exact input may be recorded.
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, input.envelope.project);
      const metadata = project ? getProjectMetadata(db, project.id) : null;
      equal(metadata?.repo_path ? realpathSync(metadata.repo_path) : null, repo, "WRONG_CHECKOUT", "Workspace Project repository");
      const row = db.prepare("SELECT proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(input.ask.proposal) as { proposal_json: string } | undefined;
      if (row) {
        const stored = JSON.parse(row.proposal_json) as AgentAskProposal;
        equal(stored.normalized, normalized, "ANOTHER_PROPOSAL", "Stored proposal");
        const settled = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE proposal_id = ?").get(stored.id) as { receipt_json: string } | undefined;
        if (settled) equal((JSON.parse(settled.receipt_json) as AgentAskSettlementReceipt).settlementRequestId,
          input.settlement.requestId, "ANOTHER_PROPOSAL", "Existing settlement request");
      }
      previewAgentAskRequest(db, { request: ask, sourcePath: source, repoRoot: repo });
    });
    const activationFlags = activation
      ? { activate: true, action: activation.settlement.action, model: activation.settlement.model, effort: activation.settlement.effort, top: true }
      : {};
    const flags = { workspace, proposal: input.ask.proposal, requestId: input.settlement.requestId, disposition: input.settlement.disposition, operator: input.settlement.operator, cwd: repo, ...activationFlags };
    // Preview and apply use precisely the same flags. No publication-time fingerprint exists.
    const preview = withinPlanAmendmentRunner(descriptorPath, () => runAgentAskSettleCommand(flags).data.receipt);
    atomic(path.join(runDirectory, "preview.json"), preview);
    equal([preview.proposalRequestId, preview.settlementRequestId, preview.projectSlug, preview.intent, preview.disposition],
      [input.ask.proposal, input.settlement.requestId, input.envelope.project, "plan", "accepted"], "ANOTHER_PROPOSAL", "Settlement identity");
    equal(preview.queueActionKeys, activation ? activation.envelope.queueSegment : [], "UNEXPECTED_EFFECTS", "Queue Action additions");
    const validate = (documents: DocumentEffects) => activation ? validateActivationDocuments(activation, documents) : validateDocuments(amendment!, documents);
    if (preview.applied) {
      if (!preview.documentsCommit || preview.recovery) refuse("SETTLEMENT_RECOVERY", "Canonical settlement needs recovery.", preview.recovery?.remedy ?? "Preserve the canonical receipt; no second settlement is permitted.");
      const commit = preview.documentsCommit;
      git(["merge-base", "--is-ancestor", commit, "HEAD"]);
      const paths = git(["diff-tree", "--no-commit-id", "--name-only", "-r", commit]).split("\n");
      const documents = paths.map((file) => {
        const read = (revision: string): string | null => {
          try { return execFileSync("git", ["show", `${revision}:${file}`], { cwd: repo, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 }); } catch { return null; }
        };
        return { path: file, before: read(`${commit}^`), after: read(commit) };
      });
      validate(documents);
      if (activation) activationSettled(repo, activation);
      else equal(targetAction(documentState(readFileSync(path.join(repo, `docs/plans/${amendment!.envelope.plan}.md`), "utf8")).fields, amendment!.envelope.action), amendment!.envelope.actionAfter, "TARGET_STATE_DRIFT", "Settled Action");
      result.settlement = preview;
    } else {
      if (!preview.review) refuse("UNEXPECTED_EFFECTS", "Canonical preview omitted structured effects.");
      const projectSlug = input.envelope.project;
      // Activation replaces only this Project's segment, at the top; every other Project keeps its order.
      equal(preview.review.queueAfter, activation ? [...activation.envelope.queueSegment, ...preview.review.queueBefore.filter((key) => !key.startsWith(`${projectSlug}/`))] : preview.review.queueBefore,
        "UNEXPECTED_EFFECTS", "Queue order");
      validate(preview.review.documents);
      try {
        git(["fetch", "origin", input.checkout.branch]);
        equal(git(["rev-parse", "HEAD"]), git(["rev-parse", `refs/remotes/origin/${input.checkout.branch}`]), "BASE_NOT_SYNCHRONIZED", "Checkout versus origin base");
      } catch (error) {
        if (error instanceof Refusal) throw error;
        refuse("PUBLICATION_UNAVAILABLE", "Origin cannot be reached before settlement.", "Restore origin connectivity and retry; no governance was changed.");
      }
      if (git(["status", "--porcelain"])) refuse("DIRTY_CHECKOUT", "Checkout changed after preview.");
      equal(hash(readFileSync(source)), input.ask.sha256, "CHANGED_ASK", "Ask bytes after preview");
      equal(hash(readFileSync(descriptorPath)), result.descriptorSha256, "CHANGED_ENVELOPE", "Reviewed descriptor after preview");
      const beforeGovernanceWrite = (db: Database.Database) => {
        // The same interlock used by every canonical settlement holds this fence.
        if (git(["status", "--porcelain"])) refuse("DIRTY_CHECKOUT", "Checkout changed before governance write.");
        equal(hash(readFileSync(descriptorPath)), result.descriptorSha256, "CHANGED_ENVELOPE", "Descriptor at write fence");
        equal(readFileSync(path.join(repo, "PROJECT.md"), "utf8"), readProjectBefore, "TARGET_STATE_DRIFT", "Project at write fence");
        for (const change of preview.review!.documents) {
          const file = path.join(repo, change.path);
          equal(existsSync(file) ? readFileSync(file, "utf8") : null, change.before, "TARGET_STATE_DRIFT", `${change.path} at write fence`);
        }
        const queue = buildAgentQueue(db);
        equal(queue.revision, preview.queueRevision, "TARGET_STATE_DRIFT", "Queue revision at write fence");
        equal(queue.ordered.flatMap(entry => entry.orderKey ? [entry.orderKey] : []), preview.review!.queueBefore, "UNEXPECTED_EFFECTS", "Queue at write fence");
      };
      result.settlement = withinPlanAmendmentRunner(descriptorPath, () => runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true, beforeGovernanceWrite }).data.receipt);
      equal([result.settlement.proposalRequestId, result.settlement.settlementRequestId, result.settlement.queueActionKeys], [preview.proposalRequestId, preview.settlementRequestId, preview.queueActionKeys],
        "SETTLEMENT_RECOVERY", "Applied settlement versus preview");
    }
    atomic(path.join(runDirectory, "settlement-receipt.json"), result.settlement);
    save(); // Durable before push, including crashes and retries.
    if (!result.settlement.applied || !result.settlement.documentsCommit || result.settlement.recovery) refuse("SETTLEMENT_RECOVERY", "Settlement did not finish every durable step.", result.settlement.recovery?.remedy ?? "Preserve the settlement receipt and recover its exact commit.");
    if (git(["status", "--porcelain"])) refuse("SETTLEMENT_RECOVERY", "Settlement left uncommitted files.", "Preserve the canonical receipt and commit; do not replay governance against unrelated work.");
    // Never publish unrelated local commits. A harmless remote advance is allowed only before settlement.
    try {
      git(["fetch", "origin", input.checkout.branch]);
      const remote = git(["rev-parse", `refs/remotes/origin/${input.checkout.branch}`]);
      const head = git(["rev-parse", "HEAD"]);
      if (remote !== head) {
        equal(head, result.settlement.documentsCommit, "PUBLICATION_FAILED", "Settlement publication HEAD");
        equal(git(["rev-parse", `${head}^`]), remote, "PUBLICATION_FAILED", "Remote base for exact settlement");
        git(["push", "origin", `${head}:refs/heads/${input.publication.branch}`]);
      }
    } catch (error) { refuse("PUBLICATION_FAILED", `Settlement is committed locally; publication failed: ${error instanceof Error ? error.message : String(error)}`, "Restore origin connectivity or its expected base, then retry this same action. It will verify and publish the existing settlement without applying again."); }
    result.status = "succeeded";
    result.reason = preview.applied ? "REPLAY_PUBLISHED" : "SETTLED_AND_PUBLISHED";
    result.message = activation ? "The exact Plan activation is committed and published." : "The exact Plan amendment is committed and published.";
    result.next = activation
      ? "Keep this receipt. Only the pinned pointers, Plan statuses and this Project's queue segment changed; no Session, Grant, production, service, or PR transition was authorized."
      : "Keep this receipt. No queue, pointer, Grant, production, service, or PR transition was authorized.";
  } catch (error) {
    result.status = "failed";
    const normalized = normalizeError(error);
    result.reason = error instanceof Refusal ? error.reason
      : ["WORKSPACE_NOT_FOUND", "DATABASE_NOT_INITIALIZED", "SQLITE_WORKSPACE_WRITE_DENIED", "SQLITE_NATIVE_ABI_MISMATCH", "SQLITE_ERROR"].includes(normalized.code)
        ? "WORKSPACE_UNAVAILABLE" : normalized.code === "VALIDATION_ERROR" ? "SETTLEMENT_REFUSED" : "RUNNER_FAILURE";
    result.message = error instanceof Error ? error.message : String(error);
    result.next = error instanceof Refusal ? error.next : "Restore the reported input or host failure and retry the same descriptor; preserve any canonical settlement receipt.";
    writeFileSync(path.join(runDirectory, "failure-handoff.txt"), `${result.reason}: ${result.message}\nNext: ${result.next}\n`);
  } finally {
    save();
    writeFileSync(path.join(runDirectory, "run.log"), `${result.reason}: ${result.message}\n${result.next}\n`);
    if (locked) unlinkSync(lock);
  }
  return result;
}
