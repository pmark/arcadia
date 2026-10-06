import { workKindFor } from "../classify.js";
import { strongestActor, toolFromBranch, actionHintFromBranch } from "../identity.js";
import { inWindow, timelineEvent, type TimelineEvent } from "../schema.js";
import type { Collector, CollectorContext, TimelineRepository } from "./context.js";

/**
 * Pull-request activity from GitHub's REST API (`gh api` GET only), for
 * repositories whose origin is on github.com. Off unless `--pull-requests`
 * is passed; bounded to the most recently updated page; offline or
 * unauthenticated becomes one source_error, never an abort.
 */

const PAGE = 50;

interface PullRow {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string } | null;
  user: { login: string } | null;
}

export function githubSlug(remoteUrl: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function collectPullRequests(repository: TimelineRepository, context: CollectorContext): TimelineEvent[] {
  if (!context.includePullRequests) return [];
  const remote = context.git(repository.path, ["remote", "get-url", "origin"]);
  const slug = remote.ok ? githubSlug(remote.stdout) : null;
  if (!slug) return [];
  const result = context.gh(["api", `repos/${slug}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE}`]);
  if (!result.ok) throw new Error(`gh api pulls for ${slug} failed: ${result.stderr.trim().slice(0, 200)}`);
  const pulls = JSON.parse(result.stdout) as PullRow[];
  const events: TimelineEvent[] = [];
  for (const pull of pulls) {
    const branch = pull.head?.ref ?? null;
    const who = strongestActor([toolFromBranch(branch)]);
    const action = actionHintFromBranch(branch) ?? undefined;
    const subjects = { project: repository.projectSlug, repository: repository.path, pullRequest: `#${pull.number}`, branch: branch ?? undefined, action };
    const base = {
      clock: "github-api" as const,
      source: "pull-requests" as const,
      subjects,
      actor: { ...who.actor, account: pull.user?.login ? `GitHub ${pull.user.login}` : null },
      evidence: [{ kind: "url" as const, value: pull.html_url }]
    };
    const stages: Array<[string, string | null, string, string[]]> = [
      ["opened", pull.created_at, `PR #${pull.number} opened: ${pull.title}`, []],
      pull.merged_at
        ? ["merged", pull.merged_at, `PR #${pull.number} merged: ${pull.title}`, pull.merge_commit_sha ? [`commit:${pull.merge_commit_sha}`] : []]
        : ["closed", pull.closed_at, `PR #${pull.number} closed without merging: ${pull.title}`, []]
    ];
    for (const [stage, time, summary, dedupeKeys] of stages) {
      if (!time || !inWindow(new Date(time).toISOString(), context.window)) continue;
      const kind = `pr.${stage}`;
      const event = timelineEvent({
        ...base,
        id: `pull-requests:${slug}:${pull.number}:${stage}`,
        time,
        kind,
        workKind: workKindFor(kind),
        summary,
        provenance: { event: `GitHub REST pulls ${stage === "opened" ? "created_at" : stage === "merged" ? "merged_at" : "closed_at"}`, actor: `${who.provenance}; every agent uses the operator's GitHub login, so the account names no agent` },
        dedupeKeys
      });
      if (event) events.push(event);
    }
  }
  return events;
}

export function pullRequestCollectors(repositories: TimelineRepository[]): Collector[] {
  return repositories.map((repository) => ({
    source: "pull-requests" as const,
    describe: `GitHub pull requests ${repository.projectSlug}`,
    collect: (context: CollectorContext) => collectPullRequests(repository, context)
  }));
}
