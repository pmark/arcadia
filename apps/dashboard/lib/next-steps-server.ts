import { execFile } from "node:child_process";
import type { DecisionCard } from "../../../src/decisions/card";
import { DEFAULT_CARD_REPO } from "../../../src/decisions/cardSources";
import {
  INVENTORY_MAX_AGE_SECONDS,
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
  /** Head shas read this time, by PR number (for `repo`); the next poll passes them back as `pinnedHeads`. */
  heads: Record<number, string>;
  /** The PR list may have lagged (stale or too old) and there are no steps, so "moving" was withheld. */
  outOfDate: boolean;
  /** Pull requests in the cached inventory that are no longer OPEN on GitHub; dropped, never offered. */
  closedSinceInventory: number;
}

const CONCURRENCY = 4;
const GH_TIMEOUT_MS = 20_000;
/** `gh pr checks` exited non-zero and printed nothing: no required checks configured, or a failure. */
export const GH_NO_OUTPUT = "__gh_no_output__";

/**
 * What a non-zero `gh pr checks --required` means. It exits non-zero while checks are pending or failing but
 * still prints its JSON (output). Printing nothing is "no required checks configured" ONLY when gh says so on
 * stderr; auth, TLS, timeout and any other failure is a failure, never mistaken for "none configured".
 */
export function interpretChecksFailure(stdout: string, stderr: string): "output" | "none_required" | "failed" {
  if (stdout.trim() !== "") return "output";
  return /no required checks/i.test(stderr) ? "none_required" : "failed";
}

