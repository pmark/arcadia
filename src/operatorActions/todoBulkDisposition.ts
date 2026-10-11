import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentAskRejections } from "./libraryContract.js";

/**
 * The /todo bulk disposition the operator accepted on 2026-10-10 (Ask "Dismiss
 * 286 superseded/off-path items", settlement
 * dashboard-approve-agentask_0e5f4be24acb0e6e21-1791667137632). Pure planning
 * and decision logic for `scripts/apply-todo-bulk-disposition.ts`: it reads
 * nothing and writes nothing. Every pin below is checked again at run time.
 */
export const TODO_BULK_DISPOSITION_20261010 = {
  manifestPath: "docs/reports/todo-bulk-disposition-2026-10-10.json",
  sha256: "813e83eaa4068a86b2bf1a5c088938c293e0bdf4aacfd500450fa418556916a4",
  settlementRequestIdPrefix: "bulk-20261010-",
  /** Classes the operator accepted for bulk disposition; class a and d stay. */
  bulkClasses: ["b", "c", "e"] as const,
  /** The 8 rehearsal fixture Projects marked completed, pinned by id and slug. */
  fixtureProjects: [
    { id: "proj_f9af573185984c4bb1", slug: "three-action-rehearsal" },
    { id: "proj_6f9a48901eb64a849f", slug: "two-action-rehearsal" },
    { id: "proj_9492782cef794dda9d", slug: "two-action-rehearsal-v2" },
    { id: "proj_bf52c629aa384f8493", slug: "two-action-rehearsal-v3" },
    { id: "proj_fbdbf9d73b2b40d79b", slug: "two-action-rehearsal-v4" },
    { id: "proj_f9ccab08c6ad4d4298", slug: "two-action-rehearsal-v5" },
    { id: "proj_9f837e5188534af2b3", slug: "two-action-rehearsal-v6" },
    { id: "proj_fc0a2c56e3e7424c84", slug: "zero-prompt-rehearsal" }
  ],
  /** Never settled, rejected or edited, whatever any list says. */
  neverTouch: {
    proposals: [
      "agentask_951cb38647e2635013", // pr-opened-arcadia-pr1212
      "agentask_a407e984e2dababe54"  // pr-opened-arcadia-pr1033
    ],
    reviewItems: [
      "review_c1cc2f67b165454dab", // R366 (fixture; stays unapproved)
      "review_af4fe69f0faf47ad9b"  // R368 (fixture; stays unapproved)
    ]
  }
} as const;

export interface ManifestItem {
  key: string;
  project: string;
  cls: string;
  writer?: { agent_ask?: string; review_item?: string } | null;
}
export interface DispositionManifest {
  schema: string;
  id: string;
  fixtureProjects: string[];
  items: ManifestItem[];
}
export interface PlannedAsk { proposalId: string; key: string; project: string; settlementRequestId: string }
export interface PlannedReview { reviewItemId: string; key: string; project: string }
export interface DispositionPlan {
  asks: PlannedAsk[];
  /** In the accepted list but outside the declared rejection scope: cross-repo, left for their own repositories. */
  crossRepoSkips: PlannedAsk[];
  reviews: PlannedReview[];
  projects: ReadonlyArray<{ id: string; slug: string }>;
}

export class DispositionRefusal extends Error {
  constructor(public reason: string, message: string) { super(message); }
}
const refuse = (reason: string, message: string): never => { throw new DispositionRefusal(reason, message); };

