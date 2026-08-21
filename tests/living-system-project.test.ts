import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseLivingSystemManifest } from "../src/livingSystem/contract.js";
import {
  applyLivingSystemProjection,
  previewLivingSystemProjection
} from "../src/livingSystem/project.js";
import type {
  LivingSystemEpisode,
  LivingSystemModel,
  LivingSystemSignal,
  LivingSystemSourceReceipt
} from "../src/livingSystem/types.js";

const FIXTURES = path.resolve("tests/fixtures/living-system");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("living-system Obsidian projection", () => {
  it("previews then writes the complete cross-linked Arcadia story and valid Canvas", () => {
    const vault = temporary("arcadia-living-vault-");
    mkdirSync(path.join(vault, ".obsidian"));
    const model = modelFor("arcadia");
    const input = projectionInput(vault, "arcadia", model);

    const preview = previewLivingSystemProjection(input);
    expect(preview.applied).toBe(false);
    expect(preview.counts.created).toBe(12);
    expect(readdirSync(vault)).toEqual([".obsidian"]);
    expect(preview.entries.every((entry) => entry.path.startsWith("Projects/arcadia/"))).toBe(true);

    const applied = applyLivingSystemProjection(input);
    expect(applied.counts).toEqual(preview.counts);
    const root = path.join(vault, "Projects", "arcadia");
    expect(projectFiles(root).map((file) => path.relative(root, file).split(path.sep).join("/"))).toEqual(expect.arrayContaining([
      "Home.md",
      "README.md",
      "Maps/00_Capability_Map.md",
      "Maps/View_operator-loop.md",
      "Maps/View_whole-system.md",
      "Timeline/00_Project_Evolution.md",
      "Timeline/Current_Work.md",
      "Topics/capture.md",
      "Episodes/main--clarify.md",
      "Living_System.canvas"
    ]));
    const home = readFileSync(path.join(root, "Home.md"), "utf8");
    expect(home).toContain("Turn stated outcomes into governed, evidence-backed progress.");
    expect(home).toContain("[[Episodes/main--clarify|Clarify the next Action]]");
    expect(home).toContain("[[Topics/clarification|Clarify the next Action]] _observed_");
    expect(home).toContain("## Choose your depth");
    const topic = readFileSync(path.join(root, "Topics", "clarification.md"), "utf8");
    const episode = readFileSync(path.join(root, "Episodes", "main--clarify.md"), "utf8");
    expect(topic).toContain("[[Episodes/main--clarify|Clarify the next Action]]");
    expect(topic).toContain("file://");
    expect(episode).toContain("[[Topics/clarification|Clarify the next Action]]");
    expect(episode).toContain("**Observed**");
    expect(episode).toContain("**Current**");

    const canvas = JSON.parse(readFileSync(path.join(root, "Living_System.canvas"), "utf8")) as any;
    expect(canvas.nodes.map((node: any) => node.file)).toEqual([
      "Maps/00_Capability_Map.md",
      "Timeline/00_Project_Evolution.md",
      "Timeline/Current_Work.md"
    ]);
    expect(canvas.edges).toHaveLength(2);
    expect(canvas.arcadiaLivingSystem).toMatchObject({ version: "v1", project: "arcadia" });
    expect(resolveWikiLinks(root)).toEqual([]);
    expect(projectFiles(root).some((file) => path.basename(file).includes(".tmp"))).toBe(false);
  });

  it("is byte-stable across refresh times, updates changed models, and retains removed content as stale", () => {
    const vault = temporary("arcadia-living-stable-");
    const model = modelFor("arcadia");
    applyLivingSystemProjection(projectionInput(vault, "arcadia", model));
    const homePath = path.join(vault, "Projects", "arcadia", "Home.md");
    const original = readFileSync(homePath, "utf8");

    const rerun = applyLivingSystemProjection({
      ...projectionInput(vault, "arcadia", model),
      refreshedAt: "2026-08-22T09:00:00.000Z"
    });
    expect(rerun.counts.unchanged).toBe(rerun.entries.length);
    expect(readFileSync(homePath, "utf8")).toBe(original);

    const changed: LivingSystemModel = structuredClone(model);
    changed.purpose = "A changed purpose with authoritative backing.";
    changed.topics = changed.topics.filter((topic) => topic.id !== "capture");
    changed.relationships = changed.relationships.filter((relationship) => relationship.from !== "capture" && relationship.to !== "capture");
    changed.views = changed.views.map((view) => ({ ...view, topicIds: view.topicIds.filter((id) => id !== "capture") }));
    const preview = previewLivingSystemProjection(projectionInput(vault, "arcadia", changed));
    expect(preview.entries).toContainEqual(expect.objectContaining({ path: "Projects/arcadia/Topics/capture.md", status: "stale" }));
    expect(preview.entries).toContainEqual(expect.objectContaining({ path: "Projects/arcadia/Home.md", status: "updated" }));
    applyLivingSystemProjection(projectionInput(vault, "arcadia", changed));
    expect(readFileSync(homePath, "utf8")).toContain("A changed purpose");
    expect(existsSync(path.join(vault, "Projects", "arcadia", "Topics", "capture.md"))).toBe(true);
  });

  it("refuses collisions and symlink escape before writing any generated file", () => {
    const vault = temporary("arcadia-living-refusal-");
    const projectRoot = path.join(vault, "Projects", "arcadia");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(path.join(projectRoot, "Home.md"), "human-owned\n", "utf8");
    const input = projectionInput(vault, "arcadia", modelFor("arcadia"));
    expect(previewLivingSystemProjection(input).entries).toContainEqual(expect.objectContaining({
      path: "Projects/arcadia/Home.md",
      status: "refused"
    }));
    expect(() => applyLivingSystemProjection(input)).toThrow(/unmarked/);
    expect(projectFiles(projectRoot)).toEqual([path.join(projectRoot, "Home.md")]);

    const symlinkVault = temporary("arcadia-living-symlink-");
    const outside = temporary("arcadia-living-outside-");
    mkdirSync(path.join(symlinkVault, "Projects"));
    symlinkSync(outside, path.join(symlinkVault, "Projects", "arcadia"));
    expect(() => previewLivingSystemProjection(projectionInput(symlinkVault, "arcadia", modelFor("arcadia"))))
      .toThrow(/symlink/);
    expect(projectFiles(outside)).toEqual([]);
  });

  it("isolates Arcadia and Private Practice Now under the same vault", () => {
    const vault = temporary("arcadia-living-isolation-");
    writeFileSync(path.join(vault, "Welcome.md"), "untouched\n", "utf8");
    applyLivingSystemProjection(projectionInput(vault, "arcadia", modelFor("arcadia")));
    applyLivingSystemProjection(projectionInput(vault, "private-practice-now", modelFor("private-practice-now")));

    expect(existsSync(path.join(vault, "Projects", "arcadia", "Home.md"))).toBe(true);
    expect(existsSync(path.join(vault, "Projects", "private-practice-now", "Home.md"))).toBe(true);
    expect(readFileSync(path.join(vault, "Welcome.md"), "utf8")).toBe("untouched\n");
    expect(existsSync(path.join(vault, "Arcadia"))).toBe(false);
    expect(readFileSync(path.join(vault, "Projects", "private-practice-now", "Home.md"), "utf8"))
      .toContain("Help a practitioner become visible online");
  });
});

