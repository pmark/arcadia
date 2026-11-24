import type Database from "better-sqlite3";
import { tryGit } from "../git/worktrees.js";
import { retireHandoffForFreshDispatch, type HandoffRetirementRecord } from "./handoffRetirement.js";
import type { AgentSession, TmuxAdapter } from "./index.js";
import { criteriaPathMentions, isGovernedRecordPath, scopeAllowances } from "./scopeCriteria.js";

/**
 * Issue #3015: a resumed `incomplete_resumable` candidate keeps its original
 * base, so a fix merged to main after the first attempt never reaches the
 * resume (live 2026-11-24: #3014 fixed the test every timeline Action required,
 * and Action 1's resume would still have run without it). Before the tick
 * resumes such a handoff it asks one question: did main gain a commit, absent
 * from both the candidate's base and its head, that touches a file the
 * Action's criteria name (paths they mention as work, including test files
 * their commands run, and "touches only ..." lists)? Only a definite yes stops the resume; anything
 * it cannot tell is `unknown`, and the tick resumes as before.
 */
export type StaleBaseCheck =
  | { kind: "stale"; namedFiles: string[]; commits: Array<{ sha: string; files: string[] }> }
  | { kind: "current" }
  | { kind: "unknown"; reason: string };

const MAX_LISTED = 5;

/**
 * Shared append-only docs: nearly every Action's scope lists them and main
 * appends to them all day, so they would make most resumes look stale, and an
 * appended note is not the source fix this check exists for.
 */
const APPEND_ONLY_DOCS = new Set(["docs/notes-to-self.md", "docs/COMMANDS.md"]);

/**
 * The files the criteria name: paths they mention as work (a negated or
 * `path:line` mention does not count; a test file a command runs is a
 * mention) and "touches only ..." lists. Governed records are left out: every
 * settlement on main writes PROJECT.md, the Plan and the Ask archive, so
 * naming one would make every resume look stale, and a records change is not
 * the source fix this check exists for. Shared append-only docs are left out
 * for the same reason. A `dir/` scope entry names a directory.
 */
export function criteriaNamedFiles(criteria: readonly string[]): string[] {
  const named = [
    ...criteriaPathMentions(criteria),
    ...scopeAllowances(criteria).flatMap((allowance) => allowance.allowed)
  ];
  return [...new Set(named)].filter((file) => !isGovernedRecordPath(file) && !APPEND_ONLY_DOCS.has(file));
}

export function checkStaleBase(input: {
  repoRoot: string;
  baseRevision: string;
  candidateHead: string;
  mainRevision: string;
  criteria: readonly string[];
}): StaleBaseCheck {
  const namedFiles = criteriaNamedFiles(input.criteria);
  if (namedFiles.length === 0) return { kind: "unknown", reason: "the Action's criteria name no file to compare" };
  const revisions = [input.baseRevision, input.candidateHead, input.mainRevision];
  if (revisions.some((revision) => !/^[0-9a-f]{40,64}$/.test(revision)
    || tryGit(input.repoRoot, ["cat-file", "-e", `${revision}^{commit}`]) === null)) {
    return { kind: "unknown", reason: "the candidate's base, its head or main cannot be read as a commit" };
  }
  const log = tryGit(input.repoRoot, ["-c", "core.quotepath=false", "log", "--no-renames", "--name-only", "--format=%x01%H",
    input.mainRevision, `^${input.baseRevision}`, `^${input.candidateHead}`, "--"]);
  if (log === null) return { kind: "unknown", reason: "the commits main gained since the candidate's base cannot be listed" };
  const named = (file: string) => namedFiles.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
  const commits = log.split("\u0001").filter(Boolean).map((block) => {
    const [sha, ...files] = block.split("\n").map((line) => line.trim()).filter(Boolean);
    return { sha, files: files.filter(named) };
  }).filter((commit) => commit.files.length > 0);
  return commits.length > 0 ? { kind: "stale", namedFiles, commits } : { kind: "current" };
}

/**
 * The tick's decision for a same-Action resumable handoff. Returns the
 * retirement when the base misses a fix to a criteria-named file and the
 * governed retirement succeeded (the caller then dispatches fresh from
 * current main); null in every other case, which resumes as before. Each
 * unknown or refused case is logged.
 */
export function retireStaleBaseHandoff(input: {
  db: Database.Database;
  repoRoot: string;
  session: AgentSession;
  candidateHead: string;
  mainRevision: string;
  criteria: readonly string[];
  tmux: Pick<TmuxAdapter, "hasSession">;
  now: Date;
  log?: (line: string) => void;
}): HandoffRetirementRecord | null {
  const label = `${input.session.project_slug}/${input.session.action_id}`;
  const check = checkStaleBase({
    repoRoot: input.repoRoot, baseRevision: input.session.base_revision, candidateHead: input.candidateHead,
    mainRevision: input.mainRevision, criteria: input.criteria
  });
  if (check.kind === "unknown") {
    input.log?.(`Stale-base check for ${label} is unknown (${check.reason}); resuming Session ${input.session.id}'s candidate as before (Issue #3015).`);
    return null;
  }
  if (check.kind === "current") return null;
  const listed = check.commits.slice(0, MAX_LISTED).map((commit) => `${commit.sha.slice(0, 12)} (${commit.files.slice(0, MAX_LISTED).join(", ")})`).join(", ");
  const more = check.commits.length > MAX_LISTED ? ` and ${check.commits.length - MAX_LISTED} more` : "";
  const reason = `Base ${input.session.base_revision.slice(0, 12)} lacks main commit(s) touching files the Action's criteria name: ${listed}${more}. `
    + `Dispatched fresh from ${input.mainRevision.slice(0, 12)} instead of resuming; the old worktree and branch are kept (Issue #3015).`
    + preservedCandidateNote(input.db, input.session.id);
  let result: ReturnType<typeof retireHandoffForFreshDispatch>;
  try {
    result = retireHandoffForFreshDispatch({
      db: input.db, sessionId: input.session.id, requestId: `stale-base-${input.session.id}`, reason, tmux: input.tmux, now: input.now
    });
  } catch (error) {
    input.log?.(`Stale-base retirement for ${label} failed (${error instanceof Error ? error.message : String(error)}); resuming Session ${input.session.id}'s candidate as before (Issue #3015).`);
    return null;
  }
  if ("refusal" in result) {
    input.log?.(`Stale-base retirement for ${label} refused [${result.refusal.code}]: ${result.refusal.reason} Resuming Session ${input.session.id}'s candidate as before (Issue #3015).`);
    return null;
  }
  input.log?.(`Retired the resumable handoff of Session ${input.session.id} for ${label} (receipt ${result.retirement.id}): ${reason}`);
  return result.retirement;
}

/**
 * A preserved candidate is retired too (its commit is already pushed), but the
 * receipt names that commit and any open pull request, so the abandoned
 * candidate is found by whoever reads the retirement. Empty when none.
 */
function preservedCandidateNote(db: Database.Database, sessionId: string): string {
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_preservation_receipts'").get()) return "";
    const row = db.prepare("SELECT commit_sha, preservation_state, pull_request_url FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${sessionId}`) as { commit_sha: string; preservation_state: string; pull_request_url: string | null } | undefined;
    if (!row) return "";
    return ` The retired candidate was preserved as commit ${row.commit_sha.slice(0, 12)} (${row.preservation_state})`
      + `${row.pull_request_url ? `, pull request ${row.pull_request_url}` : ""}; integrate, close or salvage it by hand.`;
  } catch {
    return "";
  }
}