export function sha256Hex(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Verify the manifest bytes against the pins and the descriptor's declared
 * rejection scope, then derive exactly what may be applied. Refuses on any
 * drift instead of guessing.
 */
export function buildDispositionPlan(manifestText: string, declared: AgentAskRejections): DispositionPlan {
  const pins = TODO_BULK_DISPOSITION_20261010;
  const digest = sha256Hex(manifestText);
  if (digest !== pins.sha256) refuse("MANIFEST_SHA256_MISMATCH", `Manifest sha256 ${digest} is not the accepted ${pins.sha256}.`);
  if (declared.sha256 !== pins.sha256 || declared.manifest !== pins.manifestPath) {
    refuse("DESCRIPTOR_SCOPE_MISMATCH", "The descriptor's declared manifest or sha256 differs from the accepted list.");
  }
  const manifest = JSON.parse(manifestText) as DispositionManifest;
  if (manifest.schema !== "arcadia-todo-bulk-disposition-v1" || !Array.isArray(manifest.items)) {
    refuse("MANIFEST_SHAPE", "Manifest is not an arcadia-todo-bulk-disposition-v1 list.");
  }
  const bulk = manifest.items.filter((item) => (pins.bulkClasses as readonly string[]).includes(item.cls));
  const askItems = new Map<string, ManifestItem>();
  for (const item of bulk) {
    const id = item.writer?.agent_ask;
    if (id) askItems.set(id, item);
  }
  const declaredSet = new Set(declared.proposals);
  const outside = declared.proposals.filter((id) => !askItems.has(id));
  if (outside.length > 0) refuse("DESCRIPTOR_SCOPE_MISMATCH", `The descriptor declares ${outside.length} proposal(s) the accepted list does not reject: ${outside.slice(0, 5).join(", ")}.`);
  const touched = [...pins.neverTouch.proposals].filter((id) => declaredSet.has(id) || askItems.has(id));
  if (touched.length > 0) refuse("NEVER_TOUCH_IN_SCOPE", `Protected proposal(s) appear in the scope: ${touched.join(", ")}.`);

  const toPlanned = (id: string, item: ManifestItem): PlannedAsk =>
    ({ proposalId: id, key: item.key, project: item.project, settlementRequestId: `${pins.settlementRequestIdPrefix}${id}` });
  const asks: PlannedAsk[] = [];
  const crossRepoSkips: PlannedAsk[] = [];
  for (const [id, item] of askItems) {
    if (declaredSet.has(id)) asks.push(toPlanned(id, item));
    else if (item.project === "arcadia") refuse("DESCRIPTOR_SCOPE_MISMATCH", `Arcadia proposal ${id} is in the accepted list but not declared; only cross-repo items may be left out.`);
    else crossRepoSkips.push(toPlanned(id, item));
  }
  const reviews: PlannedReview[] = bulk.flatMap((item) => item.writer?.review_item
    ? [{ reviewItemId: item.writer.review_item, key: item.key, project: item.project }] : []);
  const protectedReviews = reviews.filter((review) => (pins.neverTouch.reviewItems as readonly string[]).includes(review.reviewItemId));
  if (protectedReviews.length > 0) refuse("NEVER_TOUCH_IN_SCOPE", `Protected review item(s) appear in the list: ${protectedReviews.map((r) => r.reviewItemId).join(", ")}.`);
  const slugs = pins.fixtureProjects.map((p) => p.slug);
  if (!Array.isArray(manifest.fixtureProjects) || [...manifest.fixtureProjects].sort().join(",") !== [...slugs].sort().join(",")) {
    refuse("FIXTURE_PROJECTS_MISMATCH", "The manifest's fixture Projects differ from the pinned eight.");
  }
  return { asks, crossRepoSkips, reviews, projects: pins.fixtureProjects };
}

export interface ProjectRow { id: string; slug: string | null; status: string; repo_path: string | null }
export type Decision = { act: true; note: string } | { act: false; note: string; failed?: boolean };

/** A fixture Project is completed only when it is still exactly the pinned rehearsal fixture. */
export function decideProject(pinned: { id: string; slug: string }, row: ProjectRow | undefined, home: string): Decision {
  if (!row) return { act: false, failed: true, note: "missing from the workspace" };
  if (row.slug !== pinned.slug) return { act: false, failed: true, note: `slug is ${row.slug ?? "null"}, not ${pinned.slug}` };
  const expectedRepo = path.join(home, "tmp", `arcadia-${pinned.slug}`);
  if (!row.repo_path || path.resolve(row.repo_path) !== expectedRepo || !pinned.slug.includes("rehearsal")) {
    return { act: false, failed: true, note: `repo_path ${row.repo_path ?? "null"} is not the disposable fixture ${expectedRepo}` };
  }
  if (row.status === "completed") return { act: false, note: "already completed" };
  return { act: true, note: `${row.status} -> completed` };
}

export function decideReview(status: string | undefined): Decision {
  if (status === undefined) return { act: false, note: "missing from the workspace" };
  if (status === "open" || status === "deferred") return { act: true, note: `${status} -> rejected` };
  return { act: false, note: `already ${status}` };
}

export interface ExistingSettlement { requestId: string; disposition: string }
export function decideAsk(planned: PlannedAsk, exists: boolean, settled: ExistingSettlement | undefined): Decision {
  if (!exists) return { act: false, note: "proposal missing from the workspace" };
  if (settled) {
    return settled.requestId === planned.settlementRequestId
      ? { act: false, note: "already rejected by this list (resumed)" }
      : { act: false, note: `already settled (${settled.disposition}) by ${settled.requestId}` };
  }
  return { act: true, note: "pending -> rejected" };
}

/**
 * A rejection archives a drafted Ask file when one exists. For Arcadia the
 * settlement runs from the fresh archive worktree, so any file it writes lands
 * there; for another repository it would land on that repository's own
 * checkout, so such an item is skipped and reported instead.
 */
export function previewTouchesOtherCheckout(project: string, documents: ReadonlyArray<{ path: string }>): boolean {
  return project !== "arcadia" && documents.length > 0;
}
