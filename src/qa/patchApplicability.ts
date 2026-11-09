/**
 * The deterministic half of a code reviewer's `not-applicable` claim.
 *
 * A reviewer may say a criterion cannot be affected by a change (a one-line
 * marker file cannot exercise failure handling). That is a model claim, so it
 * is accepted only when the immutable patch agrees, failing closed:
 *
 * - every touched file is on an explicit inert allowlist (plain documents
 *   outside code, agent and dot directories), or is one of Arcadia's governed
 *   records changed only within the exact shape Arcadia's governed commands
 *   write, by commits that carry their attestation and touch nothing else;
 * - the patch is a complete `git format-patch` series whose commit
 *   boundaries are pairwise distinct, consistently numbered `[PATCH i/N]`, and
 *   exactly the pull request's commit ids (GitHub's compare patch omits merge
 *   commits and their conflict resolutions, so a pull request containing any
 *   merge commit, including a base-branch merge, never qualifies; a boundary
 *   line forged inside a commit message breaks the numbering), and every file
 *   the pull request declares is in it, below the GitHub CLI's 100-file and
 *   100-commit caps.
 *
 * What this text parser cannot do alone: format-patch writes a commit message
 * verbatim, so a message can hold `---`, a diffstat and a whole `diff --git`
 * entry with a self-computed blob id, indistinguishable from a real one. A
 * forged entry only ever adds to the commit's real ones, so
 * {@link checkGovernedRecords}, whose Verified facts a reviewer relies on,
 * also requires each commit's entries to be exactly the files its Git object
 * changes ({@link CommitObjectFiles}). The not-applicable classifier does not
 * (it has no such evidence): a forged entry cannot hide a real code file from
 * it, but could excuse a real shape-limited change, which the same reviewer
 * backstops named below still judge.
 *
 * Anything else (code, scripts, workflows, configuration, manifests,
 * authority-bearing or agent-instruction documents, any dot directory, an
 * executable or symlink mode, binaries, an unparseable header or hunk, a
 * governed record changed beyond its shape) makes every criterion applicable,
 * and the claim is refused. Attestations are author-controlled text, so they
 * never excuse a file on their own: the shape limit is checked regardless.
 *
 * Each claim also needs substantive evidence of its own, and the verdict's
 * claims need at least one that names a touched file by path or basename (or,
 * on such a docs-only patch, a review summary that does). That naming rule is
 * verdict-level and only anchors the claims to this patch: the per-file
 * classification above alone decides whether any claim can be accepted.
 *
 * The Plan-completing settlement (#2270) is a verified shape only with the
 * commit's parent revision of PROJECT.md and the Plan (`parentDocuments`):
 * one Plan, the active one, completed at its current Action with every other
 * Action already done or deferred. The commit's hunks are applied to the
 * parent's text (they must apply exactly), both sides are read with the
 * repository's own YAML front-matter parser, and the parsed change must be
 * exactly that: no body change, no other key, Action or PROJECT.md change. A
 * second Plan with the same slug and project is not visible from one Plan's
 * evidence, and the `updated:` date is not compared. Residual there: the
 * evidence is the commit's parent, not the merge result, so an Action added to
 * the Plan on the base branch after the branch point is not seen; and a Plan
 * whose other Actions are deferred only by a Decision, or that has a queued
 * successor, stays refused.
 *
 * Residual: a forged attestation can still make shape-limited governed edits
 * pass this check (add Agent Ask data files or archive them, by rename or as a
 * deletion beside a same-Ask archive copy differing only in candidate_revision,
 * append to the Mission Log and move its front-matter `updated:` forward to
 * the date an appended entry heading carries (front matter is inferred from
 * the hunk's context, so a body line shaped exactly like it within the first
 * lines would pass too), mark the current Action done and move current_action to any
 * well-formed Action id, which can skip Actions or change which Actions are
 * dependency-ready, and rewrite that same done Action's own `next_action` to
 * its exact canonical completed form naming any Agent Ask id this same patch
 * series actually carries: by file name, by a whole-content-verified Ask's own
 * request_id, or as the auto-settle id derived from that content; and excuse a
 * host-preserved completion draft from the governed-only rule when its own
 * settlement archives it or a review repair's controller-authored retirement
 * commit names and deletes it for the Action this patch settles — the filename/content checks only establish that
 * *some* file under `.arcadia/asks/` with that exact id was added or
 * archived here, never that its content truly describes this Action or
 * criteria, or that a real operator ever accepted it). The code reviewer's
 * correctness judgment and QA's managed-document and approval-boundary
 * criteria (never not-applicable) are the backstops for those.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { autoSettleRequestId } from "../ask/autoSettleRequestId.js";

export type PatchFileClass =
  | "inert-document"
  | "governed-record"
  | "executable"
  | "configuration"
  | "authority"
  | "unknown";

export interface PatchFileClassification {
  path: string;
  class: PatchFileClass;
  reason: string;
}

export interface PatchApplicability {
  /** True only when every touched file is inert or a shape-limited governed record, and the patch is complete. */
  inert: boolean;
  files: PatchFileClassification[];
  /** Patch-level reasons nothing in it can be judged inert (incomplete or unverifiable evidence). */
  problems: string[];
}

export interface PatchEvidence {
  /** The paths the pull request declares (`gh pr view --json files`). */
  declaredFiles?: readonly string[];
  /**
   * The pull request's commit ids (`gh pr view --json commits`), merges
   * included; null when they could not be read, which fails closed. Omitted
   * only by callers that classify a patch without pull-request evidence.
   */
  declaredCommits?: readonly string[] | null;
  /**
   * What each commit's own Git object changes, by full commit id; null or
   * omitted when it could not be read. {@link checkGovernedRecords} verifies
   * nothing without it.
   */
  commitFiles?: CommitObjectFiles | null;
  /**
   * Governed documents (`PROJECT.md`, `docs/plans/*.md`) as they stood at each
   * commit's first parent, by full commit id then path, read from the Git
   * object. A Plan-completing settlement (the last Action done, the Plan
   * `complete`, `current_action` removed) is a verified shape only with it:
   * the patch cannot show that every other Action was already done. Null,
   * omitted or missing an entry leaves that shape refused (fail closed).
   */
  parentDocuments?: ParentDocuments | null;
}

export type ParentDocuments = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** One file a commit changes, read from the commit's Git object rather than from patch text, so no commit message reaches it. */
export interface CommitObjectFile {
  path: string;
  /** The path it was renamed or copied from, when the object read reports one. */
  previousPath: string | null;
  /** The file's full blob id: the new one, or the old one for a deletion. */
  blob: string | null;
}

export type CommitObjectFiles = Readonly<Record<string, readonly CommitObjectFile[]>>;

export interface NotApplicableClaim {
  criterion: string;
  name: string;
  status: string;
  evidence: string;
}

export interface NotApplicableEvaluation {
  /** Criteria whose not-applicable claim the deterministic check accepted. */
  accepted: string[];
  refused: Array<{ criterion: string; name: string; reason: string }>;
}

/** The GitHub CLI reads at most this many files and commits of a pull request. */
export const GITHUB_CLI_LIST_CAP = 100;

/** Arcadia's governed-command attestations, as the commands write them. */
const GOVERNED_ATTESTATIONS: RegExp[] = [
  /^Arcadia-Preservation-Request: \S+$/m,
  /^Arcadia-Candidate-Fingerprint: [0-9a-f]{7,64}$/m,
  /^Written by `arcadia agent-ask settle --apply` \(asksettle_[A-Za-z0-9]+\)\.?$/m
];