export function ghRunner(): NextStepsReaders["runGh"] {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if (args[0] === "pr" && args[1] === "checks") {
          const kind = interpretChecksFailure(stdout, stderr);
          if (kind === "output") return resolve(stdout);
          if (kind === "none_required") return resolve(GH_NO_OUTPUT);
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
  state?: string;
  body?: string | null;
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
  pr: DashboardOutstandingPullRequest,
  runGh: NextStepsReaders["runGh"]
): Promise<NextStepsPr | "closed"> {
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
        "state,body,headRefOid,baseRefName,headRefName,isDraft,mergeStateStatus,headRepository,headRepositoryOwner,reviews,statusCheckRollup"
      ])
    ) as GhPrView;
    // The cached inventory may still list a pull request merged or closed since it was read: never offer it.
    if (typeof view.state !== "string") throw new Error("gh pr view did not report the pull request state");
    if (view.state.toUpperCase() !== "OPEN") return "closed";
    const meta = JSON.parse(await runGh(["api", `repos/${repo}/pulls/${pr.number}`])) as { changed_files?: number };
    const pages = JSON.parse(await runGh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/files`])) as GhFileRow[][];
    const baseRef = typeof view.baseRefName === "string" ? view.baseRefName : pr.baseBranch;
    const rawRequired = await runGh(["pr", "checks", String(pr.number), "--repo", repo, "--required", "--json", "name"]);
    let requiredChecks: string[];
    if (rawRequired === GH_NO_OUTPUT) {
      // gh itself said "no required checks": genuinely none configured. For a stacked child (base is not the
      // trunk) that is expected and it stays parent_unmerged; for a trunk-based PR the list shows it as
      // no_required_checks. Any other gh failure threw above and makes the pull request unreadable instead.
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
      body: typeof view.body === "string" ? view.body : null,
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
  options: { repo?: string; cap?: number; pinnedHeads?: Readonly<Record<number, string>> | null; now?: Date } = {}
): Promise<NextStepsResponse> {
  const repo = options.repo ?? DEFAULT_CARD_REPO;
  const unavailable = new Set<NextStepsSource>();
  const prs: NextStepsPr[] = [];
  let trunk = "main";
  let otherRepositories = 0;
  let inventoryStale = false;
  let inventoryCheckedAt: string | null = null;
  let queue: NextStepsQueue | null = null;
  let decisionToAction = new Map<string, string>();
  let cards: NextStepsCard[] | null = null;
  let closedSinceInventory = 0;

  try {
    const inventory = await readers.readInventory();
    inventoryStale = inventory.stale;
    inventoryCheckedAt = inventory.checkedAt;
    // A refresh that errored, or a scan that skipped a repository, may hide pull requests: never "moving".
    if (inventory.refreshError !== null || inventory.incomplete) unavailable.add("prs");
    const mine = inventory.pullRequests.filter((pr) => pr.repository.trim().toLowerCase() === repo.toLowerCase());
    otherRepositories = inventory.pullRequests.length - mine.length;
    trunk = await readTrunk(repo, readers.runGh);
    const read = await mapLimited(mine, CONCURRENCY, (pr) => readFacts(repo, pr, readers.runGh));
    for (const item of read) {
      if (item === "closed") closedSinceInventory += 1;
      else prs.push(item);
    }
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
  return applyInventoryAge(
    { ...result, otherRepositories, inventoryStale, inventoryCheckedAt, repo, heads, outOfDate: false, closedSinceInventory },
    options.now ?? new Date()
  );
}

/**
 * Production is never "moving" on a PR list that may have lagged. When the inventory is stale or was read more
 * than INVENTORY_MAX_AGE_SECONDS ago and there are zero steps, the state is `unavailable` naming `prs`. Applied
 * to a fresh computation and again to a response served from the route's own cache, where the inventory's age
 * is the age at read plus the time spent in that cache.
 */
export function applyInventoryAge(response: NextStepsResponse, now: Date): NextStepsResponse {
  if (response.state !== "moving") return response;
  const readAt = response.inventoryCheckedAt === null ? Number.NaN : Date.parse(response.inventoryCheckedAt);
  const ageSeconds = (now.getTime() - readAt) / 1000;
  // A checkedAt in the future (clock skew, bad data) is not a fresh read: it is rejected, never clamped to zero.
  const lagging = response.inventoryStale || !Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > INVENTORY_MAX_AGE_SECONDS;
  if (!lagging) return response;
  return {
    ...response,
    state: "unavailable",
    unavailable: [...new Set([...response.unavailable, "prs" as const])].sort(),
    outOfDate: true
  };
}

/** The body /api/pull-requests serves (the inventory cache state, JSON). */
export interface InventoryBody {
  snapshot: { pullRequests: DashboardOutstandingPullRequest[]; errors?: unknown[] };
  stale?: boolean;
  refreshing?: boolean;
  checkedAt?: string;
  refreshError?: string | null;
  incomplete?: boolean;
}

export const INVENTORY_REFRESH_TIMEOUT_MS = 10_000;
const INVENTORY_REFRESH_POLL_MS = 250;

/**
 * Await a BOUNDED refresh of a stale inventory. The inventory cache serves a stale snapshot immediately and
 * refreshes in the background (fresh window 30s), so a quiet repository would flap between "moving" and "PR
 * list may be out of date". When the first read is stale this asks for a refresh and polls until it finishes or
 * INVENTORY_REFRESH_TIMEOUT_MS passes; on timeout the still-stale body is returned and the stale-and-empty rule
 * (applyInventoryAge) withholds "moving". Poll interval, cache freshness (30s), the route's 30s response cache
 * and the 60s age ceiling are independent: a fresh body is reused as read, a stale one is refreshed here.
 */
export async function readInventoryFresh(
  read: (refresh: boolean) => Promise<InventoryBody>,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<InventoryBody> {
  const timeoutMs = options.timeoutMs ?? INVENTORY_REFRESH_TIMEOUT_MS;
  const pollMs = options.pollMs ?? INVENTORY_REFRESH_POLL_MS;
  let body = await read(false);
  if (body.stale !== true) return body;
  const deadline = Date.now() + timeoutMs;
  body = await read(true);
  while (body.stale === true && body.refreshing === true && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    body = await read(false);
  }
  return body;
}

export function toInventoryRead(body: InventoryBody): InventoryRead {
  return {
    pullRequests: body.snapshot.pullRequests,
    stale: body.stale === true,
    checkedAt: typeof body.checkedAt === "string" ? body.checkedAt : null,
    refreshError: typeof body.refreshError === "string" ? body.refreshError : null,
    incomplete: body.incomplete === true || (body.snapshot.errors?.length ?? 0) > 0
  };
}

/** Heads are remembered per repository and pull request number; `head_moved` is a one-poll signal. */
export const headKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;
