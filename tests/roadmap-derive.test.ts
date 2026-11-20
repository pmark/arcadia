import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveRoadmap, parseRoadmapOrder, roadmapFingerprint } from "../src/roadmap/derive.js";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function plan(slug: string, statuses: string[], extra = ""): string {
  const actions = statuses
    .map((status, i) => `  - id: a${i}\n    title: Action ${i}\n    status: ${status}\n    responsibility: agent\n    execution: build\n    effort: session\n    next_action: Do a${i} with a concrete verb.\n    expected_artifact: Evidence a${i}\n    clarification: clarified\n    confidence: high\n    source: test\n    acceptance_criteria:\n      - A test shows the recorded count equals 3 and a refusal is returned.\n    depends_on: []\n    decisions: []`)
    .join("\n");
  return `---\narcadia: v1\ntype: plan\nslug: ${slug}\nproject: demo\nstatus: draft\nmilestone: "Checkpoint for ${slug}"\ntoken_impact: small\ntoken_budget: Deterministic.\nupdated: 2026-11-19\nactions:\n${actions}\n${extra}---\n\nBody.\n`;
}

const ROADMAP = `# Roadmap

## Plan order (operator direction)

1. **F**, \`plan-f\`: keep the loop alive.
2. **G**, \`plan-g\`: the surface.
3. **H**, \`plan-h\`: hosted <b>coordinators</b>.
4. **Later.** Each item has a revival trigger:
   - Creating Plans in the Workspace: when G is done.
   - Per-project queues.

## Capability map
`;

function makeRepo(options: { skipPlanH?: boolean; badNorthStar?: boolean } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "roadmap-"));
  roots.push(root);
  mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  writeFileSync(
    path.join(root, "PROJECT.md"),
    `---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: A goal.\nactive_plan: plan-f\nupdated: 2026-11-19\ncurrent_action: a1\n---\n\n# Demo\n`
  );
  writeFileSync(path.join(root, "docs", "roadmap.md"), ROADMAP);
  writeFileSync(path.join(root, "docs", "plans", "plan-f.md"), plan("plan-f", ["done", "done", "open", "in_progress", "deferred"]));
  writeFileSync(path.join(root, "docs", "plans", "plan-g.md"), plan("plan-g", ["open", "open"]));
  if (!options.skipPlanH) writeFileSync(path.join(root, "docs", "plans", "plan-h.md"), plan("plan-h", ["blocked"]));
  writeFileSync(
    path.join(root, "NORTH_STAR.md"),
    options.badNorthStar
      ? "no frontmatter here"
      : `---\ntype: north_star\ntarget: "Ship <script>alert(1)</script> nights"\nproject: demo\nwhy: Because.\nlooks_like: A quiet night.\nupdated: 2026-11-20\ngates:\n  - id: g1\n    title: First gate\n    action: plan/plan-f#a0\n  - id: g2\n    title: Second gate\n    action: plan/plan-f#a2\n  - id: g3\n    title: Third gate\n    action: plan/plan-gone#x\n---\n\n# North Star\n`
  );
  return root;
}

function treeHash(root: string): string {
  const hash = createHash("sha1");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const absolute = path.join(dir, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) walk(absolute);
      else hash.update(`${absolute}\0${stats.size}\0${stats.mtimeMs}\0${readFileSync(absolute, "utf8")}`);
    }
  };
  walk(root);
  return hash.digest("hex");
}