const FORMAT_PATCH_BOUNDARY = /^From ([0-9a-f]{40}) Mon Sep 17 00:00:00 2001$/;
const SIMPLE_DIFF_HEADER = /^diff --git a\/(\S+) b\/(\S+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Minimum substance of a not-applicable claim's evidence. */
export const NOT_APPLICABLE_MIN_EVIDENCE_CHARS = 40;
export const NOT_APPLICABLE_MIN_EVIDENCE_WORDS = 6;

/** Criteria a reviewer may never mark not-applicable: every change claims a behavior. */
export const NEVER_NOT_APPLICABLE_CRITERIA: ReadonlySet<string> = new Set(["correctness"]);

interface ParsedFile {
  paths: string[];
  oldPath: string | null;
  newPath: string | null;
  commit: number;
  executableMode: boolean;
  special: string | null;
  created: boolean;
  deleted: boolean;
  renamed: boolean;
  copied: boolean;
  /** Each hunk's body lines, prefix included (` `, `+`, `-`, `\`). */
  hunks: string[][];
  /** Each hunk's old-side start line, parallel to `hunks`. */
  hunkStarts: number[];
  /** The new blob id from the `index <old>..<new>` header line (abbreviated), when shown. */
  newBlob: string | null;
  /** The old blob id from the same `index` line, when shown. */
  oldBlob: string | null;
}

interface ParsedCommit {
  sha: string | null;
  attested: boolean;
  /** `[PATCH i/N]` from the Subject header; null for a bare `[PATCH]`, undefined when absent. */
  numbering: { index: number; total: number } | null | undefined;
  /** The `From:` header (the commit author), as format-patch writes it; null when absent. */
  author?: string | null;
  /** The request ids its `Arcadia-Retired-Completion-Draft:` trailers name. */
  retiredDraftIds?: string[];
}

const SUBJECT_NUMBERING = /^Subject: \[PATCH(?: (\d+)\/(\d+))?\]/;

/**
 * Every boundary is a distinct commit, and `[PATCH i/N]` agrees with the
 * boundaries actually parsed: git numbers the real commits, so a boundary
 * forged inside a commit message (format-patch emits bodies verbatim) breaks
 * the count, whatever headers the forger writes after it.
 */
function boundaryProblems(commits: ParsedCommit[]): string[] {
  const problems: string[] = [];
  const shas = commits.map((commit) => commit.sha);
  if (new Set(shas).size !== shas.length) problems.push("the compare patch repeats a commit boundary");
  const numbered = commits.every((commit, index) => commits.length === 1
    ? commit.numbering === null || (commit.numbering?.index === 1 && commit.numbering.total === 1)
    : commit.numbering?.index === index + 1 && commit.numbering.total === commits.length);
  if (!numbered) problems.push("the compare patch's [PATCH i/N] numbering does not match its commit boundaries, as when a commit message carries a forged boundary");
  return problems;
}

export function classifyPatchApplicability(patch: string, evidence: PatchEvidence = {}): PatchApplicability {
  return analyzePatch(patch, evidence).applicability;
}

/** One governed-record fact as Arcadia's check found it, on this exact patch. */
export interface GovernedRecordFact {
  verified: boolean;
  /** Which thing the fact is about: a request id or a path. Untrusted patch text; encode it when shown. */
  subject: string;
  /** What was or was not established. Host wording around untrusted text. */
  detail: string;
}

/** What the deterministic check establishes about a patch's governed records, for a reviewer who cannot recompute it. */
export interface GovernedRecordCheck {
  /** Patch-level reasons nothing here can be verified (the facts then all read not verified). */
  problems: string[];
  /** The Agent Ask ids the Plan's completed next_action and the Mission Log cite. */
  citations: GovernedRecordFact[];
  /** Each Ask file under `.arcadia/asks/archive/` the patch adds. */
  archives: GovernedRecordFact[];
  /** Each commit presenting itself as a review repair's retirement of a completion draft. */
  retirements: GovernedRecordFact[];
  /** Each governed-record path the patch touches, against its allowed shape. */
  shapes: GovernedRecordFact[];
}

const AUTO_SETTLE_CITATION = /\bauto-settle-[A-Za-z0-9][\w.-]*[\w-]/g;

/**
 * Runs the classifier's own checks and reports them per fact, so a review that
 * makes no not-applicable claim is told what was actually established instead
 * of being told it is. Nothing here is a second derivation: citations use the
 * same carried Asks and `autoSettleRequestId`, archives the same split-archive
 * recognition, retirements the same commit recognition, shapes the same
 * per-path classification. Fails closed: any patch-level problem (a merge
 * commit GitHub's patch omits, an unreadable commit list, a truncated list, a
 * commit's entries differing from its Git object) leaves every fact not
 * verified. A verified fact is about files the commit objects really change,
 * and never that a real settlement wrote them: a governed marker, a retirement
 * trailer and the `From:` header are still text a Session can write, so a
 * forged commit of the same shape verifies too, as the module header says. It
 * also holds at the head, since a reviewer reads it as a statement about the
 * candidate: any later commit touching the record it is about leaves it not
 * verified, naming that commit, whether or not that commit is itself in shape.
 */
export function checkGovernedRecords(patch: string, evidence: PatchEvidence = {}): GovernedRecordCheck {
  const { commits, files, applicability, shapes, retired, splitArchives } = analyzePatch(patch, evidence);
  const problems = [...applicability.problems, ...commitObjectProblems(commits, files, evidence.commitFiles)];
  const clean = problems.length === 0;
  const fact = (verified: boolean, subject: string, detail: string): GovernedRecordFact => ({ verified: clean && verified, subject, detail });
  /** The first commit after `after` (other than `except`) touching any of these paths, by id; null when none does. */
  const laterTouch = (paths: readonly string[], after: number, except?: number): string | null => {
    const found = files.find((file) => file.commit > after && file.commit !== except && file.paths.some((filePath) => paths.includes(filePath)));
    return found ? commits[found.commit]?.sha ?? "(no commit id)" : null;
  };
  /** A fact established at one commit, kept only when no later commit touched its record. */
  const heldAtHead = (subject: string, detail: string, toucher: string | null): GovernedRecordFact => toucher
    ? fact(false, subject, `${detail}, but commit ${toucher} touches this record afterwards, so that is not known to hold at the head`)
    : fact(true, subject, detail);
  const { carriedAsks } = shapes;
  const archivedNames = new Set(files.flatMap((file) => file.newPath?.startsWith(".arcadia/asks/archive/") ? [basename(file.newPath)] : []));
  const actionOf = (ask: CarriedAsk) => ask.targetRef.startsWith("action/") ? ask.targetRef.slice("action/".length) : ask.targetRef.split("#")[1] ?? null;

  /** The Ask this patch carries and archives that an id names: as its own request_id, or as the id derived from its content. */
  const namedAsk = (requestId: string, actionId: string | null) => carriedAsks.find((ask) => {
    const action = actionOf(ask);
    return action !== null && (actionId === null || action === actionId) && archivedNames.has(basename(ask.path))
      && (ask.requestId === requestId || autoSettleRequestId(ask.project, action, ask.content) === requestId);
  });
  /** A later touch of the citation's own line, or of the Ask's draft or archive beyond the one commit archiving it. */
  const citationToucher = (ask: CarriedAsk, source: string, citedAt: number): string | null => {
    const name = basename(ask.path);
    const archivePath = `.arcadia/asks/archive/${name}`;
    const archivedAt = files.find((file) => file.newPath === archivePath && (file.created || file.renamed))?.commit ?? ask.commit;
    return laterTouch([source], citedAt) ?? laterTouch([ask.path, archivePath, `.arcadia/asks/${name}`], Math.min(ask.commit, archivedAt), archivedAt);
  };
  const citation = (source: string, requestId: string, actionId: string | null, citedAt: number): GovernedRecordFact => {
    const ask = namedAsk(requestId, actionId);
    return ask
      ? heldAtHead(requestId, `cited in ${JSON.stringify(source)}: names the Agent Ask ${JSON.stringify(ask.path)} (request_id ${JSON.stringify(ask.requestId)}) that this patch carries whole and archives, ${ask.requestId === requestId ? "by its own request_id" : "as the auto-settle id derived from its content"}, whose target_ref is ${JSON.stringify(ask.targetRef)}`, citationToucher(ask, source, citedAt))
      : fact(false, requestId, `cited in ${JSON.stringify(source)}: names no Agent Ask this patch carries whole and archives for ${actionId ? `this Action, ${JSON.stringify(actionId)}` : "any Action"}, by its request_id or by the id derived from its content`);
  };
  const citations = [...shapes.nextActionRewrites].flatMap(([plan, rewrites]) => rewrites.map((entry) => citation(plan, entry.requestId, entry.id, entry.commit)));
  const cited = new Set(citations.map((entry) => entry.subject));
  for (const file of files) {
    if (file.newPath !== "MISSION_LOG.md") continue;
    const added = file.hunks.flatMap((lines) => lines.filter((line) => line.startsWith("+")));
    for (const id of new Set(added.flatMap((line) => line.match(AUTO_SETTLE_CITATION) ?? []))) {
      if (!cited.has(id)) citations.push(citation("MISSION_LOG.md", id, null, file.commit));
    }
  }

  // Per commit, not per path: the comparison was of that commit's copy, and a later commit can change the path.
  const splitTargets = new Set([...splitArchives].map((file) => `${file.commit}:.arcadia/asks/archive/${basename(file.oldPath!)}`));
  const archives = files.flatMap((file): GovernedRecordFact[] => {
    const target = file.newPath;
    if (!target?.startsWith(".arcadia/asks/archive/") || file.deleted || !(file.created || file.renamed)) return [];
    if (splitTargets.has(`${file.commit}:${target}`)) {
      return [heldAtHead(target, "differs from the draft this patch deletes only in candidate_revision", laterTouch([target, `.arcadia/asks/${basename(target)}`], file.commit))];
    }
    return [fact(false, target, file.renamed
      ? "archived by a rename, whose changed lines this check does not compare"
      : "added with no deleted draft this check could show it matches apart from candidate_revision")];
  });

  const retirements = commits.flatMap((commit, index): GovernedRecordFact[] => {
    if ((commit.retiredDraftIds ?? []).length === 0) return [];
    const entries = files.filter((file) => file.commit === index);
    const paths = entries.flatMap((file) => file.oldPath ? [file.oldPath] : []);
    const recognized = entries.length > 0 && entries.every((file) => retired.has(file) && !shapes.violations.has(file.oldPath!));
    if (!recognized) return [fact(false, commit.sha ?? "(no commit id)", "carries a retirement trailer but is not a retirement this check recognizes by its From: header, trailers and content")];
    return [heldAtHead(commit.sha ?? "(no commit id)", `only deletes ${JSON.stringify(paths)}, each a whole complete-intent draft an earlier commit in this series created under a governed marker, named by its trailers, for the Action this patch marks done. Its From: header names the Arcadia Controller, which a Session can set, so this says nothing about who wrote it`, laterTouch(paths, index))];
  });

  /** A touch that ends a draft's life here (its archive or retirement) is that draft's expected second commit, when nothing follows it. */
  const endsDraft = (file: ParsedFile, draft: string) => file.oldPath === draft
    && (retired.has(file) || splitArchives.has(file) || (file.renamed && file.newPath === `.arcadia/asks/archive/${basename(draft)}`));
  /** The first commit touching this path after the one that wrote it, apart from a draft's last touch ending it. */
  const shapeToucher = (filePath: string): string | null => {
    const touching = files.filter((file) => file.paths.includes(filePath));
    const ended = touching.length > 0 && endsDraft(touching[touching.length - 1], filePath);
    const second = ended ? touching.slice(0, -1)[1] : touching[1];
    return second ? commits[second.commit]?.sha ?? "(no commit id)" : null;
  };
  const shapeFact = (file: PatchFileClassification): GovernedRecordFact => {
    const toucher = shapeToucher(file.path);
    if (file.class === "governed-record") return heldAtHead(file.path, "stays within its allowed shape, in commits whose message carries a governed marker, which is text a Session can write", toucher);
    return fact(false, file.path, `${JSON.stringify(file.reason)}${toucher ? `; commit ${toucher} touches it after the commit that first did` : ""}`);
  };
  const governed = applicability.files.filter((file) => isGovernedRecordPath(file.path));
  return {
    problems,
    citations,
    archives,
    retirements,
    shapes: governed.map(shapeFact)
  };
}

/** Whether the patch shows a governed record, so the check has anything to report. */
export function patchTouchesGovernedRecord(patch: string): boolean {
  return parsePatch(patch).files.some((file) => file.paths.some(isGovernedRecordPath));
}

/**
 * Why a commit's entries in the patch cannot be trusted as its real files. A
 * message can add entries but never remove a real one, so an exact match of
 * paths, counted (a forged entry for a really changed path shows it twice), rules
 * forgery out; rename detection may differ between GitHub's two reads, so a
 * rename and a delete-plus-add count the same. The blob ids then tie each
 * entry's content, which the facts hash against them, to the object.
 */
function commitObjectProblems(commits: ParsedCommit[], files: ParsedFile[], objects: CommitObjectFiles | null | undefined): string[] {
  if (!objects) return ["the commits' Git objects could not be read, so a diff entry written inside a commit message cannot be told from a real one"];
  return commits.flatMap((commit, index) => {
    const label = commit.sha ?? "(no commit id)";
    const real = commit.sha !== null && Object.hasOwn(objects, commit.sha) ? objects[commit.sha] : null;
    if (!real) return [`no Git object was read for commit ${label}`];
    const shown = files.filter((file) => file.commit === index);
    const sorted = (paths: string[]) => paths.sort().join("\0");
    if (sorted(shown.flatMap((file) => file.paths)) !== sorted(real.flatMap((file) => file.previousPath && file.previousPath !== file.path ? [file.previousPath, file.path] : [file.path]))) {
      return [`commit ${label}'s entries in the patch are not exactly the files its Git object changes, as when its message carries a forged diff entry`];
    }
    const blobsMatch = shown.every((file) => {
      const [filePath, blob] = file.deleted ? [file.oldPath, file.oldBlob] : [file.newPath, file.newBlob];
      return !blob || real.some((entry) => entry.path === filePath && entry.blob?.startsWith(blob));
    });
    return blobsMatch ? [] : [`a blob id in commit ${label}'s entries in the patch is not the one its Git object records`];
  });
}

function analyzePatch(patch: string, evidence: PatchEvidence) {
  const { commits, files, formatPatch } = parsePatch(patch);
  const problems: string[] = [];
  if (!formatPatch) problems.push("the patch is not a git format-patch series, so its commits cannot be checked");
  const declaredFiles = evidence.declaredFiles ?? [];
  if (declaredFiles.length >= GITHUB_CLI_LIST_CAP) {
    problems.push(`the pull request declares ${declaredFiles.length} files, at the GitHub CLI's ${GITHUB_CLI_LIST_CAP}-file cap, so its file list may be truncated`);
  }
  if (formatPatch) problems.push(...boundaryProblems(commits));
  if (evidence.declaredCommits === null) {
    problems.push("the pull request's commits could not be read, so omitted merge commits cannot be ruled out");
  } else if (evidence.declaredCommits !== undefined) {
    const declared = evidence.declaredCommits;
    const shown = commits.map((commit) => commit.sha);
    if (declared.length >= GITHUB_CLI_LIST_CAP) {
      problems.push(`the pull request reports ${declared.length} commits, at the GitHub CLI's ${GITHUB_CLI_LIST_CAP}-commit cap`);
    } else if (new Set(declared).size !== declared.length || declared.length !== shown.length || !declared.every((oid) => shown.includes(oid))) {
      problems.push(`the pull request's ${declared.length} commits are not exactly the compare patch's ${shown.length}; GitHub omits merge commits and their conflict resolutions from it`);
    }
  }

  // A commit is a governed record only when its own message carries an
  // attestation and every path it touches is a governed-record path.
  const governedCommit = commits.map((commit, index) => commit.attested &&
    files.filter((file) => file.commit === index).every((file) => !file.special && !file.executableMode && file.paths.every(isGovernedRecordPath)));
  const retired = retiredCompletionDrafts(files, commits);
  const splitArchives = splitArchiveMoves(files, governedCommit);
  const shapes = governedShapeViolations(files, retired, splitArchives, commits, evidence.parentDocuments);
  const shapeViolations = shapes.violations;
  const consumed = consumedCompletionDraftCreations(files, commits, governedCommit, retired, splitArchives);
  const byPath = new Map<string, PathEntry>();
  for (const file of files) {
    for (const filePath of file.paths) {
      const entry = byPath.get(filePath) ?? { governedOnly: true, executableMode: false, special: null, shapeViolation: null };
      entry.governedOnly &&= governedCommit[file.commit] === true || consumed.has(file) || retired.has(file);
      entry.executableMode ||= file.executableMode;
      entry.special ??= file.special;
      entry.shapeViolation ??= shapeViolations.get(filePath) ?? null;
      byPath.set(filePath, entry);
    }
  }
  // A path the PR declares but the patch does not show is unverifiable.
  for (const declared of declaredFiles) {
    if (!byPath.has(declared)) {
      byPath.set(declared, { governedOnly: false, executableMode: false, special: "declared by the pull request but absent from the compare patch", shapeViolation: null });
    }
  }
  const classified = [...byPath.entries()].map(([filePath, entry]) => classifyPath(filePath, entry));
  const applicability: PatchApplicability = {
    inert: problems.length === 0 && classified.length > 0 &&
      classified.every((file) => file.class === "inert-document" || file.class === "governed-record"),
    files: classified,
    problems
  };
  return { commits, files, applicability, shapes, retired, splitArchives };
}

export interface NotApplicableContext {
  /**
   * The reviewer's verdict summary. It is consulted only on a docs-only patch
   * (every touched file an inert document or a shape-limited governed record,
   * the classifier's `inert` verdict) and only for the naming rule below.
   */
  summary?: string;
}

/**
 * Judges the not-applicable claims of one verdict. The deterministic per-file
 * classification is the sole decision on whether any claim can stand: each
 * claim is refused for correctness, for thin evidence, for patch-level
 * problems, for any touched file that is not inert, or for a patch that shows
 * no file. The claims left standing then face one verdict-level naming rule:
 * they are accepted only when at least one of them names a touched file's
 * path or basename (or, on a docs-only patch, the review summary does), and
 * are all refused otherwise. Naming is only an anchor that the reviewer read
 * this patch; it never widens which files can be not-applicable, so a claim
 * worded generically ("all touched files", "governed records") is accepted
 * beside a claim that names the files, and refused on a patch the classifier
 * does not judge inert whatever its wording.
 */
export function evaluateNotApplicableClaims(
  checks: readonly NotApplicableClaim[],
  applicability: PatchApplicability,
  context: NotApplicableContext = {}
): NotApplicableEvaluation {
  const affecting = applicability.files.filter((file) => file.class !== "inert-document" && file.class !== "governed-record");
  const judged = checks
    .filter((check) => check.status === "not-applicable")
    .map((check) => ({ check, reason: refusalReason(check, applicability, affecting) }));
  const standing = judged.filter((entry) => entry.reason === null).map((entry) => entry.check);
  // Only reached when the classifier found the patch inert (refusalReason
  // refuses every claim otherwise); the guard keeps the summary fallback to
  // docs-only patches even if that ordering ever changes.
  const anchors = [
    ...standing.map((check) => check.evidence),
    ...(applicability.inert && context.summary ? [context.summary] : [])
  ];
  const unanchored = standing.length > 0 && !anchors.some((text) => namesTouchedFile(text, applicability.files))
    ? `no not-applicable claim's evidence, nor the review summary, names a file the patch touches; name each touched file by exact path, such as ${applicability.files[0]?.path ?? "MARKER.md"}.`
    : null;
  const accepted: string[] = [];
  const refused: NotApplicableEvaluation["refused"] = [];
  for (const { check, reason } of judged) {
    const refusal = reason ?? unanchored;
    if (refusal) refused.push({ criterion: check.criterion, name: check.name, reason: refusal });
    else accepted.push(check.criterion);
  }
  return { accepted, refused };
}

function namesTouchedFile(text: string, files: readonly PatchFileClassification[]): boolean {
  const lowered = text.toLowerCase();
  return files.some((file) => lowered.includes(file.path.toLowerCase()) || lowered.includes(basename(file.path).toLowerCase()));
}

/** A single claim's refusal, before the verdict-level naming rule; null when it may stand. */
function refusalReason(
  check: NotApplicableClaim,
  applicability: PatchApplicability,
  affecting: PatchFileClassification[]
): string | null {
  if (NEVER_NOT_APPLICABLE_CRITERIA.has(check.criterion)) return `${check.name} can never be not-applicable; judge it pass or fail.`;
  const evidence = check.evidence.trim();
  const words = evidence.split(/\s+/).filter(Boolean).length;
  if (evidence.length < NOT_APPLICABLE_MIN_EVIDENCE_CHARS || words < NOT_APPLICABLE_MIN_EVIDENCE_WORDS) {
    return `the evidence is too thin to show the change cannot affect ${check.name.toLowerCase()} (at least ${NOT_APPLICABLE_MIN_EVIDENCE_WORDS} words and ${NOT_APPLICABLE_MIN_EVIDENCE_CHARS} characters naming the touched files).`;
  }
  if (applicability.problems.length > 0) return `${applicability.problems.join("; ")}.`;
  if (affecting.length > 0) {
    const shown = affecting.slice(0, 5).map((file) => `${file.path} (${file.class}: ${file.reason})`).join("; ");
    return `the patch touches files that can affect it: ${shown}${affecting.length > 5 ? `; and ${affecting.length - 5} more` : ""}.`;
  }
  if (applicability.files.length === 0) return "the patch shows no touched file, so nothing establishes that the change cannot affect it.";
  return null;
}

function parsePatch(patch: string): { commits: ParsedCommit[]; files: ParsedFile[]; formatPatch: boolean } {
  const lines = patch.split(/\r?\n/);
  const commits: ParsedCommit[] = [];
  const files: ParsedFile[] = [];
  const formatPatch = lines.some((line) => FORMAT_PATCH_BOUNDARY.test(line));
  // A plain diff is one commit with no message: nothing in it is attested.
  if (!formatPatch) commits.push({ sha: null, attested: false, numbering: undefined });
  let messageLines: string[] | null = null;
  let current: ParsedFile | null = null;
  let inExtendedHeader = false;
  let hunk: { lines: string[]; old: number; new: number; start: number } | null = null;
  const finishMessage = () => {
    if (messageLines === null) return;
    const message = messageLines.join("\n");
    const subject = messageLines.find((line) => line.startsWith("Subject: "));
    const numbering = subject ? SUBJECT_NUMBERING.exec(subject) : null;
    commits[commits.length - 1] = {
      ...commits[commits.length - 1],
      attested: GOVERNED_ATTESTATIONS.some((pattern) => pattern.test(message)),
      author: messageLines.find((line) => line.startsWith("From: "))?.slice("From: ".length).trim() ?? null,
      retiredDraftIds: messageLines.flatMap((line) => RETIRED_DRAFT_LINE.exec(line)?.[1] ?? []),
      numbering: !numbering ? undefined : numbering[1] ? { index: Number(numbering[1]), total: Number(numbering[2]) } : null
    };
    messageLines = null;
  };
  const endHunk = () => {
    if (hunk && current && (hunk.old > 0 || hunk.new > 0)) current.special ??= "truncated or malformed hunk";
    hunk = null;
  };
  for (const line of lines) {
    const boundary = FORMAT_PATCH_BOUNDARY.exec(line);
    if (boundary) {
      endHunk();
      finishMessage();
      commits.push({ sha: boundary[1], attested: false, numbering: undefined });
      messageLines = [];
      current = null;
      inExtendedHeader = false;
      continue;
    }
    if (messageLines !== null) {
      // The message ends at the first `---` separator before the diffstat.
      if (line === "---") finishMessage();
      else if (line.startsWith("diff --git ")) finishMessage();
      else {
        messageLines.push(line);
        continue;
      }
    }
    if (hunk && current) {
      const prefix = line[0];
      if (prefix === "\\") {
        hunk.lines.push(line);
        continue;
      }
      if ((prefix === " " && hunk.old > 0 && hunk.new > 0) || (prefix === "-" && hunk.old > 0) || (prefix === "+" && hunk.new > 0)) {
        hunk.lines.push(line);
        if (prefix !== "+") hunk.old -= 1;
        if (prefix !== "-") hunk.new -= 1;
        if (hunk.old === 0 && hunk.new === 0) {
          current.hunks.push(hunk.lines);
          current.hunkStarts.push(hunk.start);
          hunk = null;
        }
        continue;
      }
      endHunk();
    }
    // The marker follows a hunk's last counted line, so that hunk has already closed.
    if (current && line.startsWith("\\ ") && current.hunks.length > 0) {
      current.hunks[current.hunks.length - 1].push(line);
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const match = SIMPLE_DIFF_HEADER.exec(line);
      current = {
        paths: match ? uniqueStrings([match[1], match[2]]) : [line.slice("diff --git ".length)],
        oldPath: match ? match[1] : null,
        newPath: match ? match[2] : null,
        commit: commits.length - 1,
        executableMode: false,
        special: match ? null : "path the reader cannot parse unambiguously",
        created: false,
        deleted: false,
        renamed: false,
        copied: false,
        hunks: [],
        hunkStarts: [],
        newBlob: null,
        oldBlob: null
      };
      files.push(current);
      inExtendedHeader = true;
      continue;
    }
    if (!current) continue;
    const hunkHeader = HUNK_HEADER.exec(line);
    if (hunkHeader) {
      inExtendedHeader = false;
      hunk = { lines: [], old: Number(hunkHeader[2] ?? "1"), new: Number(hunkHeader[4] ?? "1"), start: Number(hunkHeader[1]) };
      if (hunk.old === 0 && hunk.new === 0) hunk = null;
      continue;
    }
    if (line.startsWith("@@")) {
      current.special ??= "malformed hunk header";
      continue;
    }
    if (!inExtendedHeader) continue;
    const blob = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: \d{6})?$/.exec(line);
    if (blob) {
      current.oldBlob = blob[1];
      current.newBlob = blob[2];
    }
    const mode = /^(?:new file mode|new mode|old mode|deleted file mode) (\d{6})$/.exec(line) ??
      /^index [0-9a-f]+\.\.[0-9a-f]+ (\d{6})$/.exec(line);
    if (mode) {
      applyMode(current, mode[1]);
      if (line.startsWith("new file mode")) current.created = true;
      if (line.startsWith("deleted file mode")) current.deleted = true;
      continue;
    }
    const moved = /^(rename|copy) (?:from|to) (.+)$/.exec(line);
    if (moved) {
      if (moved[1] === "rename") current.renamed = true;
      else current.copied = true;
      if (!current.paths.includes(moved[2])) current.paths.push(moved[2]);
      continue;
    }
    if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
      current.special ??= "binary content";
      inExtendedHeader = false;
    }
  }
  endHunk();
  finishMessage();
  return { commits, files, formatPatch };
}

