import type Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildAgentQueue } from "../dispatch/queue.js";
import { normalizeError } from "../cli/errors.js";
import { normalizeAgentAsk, type AgentAskProposal } from "../ask/agentAsk.js";
import type { AgentAskSettlementReceipt } from "../ask/settlement.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { runAgentAskSettleCommand } from "../commands/agentAsk.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";

/** Version 1 is deliberately one existing Action, with no activation or queue flags. */
export interface PlanAmendmentInput {
  schema: "arcadia-plan-amendment-v1";
  checkout: { path: string; origin: string; branch: string; reviewedBase: string };
  ask: { path: string; sha256: string; proposal: string };
  settlement: { requestId: string; disposition: "accepted"; operator: true };
  envelope: {
    project: string;
    plan: string;
    action: string;
    projectUnchanged: Record<string, unknown>;
    planUnchanged: Record<string, unknown>;
    actionBefore: Record<string, unknown>;
    actionAfter: Record<string, unknown>;
    noChange: string[];
  };
  publication: { remote: "origin"; branch: string };
}
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
class Refusal extends Error {
  constructor(public reason: string, message: string, public next: string) { super(message); }
}
function refuse(reason: string, message: string, next = "Restore the named precondition and retry this same action; do not substitute another proposal."): never {
  throw new Refusal(reason, message, next);
}
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function atomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, file);
}
function exactKeys(value: object, keys: string[], label: string): void {
  if (!value || !isDeepStrictEqual(Object.keys(value).sort(), keys.sort())) refuse("INVALID_CONTRACT", `${label} has unsupported or missing fields.`);
}
function difference(actual: unknown, expected: unknown, label: string): string {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${label}.length: expected ${expected.length}, received ${actual.length}`;
    for (let index = 0; index < expected.length; index++) {
      if (!isDeepStrictEqual(actual[index], expected[index])) return difference(actual[index], expected[index], `${label}[${index}]`);
    }
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(e), ...Object.keys(a)])]) {
      if (!isDeepStrictEqual(a[key], e[key])) return difference(a[key], e[key], `${label}.${key}`);
    }
  }
  const short = (value: unknown) => {
    const text = JSON.stringify(value) ?? "missing";
    return text.length > 200 ? `${text.slice(0, 200)}… (sha256 ${hash(text)})` : text;
  };
  return `${label}: expected ${short(expected)}, received ${short(actual)}`;
}
function equal(actual: unknown, expected: unknown, reason: string, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) refuse(reason, difference(actual, expected, label),
    "Review the named difference and restore it, or publish a newly reviewed envelope. This click changed no unvalidated governance.");
}
/** Preserve unknown fields too: a new schema field is never silently discarded. */
export function documentState(content: string): { fields: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) refuse("TARGET_STATE_DRIFT", "Managed document frontmatter is missing.");
  return { fields: parseYaml(match[1]) as Record<string, unknown>, body: match[2] };
}
function fieldsMatch(fields: Record<string, unknown>, pinned: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(pinned)) equal(fields[key], value, "TARGET_STATE_DRIFT", `${label}.${key}`);
}
function targetAction(fields: Record<string, unknown>, actionId: string): Record<string, unknown> {
  const actions = fields.actions as Record<string, unknown>[];
  const matches = Array.isArray(actions) ? actions.filter((action) => action.id === actionId) : [];
  if (matches.length !== 1) refuse("TARGET_STATE_DRIFT", `Action ${actionId} is missing or duplicated.`);
  return matches[0];
}
function validateContract(input: PlanAmendmentInput): void {
  exactKeys(input, ["schema", "checkout", "ask", "settlement", "envelope", "publication"], "Runner input");
  equal(input.schema, "arcadia-plan-amendment-v1", "INVALID_CONTRACT", "Runner version");
  exactKeys(input.checkout, ["path", "origin", "branch", "reviewedBase"], "Checkout");
  exactKeys(input.ask, ["path", "sha256", "proposal"], "Ask");
  exactKeys(input.settlement, ["requestId", "disposition", "operator"], "Settlement flags");
  exactKeys(input.publication, ["remote", "branch"], "Publication");
  exactKeys(input.envelope, ["project", "plan", "action", "projectUnchanged", "planUnchanged", "actionBefore", "actionAfter", "noChange"], "Envelope");
  for (const value of [input.ask.proposal, input.settlement.requestId, input.envelope.project, input.envelope.plan, input.envelope.action]) {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) refuse("INVALID_CONTRACT", "Pinned identifiers must be lowercase slugs.");
  }
  equal(input.settlement.disposition, "accepted", "INVALID_CONTRACT", "Disposition");
  equal(input.settlement.operator, true, "INVALID_CONTRACT", "Operator authority");
  equal(input.publication.remote, "origin", "INVALID_CONTRACT", "Publication remote");
  equal(input.publication.branch, input.checkout.branch, "INVALID_CONTRACT", "Publication branch");
  if (!/^[a-f0-9]{40}$/.test(input.checkout.reviewedBase) || !/^[a-f0-9]{64}$/.test(input.ask.sha256)) refuse("INVALID_CONTRACT", "Reviewed base or Ask hash is invalid.");
  const e = input.envelope;
  fieldsMatch(e.projectUnchanged, { slug: e.project }, "Pinned Project");
  fieldsMatch(e.planUnchanged, { slug: e.plan, project: e.project }, "Pinned Plan");
  for (const key of ["active_plan", "current_action"]) {
    if (!(key in e.projectUnchanged)) refuse("INVALID_CONTRACT", `Project no-change envelope omits ${key}.`);
  }
  for (const key of ["status", "current_action", "milestone"]) {
    if (!(key in e.planUnchanged)) refuse("INVALID_CONTRACT", `Plan no-change envelope omits ${key}.`);
  }
  for (const key of ["id", "responsibility", "status", "title", "decisions", "clarification"]) {
    if (!e.noChange.includes(key) || !(key in e.actionBefore)) refuse("INVALID_CONTRACT", `Action no-change envelope omits ${key}.`);
  }
  for (const key of e.noChange) equal(e.actionAfter[key], e.actionBefore[key], "INVALID_CONTRACT", `Preserved Action.${key}`);
  equal(e.actionBefore.id, e.action, "INVALID_CONTRACT", "Action id");
  const acceptance = e.actionAfter.acceptance_criteria;
  if (!Array.isArray(acceptance) || !acceptance.length || !acceptance.every((item) => typeof item === "string" && item.trim())) refuse("INVALID_CONTRACT", "Acceptance replacement must contain observable criteria.");
}
function validateDocuments(input: PlanAmendmentInput, documents: NonNullable<AgentAskSettlementReceipt["review"]>["documents"]): void {
  const e = input.envelope;
  const planPath = `docs/plans/${e.plan}.md`;
  const askArchive = `.arcadia/asks/archive/${path.basename(input.ask.path)}`;
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
  if (typeof after.fields.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(after.fields.updated)) refuse("UNEXPECTED_EFFECTS", "Invalid Plan update date.");
  expected.fields.updated = after.fields.updated;
  equal(after, expected, "UNEXPECTED_EFFECTS", "Preview document effects");
  for (const document of documents.filter((item) => item.path !== planPath)) {
    if (document.path === input.ask.path && document.after === null && document.before !== null && hash(document.before) === input.ask.sha256) continue;
    if (document.path === askArchive && document.before === null && document.after !== null && hash(document.after) === input.ask.sha256) continue;
    refuse("UNEXPECTED_EFFECTS", `Preview changes unauthorized document ${document.path}.`);
  }
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
    mkdirSync(path.dirname(lock), { recursive: true });
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); locked = true; }
    catch {
      const owner = Number(readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(owner) || owner < 1) refuse("ALREADY_RUNNING", "The amendment lock has no valid owner.", "Preserve the lock and receipt; repair the invalid host lock before retrying.");
      try { process.kill(owner, 0); refuse("ALREADY_RUNNING", "This amendment is already running.", "Wait for the current invocation to finish; it owns the exact proposal."); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        // A dead invocation's canonical receipt, not the lock, decides replay.
        unlinkSync(lock);
        writeFileSync(lock, String(process.pid), { flag: "wx" });
        locked = true;
      }
    }
    const descriptorBytes = readFileSync(descriptorPath);
    result.descriptorSha256 = hash(descriptorBytes);
    const descriptor = JSON.parse(descriptorBytes.toString()) as { schema: string; id: string; script: string; planAmendment: PlanAmendmentInput };
    equal([descriptor.schema, descriptor.id, descriptor.script], ["arcadia-operator-script-v1", id, `${id}.sh`], "INVALID_CONTRACT", "Descriptor identity");
    const input = descriptor.planAmendment;
    validateContract(input);
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
    equal(normalized.actions.length, 1, "ANOTHER_PROPOSAL", "Ask Action count");
    equal(normalized.actions[0].targetRef, `action/${input.envelope.action}`, "ANOTHER_PROPOSAL", "Ask Action");
    const readProjectBefore = readFileSync(path.join(repo, "PROJECT.md"), "utf8");
    const project = documentState(readProjectBefore);
    fieldsMatch(project.fields, input.envelope.projectUnchanged, "Project");
    const currentPlan = documentState(readFileSync(path.join(repo, `docs/plans/${input.envelope.plan}.md`), "utf8"));
    fieldsMatch(currentPlan.fields, input.envelope.planUnchanged, "Plan");
    let workspace: string;
    try { workspace = resolveReadyWorkspace(process.env.ARCADIA_WORKSPACE).workspacePath; }
    catch { refuse("WORKSPACE_UNAVAILABLE", "The configured workspace cannot be opened.", "Restore the configured workspace and retry; no alternative workspace or proposal will be selected."); }
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
    const flags = { workspace, proposal: input.ask.proposal, requestId: input.settlement.requestId, disposition: input.settlement.disposition, operator: input.settlement.operator, cwd: repo };
    // Preview and apply use precisely the same flags. No publication-time fingerprint exists.
    const preview = runAgentAskSettleCommand(flags).data.receipt;
    atomic(path.join(runDirectory, "preview.json"), preview);
    equal([preview.proposalRequestId, preview.settlementRequestId, preview.projectSlug, preview.intent, preview.disposition],
      [input.ask.proposal, input.settlement.requestId, input.envelope.project, "plan", "accepted"], "ANOTHER_PROPOSAL", "Settlement identity");
    equal(preview.queueActionKeys, [], "UNEXPECTED_EFFECTS", "Queue Action additions");
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
      validateDocuments(input, documents);
      equal(targetAction(documentState(readFileSync(path.join(repo, `docs/plans/${input.envelope.plan}.md`), "utf8")).fields, input.envelope.action), input.envelope.actionAfter, "TARGET_STATE_DRIFT", "Settled Action");
      result.settlement = preview;
    } else {
      if (!preview.review) refuse("UNEXPECTED_EFFECTS", "Canonical preview omitted structured effects.");
      equal(preview.review.queueAfter, preview.review.queueBefore, "UNEXPECTED_EFFECTS", "Queue order");
      validateDocuments(input, preview.review.documents);
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
      result.settlement = runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true, beforeGovernanceWrite }).data.receipt;
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
    result.message = "The exact Plan amendment is committed and published.";
    result.next = "Keep this receipt. No queue, pointer, Grant, production, service, or PR transition was authorized.";
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
