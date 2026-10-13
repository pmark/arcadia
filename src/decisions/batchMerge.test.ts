import { describe, expect, it } from "vitest";
import {
  buildBatchMergeCard,
  buildBatchMergeDescriptor,
  buildBatchMergePing,
  classifyAuthorityPath,
  classifyAuthorityPaths,
  evaluateBatchMerge,
  orderStack,
  parseBatchMergeRequest,
  requestFromSpec,
  runBatchMerge,
  validateBatchMergeSpec,
  type BatchMergeBuild,
  type BatchMergeGateway,
  type BatchPrFacts,
  type BatchReceipt,
} from "./batchMerge.js";
import { validateOperatorScriptContract } from "../operatorActions/libraryContract.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const EXPIRES = "2026-10-13T12:00:00Z";
const sha = (c: string) => c.repeat(40);

function pr(number: number, over: Partial<BatchPrFacts> = {}): BatchPrFacts {
  const head = sha(String(number % 10));
  return {
    number,
    title: `PR ${number}`,
    headSha: head,
    baseRef: "main",
    headRef: `branch-${number}`,
    files: [`src/feature${number}.ts`],
    why: "Needs the operator.",
    decisions: [],
    reviews: [{ verdict: "APPROVED", headSha: head }],
    checks: [{ name: "ci", conclusion: "SUCCESS" }],
    requiredChecks: ["ci"],
    state: "open",
    ...over,
  };
}

function build(prs: BatchPrFacts[]): Extract<BatchMergeBuild, { ok: true }> {
  const r = buildBatchMergeCard({ prs, now: NOW, expires: EXPIRES });
  if (!r.ok) throw new Error(`build refused: ${r.refusal.code}`);
  return r;
}

// Fixture: #3 stacks on #2, #2 stacks on #1; #4 is independent. Listed out of order on purpose.
const STACK = () => [
  pr(3, { baseRef: "branch-2" }),
  pr(4),
  pr(1),
  pr(2, { baseRef: "branch-1" }),
];

function liveOf(prs: BatchPrFacts[]): Map<number, BatchPrFacts> {
  return new Map(prs.map((p) => [p.number, { ...p }]));
}

function gatewayOf(prs: BatchPrFacts[], opts: { failOn?: number } = {}) {
  const live = liveOf(prs);
  const receipts = new Map<string, BatchReceipt>();
  const merged: number[] = [];
  const gateway: BatchMergeGateway = {
    readPr: (n) => live.get(n) ?? null,
    readReceipt: (c, n) => receipts.get(`${c}:${n}`) ?? null,
    writeReceipt: (r) => {
      const key = `${r.cardId}:${r.number}`;
      if (receipts.get(key)?.outcome === "merged") return;
      receipts.set(key, r);
    },
    merge: (n, head) => {
      if (opts.failOn === n) throw new Error("host failure");
      const p = live.get(n)!;
      if (p.headSha !== head) throw new Error("head mismatch");
      p.state = "merged";
      p.mergedHeadSha = head;
      merged.push(n);
    },
  };
  return { gateway, live, receipts, merged };
}

describe("authority classifier (acceptance 1)", () => {
  const cases: Array<[string, string]> = [
    ["PROJECT.md", "project_governance"],
    ["./PROJECT.md", "project_governance"],
    ["CONSTITUTION.md", "project_governance"],
    ["docs/decisions/0100-x.md", "decisions"],
    [".GitHub/workflows/ci.yml", "ci_and_gates"],
    [".github\\workflows\\ci.yml", "ci_and_gates"],
    ["src/production/policy.ts", "production_policy"],
    ["SRC/Production/x.ts", "production_policy"],
    ["apps/dashboard/app/api/blocker-clear/route.ts", "dashboard_api_route"],
    [".arcadia/context-policy.json", "arcadia_control_state"],
    [".claude/settings.json", "agent_permissions"],
    ["config/allow-rules.json", "agent_permissions"],
    ["config/permissions.yaml", "agent_permissions"],
    ["src/decisions/card.ts", "operator_authority"],
    ["src/foo/../production/x.ts", "unclassifiable_path"],
    ["../PROJECT.md", "unclassifiable_path"],
    ["src/ production/x.ts", "unclassifiable_path"],
    ["src/production /x.ts", "unclassifiable_path"],
    ["/etc/passwd", "unclassifiable_path"],
    ["C:\\x\\PROJECT.md", "unclassifiable_path"],
    ["src/ρroduction/x.ts", "unclassifiable_path"],
    ["PROJECT.md.", "unclassifiable_path"],
    ["src/a\u0000b.ts", "unclassifiable_path"],
    ["", "unclassifiable_path"],
  ];
  it.each(cases)("classifies %j as %s", (path, boundary) => {
    expect(classifyAuthorityPath(path)).toContain(boundary);
  });
  it("folds fullwidth lookalikes through NFKC", () => {
    expect(classifyAuthorityPath("ＰＲＯＪＥＣＴ.md")).toContain("project_governance");
  });
  it("leaves an ordinary path unclassified and an empty list unclassifiable", () => {
    expect(classifyAuthorityPath("src/feature1.ts")).toEqual([]);
    expect(classifyAuthorityPaths([])).toEqual(["unclassifiable_path"]);
    expect(classifyAuthorityPaths(null)).toEqual(["unclassifiable_path"]);
    expect(classifyAuthorityPath(42)).toEqual(["unclassifiable_path"]);
  });
});

