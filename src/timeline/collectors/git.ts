import { closeSync, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { classifyCommit, workKindFor } from "../classify.js";
import {
  actionFromPeerWatchTrailer,
  actionHintFromBranch,
  actorFromPeerWatchTrailer,
  actorFromCoAuthors,
  actorFromEmail,
  strongestActor,
  toolFromBranch,
  toolFromWorktreePath,
  type ActorClaim
} from "../identity.js";
import { inWindow, timelineEvent, type TimelineEvent } from "../schema.js";
import type { Collector, CollectorContext, TimelineRepository } from "./context.js";

/**
 * Git activity across every repository the workspace knows and every worktree
 * Git itself has registered for them (main checkout, ~/.claude, ~/.codex and
 * ~/.opencode worktrees, fixture repositories). Worktrees are discovered from
 * each repository's own `worktrees/` admin directory, not by scanning the tool
 * directories, which hold thousands of dead fixture checkouts.
 *
 * Reads only: `git log`, `git rev-parse`, and the reflog and index files.
 */

const REFLOG_TAIL_BYTES = 512 * 1024;
const FIELD = "\x1f";
const RECORD = "\x1e";

export interface WorktreeAdmin {
  /** The worktree's checkout path. */
  path: string;
  /** Its administrative Git directory (holds HEAD, index, logs/HEAD). */
  gitDir: string;
  isMain: boolean;
  branch: string | null;
}

export interface ReflogEntry {
  oldSha: string;
  newSha: string;
  name: string;
  email: string;
  time: Date;
  message: string;
}

/** `pull https://user:token@host/…` → `pull https://***@host/…`: reflog messages can carry a remote URL. */
export function redactUrlUserinfo(text: string): string {
  return text.replace(/\/\/[^@/\s]+@/g, "//***@");
}

export function parseReflogLine(line: string): ReflogEntry | null {
  const tab = line.indexOf("\t");
  const head = tab >= 0 ? line.slice(0, tab) : line;
  const message = tab >= 0 ? line.slice(tab + 1) : "";
  const match = /^([0-9a-f]{40}) ([0-9a-f]{40}) (.*) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(head);
  if (!match) return null;
  return {
    oldSha: match[1],
    newSha: match[2],
    name: match[3],
    email: match[4],
    time: new Date(Number(match[5]) * 1000),
    message
  };
}

/** The last `bytes` of a file, dropping a partial first line; whole file when smaller. */
export function readTail(file: string, bytes = REFLOG_TAIL_BYTES): { text: string; truncated: boolean } {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return { text, truncated: start > 0 };
  } finally {
    closeSync(fd);
  }
}

function firstLine(file: string): string | null {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const newline = text.indexOf("\n");
    return newline >= 0 ? text.slice(0, newline) : text || null;
  } finally {
    closeSync(fd);
  }
}