function applyMode(file: ParsedFile, mode: string): void {
  if (mode === "120000") file.special ??= "symbolic link";
  else if (mode === "160000") file.special ??= "submodule";
  else if (mode !== "100644") file.executableMode = true;
}

/**
 * Arcadia's governed-record paths: exactly the managed-document set the
 * pull-request procedure exempts for commits Arcadia's own commands write,
 * less `docs/decisions/` (a Decision answer is an authority change that waits
 * for the operator, so it is never inert). Asks are data files only.
 */
function isGovernedRecordPath(filePath: string): boolean {
  return /^\.arcadia\/asks\/(?:archive\/)?[^/]+\.(?:ya?ml|json)$/.test(filePath) ||
    filePath === "MISSION_LOG.md" ||
    filePath === "PROJECT.md" ||
    /^docs\/plans\/[^/]+\.md$/.test(filePath);
}

/** The trailer a review repair's host retirement commit carries, once per retired draft's request id. */
export const RETIRED_COMPLETION_DRAFT_TRAILER = "Arcadia-Retired-Completion-Draft";
const RETIRED_DRAFT_LINE = new RegExp(`^${RETIRED_COMPLETION_DRAFT_TRAILER}: (\\S+)$`);
/** The identity host preservation and the repair's draft retirement commit under (src/sessions/candidateSnapshot.ts). */
export const ARCADIA_CONTROLLER_AUTHOR = "Arcadia Controller <controller@arcadia.local>";
const COMPLETION_DRAFT_PATH = /^\.arcadia\/asks\/agent-ask-[^/]+\.ya?ml$/;