describe("card build and stack order (acceptance 1)", () => {
  it("orders stacked PRs base first and validates as a merge card", () => {
    const b = build(STACK());
    expect(b.items.map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(b.card.verb).toBe("merge");
    expect(b.card.id).toBe(b.spec.cardId);
    expect(b.items[0].consequence).toMatch(/Merges #1 at head/);
    expect(b.items.every((i) => i.reviewVerdict === "approved" && i.checks.length === 1)).toBe(true);
  });
  it("says so on the card when a PR touches an authority boundary and pins it", () => {
    const b = build([pr(1, { files: ["PROJECT.md", ".github/workflows/ci.yml"] })]);
    expect(b.items[0].boundaries).toEqual(["project_governance", "ci_and_gates"]);
    expect(b.items[0].boundarySummary).toMatch(/authority boundary/);
    expect(b.card.what).toMatch(/authority boundaries/);
    expect(b.spec.prs[0].acknowledgedBoundaries).toEqual(["project_governance", "ci_and_gates"]);
  });
  const refused = (prs: BatchPrFacts[]) => {
    const r = buildBatchMergeCard({ prs, now: NOW, expires: EXPIRES });
    return r.ok ? "ok" : r.refusal.code;
  };
  it("refuses an empty batch", () => expect(refused([])).toBe("empty_batch"));
  it("refuses duplicate PR numbers", () => expect(refused([pr(1), pr(1)])).toBe("duplicate_pr"));
  it("refuses a base PR missing from the batch", () =>
    expect(refused([pr(2, { baseRef: "branch-1" })])).toBe("base_pr_missing"));
  it("refuses a self-parent and a cycle", () => {
    expect(refused([pr(1, { baseRef: "branch-1" })])).toBe("stack_cycle");
    expect(refused([pr(1, { baseRef: "branch-2" }), pr(2, { baseRef: "branch-1" })])).toBe("stack_cycle");
  });
  it.each([
    ["uppercase", "A".repeat(40)],
    ["short", "abc1234"],
    ["padded", ` ${"a".repeat(40)}`],
    ["non-hex", "g".repeat(40)],
    ["39 chars", "a".repeat(39)],
    ["41 chars", "a".repeat(41)],
  ])("refuses a %s head sha at build", (_n, head) => {
    expect(refused([pr(1, { headSha: head })])).toBe("bad_head_sha");
  });
  it("does not build a card for a PR that is not ready", () => {
    expect(refused([pr(1, { reviews: [] })])).toBe("review_missing");
    expect(refused([pr(1, { checks: [] })])).toBe("check_not_green");
  });
  it("orderStack reports cycles, self-parent and missing bases", () => {
    expect(orderStack([{ number: 1, parent: 1 }])).toMatchObject({ ok: false, code: "stack_cycle" });
    expect(orderStack([{ number: 2, parent: 9 }])).toMatchObject({ ok: false, code: "base_pr_missing" });
    expect(orderStack([{ number: 1, parent: null }, { number: 1, parent: null }])).toMatchObject({ ok: false, code: "duplicate_pr" });
  });
});

describe("button payload (acceptance 2)", () => {
  const b = build(STACK());
  const good = () => requestFromSpec(b.spec);
  it("is exactly the card id and the pinned heads", () => {
    const r = parseBatchMergeRequest(good());
    expect(r.ok).toBe(true);
    expect(Object.keys(good()).sort()).toEqual(["cardId", "heads"]);
  });
  it("refuses extra keys, getters and non-plain data", () => {
    expect(parseBatchMergeRequest({ ...good(), merge: true }).ok).toBe(false);
    expect(parseBatchMergeRequest({ cardId: b.spec.cardId, heads: [{ number: 1, headSha: sha("1"), force: 1 }] }).ok).toBe(false);
    const getter = { cardId: b.spec.cardId };
    Object.defineProperty(getter, "heads", { enumerable: true, get: () => good().heads });
    expect(parseBatchMergeRequest(getter).ok).toBe(false);
    expect(parseBatchMergeRequest(null).ok).toBe(false);
    expect(parseBatchMergeRequest([]).ok).toBe(false);
  });
  it("refuses empty, duplicate, and bad shas", () => {
    const code = (v: unknown) => {
      const r = parseBatchMergeRequest(v);
      return r.ok ? "ok" : r.refusal.code;
    };
    expect(code({ cardId: b.spec.cardId, heads: [] })).toBe("empty_batch");
    expect(code({ cardId: b.spec.cardId, heads: [{ number: 1, headSha: sha("1") }, { number: 1, headSha: sha("1") }] })).toBe("duplicate_pr");
    expect(code({ cardId: b.spec.cardId, heads: [{ number: 1, headSha: sha("A") }] })).toBe("bad_head_sha");
    expect(code({ cardId: b.spec.cardId, heads: [{ number: 1, headSha: "abc" }] })).toBe("bad_head_sha");
    expect(code({ cardId: "nope", heads: [{ number: 1, headSha: sha("1") }] })).toBe("invalid_request");
  });
});

describe("evaluation refuses the whole batch (acceptance 2)", () => {
  const prs = STACK();
  const b = build(prs);
  const codes = (live: Map<number, BatchPrFacts>, req: unknown = requestFromSpec(b.spec)) => {
    const e = evaluateBatchMerge(b.spec, req, live);
    return e.ok ? ["ok"] : e.refusals.map((r) => r.code);
  };
  it("accepts a clean batch in stack order", () => {
    const e = evaluateBatchMerge(b.spec, requestFromSpec(b.spec), liveOf(prs));
    expect(e).toEqual({ ok: true, order: [1, 2, 3, 4], toMerge: [1, 2, 3, 4], alreadyMerged: [] });
  });
  it("refuses a stale head on one PR and names it", () => {
    const live = liveOf(prs);
    live.get(2)!.headSha = sha("f");
    const e = evaluateBatchMerge(b.spec, requestFromSpec(b.spec), live);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.refusals).toContainEqual(expect.objectContaining({ code: "head_moved", number: 2 }));
  });
  it("refuses a card id mismatch and a request set mismatch", () => {
    const req = requestFromSpec(b.spec);
    expect(codes(liveOf(prs), { ...req, cardId: "batch-merge-" + "0".repeat(24) })).toContain("card_id_mismatch");
    expect(codes(liveOf(prs), { ...req, heads: req.heads.slice(1) })).toContain("request_set_mismatch");
    const wrongHead = { ...req, heads: req.heads.map((h) => (h.number === 1 ? { ...h, headSha: sha("e") } : h)) };
    expect(codes(liveOf(prs), wrongHead)).toContain("head_moved");
  });
  it("treats a missing, unknown or failing check as not green", () => {
    for (const conclusion of [undefined, null, "", "UNKNOWN", "PENDING", "FAILURE", "NEUTRAL", "success-ish"]) {
      const live = liveOf(prs);
      live.get(1)!.checks = [{ name: "ci", conclusion }];
      expect(codes(live)).toContain("check_not_green");
    }
    const live = liveOf(prs);
    live.get(1)!.checks = [];
    expect(codes(live)).toContain("check_not_green");
    const dup = liveOf(prs);
    dup.get(1)!.checks = [{ name: "ci", conclusion: "SUCCESS" }, { name: "ci", conclusion: "FAILURE" }];
    expect(codes(dup)).toContain("check_not_green");
    const none = liveOf(prs);
    none.get(1)!.requiredChecks = [];
    expect(codes(none)).toContain("no_required_checks");
  });
  it("distinguishes a missing review, a stale-head review and a non-approval", () => {
    const missing = liveOf(prs);
    missing.get(3)!.reviews = [];
    expect(codes(missing)).toContain("review_missing");
    const stale = liveOf(prs);
    stale.get(3)!.reviews = [{ verdict: "APPROVED", headSha: sha("9") }];
    expect(codes(stale)).toContain("review_stale_head");
    const changes = liveOf(prs);
    changes.get(3)!.reviews = [{ verdict: "APPROVED", headSha: sha("3") }, { verdict: "CHANGES_REQUESTED", headSha: sha("3") }];
    expect(codes(changes)).toContain("review_not_approved");
  });
  it("refuses an unreadable or closed PR and a changed stack", () => {
    const gone = liveOf(prs);
    gone.delete(4);
    expect(codes(gone)).toContain("pr_unreadable");
    const closed = liveOf(prs);
    closed.get(4)!.state = "closed";
    expect(codes(closed)).toContain("pr_closed_unmerged");
    const moved = liveOf(prs);
    moved.get(3)!.baseRef = "main";
    expect(codes(moved)).toContain("stack_changed");
  });
  it("refuses a PR whose live diff gained an authority boundary not on the card", () => {
    const live = liveOf(prs);
    live.get(4)!.files = ["src/feature4.ts", "PROJECT.md"];
    expect(codes(live)).toContain("authority_boundary_not_acknowledged");
    const traversal = liveOf(prs);
    traversal.get(4)!.files = ["src/../PROJECT.md"];
    expect(codes(traversal)).toContain("authority_boundary_not_acknowledged");
  });
  it("accepts an authority PR only when the card was pinned with it listed", () => {
    const pinned = build([pr(1, { files: ["PROJECT.md"] })]);
    const live = liveOf([pr(1, { files: ["PROJECT.md"] })]);
    expect(evaluateBatchMerge(pinned.spec, requestFromSpec(pinned.spec), live).ok).toBe(true);
    const unpinned = build([pr(1)]);
    const e = evaluateBatchMerge(unpinned.spec, requestFromSpec(unpinned.spec), live);
    expect(e.ok).toBe(false);
  });
  it("rejects a spec whose id or stack was tampered", () => {
    const tampered = { ...b.spec, prs: b.spec.prs.map((p) => (p.number === 4 ? { ...p, headSha: sha("a") } : p)) };
    expect(validateBatchMergeSpec(tampered)).toMatchObject({ ok: false, refusal: { code: "card_id_mismatch" } });
    const cyc = { ...b.spec, prs: b.spec.prs.map((p) => (p.number === 1 ? { ...p, parent: 3 } : p)) };
    expect(validateBatchMergeSpec(cyc).ok).toBe(false);
    expect(validateBatchMergeSpec({ ...b.spec, prs: [] })).toMatchObject({ ok: false, refusal: { code: "empty_batch" } });
  });
  it("reads a flipping getter once", () => {
    const live = liveOf(prs);
    let reads = 0;
    const flipper = live.get(1)!;
    Object.defineProperty(flipper, "headSha", {
      enumerable: true,
      get: () => (reads++ === 0 ? sha("1") : sha("f")),
    });
    const e = evaluateBatchMerge(b.spec, requestFromSpec(b.spec), live);
    expect(reads).toBe(1);
    // The single read is what was compared; the later value was never consulted.
    expect(e.ok).toBe(true);
  });
});

describe("operator-script run (acceptance 3)", () => {
  it("merges in stack order and writes one merged receipt per PR", () => {
    const prs = STACK();
    const b = build(prs);
    const g = gatewayOf(prs);
    const r = runBatchMerge(b.spec, requestFromSpec(b.spec), g.gateway, NOW);
    expect(r.outcome).toBe("merged");
    expect(g.merged).toEqual([1, 2, 3, 4]);
    expect(r.receipts).toHaveLength(4);
    expect(r.receipts.every((x) => x.outcome === "merged" && x.cardId === b.spec.cardId && x.schema === "arcadia-batch-merge-receipt-v1")).toBe(true);
    expect(r.receipts.map((x) => x.headSha)).toEqual([sha("1"), sha("2"), sha("3"), sha("4")]);
  });
  it("one refusal merges none and writes a refused receipt per PR", () => {
    const prs = STACK();
    const b = build(prs);
    const g = gatewayOf(prs);
    g.live.get(3)!.headSha = sha("f");
    const r = runBatchMerge(b.spec, requestFromSpec(b.spec), g.gateway, NOW);
    expect(r.outcome).toBe("refused");
    expect(g.merged).toEqual([]);
    expect(r.receipts).toHaveLength(4);
    expect(r.receipts.every((x) => x.outcome === "refused" && /head_moved/.test(x.reason ?? ""))).toBe(true);
  });
  it("is idempotent after a partial merge and never re-merges", () => {
    const prs = STACK();
    const b = build(prs);
    const g = gatewayOf(prs, { failOn: 3 });
    const first = runBatchMerge(b.spec, requestFromSpec(b.spec), g.gateway, NOW);
    expect(first.outcome).toBe("failed");
    expect(g.merged).toEqual([1, 2]);
    expect(first.receipts.map((x) => `${x.number}:${x.outcome}`)).toEqual(["1:merged", "2:merged", "3:failed", "4:not_attempted"]);
    const healed = gatewayOf(prs);
    // Rerun on the same host state with the failure cleared.
    for (const [n, p] of g.live) healed.live.set(n, p);
    for (const [k, v] of g.receipts) healed.receipts.set(k, v);
    const second = runBatchMerge(b.spec, requestFromSpec(b.spec), healed.gateway, NOW);
    expect(second.outcome).toBe("merged");
    expect(healed.merged).toEqual([3, 4]);
    expect(second.alreadyMerged).toEqual([1, 2]);
    const third = runBatchMerge(b.spec, requestFromSpec(b.spec), healed.gateway, NOW);
    expect(third.outcome).toBe("nothing_to_merge");
    expect(healed.merged).toEqual([3, 4]);
    expect(healed.receipts.get(`${b.spec.cardId}:1`)!.outcome).toBe("merged");
  });
  it("refuses a PR merged at another head or a merged receipt the host contradicts", () => {
    const prs = STACK();
    const b = build(prs);
    const g = gatewayOf(prs);
    g.live.get(1)!.state = "merged";
    g.live.get(1)!.mergedHeadSha = sha("e");
    expect(runBatchMerge(b.spec, requestFromSpec(b.spec), g.gateway, NOW).refusals[0].code).toBe("merged_at_other_head");
    const h = gatewayOf(prs);
    h.receipts.set(`${b.spec.cardId}:2`, { schema: "arcadia-batch-merge-receipt-v1", cardId: b.spec.cardId, number: 2, headSha: sha("2"), outcome: "merged", reason: null, at: NOW.toISOString() });
    expect(runBatchMerge(b.spec, requestFromSpec(b.spec), h.gateway, NOW).refusals[0].code).toBe("receipt_conflict");
    expect(h.merged).toEqual([]);
  });
  it("refuses an authority-boundary PR the card was not pinned with", () => {
    const prs = STACK();
    const b = build(prs);
    const g = gatewayOf(prs);
    g.live.get(2)!.files = ["docs/decisions/0001.md"];
    const r = runBatchMerge(b.spec, requestFromSpec(b.spec), g.gateway, NOW);
    expect(r.outcome).toBe("refused");
    expect(r.refusals[0].code).toBe("authority_boundary_not_acknowledged");
    expect(g.merged).toEqual([]);
  });
  it("publishes a descriptor the operator-script contract accepts and that pins every head", () => {
    const b = build(STACK());
    const d = buildBatchMergeDescriptor(b.spec, b.items);
    const parsed = validateOperatorScriptContract(d, b.spec.cardId, "#!/usr/bin/env bash\n");
    expect(parsed.id).toBe(b.spec.cardId);
    for (const p of b.spec.prs) expect(JSON.stringify(d)).toContain(p.headSha);
    expect(validateBatchMergeSpec((d as { batchMerge: unknown }).batchMerge).ok).toBe(true);
  });
});

describe("pending-batch ping (acceptance 4)", () => {
  const b = build(STACK());
  it("links the card and states the count", () => {
    const r = buildBatchMergePing(b.card, b.spec, "https://dash.example.ts.net");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ping.message).toMatch(/^4 PRs await your merge/);
      expect(r.ping.link).toBe(`https://dash.example.ts.net/todo?card=${b.card.id}`);
      expect(r.ping.kind).toBe("attention");
    }
  });
  it("refuses a bad base and a mismatched card", () => {
    expect(buildBatchMergePing(b.card, b.spec, "javascript:alert(1)").ok).toBe(false);
    expect(buildBatchMergePing(b.card, b.spec, "https://x.test/?a=b").ok).toBe(false);
    const other = build([pr(9)]);
    expect(buildBatchMergePing(b.card, other.spec, "https://x.test").ok).toBe(false);
  });
});