function modelFor(slug: "arcadia" | "private-practice-now"): LivingSystemModel {
  const repoRoot = path.join(FIXTURES, slug);
  const parsed = parseLivingSystemManifest(repoRoot, slug);
  if (!parsed.manifest) throw new Error(JSON.stringify(parsed.errors));
  const topic = slug === "arcadia" ? "clarification" : "authentic-profile";
  const downstream = slug === "arcadia" ? "governed-build" : "trusted-launch";
  const episode: LivingSystemEpisode = {
    id: "main#clarify",
    planSlug: "main",
    actionId: "clarify",
    milestone: "A compelling system story",
    title: slug === "arcadia" ? "Clarify the next Action" : "Accept the authentic profile",
    status: "in_progress",
    occurredOn: "2026-08-21",
    why: "Make the next meaningful choice explicit.",
    changed: "The primary journey now has explicit proof and continuation.",
    nextAction: "Project the accepted result into the site.",
    dependsOn: [],
    decisions: ["0032"],
    impacts: [
      { topicId: topic, kind: "observed", sources: [receipt("git", "commit:abc")], viaRelationship: null },
      {
        topicId: downstream,
        kind: "downstream",
        sources: [receipt("git", "commit:abc")],
        viaRelationship: parsed.manifest.relationships.find((relationship) => relationship.from === topic) ?? null
      }
    ],
    sources: [receipt("plan", "docs/plans/main.md")],
    freshness: { observedAt: "2026-08-21T08:00:00.000Z", sourceUpdatedAt: "2026-08-21", state: "current", reason: null }
  };
  const signal: LivingSystemSignal = {
    id: "validation:abc",
    kind: "validation",
    summary: "Focused journey validation passed.",
    state: "passed",
    episodeId: episode.id,
    sources: [receipt("validation", "ci:abc")],
    freshness: episode.freshness,
    uncertainty: null
  };
  return {
    version: "v1",
    project: slug,
    purpose: parsed.manifest.purpose,
    currentEpisodeId: episode.id,
    topics: parsed.manifest.topics,
    relationships: parsed.manifest.relationships,
    views: parsed.manifest.views,
    episodes: [episode],
    signals: [signal],
    unlinkedHistory: [{
      id: "MISSION_LOG.md#2026-08-20--context",
      date: "2026-08-20",
      title: "Context before explicit links",
      summary: "Visible, but intentionally unlinked.",
      source: receipt("log", "MISSION_LOG.md")
    }],
    sources: [receipt("manifest", "docs/living-system.yaml")],
    freshness: episode.freshness
  };
}

function projectionInput(vaultPath: string, slug: "arcadia" | "private-practice-now", model: LivingSystemModel) {
  return {
    vaultPath,
    repoRoot: path.join(FIXTURES, slug),
    model,
    refreshedAt: "2026-08-21T09:00:00.000Z"
  };
}

function receipt(kind: LivingSystemSourceReceipt["kind"], reference: string): LivingSystemSourceReceipt {
  return { kind, reference, observedAt: null, contentHash: "abc", availability: "present" };
}

function resolveWikiLinks(projectRoot: string): string[] {
  const missing: string[] = [];
  for (const file of projectFiles(projectRoot).filter((candidate) => candidate.endsWith(".md"))) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const target = match[1]!;
      const targetFile = path.join(projectRoot, `${target}.md`);
      if (!existsSync(targetFile)) missing.push(`${path.relative(projectRoot, file)} -> ${target}`);
    }
  }
  return missing.sort();
}

function projectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? projectFiles(absolute) : [absolute];
  }).sort();
}

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
