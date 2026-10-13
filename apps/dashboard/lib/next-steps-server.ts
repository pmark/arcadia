import { execFile } from "node:child_process";
import type { DecisionCard } from "../../../src/decisions/card";
import { DEFAULT_CARD_REPO } from "../../../src/decisions/cardSources";
import {
  buildNextSteps,
  type NextStepsCard,
  type NextStepsPr,
  type NextStepsQueue,
  type NextStepsResult
} from "../../../src/decisions/nextSteps";
import type { CardTarget } from "./decision-cards";
import type { DashboardOutstandingPullRequest } from "./types";
import type { WorkQueue } from "./work-queue-types";

/** What the loader reads. Every reader is injected so the loader is tested without gh, a CLI or a network. */
export interface NextStepsReaders {
  /** The existing cached open-pull-request inventory (the same one /api/pull-requests serves). */
  readInventory: () => Promise<{ pullRequests: DashboardOutstandingPullRequest[]; stale: boolean }>;
  readQueue: () => Promise<WorkQueue>;
  readCards: () => Promise<{ cards: DecisionCard[]; targets: ReadonlyMap<string, CardTarget> }>;
  /** `gh` for the per-PR facts the inventory does not carry (head oid, reviews, files with renames, required checks). */
  runGh: (args: string[]) => Promise<string>;
}

export type NextStepsSource = "pull_requests" | "queue" | "cards";

export interface NextStepsResponse extends NextStepsResult {
  /** Sources that could not be read. When non-empty, "production is moving" is never claimed. */
  unavailable: NextStepsSource[];
  /** Pull requests in other repositories, not part of this list (counted, never dropped silently). */
  otherRepositories: number;
  inventoryStale: boolean;
  repo: string;
}

const CONCURRENCY = 4;
const GH_TIMEOUT_MS = 20_000;

export function ghRunner(): NextStepsReaders["runGh"] {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
        // `gh pr checks` exits non-zero while checks are pending or failing but still prints its JSON.
        if (error && !(args[0] === "pr" && args[1] === "checks" && stdout.trim() !== "")) reject(new Error("gh failed", { cause: error }));
        else resolve(stdout);
      });
    });
}

interface GhFileRow {
  filename: string;
  previous_filename?: string | null;
}

/** Per-PR facts via the same gh reads the batch-merge script uses; any failure makes the PR unreadable, never partial. */
async function readFacts(
  repo: string,
  pr: DashboardOutstandingPullRequest,
  runGh: NextStepsReaders["runGh"]
): Promise<NextStepsPr> {
  const base: NextStepsPr = {
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
    checks: pr.checks.map((check) => ({ name: check.name, conclusion: check.conclusion })),
    requiredChecks: [],
    mergeStateStatus: pr.mergeStateStatus
  };
  try {
    const view = JSON.parse(await runGh(["pr", "view", String(pr.number), "--repo", repo, "--json", "headRefOid,reviews"])) as {
      headRefOid?: string;
      reviews?: Array<{ state?: string; author?: { login?: string } | null; commit?: { oid?: string } | null }>;
    };
    const meta = JSON.parse(await runGh(["api", `repos/${repo}/pulls/${pr.number}`])) as { changed_files?: number };
    const pages = JSON.parse(await runGh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/files`])) as GhFileRow[][];
    const required = JSON.parse(await runGh(["pr", "checks", String(pr.number), "--repo", repo, "--required", "--json", "name"])) as Array<{ name: string }>;
    return {
      ...base,
      headSha: typeof view.headRefOid === "string" ? view.headRefOid : "",
      files: pages.flat().map((row) => ({ filename: row.filename, previous_filename: row.previous_filename ?? null })),
      changedFiles: typeof meta.changed_files === "number" ? meta.changed_files : null,
      reviews: (view.reviews ?? []).map((review) => ({
        verdict: review.state ?? "",
        headSha: review.commit?.oid ?? "",
        author: review.author?.login ?? null
      })),
      requiredChecks: required.map((check) => check.name)
    };
  } catch {
    return { ...base, unreadable: "gh read failed" };
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
 * nothing. A source that cannot be read is named in `unavailable`; nothing is then claimed to be moving.
 */
export async function loadNextSteps(readers: NextStepsReaders, options: { repo?: string; cap?: number } = {}): Promise<NextStepsResponse> {
  const repo = options.repo ?? DEFAULT_CARD_REPO;
  const unavailable: NextStepsSource[] = [];
  let prs: NextStepsPr[] = [];
  let otherRepositories = 0;
  let inventoryStale = false;
  let queue: NextStepsQueue | null = null;
  let decisionToAction = new Map<string, string>();
  let cards: NextStepsCard[] = [];

  try {
    const inventory = await readers.readInventory();
    inventoryStale = inventory.stale;
    const mine = inventory.pullRequests.filter((pr) => pr.repository.trim().toLowerCase() === repo.toLowerCase());
    otherRepositories = inventory.pullRequests.length - mine.length;
    prs = await mapLimited(mine, CONCURRENCY, (pr) => readFacts(repo, pr, readers.runGh));
  } catch {
    unavailable.push("pull_requests");
  }

  try {
    const derived = queueFacts(await readers.readQueue());
    queue = derived.facts;
    decisionToAction = derived.decisionToAction;
  } catch {
    unavailable.push("queue");
  }

  try {
    const loaded = await readers.readCards();
    cards = loaded.cards.map((card) => {
      const target = loaded.targets.get(card.id);
      const unblocks = target?.kind === "decision" ? decisionToAction.get(`${target.projectSlug}/${target.decisionId}`) ?? null : null;
      return { id: card.id, verb: card.verb, kind: card.kind, what: card.what, unblocksActionId: unblocks };
    });
  } catch {
    unavailable.push("cards");
  }

  const result = buildNextSteps({ prs, queue, cards, repo, cap: options.cap });
  // An unreadable source means an unknown touch may be missing: never say production is moving then.
  const moving = result.moving && unavailable.length === 0;
  return { ...result, moving, unavailable, otherRepositories, inventoryStale, repo };
}