/**
 * The commit message of a review repair's host retirement of the failed
 * candidate's own completion draft (src/sessions/launch.ts): the patch check
 * recognizes exactly this commit by its trailers and author.
 */
export function retiredCompletionDraftMessage(actionId: string, requestIds: readonly string[]): string {
  return [
    `chore(arcadia): retire the failed candidate's completion draft for ${actionId}`,
    "",
    "A review repair settles only a completion it drafts itself.",
    "",
    ...requestIds.map((requestId) => `${RETIRED_COMPLETION_DRAFT_TRAILER}: ${requestId}`)
  ].join("\n");
}

/**
 * The deletions a review repair's host retirement commit made, each mapped to
 * the Action its draft completes. A commit qualifies only when it is authored
 * by the Arcadia Controller, carries retirement trailers, and does nothing but
 * delete top-level `agent-ask-*.yaml` drafts, each of which:
 * - shows its whole old content (verified against its blob id),
 * - is a `complete` Ask whose request_id one of the trailers names (and every
 *   trailer names one of them),
 * - was created earlier in this series by an attested commit (the failed
 *   candidate's own preserved draft).
 * The Action must also be the one this patch settles (checked with the
 * Plan's done transition in governedShapeViolations). Anything else is no
 * retirement, and its deletions stay "a governed record may not be deleted".
 */
function retiredCompletionDrafts(files: ParsedFile[], commits: ParsedCommit[]): Map<ParsedFile, string> {
  const retired = new Map<ParsedFile, string>();
  commits.forEach((commit, index) => {
    const trailers = commit.retiredDraftIds ?? [];
    if (commit.author !== ARCADIA_CONTROLLER_AUTHOR || trailers.length === 0) return;
    const entries = files.filter((file) => file.commit === index);
    const found = new Map<ParsedFile, string>();
    const named = new Set<string>();
    for (const file of entries) {
      const draft = file.oldPath;
      if (!file.deleted || !draft || file.paths.length !== 1 || !COMPLETION_DRAFT_PATH.test(draft) || file.special || file.executableMode) return;
      const content = verifiedOldContent(file);
      const requestId = content === null ? null : askScalar(content, "request_id");
      const targetRef = content === null ? null : askScalar(content, "target_ref");
      const actionId = targetRef?.startsWith("action/") ? targetRef.slice("action/".length) : targetRef?.split("#")[1] ?? null;
      if (!content || askScalar(content, "intent") !== "complete" || !requestId || !trailers.includes(requestId) || !actionId) return;
      const createdEarlier = files.some((other) => other.created && other.newPath === draft && other.commit < index && commits[other.commit]?.attested === true);
      if (!createdEarlier) return;
      found.set(file, actionId);
      named.add(requestId);
    }
    if (entries.length === 0 || !trailers.every((requestId) => named.has(requestId))) return;
    for (const [file, actionId] of found) retired.set(file, actionId);
  });
  return retired;
}

