import { execFile } from "node:child_process";
import type { DecisionCard } from "../../../src/decisions/card";
import { DEFAULT_CARD_REPO } from "../../../src/decisions/cardSources";
import {
  buildNextSteps,
  type NextStepsCard,
  type NextStepsPr,
  type NextStepsQueue,
  type NextStepsResult,
  type NextStepsSource
} from "../../../src/decisions/nextSteps";
import type { CardTarget } from "./decision-cards";
import type { DashboardOutstandingPullRequest } from "./types";
import type { WorkQueue } from "./work-queue-types";

/** What the inventory read says about itself; any problem here blocks "production is moving". */
export interface InventoryRead {
  pullRequests: DashboardOutstandingPullRequest[];
  /** Older than the freshness window, or being refreshed. Shown; not by itself unreadable. */
  stale: boolean;
  checkedAt: string | null;
  /** The last refresh failed: the list may be missing pull requests. */
  refreshError: string | null;
  /** Some repository could not be scanned (errors non-empty). */
  incomplete: boolean;
}

/** What the loader reads. Every reader is injected so the loader is tested without gh, a CLI or a network. */
export interface NextStepsReaders {
  /** The existing cached open-pull-request inventory (the same one /api/pull-requests serves); used for the PR SET only. */
  readInventory: () => Promise<InventoryRead>;
  readQueue: () => Promise<WorkQueue>;
  readCards: () => Promise<{ cards: DecisionCard[]; targets: ReadonlyMap<string, CardTarget> }>;
  /** `gh` for the per-PR facts the inventory does not carry, read fresh together so head, checks and state pair. */
  runGh: (args: string[]) => Promise<string>;
}

export interface NextStepsResponse extends NextStepsResult {
  /** Pull requests in other repositories, not part of this list (counted, never dropped silently). */
  otherRepositories: number;
  inventoryStale: boolean;
  inventoryCheckedAt: string | null;
  repo: string;
  /** Head shas read this time, by PR number; the next poll passes them back as `pinnedHeads`. */
  heads: Record<number, string>;
}

const CONCURRENCY = 4;
const GH_TIMEOUT_MS = 20_000;
/** `gh pr checks` exited non-zero and printed nothing: no required checks configured, or a failure. */
export const GH_NO_OUTPUT = "__gh_no_output__";

export function ghRunner(): NextStepsReaders["runGh"] {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        // `gh pr checks` exits non-zero while checks are pending or failing but still prints its JSON.
        if (args[0] === "pr" && args[1] === "checks") {
          resolve(stdout.trim() !== "" ? stdout : GH_NO_OUTPUT);
          return;
        }
        reject(new Error("gh failed", { cause: error }));
      });
    });
}

interface GhFileRow {
  filename: string;
  previous_filename?: string | null;
}

interface GhPrView {
  headRefOid?: string;
  baseRefName?: string;
  headRefName?: string;
  isDraft?: boolean;
  mergeStateStatus?: string;
  headRepository?: { name?: string } | null;
  headRepositoryOwner?: { login?: string } | null;
  reviews?: Array<{ state?: string; author?: { login?: string } | null; commit?: { oid?: string } | null }>;
  statusCheckRollup?: Array<{ name?: string; context?: string; conclusion?: string | null; state?: string | null }> | null;
}

/**
 * Per-PR facts from ONE fresh gh read (head oid, reviews, checks, draft and merge state come from the same
 * `pr view`, so a just-pushed head can never pair with old green checks), plus the REST file list and required
 * checks. Any failure makes the PR unreadable, never partial.
 */
