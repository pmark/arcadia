import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runAgentAskDraftCommand, runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../../../src/commands/agentAsk.js";
import type { PhaseRecorder } from "./report.js";

/**
 * The scripted executor: the stand-in for the coding agent.
 *
 * It receives exactly what a real agent receives -- the process tmux was
 * asked to start (the `env` wrapper with the Session's Git identity, the
 * provider command and the rendered Action brief as its last argument) and
 * that process's working directory -- and nothing else: no database row, no
 * Session id. From the brief it reads the Project, the Action, the candidate
 * worktree and the acceptance criteria, then follows the brief's completion
 * protocol in that worktree: edit, run the declared validation, commit under
 * the launch identity, and draft and settle a `complete` Agent Ask through
 * the same `agent-ask draft` / `preview` / `settle` command functions the
 * agent's shell runs (`src/commands/agentAsk.ts`), with `--cwd` the worktree.
 *
 * One deliberate difference from a real agent: it does not call the
 * `arcadia-preserve-broker-<agent>` launcher (completion step 2). The worker
 * preserves a terminal candidate itself when the Session exits, which is the
 * path every live rehearsal took; the broker's file transport is covered by
 * tests/preservation-request-*.test.ts.
 *
 * Behaviours select how it deviates from the clean protocol, each one a
 * shape a live run produced or could produce.
 */
export type ExecutorBehaviour =
  /** The brief's protocol, exactly: `agent-ask draft` (which previews and records the file), settle, clean tree. */
  | "clean"
  /**
   * Run 4's shape: the draft is written as a file only, the proposal is
   * previewed from inline text (so it records no source path) and settled by
   * proposal id. Before #983 the drafted file stayed untracked and unarchived.
   */
  | "untracked-unarchived-draft"
  /**
   * #983's N4 case: as run 4, but the drafted file is edited after the inline
   * preview, so it no longer matches the settled proposal.
   */
  | "edit-draft-after-inline-preview"
  /** Settles cleanly, then leaves one extra untracked file in the worktree. */
  | "extra-uncommitted-file"
  /** Settles cleanly, then commits one extra file on top of the settlement commit. */
  | "extra-commit-after-settle"
  /**
   * Failure injection at the completion boundary: commits its work, drafts
   * and previews the Ask, then dies inside `settle --apply` after the
   * settlement commit lands in the candidate and before the settlement is
   * recorded in the workspace (the `beforeOperationalProjection` hook the
   * settlement already exposes for exactly this window).
   */
  | "interrupted-after-settlement-commit"
  /** Commits its work and dies before drafting or settling anything. */
  | "interrupted-after-work-commit"
  /**
   * Reads its brief and exits at once: no edit, no commit, no draft. A
   * continuation agent that finds nothing it can do behaves like this.
   */
  | "exits-without-completing";

/** What one Action's agent does, in files. */
export interface ActionWork {
  files: Record<string, string>;
  /** The Project's declared validation command, run from the worktree root. */
  validation: string;
}

export interface LaunchRecord { name: string; cwd: string; command: string; args: string[] }

export interface ParsedBrief {
  project: string;
  action: string;
  worktree: string;
  branch: string;
  criteria: string[];
  continuation: boolean;
}

export interface ExecutorResult {
  brief: ParsedBrief;
  requestId: string;
  workCommit: string;
  settlementCommit: string | null;
  finalHead: string;
  settleWarnings: string[];
  /** `git status --porcelain --untracked-files=all` when the executor exited. */
  statusAtExit: string;
  interrupted: string | null;
}

/** Parse the rendered Action brief (src/sessions/actionBrief.ts). Throws if it is not one. */
export function parseBrief(text: string): ParsedBrief {
  if (!text.startsWith("Arcadia managed-production Action brief")) throw new Error("The launch's last argument is not an Action brief.");
  const field = (name: string) => {
    const match = new RegExp(`^${name}: (.+)$`, "m").exec(text);
    if (!match) throw new Error(`The brief has no "${name}:" line.`);
    return match[1].trim();
  };
  const lines = text.split("\n");
  const start = lines.indexOf("Acceptance criteria (verbatim, in the plan's order):");
  if (start < 0) throw new Error("The brief lists no acceptance criteria.");
  const criteria: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+\d+\. (.*)$/.exec(line);
    if (!match) break;
    criteria.push(match[1]);
  }
  return {
    project: field("Project"),
    action: field("Action"),
    worktree: field("Candidate worktree"),
    branch: field("Branch"),
    criteria,
    continuation: text.includes("Continuation — this is a resumed Session")
  };
}