/**
 * A settlement's archive of a completion draft that git shows as a deletion
 * plus a new archive file rather than a rename: settlement rewrites the
 * archived copy with the revision it bound (src/ask/settlement.ts
 * pushAskArchiveMutations re-serializes a JSON draft compactly), so a
 * pretty-printed or short draft shares too little text for rename detection
 * (live repair PR #1554). Recognized only when one governed-only commit deletes
 * a top-level `agent-ask-*.yaml` draft and creates
 * `.arcadia/asks/archive/<the same name>`, both whole contents verified
 * against their blob ids, and the two Asks are identical apart from
 * `candidate_revision` (a hex revision on both sides). Returns the deletions.
 */
function splitArchiveMoves(files: ParsedFile[], governedCommit: boolean[]): Set<ParsedFile> {
  const moves = new Set<ParsedFile>();
  const plain = (file: ParsedFile) => file.paths.length === 1 && !file.special && !file.executableMode;
  for (const deleted of files) {
    const draft = deleted.oldPath;
    if (!deleted.deleted || !draft || !plain(deleted) || !COMPLETION_DRAFT_PATH.test(draft) || governedCommit[deleted.commit] !== true) continue;
    const archivePath = `.arcadia/asks/archive/${basename(draft)}`;
    const copies = files.filter((file) => file.commit === deleted.commit && file.paths.includes(archivePath));
    const archive = copies.length === 1 && copies[0].created && plain(copies[0]) ? copies[0] : null;
    if (!archive) continue;
    const before = verifiedOldContent(deleted);
    const after = verifiedNewContent(archive);
    if (before === null || after === null) continue;
    const left = askWithoutCandidate(before);
    if (left !== null && left === askWithoutCandidate(after)) moves.add(deleted);
  }
  return moves;
}

const CANDIDATE_REVISION_VALUE = /^[0-9a-f]{7,40}$/;
const CANDIDATE_REVISION_LINE = /^(\s*candidate_revision\s*:\s*)(.*)$/m;

/** An Ask's content with its `candidate_revision` blanked (a JSON object or simple YAML), or null when it has no hex one. */
/**
 * Whether an archived Ask is the same Ask as the draft it archives apart from
 * the `candidate_revision` settlement binds (both a hex revision): the split
 * archive move `splitArchiveMoves` recognizes, shared with the worker merge's
 * blast radius (src/production/workerMerge.ts).
 */
export function isSettlementArchiveOf(draft: string, archive: string): boolean {
  const left = askWithoutCandidate(draft);
  return left !== null && left === askWithoutCandidate(archive);
}

function askWithoutCandidate(content: string): string | null {
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const { candidate_revision: revision, ...rest } = parsed as Record<string, unknown>;
      return typeof revision === "string" && CANDIDATE_REVISION_VALUE.test(revision) ? JSON.stringify(rest) : null;
    } catch {
      return null;
    }
  }
  const match = CANDIDATE_REVISION_LINE.exec(content);
  const value = match?.[2].trim().replace(/^["']|["']$/g, "");
  return match && value && CANDIDATE_REVISION_VALUE.test(value) ? content.replace(CANDIDATE_REVISION_LINE, "$1") : null;
}

/**
 * The creations of a candidate's own completion draft that its host
 * settlement consumed: a top-level `.arcadia/asks/agent-ask-<id>.yaml` created
 * in this series (so absent at its base) by an attested commit (host
 * preservation commits it beside the agent's work, so that commit is not
 * governed-only), then renamed to `.arcadia/asks/archive/` under the same name
 * by a governed-only commit, and touched by nothing else, so it is gone at the
 * head. Only that creation is excused from the governed-only rule; a draft
 * left in place, archived otherwise or touched again is not.
 */
function consumedCompletionDraftCreations(
  files: ParsedFile[], commits: ParsedCommit[], governedCommit: boolean[], retired: Map<ParsedFile, string>, splitArchives: Set<ParsedFile>
): Set<ParsedFile> {
  const consumed = new Set<ParsedFile>();
  for (const created of files) {
    const draft = created.newPath;
    if (!created.created || !draft || !COMPLETION_DRAFT_PATH.test(draft) || created.special || created.executableMode || created.paths.length !== 1) continue;
    const touching = files.filter((file) => file.paths.includes(draft));
    // Archived by its own settlement (as a rename, or as a deletion beside its
    // re-serialized archive copy), or retired by a review repair's host retirement commit.
    const archived = touching.find((file) => file !== created && file.renamed && file.oldPath === draft
      && file.newPath === `.arcadia/asks/archive/${basename(draft)}` && governedCommit[file.commit] === true)
      ?? touching.find((file) => file !== created && (retired.has(file) || splitArchives.has(file)));
    if (!archived || touching.length !== 2 || archived.commit <= created.commit) continue;
    if (commits[created.commit]?.attested !== true) continue;
    // Its creating commit may otherwise hold only inert documents and governed
    // records: a commit that also edits code keeps tainting it.
    const otherwiseInert = files.filter((file) => file.commit === created.commit && file !== created).every((file) => file.paths.every((filePath) =>
      ["inert-document", "governed-record"].includes(classifyPath(filePath, { governedOnly: true, executableMode: file.executableMode, special: file.special, shapeViolation: null }).class)));
    if (!otherwiseInert) continue;
    consumed.add(created);
  }
  return consumed;
}

/**
 * A file's whole new content, rebuilt from its hunks' new side, only when the
 * patch proves it is complete: the rebuilt bytes hash to the blob id on the
 * file's `index` line. Null otherwise (no index line, hunks that skip lines).
 */
function verifiedNewContent(file: ParsedFile): string | null {
  return verifiedSideContent(file, "new");
}

/** The same for the file's whole OLD content (a deletion shows it all as removed lines). */
function verifiedOldContent(file: ParsedFile): string | null {
  return verifiedSideContent(file, "old");
}

function verifiedSideContent(file: ParsedFile, side: "new" | "old"): string | null {
  const expected = side === "new" ? file.newBlob : file.oldBlob;
  if (!expected || file.hunks.length === 0) return null;
  const skipped = side === "new" ? "-" : "+";
  let content = "";
  let lastOnSide = false;
  for (const lines of file.hunks) {
    for (const line of lines) {
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" after a line of this side: drop the newline just added.
        if (content.endsWith("\n") && lastOnSide) content = content.slice(0, -1);
        continue;
      }
      lastOnSide = line[0] !== skipped;
      if (lastOnSide) content += `${line.slice(1)}\n`;
    }
  }
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
  return blob.startsWith(expected) ? content : null;
}