describe("deriveRoadmap", () => {
  it("counts Actions per Plan in the roadmap's order and treats every open Action as not small", () => {
    const view = deriveRoadmap(makeRepo());
    expect(view.warnings).toEqual([]);
    expect(view.sequence.map((s) => [s.letter, s.slug])).toEqual([["F", "plan-f"], ["G", "plan-g"], ["H", "plan-h"]]);
    const f = view.sequence[0];
    expect(f.kind === "plan" && f.counts).toEqual({ done: 2, open: 1, inProgress: 1, blocked: 0, deferred: 1, total: 5 });
    expect(f.kind === "plan" && f.notSmall).toBe(2);
    expect(f.kind === "plan" && f.isActive).toBe(true);
    expect(f.kind === "plan" && f.countsAsOf).toBe("2026-11-19");
    const h = view.sequence[2];
    expect(h.kind === "plan" && h.notSmall).toBe(1);
    expect(view.project).toMatchObject({ slug: "demo", activePlan: "plan-f", currentAction: "a1" });
    expect(view.activePlanOffRoute).toBe(false);
  });

  it("exposes the Plan's milestone string as a checkpoint and records no Milestones", () => {
    const view = deriveRoadmap(makeRepo());
    expect(view.sequence[0].kind === "plan" && view.sequence[0].checkpoint).toBe("Checkpoint for plan-f");
    expect(view.milestones.recorded).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/"nights?"/i);
  });

  it("keeps the North Star as written (text untouched) and derives gates from the named Action", () => {
    const view = deriveRoadmap(makeRepo());
    expect(view.northStar?.target).toBe("Ship <script>alert(1)</script> nights");
    expect(view.northStar?.gates.map((g) => [g.id, g.status])).toEqual([["g1", "done"], ["g2", "open"], ["g3", "unknown"]]);
    expect(view.northStar?.gates[2].basis).toMatch(/could not be read/);
  });

  it("keeps hostile titles as plain strings and lists Later items as fog", () => {
    const view = deriveRoadmap(makeRepo());
    expect(view.sequence[2].description).toBe("hosted <b>coordinators</b>.");
    expect(view.later.map((l) => l.text)).toEqual(["Creating Plans in the Workspace: when G is done.", "Per-project queues."]);
  });

  it("draws a gap and a warning for a Plan it cannot read, and still derives the rest", () => {
    const view = deriveRoadmap(makeRepo({ skipPlanH: true }));
    expect(view.sequence[2].kind).toBe("unreadable");
    expect(view.warnings.some((w) => w.source === "docs/plans/plan-h.md")).toBe(true);
    expect(view.sequence[0].kind).toBe("plan");
  });

  it("reports a malformed North Star and a missing roadmap without throwing", () => {
    const repo = makeRepo({ badNorthStar: true });
    rmSync(path.join(repo, "docs", "roadmap.md"));
    const view = deriveRoadmap(repo);
    expect(view.northStar).toBeNull();
    expect(view.sequence).toEqual([]);
    expect([...new Set(view.warnings.map((w) => w.source))].sort()).toEqual(["NORTH_STAR.md", "docs/roadmap.md"]);
  });

  it("says when the active Plan is not on the route", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "docs", "roadmap.md"), ROADMAP.replace("1. **F**, `plan-f`", "1. **F**, `plan-g`").replace("2. **G**, `plan-g`", "2. **X**, `plan-h`"));
    const view = deriveRoadmap(repo);
    expect(view.activePlanOffRoute).toBe(true);
  });

  it("writes nothing: the repository is byte-identical afterwards", () => {
    const repo = makeRepo();
    const before = treeHash(repo);
    deriveRoadmap(repo);
    roadmapFingerprint(repo);
    expect(treeHash(repo)).toBe(before);
  });

  it("derives from this repository's real records without warnings it cannot explain", () => {
    const view = deriveRoadmap(path.resolve(import.meta.dirname, ".."));
    expect(view.schema).toBe("arcadia-roadmap-v1");
    expect(view.northStar?.target).toBeTruthy();
    expect(view.sequence.length).toBeGreaterThan(0);
  });
});

describe("roadmapFingerprint", () => {
  it("changes when a Plan, the roadmap or the North Star changes, and only then", () => {
    const repo = makeRepo();
    const first = roadmapFingerprint(repo);
    expect(roadmapFingerprint(repo)).toBe(first);
    writeFileSync(path.join(repo, "docs", "plans", "plan-g.md"), plan("plan-g", ["done", "open"]));
    const second = roadmapFingerprint(repo);
    expect(second).not.toBe(first);
    writeFileSync(path.join(repo, "NORTH_STAR.md"), readFileSync(path.join(repo, "NORTH_STAR.md"), "utf8") + "\nmore\n");
    expect(roadmapFingerprint(repo)).not.toBe(second);
  });
});

describe("parseRoadmapOrder", () => {
  it("ignores lists outside Plan order", () => {
    expect(parseRoadmapOrder("## Other\n1. **A**, `x`: y\n").order).toEqual([]);
  });
});

describe("freshness through the dashboard's fingerprint cache", () => {
  it("serves a cached view until a source changes, then shows the change within one check", async () => {
    const { createFingerprintCache } = await import("../apps/dashboard/lib/fingerprint-cache");
    let clock = 1_000_000;
    const repo = makeRepo();
    const cache = createFingerprintCache<string, ReturnType<typeof deriveRoadmap>>({
      name: `roadmap-test-${repo}`,
      keyOf: (key) => key,
      fingerprint: (key) => roadmapFingerprint(key),
      load: (key) => deriveRoadmap(key),
      checkAfterMs: 2_000,
      now: () => clock
    });
    const first = await cache.get(repo);
    expect(first.sequence[1].kind === "plan" && first.sequence[1].counts.done).toBe(0);
    writeFileSync(path.join(repo, "docs", "plans", "plan-g.md"), plan("plan-g", ["done", "open"]));
    expect(await cache.get(repo)).toBe(first); // inside the check window: served from cache
    clock += 2_500;
    await cache.get(repo); // past the window: answers at once, checks behind
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await cache.get(repo);
    expect(second.sequence[1].kind === "plan" && second.sequence[1].counts.done).toBe(1);
    expect((await cache.get(repo, { fresh: true })).sequence[1].kind).toBe("plan");
  });
});