/** The `GIT_AUTHOR_*` / `GIT_COMMITTER_*` assignments the launch's `env` wrapper carries. */
export function launchIdentity(launch: LaunchRecord): Record<string, string> {
  const argv = [launch.command, ...launch.args];
  return Object.fromEntries(argv.flatMap((arg) => {
    const match = /^(GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL))=(.*)$/.exec(arg);
    return match ? [[match[1], match[2]]] : [];
  }));
}

class Interrupted extends Error {}

export class ScriptedExecutor {
  private runs = 0;

  constructor(
    private readonly workspace: string,
    private readonly recorder: PhaseRecorder,
    /** A workspace path the agent's draft cannot reach, for file-only drafts. */
    private readonly unreachableWorkspace: string
  ) {}

  /** Act as the agent process tmux was asked to start, then return (the caller ends the pane). */
  run(launch: LaunchRecord, work: ActionWork, behaviour: ExecutorBehaviour): ExecutorResult {
    this.runs += 1;
    const brief = parseBrief(launch.args.at(-1) ?? "");
    if (path.resolve(launch.cwd) !== path.resolve(brief.worktree)) throw new Error(`tmux cwd ${launch.cwd} is not the brief's worktree ${brief.worktree}.`);
    const identity = launchIdentity(launch);
    if (!identity.GIT_AUTHOR_NAME || !identity.GIT_COMMITTER_EMAIL) throw new Error("The launch carries no agent Git identity.");
    const cwd = brief.worktree;
    const requestId = `complete-${brief.action}-run-${this.runs}`;
    const saved = Object.fromEntries(Object.keys(identity).map((key) => [key, process.env[key]]));
    Object.assign(process.env, identity);
    let settlementCommit: string | null = null;
    let settleWarnings: string[] = [];
    let interrupted: string | null = null;
    let workCommit = "";
    try {
      if (behaviour === "exits-without-completing") {
        workCommit = this.git(cwd, ["rev-parse", "HEAD"]).trim();
        return this.result(brief, requestId, workCommit, null, [], null);
      }
      this.recorder.measure("agentExecution", () => {
        for (const [file, content] of Object.entries(work.files)) {
          mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
          writeFileSync(path.join(cwd, file), content);
        }
      });
      this.recorder.measure("validation", () => this.sh(cwd, work.validation));
      workCommit = this.recorder.measure("gitFinalization", () => {
        this.git(cwd, ["add", "-A"]);
        if (this.git(cwd, ["status", "--porcelain"]).trim()) this.git(cwd, ["commit", "-q", "-m", `Implement ${brief.action}`]);
        return this.git(cwd, ["rev-parse", "HEAD"]).trim();
      });
      if (behaviour === "interrupted-after-work-commit") throw new Interrupted("agent process died after its work commit, before drafting its completion");
      const ask = JSON.stringify({
        agent_ask: "v1",
        request_id: requestId,
        project: brief.project,
        intent: "complete",
        target_ref: `action/${brief.action}`,
        desired_result: `Record ${brief.action} complete.`,
        candidate_revision: workCommit,
        evidence: brief.criteria.map((criterion) => ({ criterion, status: "met", note: "Verified in the candidate worktree by the scripted executor." })),
        requested_authority: "apply_if_approved"
      });
      this.recorder.measure("gitFinalization", () => {
        const draftPath = path.join(cwd, ".arcadia", "asks", `agent-ask-${requestId}.yaml`);
        let proposal = requestId;
        if (behaviour === "untracked-unarchived-draft" || behaviour === "edit-draft-after-inline-preview") {
          const drafted = this.arcadia("agent-ask draft", cwd, () =>
            runAgentAskDraftCommand({ workspace: this.unreachableWorkspace, request: ask, dir: cwd }));
          if (drafted.data.path !== draftPath) throw new Error(`draft wrote ${drafted.data.path}, expected ${draftPath}`);
          const preview = this.arcadia("agent-ask preview <inline>", cwd, () => runAgentAskPreviewCommand({ workspace: this.workspace, request: ask }));
          proposal = preview.data.proposal.id;
          if (behaviour === "edit-draft-after-inline-preview") {
            writeFileSync(draftPath, readFileSync(draftPath, "utf8").replace("by the scripted executor.", "by the scripted executor (edited after preview)."));
          }
        } else {
          this.arcadia("agent-ask draft", cwd, () => runAgentAskDraftCommand({ workspace: this.workspace, request: ask, dir: cwd }));
        }
        const settleRequest = `settle-${requestId}`;
        const preview = this.arcadia(`agent-ask settle --proposal ${proposal} --request-id ${settleRequest} --disposition accepted`, cwd, () =>
          runAgentAskSettleCommand({ workspace: this.workspace, proposal, requestId: settleRequest, disposition: "accepted", cwd }));
        const hooks = behaviour === "interrupted-after-settlement-commit"
          ? { beforeOperationalProjection: () => { throw new Interrupted("agent process died after the settlement commit, before the settlement was recorded"); } }
          : undefined;
        const applied = this.arcadia(`agent-ask settle --proposal ${proposal} --request-id ${settleRequest} --preview <fp> --apply`, cwd, () =>
          runAgentAskSettleCommand({
            workspace: this.workspace, proposal, requestId: settleRequest, disposition: "accepted", cwd,
            preview: preview.data.receipt.previewFingerprint, apply: true, ...(hooks ? { hooks } : {})
          }));
        settlementCommit = applied.data.receipt.documentsCommit ?? null;
        settleWarnings = applied.data.receipt.warnings ?? [];
      });
      if (behaviour === "extra-uncommitted-file") writeFileSync(path.join(cwd, "scratch-notes.txt"), "left behind by the scripted executor\n");
      if (behaviour === "extra-commit-after-settle") {
        writeFileSync(path.join(cwd, "EXTRA.md"), "committed after settlement by the scripted executor\n");
        this.git(cwd, ["add", "EXTRA.md"]);
        this.git(cwd, ["commit", "-q", "-m", "Add EXTRA.md after settling"]);
      }
    } catch (error) {
      if (!(error instanceof Interrupted)) throw error;
      interrupted = error.message;
      if (behaviour === "interrupted-after-settlement-commit") settlementCommit = this.git(cwd, ["rev-parse", "HEAD"]).trim();
      this.recorder.error({ kind: "injected", command: "scripted executor", cwd, exitCode: null, stderr: error.message, expected: true });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    return this.result(brief, requestId, workCommit, settlementCommit, settleWarnings, interrupted);
  }

  private result(brief: ParsedBrief, requestId: string, workCommit: string, settlementCommit: string | null, settleWarnings: string[], interrupted: string | null): ExecutorResult {
    return {
      brief,
      requestId,
      workCommit,
      settlementCommit,
      finalHead: this.git(brief.worktree, ["rev-parse", "HEAD"]).trim(),
      settleWarnings,
      statusAtExit: this.git(brief.worktree, ["status", "--porcelain", "--untracked-files=all"]),
      interrupted
    };
  }

  /** One in-process `arcadia` command; a refusal is recorded with its message and details, then rethrown. */
  private arcadia<T>(command: string, cwd: string, fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      const details = (error as { details?: unknown }).details;
      this.recorder.error({
        kind: "command", command: `arcadia ${command}`, cwd, exitCode: 1,
        stderr: `${error instanceof Error ? error.message : String(error)}${details ? ` ${JSON.stringify(details)}` : ""}`, expected: false
      });
      throw error;
    }
  }

  private git(cwd: string, args: string[]): string {
    return this.exec(cwd, "git", args);
  }

  private sh(cwd: string, command: string): string {
    return this.exec(cwd, "/bin/sh", ["-c", command]);
  }

  private exec(cwd: string, command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0) {
      const stderr = `${result.stderr ?? ""}${result.error ? ` ${result.error.message}` : ""}`;
      this.recorder.error({ kind: "command", command: [command, ...args].join(" "), cwd, exitCode: result.status, stderr, expected: false });
      throw new Error(`${command} ${args.join(" ")} failed in ${cwd} (exit ${String(result.status)}): ${stderr}`);
    }
    return result.stdout;
  }
}