/** A regular file, not a symlink, FIFO or device: the timeline never follows or blocks on one. */
function isRegularFile(file: string): boolean {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function readBranch(gitDir: string): string | null {
  try {
    if (!isRegularFile(path.join(gitDir, "HEAD"))) return null;
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : null;
  } catch {
    return null;
  }
}

/** Main checkout plus every linked worktree Git has an admin directory for (including ones whose checkout is gone). */
export function listWorktreeAdmins(repositoryPath: string, commonDir: string): WorktreeAdmin[] {
  const admins: WorktreeAdmin[] = [{ path: repositoryPath, gitDir: commonDir, isMain: true, branch: readBranch(commonDir) }];
  const worktreesDir = path.join(commonDir, "worktrees");
  if (!existsSync(worktreesDir)) return admins;
  for (const name of readdirSync(worktreesDir).sort()) {
    const gitDir = path.join(worktreesDir, name);
    // A symlinked admin directory could point anywhere; only real ones are read.
    if (!lstatSync(gitDir).isDirectory() || !isRegularFile(path.join(gitDir, "gitdir"))) continue;
    try {
      const pointer = readFileSync(path.join(gitDir, "gitdir"), "utf8").trim();
      admins.push({ path: path.dirname(pointer), gitDir, isMain: false, branch: readBranch(gitDir) });
    } catch {
      // An admin directory without a gitdir file is not a worktree Git can use; skip it.
    }
  }
  return admins;
}

interface CommitAttribution {
  worktree: WorktreeAdmin;
  reflogEmail: string;
}

interface RepositoryScan {
  events: TimelineEvent[];
  attribution: Map<string, CommitAttribution>;
}

function scanWorktrees(repository: TimelineRepository, admins: WorktreeAdmin[], context: CollectorContext): RepositoryScan {
  const events: TimelineEvent[] = [];
  const attribution = new Map<string, CommitAttribution>();
  for (const admin of admins) {
    const reflog = path.join(admin.gitDir, "logs", "HEAD");
    const pathClaim = toolFromWorktreePath(admin.path);
    const branchClaim = toolFromBranch(admin.branch);
    const actionHint = actionHintFromBranch(admin.branch);
    const baseSubjects = {
      project: repository.projectSlug,
      repository: repository.path,
      worktree: admin.path,
      branch: admin.branch ?? undefined,
      action: actionHint ?? undefined
    };
    if (isRegularFile(reflog)) {
      if (!admin.isMain) {
        const created = parseReflogLine(firstLine(reflog) ?? "");
        if (created && inWindow(created.time.toISOString(), context.window)) {
          const who = strongestActor([actorFromEmail(created.email, { operatorEmails: context.operatorEmails, label: "reflog" }), pathClaim, branchClaim]);
          pushEvent(events, {
            id: `git:${repository.projectSlug}:worktree-created:${admin.path}`,
            time: created.time,
            clock: "git-reflog",
            source: "git",
            kind: "git.worktree.created",
            workKind: workKindFor("git.worktree.created"),
            summary: `Worktree opened${admin.branch ? ` on ${admin.branch}` : ""}`,
            subjects: baseSubjects,
            actor: who.actor,
            evidence: [{ kind: "path", value: reflog }],
            provenance: {
              event: "first line of the worktree's HEAD reflog",
              actor: who.provenance,
              ...(actionHint ? { action: "Action slug from the branch name (worktree preparation convention)" } : {})
            }
          });
        }
      }
      const { text, truncated: tailOnly } = readTail(reflog);
      if (tailOnly) {
        const first = text.split("\n").map(parseReflogLine).find((entry) => entry !== null);
        if (first && first.time.getTime() > context.window.since.getTime()) {
          pushEvent(events, {
            id: `git:${repository.projectSlug}:reflog-truncated:${admin.path}:${context.window.since.toISOString()}`,
            time: context.window.since,
            clock: "collector",
            source: "git",
            kind: "source.truncated",
            workKind: workKindFor("source.truncated"),
            summary: `Only the last ${REFLOG_TAIL_BYTES / 1024} KB of ${admin.isMain ? "the main checkout's" : "a worktree's"} reflog were read (from ${first.time.toISOString()}); earlier commits there are not attributed to it`,
            subjects: { project: repository.projectSlug, repository: repository.path, worktree: admin.path },
            provenance: { event: "the reflog tail read did not reach the window start" }
          });
        }
      }
      for (const line of text.split("\n")) {
        const entry = parseReflogLine(line);
        if (!entry || !inWindow(entry.time.toISOString(), context.window)) continue;
        if (entry.message.startsWith("commit")) {
          attribution.set(entry.newSha, { worktree: admin, reflogEmail: entry.email });
          continue;
        }
        const integrated = /^(merge|pull|rebase \(finish\))/.exec(entry.message);
        if (!integrated) continue;
        const who = strongestActor([actorFromEmail(entry.email, { operatorEmails: context.operatorEmails, label: "reflog" }), pathClaim, branchClaim]);
        pushEvent(events, {
          id: `git:${repository.projectSlug}:reflog:${admin.path}:${entry.time.getTime()}:${entry.newSha}`,
          time: entry.time,
          clock: "git-reflog",
          source: "git",
          kind: "git.worktree.integrated",
          workKind: workKindFor("git.worktree.integrated"),
          summary: redactUrlUserinfo(entry.message),
          subjects: { ...baseSubjects, commit: entry.newSha },
          actor: who.actor,
          evidence: [{ kind: "sha", value: entry.newSha }],
          provenance: { event: `worktree HEAD reflog entry "${integrated[1]}"`, actor: who.provenance }
        });
      }
    }
    const index = path.join(admin.gitDir, "index");
    if (isRegularFile(index)) {
      const touched = lstatSync(index).mtime;
      if (inWindow(touched.toISOString(), context.window)) {
        const who = strongestActor([pathClaim, branchClaim]);
        pushEvent(events, {
          id: `git:${repository.projectSlug}:worktree-touched:${admin.path}:${touched.getTime()}`,
          time: touched,
          clock: "file-mtime",
          source: "git",
          kind: "git.worktree.touched",
          workKind: workKindFor("git.worktree.touched"),
          summary: `Git last ran in ${admin.isMain ? "the main checkout" : "worktree"}${admin.branch ? ` (${admin.branch})` : ""}`,
          subjects: baseSubjects,
          actor: who.actor,
          evidence: [{ kind: "path", value: index }],
          provenance: {
            event: "modification time of the worktree's Git index; any git command that refreshes the index sets it, including read-only scans by other tools, so it means 'git ran here', not 'work happened'",
            actor: who.provenance
          }
        });
      }
    }
  }
  return { events, attribution };
}

function commitEvents(repository: TimelineRepository, scan: RepositoryScan, context: CollectorContext): TimelineEvent[] {
  const format = [
    "%H", "%P", "%an", "%ae", "%cn", "%ce", "%cI", "%S", "%s",
    "%(trailers:key=Co-authored-by,valueonly,separator=%x1d)",
    "%(trailers:key=Arcadia-Agent,valueonly,separator=%x1d)",
    "%(trailers:key=Arcadia-Action,valueonly,separator=%x1d)"
  ].join("%x1f");
  const result = context.git(repository.path, [
    "log",
    "--branches",
    "--remotes",
    "--source",
    `--since=${context.window.since.toISOString()}`,
    `--until=${context.window.until.toISOString()}`,
    `--max-count=${context.maxPerSource}`,
    `--format=${RECORD}${format}`
  ]);
  if (!result.ok) throw new Error(`git log failed in ${repository.path}: ${result.stderr.trim().slice(0, 200)}`);
  const events: TimelineEvent[] = [];
  const records = result.stdout.split(RECORD).map((record) => record.trim()).filter(Boolean);
  for (const record of records) {
    const [sha, parents, , authorEmail, , committerEmail, committedAt, sourceRef, subject, trailerField, agentTrailer, actionTrailer] = record.split(FIELD);
    const contractAction = actionFromPeerWatchTrailer(actionTrailer?.split("\x1d")[0]);
    if (!sha || !committedAt) continue;
    const parentList = (parents ?? "").split(" ").filter(Boolean);
    const branch = (sourceRef ?? "").replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "") || null;
    const trailers = (trailerField ?? "").split("\x1d").map((value) => value.trim()).filter(Boolean);
    const committerIsGitHub = (committerEmail ?? "").toLowerCase() === "noreply@github.com";
    const attributed = scan.attribution.get(sha);
    const claims: Array<ActorClaim | null> = [
      actorFromPeerWatchTrailer(agentTrailer?.split("\x1d")[0]),
      actorFromEmail(authorEmail, { operatorEmails: context.operatorEmails }),
      committerIsGitHub ? null : actorFromEmail(committerEmail, { operatorEmails: context.operatorEmails, label: "committer" }),
      actorFromCoAuthors(trailers),
      attributed ? toolFromWorktreePath(attributed.worktree.path) : null,
      toolFromBranch(attributed?.worktree.branch ?? branch)
    ];
    const who = strongestActor(claims);
    // The merging account's address is personal; the stream names only its role.
    if (committerIsGitHub) who.actor.account ??= "GitHub merge under a human account (address withheld)";
    const classified = classifyCommit({ subject: subject ?? "", parentCount: parentList.length, actorRole: who.actor.role, committerIsGitHub });
    const kind = parentList.length > 1 || committerIsGitHub ? "git.merge" : "git.commit";
    const pullRequest = committerIsGitHub ? /\(#(\d+)\)\s*$/.exec(subject ?? "")?.[1] : undefined;
    const workBranch = attributed?.worktree.branch ?? branch;
    const actionHint = contractAction?.action ?? actionHintFromBranch(workBranch);
    const dedupeKeys = [`commit:${sha}`];
    const pointedAt = /^chore\(arcadia\): point at (\S+)/.exec(subject ?? "")?.[1];
    if (pointedAt && parentList[0]) dedupeKeys.push(`pointer-after:${parentList[0]}:${pointedAt}`);
    pushEvent(events, {
      id: `git:${repository.projectSlug}:commit:${sha}`,
      time: committedAt,
      clock: "git-committer-date",
      source: "git",
      kind,
      workKind: classified.workKind,
      summary: subject ?? "",
      subjects: {
        project: repository.projectSlug,
        repository: repository.path,
        commit: sha,
        branch: workBranch ?? undefined,
        worktree: attributed?.worktree.path,
        action: actionHint ?? undefined,
        pullRequest: pullRequest ? `#${pullRequest}` : undefined
      },
      actor: who.actor,
      evidence: [{ kind: "sha", value: sha }],
      provenance: {
        event: `git log --branches --remotes (first reached from ${sourceRef || "unknown ref"})`,
        time: "committer date: when the commit entered this history (author date survives rebases and is not used)",
        actor: who.provenance,
        workKind: classified.provenance,
        ...(attributed ? { worktree: "commit sha found in that worktree's HEAD reflog" } : {}),
        ...(contractAction
          ? { action: "Action from the Arcadia-Action trailer (peer-watch contract)" }
          : actionHint ? { action: "Action slug from the branch name (worktree preparation convention)" } : {})
      },
      dedupeKeys
    });
  }
  if (records.length >= context.maxPerSource) {
    pushEvent(events, {
      id: `git:${repository.projectSlug}:truncated:${context.window.since.toISOString()}`,
      time: context.window.since,
      clock: "collector",
      source: "git",
      kind: "source.truncated",
      workKind: workKindFor("source.truncated"),
      summary: `Only the newest ${context.maxPerSource} commits in ${repository.projectSlug} were read; narrow --since to see older ones`,
      subjects: { project: repository.projectSlug, repository: repository.path },
      provenance: { event: "the collector's per-source cap was reached" }
    });
  }
  return events;
}

function pushEvent(events: TimelineEvent[], input: Parameters<typeof timelineEvent>[0]): void {
  const event = timelineEvent(input);
  if (event) events.push(event);
}

export function collectRepositoryGit(repository: TimelineRepository, context: CollectorContext): TimelineEvent[] {
  const common = context.git(repository.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) throw new Error(`Not a readable Git repository: ${repository.path}`);
  const admins = listWorktreeAdmins(repository.path, common.stdout.trim());
  const scan = scanWorktrees(repository, admins, context);
  return [...scan.events, ...commitEvents(repository, scan, context)];
}

/** One collector per repository, so one unreadable repository becomes one source_error and the rest still stream. */
export function gitCollectors(repositories: TimelineRepository[]): Collector[] {
  return repositories.map((repository) => ({
    source: "git" as const,
    describe: `git ${repository.projectSlug} (${repository.path})`,
    collect: (context: CollectorContext) => collectRepositoryGit(repository, context)
  }));
}