async function readFacts(
  repo: string,
  trunk: string,
  pr: DashboardOutstandingPullRequest,
  runGh: NextStepsReaders["runGh"]
): Promise<NextStepsPr> {
  const unread: NextStepsPr = {
    number: pr.number,
    title: pr.title,
    headSha: "",
    baseRef: pr.baseBranch,
    headRef: pr.headBranch,
    isDraft: pr.isDraft,
    author: pr.author,
    files: [],
    changedFiles: null,
    reviews: [],
    checks: [],
    requiredChecks: [],
    mergeStateStatus: null
  };
  try {
    const view = JSON.parse(
      await runGh([
        "pr", "view", String(pr.number), "--repo", repo, "--json",
        "headRefOid,baseRefName,headRefName,isDraft,mergeStateStatus,headRepository,headRepositoryOwner,reviews,statusCheckRollup"
      ])
    ) as GhPrView;
    const meta = JSON.parse(await runGh(["api", `repos/${repo}/pulls/${pr.number}`])) as { changed_files?: number };
    const pages = JSON.parse(await runGh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/files`])) as GhFileRow[][];
    const baseRef = typeof view.baseRefName === "string" ? view.baseRefName : pr.baseBranch;
    const rawRequired = await runGh(["pr", "checks", String(pr.number), "--repo", repo, "--required", "--json", "name"]);
    let requiredChecks: string[];
    if (rawRequired === GH_NO_OUTPUT) {
      // No output is "no required checks configured" ONLY for a stacked child (its base is not the trunk, so
      // branch protection does not apply to it). On the trunk it cannot be told from a failure: refuse.
      if (baseRef === trunk) throw new Error("gh pr checks printed nothing for a trunk-based pull request");
      requiredChecks = [];
    } else {
      requiredChecks = (JSON.parse(rawRequired) as Array<{ name: string }>).map((check) => check.name);
    }
    const owner = view.headRepositoryOwner?.login;
    const name = view.headRepository?.name;
    return {
      ...unread,
      headSha: typeof view.headRefOid === "string" ? view.headRefOid : "",
      baseRef,
      headRef: typeof view.headRefName === "string" ? view.headRefName : pr.headBranch,
      isDraft: view.isDraft === true,
      mergeStateStatus: typeof view.mergeStateStatus === "string" ? view.mergeStateStatus : null,
      headRepo: typeof owner === "string" && typeof name === "string" ? `${owner}/${name}` : null,
      files: pages.flat().map((row) => ({ filename: row.filename, previous_filename: row.previous_filename ?? null })),
      changedFiles: typeof meta.changed_files === "number" ? meta.changed_files : null,
      reviews: (view.reviews ?? []).map((review) => ({
        verdict: review.state ?? "",
        headSha: review.commit?.oid ?? "",
        author: review.author?.login ?? null
      })),
      checks: (view.statusCheckRollup ?? []).map((check) => ({
        name: check.name ?? check.context ?? "",
        conclusion: check.conclusion ?? check.state ?? null
      })),
      requiredChecks
    };
  } catch {
    return { ...unread, unreadable: "fresh gh read failed" };
  }
}

async function readTrunk(repo: string, runGh: NextStepsReaders["runGh"]): Promise<string> {
  try {
    const parsed = JSON.parse(await runGh(["repo", "view", repo, "--json", "defaultBranchRef"])) as { defaultBranchRef?: { name?: string } };
    const name = parsed.defaultBranchRef?.name;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : "main";
  } catch {
    return "main";
  }
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The queue as the pure module wants it: the current Action, its Plan path and the other queued Actions. */
export function queueFacts(queue: WorkQueue): { facts: NextStepsQueue; decisionToAction: Map<string, string> } {
  const entries = [...(queue.ordered ?? []), ...(queue.running ?? []), ...(queue.attention ?? []), ...(queue.flagged ?? [])];
  const keyOf = (e: WorkQueue["ordered"][number]) => (e.projectSlug && e.actionId ? `${e.projectSlug}/${e.actionId}` : e.id);
  const current = entries.find((e) => queue.nextActionKey !== null && (keyOf(e) === queue.nextActionKey || e.id === queue.nextActionKey)) ?? null;
  const planPathOf = (value: string | null | undefined): string | null => {
    if (typeof value !== "string" || value === "") return null;
    const at = value.lastIndexOf("docs/plans/");
    return at >= 0 ? value.slice(at) : value.replace(/^\.\//, "");
  };
  const decisionToAction = new Map<string, string>();
  for (const e of entries) {
    if (e.decisionId && e.projectSlug && e.actionId) decisionToAction.set(`${e.projectSlug}/${e.decisionId}`, e.actionId);
  }
  return {
    facts: {
      currentActionId: current?.actionId ?? null,
      currentExpectedArtifact: current?.expectedArtifact ?? null,
      planPath: planPathOf(current?.planPath),
      queued: entries
        .filter((e) => e !== current && e.actionId)
        .map((e) => ({ actionId: e.actionId as string, expectedArtifact: e.expectedArtifact, dependencies: e.dependencies ?? [] }))
    },
    decisionToAction
  };
}

/**
 * Every operator touch, ordered by what unblocks the queue. GET-only and read-only: it merges, answers and runs
 * nothing. The pinned head sha it returns is a display and verification aid; the GitHub merge page is the guard.
 * A source that cannot be read (including any per-PR gh failure) is named in `unavailable` and blocks "moving".
 */
export async function loadNextSteps(
  readers: NextStepsReaders,
  options: { repo?: string; cap?: number; pinnedHeads?: Readonly<Record<number, string>> | null } = {}
): Promise<NextStepsResponse> {
  const repo = options.repo ?? DEFAULT_CARD_REPO;
  const unavailable = new Set<NextStepsSource>();
  let prs: NextStepsPr[] = [];
  let trunk = "main";
  let otherRepositories = 0;
  let inventoryStale = false;
  let inventoryCheckedAt: string | null = null;
  let queue: NextStepsQueue | null = null;
  let decisionToAction = new Map<string, string>();
  let cards: NextStepsCard[] = [];

  try {
    const inventory = await readers.readInventory();
    inventoryStale = inventory.stale;
    inventoryCheckedAt = inventory.checkedAt;
    // A refresh that errored, or a scan that skipped a repository, may hide pull requests: never "moving".
    if (inventory.refreshError !== null || inventory.incomplete) unavailable.add("prs");
    const mine = inventory.pullRequests.filter((pr) => pr.repository.trim().toLowerCase() === repo.toLowerCase());
    otherRepositories = inventory.pullRequests.length - mine.length;
    trunk = await readTrunk(repo, readers.runGh);
    prs = await mapLimited(mine, CONCURRENCY, (pr) => readFacts(repo, trunk, pr, readers.runGh));
    if (prs.some((pr) => typeof pr.unreadable === "string")) unavailable.add("checks");
  } catch {
    unavailable.add("prs");
  }

  try {
    const derived = queueFacts(await readers.readQueue());
    queue = derived.facts;
    decisionToAction = derived.decisionToAction;
  } catch {
    unavailable.add("queue");
  }

  try {
    const loaded = await readers.readCards();
    cards = loaded.cards.map((card) => {
      const target = loaded.targets.get(card.id);
      const unblocks = target?.kind === "decision" ? decisionToAction.get(`${target.projectSlug}/${target.decisionId}`) ?? null : null;
      return { id: card.id, verb: card.verb, kind: card.kind, what: card.what, unblocksActionId: unblocks };
    });
  } catch {
    unavailable.add("cards");
  }

  const result = buildNextSteps({
    prs,
    queue,
    cards,
    repo,
    trunk,
    cap: options.cap,
    pinnedHeads: options.pinnedHeads ?? null,
    unavailable: [...unavailable]
  });
  const heads: Record<number, string> = {};
  for (const pr of prs) if (pr.headSha !== "") heads[pr.number] = pr.headSha;
  return { ...result, otherRepositories, inventoryStale, inventoryCheckedAt, repo, heads };
}