/** An Agent Ask's top-level scalar (JSON or simple YAML), or null. */
function askScalar(content: string, key: string): string | null {
  try {
    const value = (JSON.parse(content) as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  } catch {
    const match = new RegExp(`^${key}:[ \\t]*["']?([^"'\\n]+?)["']?[ \\t]*$`, "m").exec(content);
    return match ? match[1] : null;
  }
}

/** An Action id: a plain slug, never YAML syntax (anchors, aliases, tags, flow or block scalars). */
const PLAN_POINTER = /^current_action: ([A-Za-z0-9][\w.-]*)$/;
const UPDATED = /^updated: \d{4}-\d{2}-\d{2}$/;
const ACTION_STATUS = /^ {4}status: (\S+)$/;
/** The Plan's own front-matter status, never an Action's (those are indented). */
const PLAN_STATUS = /^status: (\S+)$/;
const ACTION_ID = /^ {2}- id: (\S+)$/;
/** Any single-line `next_action` value, old or new — recognized generically; {@link NEXT_ACTION_CANONICAL_COMPLETED} gates what a new one may say. */
const NEXT_ACTION_FIELD = /^ {4}next_action:.*$/;
/**
 * `markActionDone`'s own rewrite (`src/ask/settlement.ts`): the only shape a
 * `next_action` line may take on *after* this patch, naming the completion's
 * own Agent Ask request id. Only the single-line-old-value shape every real
 * Plan document in this repository uses today is recognized (the adjacency
 * check below requires the added line to sit immediately after the removed
 * one); a block-scalar old value's more-indented continuation lines are not
 * matched by `NEXT_ACTION_FIELD` and fall through to the generic "only ...
 * may change here" refusal, which is safe (not a regression — no real patch
 * has ever needed it) rather than permissive.
 */
const NEXT_ACTION_CANONICAL_COMPLETED = /^ {4}next_action: Completed via Agent Ask (.+); no further action\.$/;

/**
 * The exact shapes Arcadia's preservation and `agent-ask settle --apply`
 * (complete) write, checked on the diff itself whatever a commit message
 * claims. A path is mapped to its first violation; consistency across files
 * (the pointer leaves only the Action marked done) is checked here too.
 */
function governedShapeViolations(
  files: ParsedFile[], retired: Map<ParsedFile, string> = new Map(), splitArchives: Set<ParsedFile> = new Set(),
  commits: ParsedCommit[] = [], parentDocuments: ParentDocuments | null | undefined = undefined
): { violations: Map<string, string>; carriedAsks: CarriedAsk[]; nextActionRewrites: Map<string, Array<{ id: string; requestId: string; commit: number }>> } {
  const violations = new Map<string, string>();
  const violate = (filePath: string, reason: string) => { if (!violations.has(filePath)) violations.set(filePath, reason); };
  const done = new Map<string, string[]>();
  const nextActionRewrites = new Map<string, Array<{ id: string; requestId: string; commit: number }>>();
  const planMoves = new Map<string, string[]>();
  const projectMoves: string[] = [];
  // A Plan-completing settlement removes current_action outright and sets the
  // Plan `complete`; each half is only collected here and verified together,
  // against the parent revision, after every file is read.
  const planCompletions: Array<{ file: ParsedFile; plan: string; id: string }> = [];
  const projectRemovals: Array<{ file: ParsedFile; id: string }> = [];
  // Every Agent Ask id this same patch series makes available: drafted
  // (added, anywhere under .arcadia/asks/, not yet archived), archived by a
  // same-name rename, or archived directly (added straight into
  // .arcadia/asks/archive/ — real settlements both only ever add a new Ask
  // file at either location or rename an existing one into the archive, so
  // these are the only shapes an id can actually appear under).
  const availableAskIds = new Set<string>();
  /** Agent Asks this patch carries whose whole content it proves (see verifiedNewContent). */
  const carriedAsks: CarriedAsk[] = [];
  /**
   * An auto-settle names its content-addressed proposal id, not the draft's
   * file name (src/ask/autoSettleBeforeDispatch.ts): accepted only when it is
   * exactly the id derived from a carried Ask whose target is this Action.
   */
  const derivesAutoSettleId = (actionId: string, requestId: string) => carriedAsks.some((ask) =>
    (ask.targetRef === `action/${actionId}` || ask.targetRef.endsWith(`#${actionId}`))
    && autoSettleRequestId(ask.project, actionId, ask.content) === requestId);
  const ASK_ID = /^\.arcadia\/asks\/(?:archive\/)?agent-ask-(.+)\.(?:ya?ml|json)$/;
  for (const file of files) {
    if (!file.paths.every(isGovernedRecordPath) || file.special || file.executableMode || !file.newPath || !file.oldPath) continue;
    const target = file.newPath;
    const violateFile = (reason: string) => { for (const filePath of file.paths) violate(filePath, reason); };
    const removed = file.hunks.flatMap((lines) => lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)));
    const added = file.hunks.flatMap((lines) => lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)));
    if (file.deleted && (retired.has(file) || splitArchives.has(file))) continue;
    if (file.copied || file.deleted) {
      violateFile("a governed record may not be copied or deleted");
      continue;
    }
    if (target.startsWith(".arcadia/asks/")) {
      const archiveMove = file.renamed && /^\.arcadia\/asks\/[^/]+$/.test(file.oldPath) &&
        target === `.arcadia/asks/archive/${basename(file.oldPath)}`;
      if (!file.created && !archiveMove) violateFile("an Agent Ask may only be added, or moved into .arcadia/asks/archive/ under its own name");
      else if (file.created && removed.length > 0) violateFile("a new Agent Ask cannot remove lines");
      else {
        const askId = ASK_ID.exec(target)?.[1];
        if (askId) availableAskIds.add(askId);
        // Its content, when the patch proves it whole: its own request_id, and
        // the content-addressed id an auto-settle of exactly this Ask mints.
        const content = verifiedNewContent(file);
        const project = content === null ? null : askScalar(content, "project");
        const targetRef = content === null ? null : askScalar(content, "target_ref");
        const requestId = content === null ? null : askScalar(content, "request_id");
        if (requestId) availableAskIds.add(requestId);
        if (content !== null && project && targetRef) carriedAsks.push({ path: target, content, project, targetRef, requestId, commit: file.commit });
      }
      continue;
    }
    if (file.renamed || file.oldPath !== target) {
      violateFile("a managed document may not be renamed");
      continue;
    }
    if (target === "MISSION_LOG.md") {
      // Appends only, at the end of the file. The compare patch carries three
      // lines of trailing context, so added lines followed by no context are
      // at the end of the file; a patch made with less context would defeat
      // this inference, but GitHub's compare patch is not. A settlement on a
      // later day than the last one also bumps the front matter's `updated:`
      // to the date of the entry it appends (#1555): that one replacement, in
      // its own leading hunk, is the only other change allowed.
      const bump = !file.created && file.hunks.length === 2 ? frontMatterUpdatedBump(file.hunks[0], file.hunkStarts[0]) : null;
      const appends = bump ? file.hunks.slice(1) : file.hunks;
      const appended = appends.flatMap((lines) => lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)));
      const trailingOnly = appends.length <= 1 && appends.every((lines) => {
        const firstAdded = lines.findIndex((line) => line.startsWith("+"));
        return firstAdded === -1 || lines.slice(firstAdded).every((line) => line.startsWith("+") || line.startsWith("\\"));
      });
      const appendRemoves = appends.some((lines) => lines.some((line) => line.startsWith("-")));
      const datedEntry = !bump || appended.some((line) => line.startsWith(`## ${bump} `));
      if (appendRemoves || !trailingOnly || !datedEntry) violateFile("the Mission Log may only be appended to, at its end");
      continue;
    }
    // `next_action` is recognized generically here (any single-line value, old
    // or new) so the structural check below does not refuse on its presence
    // alone; `NEXT_ACTION_CANONICAL_COMPLETED`, the owner tie, and the
    // status-done tie enforced in the hunk pass below are what actually gate
    // what a *new* next_action line may say and which Action it may belong to.
    const keyOf = (line: string): string | null => PLAN_POINTER.test(line) ? "current_action" : UPDATED.test(line) ? "updated"
      : target !== "PROJECT.md" && PLAN_STATUS.test(line) ? "planStatus"
      : target !== "PROJECT.md" && ACTION_STATUS.test(line) ? "status"
      : target !== "PROJECT.md" && NEXT_ACTION_FIELD.test(line) ? "next_action" : null;
    const bad = [...removed, ...added].find((line) => keyOf(line) === null);
    if (bad !== undefined) {
      violateFile(`only ${target === "PROJECT.md" ? "current_action and updated" : "an Action's status, current_action, updated and a completed next_action"} may change here, not \`${bad.trim().slice(0, 80)}\``);
      continue;
    }
    // `next_action` is in this count too: the canonical writer only ever
    // rewrites an *existing* field (absent stays absent, done elsewhere stays
    // untouched), so an added-only line (no corresponding removed one — an
    // Action that had no next_action, or an extra forged line beside a real
    // replacement), a removed-only one (the field deleted outright), or any
    // other count mismatch is never its shape, whatever the added text says.
    // This is necessary but not sufficient: the hunk-aware adjacency pass
    // below still separately requires the single matched pair to sit next to
    // each other and match the canonical form, so a same-count but
    // non-adjacent or non-canonical pair still refuses there.
    const moves = removed.flatMap((line) => PLAN_POINTER.exec(line)?.[1] ?? []);
    const destinations = added.flatMap((line) => PLAN_POINTER.exec(line)?.[1] ?? []);
    // The one non-replacement shape: the pointer removed outright. In a Plan
    // it is allowed only beside `status: active` -> `status: complete`, and the
    // two stand or fall together; PROJECT.md's removal is tied to a verified
    // completion of its own active Plan below.
    const removedOnly = moves.length === 1 && destinations.length === 0;
    const statusFrom = removed.flatMap((line) => PLAN_STATUS.exec(line)?.[1] ?? []);
    const statusTo = added.flatMap((line) => PLAN_STATUS.exec(line)?.[1] ?? []);
    const completes = target !== "PROJECT.md" && statusFrom.length === 1 && statusTo.length === 1 && statusFrom[0] === "active" && statusTo[0] === "complete";
    if (statusFrom.length + statusTo.length > 0 && !(completes && removedOnly)) {
      violateFile("a Plan's status may only change from active to complete together with its current_action being removed, as the settlement completing its last Action");
    }
    const completion = removedOnly && (target === "PROJECT.md" || completes);
    for (const key of ["current_action", "updated", "status", "next_action"]) {
      if (key === "current_action" && completion) continue;
      if (removed.filter((line) => keyOf(line) === key).length !== added.filter((line) => keyOf(line) === key).length) {
        violateFile(`${key} must be replaced line for line`);
      }
    }
    if (moves.some((from, index) => from === destinations[index])) violateFile("current_action must move to a different Action");
    if (target === "PROJECT.md") {
      projectMoves.push(...moves);
      if (completion) projectRemovals.push({ file, id: moves[0] });
      continue;
    }
    planMoves.set(target, [...(planMoves.get(target) ?? []), ...moves]);
    if (completion) planCompletions.push({ file, plan: target, id: moves[0] });
    for (const lines of file.hunks) {
      lines.forEach((line, index) => {
        if (!line.startsWith("-")) return;
        if (ACTION_STATUS.test(line.slice(1))) {
          const next = lines.slice(index + 1).find((candidate) => candidate.startsWith("+"));
          if (!next || ACTION_STATUS.exec(next.slice(1))?.[1] !== "done") violateFile("an Action's status may only become done");
          const owner = lines.slice(0, index).reverse().find((candidate) => ACTION_ID.test(candidate.slice(1)));
          const id = owner?.startsWith(" ") ? ACTION_ID.exec(owner.slice(1))?.[1] : undefined;
          if (!id) violateFile("the Action whose status changes is not shown in the hunk's context");
          else done.set(target, [...(done.get(target) ?? []), id]);
          return;
        }
        // A removed `next_action` line only starts a recognized rewrite at its
        // first (possibly only) line; a block-scalar old value's own
        // more-indented continuation lines are already excluded from `keyOf`
        // recognition here (NEXT_ACTION_FIELD matches only the header shape),
        // so they fall through to the generic `bad` check above and refuse —
        // this classifier only recognizes the single-line-old shape every
        // real Plan document in this repository actually uses today.
        if (!NEXT_ACTION_FIELD.test(line.slice(1))) return;
        const next = lines[index + 1];
        const match = next?.startsWith("+") ? NEXT_ACTION_CANONICAL_COMPLETED.exec(next.slice(1)) : null;
        if (!match) {
          violateFile("next_action may only change to its exact canonical completed form, `next_action: Completed via Agent Ask <request-id>; no further action.`");
          return;
        }
        const owner = lines.slice(0, index).reverse().find((candidate) => ACTION_ID.test(candidate.slice(1)));
        const id = owner?.startsWith(" ") ? ACTION_ID.exec(owner.slice(1))?.[1] : undefined;
        if (!id) violateFile("the Action whose next_action changes is not shown in the hunk's context");
        else nextActionRewrites.set(target, [...(nextActionRewrites.get(target) ?? []), { id, requestId: match[1], commit: file.commit }]);
      });
    }
  }
  // Plan-completing settlements: verified against the parent revision, or refused.
  const verifiedCompletions = new Set<ParsedFile>();
  for (const completion of planCompletions) {
    const refusal = planCompletionRefusal(completion, commits, parentDocuments, planCompletions, projectRemovals);
    if (refusal) violate(completion.plan, refusal);
    else verifiedCompletions.add(completion.file);
  }
  for (const removal of projectRemovals) {
    const completion = planCompletions.find((entry) => entry.file.commit === removal.file.commit && entry.id === removal.id && verifiedCompletions.has(entry.file));
    if (!completion) violate("PROJECT.md", "PROJECT.md's current_action may be removed only by the same commit's verified completion of the active Plan at that Action");
  }
  // The pointer may only leave an Action this patch marks done, and every
  // Action marked done must be the one the pointer left.
  for (const [plan, completed] of done) {
    const moves = planMoves.get(plan) ?? [];
    if (completed.length !== new Set(completed).size || !sameMembers(completed, moves)) {
      violate(plan, "the Action marked done must be exactly the one current_action moves away from");
    }
  }
  for (const [plan, moves] of planMoves) {
    if (!done.has(plan) && moves.length > 0) violate(plan, "current_action moved without marking its Action done");
  }
  const allDone = new Set([...done.values()].flat());
  // A retired completion draft must complete the very Action this patch settles.
  for (const [file, actionId] of retired) {
    if (!allDone.has(actionId)) violate(file.oldPath!, "a retired completion draft must complete the Action this patch marks done");
  }
  if (projectMoves.some((from) => !allDone.has(from))) violate("PROJECT.md", "PROJECT.md's current_action moved without its Action being marked done");
  // A canonical next_action rewrite is tied to the actual status transition
  // (it may only land on an Action this same file's patch also marks done,
  // never on a pending sibling or an Action done for an unrelated reason) and
  // fails closed on the request id: it must name an Agent Ask this same
  // patch series actually carries (drafted, archived by rename, or archived
  // directly — the id-collection pass above). No request id is ever accepted
  // on shape alone; one naming no Ask anywhere in the patch is refused,
  // whether or not the patch touches `.arcadia/asks/` at all.
  const claimedRequestIds = new Map<string, string>(); // requestId -> the one Action id allowed to claim it
  for (const [plan, rewritten] of nextActionRewrites) {
    const completed = new Set(done.get(plan) ?? []);
    if (rewritten.some((entry) => !completed.has(entry.id))) {
      violate(plan, "a next_action rewrite to the canonical completed form must name an Action this same patch also marks done");
      continue;
    }
    if (rewritten.some((entry) => !availableAskIds.has(entry.requestId) && !derivesAutoSettleId(entry.id, entry.requestId))) {
      violate(plan, "a next_action rewrite's completion request id must match an Agent Ask this same patch series carries (drafted or archived)");
      continue;
    }
    // One Agent Ask settles one Action: the same request id claimed by two
    // different Actions' next_action rewrites, in this file or another one
    // in the same patch, is never legitimate even though both ids resolve.
    for (const entry of rewritten) {
      const priorOwner = claimedRequestIds.get(entry.requestId);
      if (priorOwner !== undefined && priorOwner !== entry.id) {
        violate(plan, `request id ${entry.requestId} is claimed by more than one Action's next_action rewrite in this patch`);
      } else {
        claimedRequestIds.set(entry.requestId, entry.id);
      }
    }
  }
  return { violations, carriedAsks, nextActionRewrites };
}

/** The same fence `src/docs/parse.ts` uses for a managed document's front matter. */
const FRONT_MATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
/** A parent document above this is refused before any YAML parse (the largest Plan is about 0.5 MB), so a huge one cannot stall a review. */
const MAX_PARENT_DOCUMENT_CHARS = 1024 * 1024;

interface FrontMatterDocument {
  data: Record<string, unknown>;
  /** Everything after the closing fence, byte for byte. */
  body: string;
}

/**
 * A document's front matter as the repository's own parser reads it (the same
 * fence and the `yaml` package, whose default refuses duplicate keys), and its
 * body. Null on a document over the size bound, a missing fence, any parse
 * error, or a front matter that is not a mapping: the evidence is then
 * unusable and the completion stays refused.
 */
function parseFrontMatter(text: string): FrontMatterDocument | null {
  if (text.length > MAX_PARENT_DOCUMENT_CHARS) return null;
  const match = FRONT_MATTER_FENCE.exec(text);
  if (!match) return null;
  try {
    const data = parseYaml(match[1]) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
    return { data: data as Record<string, unknown>, body: match[2] };
  } catch {
    return null;
  }
}

/** Structural equality of parsed YAML values. A cycle, which a YAML alias can form, is never equal. */
function sameValue(left: unknown, right: unknown, path: Set<object> = new Set()): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (path.has(left)) return false;
  path.add(left);
  const same = Array.isArray(left) || Array.isArray(right)
    ? Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index], path))
    : Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key)
      && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path));
  path.delete(left);
  return same;
}

/** The mapping without the named keys. */
function without(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
}

/**
 * The file's hunks applied to the parent's text: every context and removed
 * line must match the parent at its stated old line exactly (a CR before the
 * newline aside), or null. A hunk with a no-newline marker is not applied.
 */
function applyHunks(base: string, file: ParsedFile): string | null {
  const baseLines = base.split("\n");
  const out: string[] = [];
  let position = 0;
  for (let hunk = 0; hunk < file.hunks.length; hunk++) {
    const lines = file.hunks[hunk];
    const start = file.hunkStarts[hunk];
    // An insertion-only hunk (`-N,0`) names the line after which it applies.
    const oldCount = lines.filter((line) => line.startsWith(" ") || line.startsWith("-")).length;
    const copyTo = oldCount === 0 ? start : start - 1;
    if (!Number.isInteger(start) || start < 0 || copyTo < position || copyTo > baseLines.length) return null;
    while (position < copyTo) out.push(baseLines[position++]);
    for (const line of lines) {
      const kind = line[0];
      const text = line.slice(1);
      if (kind === "+") { out.push(text); continue; }
      if (kind !== " " && kind !== "-") return null;
      const original = baseLines[position];
      if (original === undefined || original.replace(/\r$/, "") !== text) return null;
      if (kind === " ") out.push(original);
      position += 1;
    }
  }
  while (position < baseLines.length) out.push(baseLines[position++]);
  return out.join("\n");
}

/**
 * Why a Plan-completing commit is not a verified completion; null when it is.
 * The judgement is made on parsed documents, never on the patch's lines: the
 * commit's hunks are applied to the parent revision of PROJECT.md and the Plan
 * (which must apply exactly), both sides are parsed, and the change must be
 * exactly this and nothing else:
 * - the parent Plan is `active`, belongs to PROJECT.md's project, is the one
 *   whose slug is PROJECT.md's `active_plan` (the resolver's case-insensitive
 *   rule, src/docs/dispatch.ts), and PROJECT.md and the Plan both have
 *   `current_action` at the Action being completed;
 * - the result Plan is `complete` with no `current_action`, that Action is now
 *   `done` (its `next_action` may change) and was not before, every other
 *   Action is identical and already `done` or `deferred` (what
 *   `resolveFinishedActivePlan` counts as finished, from the Action itself),
 *   the Actions keep their ids and order, no other key changes but `updated`,
 *   and the body is byte for byte the parent's;
 * - the result PROJECT.md differs only by losing `current_action` (and
 *   `updated`), with its body unchanged.
 * It must also be the commit's only completion, with the removal in the same
 * commit. A Decision-based deferral is not evidence here and stays refused.
 */
function planCompletionRefusal(
  completion: { file: ParsedFile; plan: string; id: string },
  commits: ParsedCommit[], parentDocuments: ParentDocuments | null | undefined,
  allCompletions: ReadonlyArray<{ file: ParsedFile }>, allRemovals: ReadonlyArray<{ file: ParsedFile; id: string }>
): string | null {
  const { file, plan, id } = completion;
  const unverifiable = (why: string) => `the Plan is completed here (current_action removed, status complete), but ${why}`;
  const sha = commits[file.commit]?.sha;
  const documents = parentDocuments && sha ? parentDocuments[sha] : undefined;
  const base = documents?.[plan];
  const projectBase = documents?.["PROJECT.md"];
  if (base === undefined || projectBase === undefined) return unverifiable("the Plan and PROJECT.md at the commit's parent revision were not both read, so it cannot be shown that every other Action was already done");
  if (allCompletions.filter((entry) => entry.file.commit === file.commit).length !== 1) return unverifiable("the commit completes more than one Plan");
  const removals = allRemovals.filter((entry) => entry.file.commit === file.commit);
  if (removals.length !== 1 || removals[0].id !== id) return unverifiable("the same commit does not remove PROJECT.md's current_action at that Action");

  const planResultText = applyHunks(base, file);
  const projectResultText = applyHunks(projectBase, removals[0].file);
  if (planResultText === null || projectResultText === null) return unverifiable("a hunk does not apply exactly to the parent revision's document");
  const parentPlan = parseFrontMatter(base);
  const parentProject = parseFrontMatter(projectBase);
  const resultPlan = parseFrontMatter(planResultText);
  const resultProject = parseFrontMatter(projectResultText);
  if (!parentPlan || !parentProject || !resultPlan || !resultProject) return unverifiable("a document's front matter could not be parsed (or is over the size bound)");

  const lower = (value: unknown) => typeof value === "string" ? value.toLowerCase() : null;
  if (lower(parentPlan.data.slug) === null || lower(parentPlan.data.slug) !== lower(parentProject.data.active_plan)
    || lower(parentPlan.data.project) === null || lower(parentPlan.data.project) !== lower(parentProject.data.slug)) {
    return unverifiable("the parent revision's PROJECT.md does not name this Plan (by slug and project) as its active_plan");
  }
  if (parentProject.data.current_action !== id || parentPlan.data.current_action !== id || parentPlan.data.status !== "active") {
    return unverifiable("the parent revision's Plan is not active with PROJECT.md and the Plan both at that Action");
  }

  if (!sameValue(without(parentProject.data, ["current_action", "updated"]), without(resultProject.data, ["current_action", "updated"]))
    || Object.hasOwn(resultProject.data, "current_action") || parentProject.body !== resultProject.body) {
    return unverifiable("PROJECT.md changes by more than losing current_action");
  }
  if (resultPlan.data.status !== "complete" || Object.hasOwn(resultPlan.data, "current_action")
    || !sameValue(without(parentPlan.data, ["status", "current_action", "updated", "actions"]), without(resultPlan.data, ["status", "current_action", "updated", "actions"]))) {
    return unverifiable("the Plan changes by more than becoming complete and losing current_action");
  }
  if (parentPlan.body !== resultPlan.body) return unverifiable("the Plan's body changes");

  const before = parentPlan.data.actions;
  const after = resultPlan.data.actions;
  if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || before.length !== after.length) return unverifiable("the Plan's Actions are not the same list before and after");
  const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const seen = new Set<string>();
  let completed = false;
  for (let index = 0; index < before.length; index++) {
    const was = record(before[index]);
    const now = record(after[index]);
    if (!was || !now || typeof was.id !== "string" || now.id !== was.id || seen.has(was.id)) return unverifiable("the Plan's Actions do not keep unique ids in the same order");
    seen.add(was.id);
    if (was.id === id) {
      completed = true;
      if (was.status === "done" || now.status !== "done" || !sameValue(without(was, ["status", "next_action"]), without(now, ["status", "next_action"]))) {
        return unverifiable(`Action ${id} does not change from not-done to done with nothing else but its next_action`);
      }
    } else if (!sameValue(was, now) || (was.status !== "done" && was.status !== "deferred")) {
      return unverifiable(`Action ${String(was.id)} is not unchanged and already done or deferred at the parent revision`);
    }
  }
  return completed ? null : unverifiable(`Action ${id} is not in the Plan`);
}

const DATED_UPDATED = /^updated: (\d{4}-\d{2}-\d{2})$/;
const FRONT_MATTER_KEY = /^ [A-Za-z_][\w-]*:(?: .*)?$/;
/** The front matter's `updated:` sits within the first lines of a managed document. */
const FRONT_MATTER_MAX_LINE = 20;

/**
 * The new date when a hunk is exactly one front-matter `updated:` replacement
 * moving to a later date: one removed line immediately followed by its added
 * replacement, near the top of the file, with only `key: value` context
 * around it (and the opening fence when the hunk starts at line 1) and the
 * closing `---` fence after it. Null for anything else.
 */
function frontMatterUpdatedBump(lines: string[], oldStart: number | undefined): string | null {
  if (oldStart === undefined || lines.filter((line) => line.startsWith("+") || line.startsWith("-")).length !== 2) return null;
  const at = lines.findIndex((line) => line.startsWith("-"));
  const from = at === -1 ? null : DATED_UPDATED.exec(lines[at].slice(1));
  const to = lines[at + 1]?.startsWith("+") ? DATED_UPDATED.exec(lines[at + 1].slice(1)) : null;
  if (!from || !to || to[1] <= from[1] || oldStart + at > FRONT_MATTER_MAX_LINE) return null;
  const before = lines.slice(0, at);
  const after = lines.slice(at + 2);
  const opening = oldStart === 1 && before[0] === " ---" ? 1 : 0;
  const closing = after.indexOf(" ---");
  if (!before.slice(opening).every((line) => FRONT_MATTER_KEY.test(line))) return null;
  return closing !== -1 && after.slice(0, closing).every((line) => FRONT_MATTER_KEY.test(line)) ? to[1] : null;
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/** An Agent Ask this patch shows whole (see verifiedNewContent). */
interface CarriedAsk {
  path: string;
  content: string;
  project: string;
  targetRef: string;
  requestId: string | null;
  /** The commit whose copy this is. */
  commit: number;
}

interface PathEntry {
  governedOnly: boolean;
  executableMode: boolean;
  special: string | null;
  shapeViolation: string | null;
}

const AUTHORITY_BASENAMES = new Set([
  "constitution.md", "agents.md", "agent.md", "claude.md", "gemini.md", "codex.md", "qwen.md", "warp.md", "crush.md",
  "opencode.md", "copilot-instructions.md", "conventions.md", "skill.md", "project.md", "mission_log.md", "codeowners",
  "agents.override.md", "claude.local.md", "agent_context_policy.md", "repo-context.md", "notes-to-self.md",
  // Binding operator and Project documents Arcadia reads or installs.
  "operator_context.md", "operator-context.md", "north_star.md", "start_here.md", "setup.md", "install_with_a_coding_agent.md"
]);
/** The only documentation under docs/ that is pure prose: dated reports. Every other docs/ document may be binding. */
const DOCS_PROSE_PREFIXES = ["docs/reports/"];
const AUTHORITY_PREFIXES = ["docs/agent-guidance/", "docs/decisions/", "docs/plans/", "runs/"];
const AUTHORITY_PATHS = new Set([
  "docs/agents-context.md", "docs/managed-documents.md", "docs/planning-process.md",
  "docs/working-copy-safety.md", "docs/managed-production-readiness.md",
  // Under the prose prefix docs/reports/, but `arcadia plan close-out` reads its legacy friction table into a hashed record.
  "docs/reports/production-simulation-living-notes.md"
]);
/** Directories whose documents are agent instructions (commands, skills, rules, hooks). */
const AGENT_DIRECTORIES = new Set(["commands", "agents", "skills", "rules", "hooks", "workflows", "instructions", "prompts", "modes", "chatmodes", "personas"]);
/** Directories whose documents code may load (templates, fixtures, schemas). */
const CODE_DIRECTORIES = new Set(["src", "lib", "app", "apps", "packages", "scripts", "bin", "templates", "test", "tests", "__tests__", "fixtures", "schemas"]);
const CONFIGURATION_BASENAMES = new Set([
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum", "gemfile", "gemfile.lock", "requirements.txt", "constraints.txt",
  "pyproject.toml", "poetry.lock", "pipfile", "pipfile.lock", "mise.toml"
]);
const CONFIGURATION_EXTENSIONS = new Set([
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "xml", "plist", "lock", "gradle"
]);
const EXECUTABLE_BASENAMES = new Set(["makefile", "dockerfile", "justfile", "rakefile", "procfile", "vagrantfile", "containerfile", "cmakelists.txt"]);
const EXECUTABLE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "kts", "scala", "swift", "m", "mm",
  "c", "h", "cc", "cpp", "hpp", "cs", "fs", "php", "pl", "pm", "lua", "r", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  "sql", "vue", "svelte", "astro", "html", "htm", "css", "scss", "sass", "less", "wasm", "ex", "exs", "erl", "hs", "clj", "dart",
  "groovy", "tf", "hcl", "nix", "zig", "sol", "graphql", "gql", "proto", "prisma", "mdx", "svg", "ipynb", "cmake"
]);
/** The only inert document types: prose markup, plus plain text under a conventional prose name. */
const INERT_DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "rst", "adoc", "asciidoc"]);
const INERT_TEXT_STEMS = new Set([
  "readme", "license", "licence", "notice", "changelog", "changes", "history", "contributing", "authors", "contributors",
  "copying", "code_of_conduct", "security", "support", "maintainers", "credits"
]);

function classifyPath(filePath: string, entry: PathEntry): PatchFileClassification {
  const as = (cls: PatchFileClass, reason: string): PatchFileClassification => ({ path: filePath, class: cls, reason });
  if (entry.special) return as("unknown", entry.special);
  if (entry.executableMode) return as("executable", "executable file mode");
  if (isGovernedRecordPath(filePath)) {
    if (!entry.governedOnly) return as("authority", "managed record changed outside an attested Arcadia governed commit");
    if (entry.shapeViolation) return as("authority", `governed record changed beyond its allowed shape: ${entry.shapeViolation}`);
    return as("governed-record", "shape-limited managed record written only by attested Arcadia governed commits");
  }
  const lowered = filePath.toLowerCase();
  const name = basename(lowered);
  const directories = lowered.split("/").slice(0, -1);
  if (AUTHORITY_BASENAMES.has(name) || AUTHORITY_PATHS.has(lowered) || AUTHORITY_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return as("authority", "authority-bearing or agent-instruction document");
  }
  if (directories.some((segment) => segment.startsWith("."))) return as("authority", "inside a dot directory (tool, CI or agent configuration)");
  if (CONFIGURATION_BASENAMES.has(name)) return as("configuration", "package manifest, lockfile or tool configuration");
  if (EXECUTABLE_BASENAMES.has(name)) return as("executable", "build or container script");
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (name.startsWith(".")) return as("configuration", "dotfile configuration");
  if (EXECUTABLE_EXTENSIONS.has(extension)) return as("executable", `.${extension} source`);
  if (CONFIGURATION_EXTENSIONS.has(extension)) return as("configuration", `.${extension} configuration or data`);
  if (!extension && directories.some((segment) => segment === "bin" || segment === "scripts")) return as("executable", "extensionless script");
  const stem = extension ? name.slice(0, name.lastIndexOf(".")) : name;
  const inertType = INERT_DOCUMENT_EXTENSIONS.has(extension) || ((extension === "txt" || extension === "text") && INERT_TEXT_STEMS.has(stem));
  if (!inertType) return as("unknown", "not on the inert document allowlist");
  if (directories.some((segment) => AGENT_DIRECTORIES.has(segment))) return as("authority", "document inside an agent-instruction directory");
  if (directories.some((segment) => CODE_DIRECTORIES.has(segment))) return as("unknown", "document inside a code directory, which code may load");
  if (lowered.startsWith("docs/") && !DOCS_PROSE_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return as("authority", "documentation under docs/ outside the docs/reports/ prose allowlist, which may be binding guidance");
  }
  return as("inert-document", `.${extension} document`);
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
