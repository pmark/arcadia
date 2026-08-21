import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { serializeLivingSystem } from "./contract.js";
import type {
  LivingSystemEpisode,
  LivingSystemImpactProvenance,
  LivingSystemModel,
  LivingSystemSignal,
  LivingSystemSourceReceipt,
  LivingSystemTopic
} from "./types.js";

const GENERATED_MARKER = "arcadia_living_system_generated";
const GENERATED_VERSION = "v1";

export type LivingSystemProjectionStatus = "created" | "updated" | "unchanged" | "stale" | "refused";

export interface LivingSystemProjectionEntry {
  path: string;
  status: LivingSystemProjectionStatus;
  reason: string | null;
}

export interface LivingSystemProjectionResult {
  project: string;
  projectRoot: string;
  applied: boolean;
  sourceHash: string;
  entries: LivingSystemProjectionEntry[];
  counts: Record<LivingSystemProjectionStatus, number>;
}

export interface LivingSystemProjectionInput {
  vaultPath: string;
  repoRoot: string;
  model: LivingSystemModel;
  /** Explicit receipt time. The projector never reads the clock. */
  refreshedAt: string;
}

/** Preview a complete projection without changing the vault. */
export function previewLivingSystemProjection(input: LivingSystemProjectionInput): LivingSystemProjectionResult {
  return projectLivingSystem(input, false);
}

/** Apply exactly the projection shape returned by preview for unchanged inputs. */
export function applyLivingSystemProjection(input: LivingSystemProjectionInput): LivingSystemProjectionResult {
  return projectLivingSystem(input, true);
}

function projectLivingSystem(input: LivingSystemProjectionInput, apply: boolean): LivingSystemProjectionResult {
  const target = resolveTarget(input.vaultPath, input.model.project);
  const sourceHash = createHash("sha256")
    .update(`living-system-projector:${GENERATED_VERSION}\n${serializeLivingSystem(input.model)}`)
    .digest("hex");
  const desired = renderProjection(input, sourceHash);
  const entries = inspectProjection(target.vaultRoot, target.projectRoot, input.model.project, sourceHash, desired);
  const refused = entries.filter((entry) => entry.status === "refused");
  if (apply && refused.length > 0) {
    throw new Error(`Living-system projection refused: ${refused.map((entry) => `${entry.path}: ${entry.reason}`).join("; ")}`);
  }
  if (apply) {
    mkdirSafe(target.vaultRoot, target.projectRoot);
    for (const entry of entries) {
      if (entry.status !== "created" && entry.status !== "updated") continue;
      const content = desired.get(entry.path);
      if (content === undefined) continue;
      const destination = path.join(target.vaultRoot, entry.path);
      assertSafeDestination(target.vaultRoot, destination);
      atomicWrite(destination, content);
    }
  }
  return {
    project: input.model.project,
    projectRoot: target.projectRoot,
    applied: apply,
    sourceHash,
    entries,
    counts: count(entries)
  };
}

function renderProjection(input: LivingSystemProjectionInput, sourceHash: string): Map<string, string> {
  const root = `Projects/${input.model.project}`;
  const files = new Map<string, string>();
  const addMarkdown = (relative: string, body: string): void => {
    files.set(`${root}/${relative}`, `${frontmatter(input.model.project, sourceHash, input.refreshedAt)}\n${body.trim()}\n`);
  };

  addMarkdown("README.md", renderReadme(input.model));
  addMarkdown("Home.md", renderHome(input.model, input.repoRoot));
  addMarkdown("Maps/00_Capability_Map.md", renderCapabilityMap(input.model));
  input.model.views.forEach((view) => addMarkdown(`Maps/View_${view.id}.md`, renderView(input.model, view.id)));
  addMarkdown("Timeline/00_Project_Evolution.md", renderTimeline(input.model));
  addMarkdown("Timeline/Current_Work.md", renderCurrentWork(input.model));
  input.model.topics.forEach((topic) => addMarkdown(`Topics/${topic.id}.md`, renderTopic(input.model, topic, input.repoRoot)));
  input.model.episodes.forEach((episode) => addMarkdown(`Episodes/${episodeFileId(episode.id)}.md`, renderEpisode(input.model, episode, input.repoRoot)));
  files.set(`${root}/Living_System.canvas`, renderCanvas(input.model, sourceHash, input.refreshedAt));
  return files;
}

function renderReadme(model: LivingSystemModel): string {
  return `# ${model.project} living system

This subtree is a deterministic presentation of Project-owned meaning and Arcadia's authoritative work history. It is not a second status store.

## Start here

- ${wiki("Home", "Open the Project home")}
- ${wiki("Maps/00_Capability_Map", "Explore the capability map")}
- ${wiki("Timeline/00_Project_Evolution", "Follow the Action timeline")}
- ${wiki("Timeline/Current_Work", "Inspect current work")}

## Reading without plugins

Every page is ordinary Markdown. Headings and lists can open as Markmap panes, while WikiLinks, transclusions, and source links remain usable in Obsidian Reading View or a plain Markdown reader. The Canvas split view is a convenience, not the authority.

## Trust

The repository's \`docs/living-system.yaml\` owns durable meaning. Managed Project documents, explicit \`Action: plan#action\` Mission Log links, and supplied operational receipts own status and history. Provenance and freshness are printed beside claims; missing, stale, conflicting, unmapped, and unlinked evidence stays visible.

Preview with \`arcadia memory system sync --project ${model.project}\`; add \`--apply\` to write. Generated files are replaceable projections, so rollback means restore or remove only this generated Project subtree and re-run sync. Never edit generated pages by hand. No plugin is required, and routine sync never installs one.`;
}

function renderHome(model: LivingSystemModel, repoRoot: string): string {
  const current = currentEpisode(model);
  const recent = [...model.episodes].filter((episode) => episode.occurredOn).sort(episodeDateCompare).at(-1) ?? null;
  const impacts = current?.impacts.filter((impact) => impact.topicId) ?? [];
  const focus = current ? `${wiki(episodePath(current.id), current.title)} · **${label(current.status)}**` : "No current Action is declared.";
  const affected = impacts.length > 0
    ? impacts.map((impact) => `${wiki(`Topics/${impact.topicId}`, topicTitle(model, impact.topicId))} _${impact.kind}_`).join(" · ")
    : "No Topic impact is supported by current evidence.";
  return `# ${model.project}

> ${model.purpose}

## Now

**Current focus**  
${focus}

**Affected capabilities**  
${affected}

**Evidence freshness**  
${freshnessLine(model.freshness)}

**Most recent explicit change**  
${recent ? `${recent.occurredOn} · ${wiki(episodePath(recent.id), recent.title)}` : "No Action has an explicit linked Log date."}

## Choose your depth

### Glance

- ${wiki("Timeline/Current_Work", "What is changing now?")}
- ${wiki("Maps/00_Capability_Map", "What does this Project do?")}

### Orient

- ${model.views.map((view) => wiki(`Maps/View_${view.id}`, view.title)).join("\n- ")}
- ${wiki("Timeline/00_Project_Evolution", "How did the system get here?")}

### Understand

- Open a Topic to see the Actions that shaped it.
- Open an episode to see why it existed, what changed, what proves it, and what came next.

### Audit

- Every claim includes provenance and freshness.
- ${sourceLink(repoRoot, "PROJECT.md", "Open authoritative PROJECT.md")}

## Living system

![[Maps/00_Capability_Map]]

![[Timeline/Current_Work]]`;
}

function renderCapabilityMap(model: LivingSystemModel): string {
  const topicLines = model.topics.map((topic) => {
    const outgoing = model.relationships.filter((relationship) => relationship.from === topic.id);
    return `## ${wiki(`Topics/${topic.id}`, topic.title)}\n\n${topic.summary}\n\n- **Why:** ${topic.why}\n- **Use when:** ${topic.useWhen}${outgoing.length > 0 ? `\n- **Leads to:**\n${outgoing.map((relationship) => `  - _${relationship.type}_ → ${wiki(`Topics/${relationship.to}`, topicTitle(model, relationship.to))}`).join("\n")}` : ""}`;
  });
  return `# Capability map

> The Project's present shape. Open any capability to follow its Action history.

${topicLines.join("\n\n")}

## Continue

- ${wiki("Timeline/00_Project_Evolution", "Switch to the Action timeline")}
- ${wiki("Home", "Return home")}`;
}

function renderView(model: LivingSystemModel, viewId: string): string {
  const view = model.views.find((candidate) => candidate.id === viewId);
  if (!view) throw new Error(`Unknown View ${viewId}.`);
  return `# ${view.title}

> ${view.purpose}

${view.topicIds.map((topicId) => {
    const topic = model.topics.find((candidate) => candidate.id === topicId) as LivingSystemTopic;
    return `## ${wiki(`Topics/${topic.id}`, topic.title)}\n\n- ${topic.summary}\n- **Why:** ${topic.why}`;
  }).join("\n\n")}

## Continue

- ${wiki("Maps/00_Capability_Map", "See the whole capability map")}
- ${wiki("Timeline/00_Project_Evolution", "Follow the timeline")}`;
}

function renderTimeline(model: LivingSystemModel): string {
  const groups = new Map<string, LivingSystemEpisode[]>();
  for (const episode of model.episodes) {
    const key = episode.milestone ?? "Milestone not recorded";
    groups.set(key, [...(groups.get(key) ?? []), episode]);
  }
  const sections = [...groups.entries()].map(([milestone, episodes]) => `## ${milestone}\n\n${episodes.map((episode) =>
    `- ${episode.occurredOn ?? "Date not recorded"} · ${wiki(episodePath(episode.id), episode.title)} · **${label(episode.status)}**${episode.id === model.currentEpisodeId ? " · **Current**" : ""}`
  ).join("\n")}`);
  return `# Project evolution

> Action-centered history in managed plan order. Missing dates remain missing; no timeline position is inferred.

${sections.join("\n\n")}

## Unlinked history

${model.unlinkedHistory.length > 0 ? model.unlinkedHistory.map((entry) => `- ${entry.date} · **${entry.title}** — ${entry.summary} _(unlinked)_`).join("\n") : "- None."}

## Continue

- ${wiki("Maps/00_Capability_Map", "Switch to the capability map")}
- ${wiki("Timeline/Current_Work", "Focus on current work")}`;
}

function renderCurrentWork(model: LivingSystemModel): string {
  const current = currentEpisode(model);
  if (!current) {
    return `# Current work\n\n> No current Action is declared.\n\n${wiki("Home", "Return home")}`;
  }
  const signals = model.signals.filter((signal) => signal.episodeId === current.id);
  return `# Current work

> ${wiki(episodePath(current.id), current.title)}

- **Status:** ${label(current.status)}
- **Continuation:** ${current.nextAction ?? "Not recorded"}
- **Freshness:** ${freshnessLine(current.freshness)}

## Affected capabilities

${current.impacts.map((impact) => impact.topicId
    ? `- ${wiki(`Topics/${impact.topicId}`, topicTitle(model, impact.topicId))} · **${label(impact.kind)}**${impact.viaRelationship ? ` via _${impact.viaRelationship.type}_` : ""}`
    : "- **Unmapped** · No Topic impact is supported by current evidence.").join("\n")}

## Evidence

${signals.length > 0 ? signals.map(renderSignal).join("\n") : "- No operational Signal is linked to this Action."}

## Continue

- ${wiki("Maps/00_Capability_Map", "See the full system")}
- ${wiki("Timeline/00_Project_Evolution", "Place this Action in history")}`;
}

function renderTopic(model: LivingSystemModel, topic: LivingSystemTopic, repoRoot: string): string {
  const impacts = model.episodes.flatMap((episode) => episode.impacts
    .filter((impact) => impact.topicId === topic.id)
    .map((impact) => ({ episode, impact })));
  const related = model.relationships.filter((relationship) => relationship.from === topic.id || relationship.to === topic.id);
  return `# ${topic.title}

> ${topic.summary}

## Why this matters

${topic.why}

**Use when:** ${topic.useWhen}

## Evolution

${impacts.length > 0 ? impacts.map(({ episode, impact }) => `- ${wiki(episodePath(episode.id), episode.title)} · **${impact.kind}** · ${freshnessLine(episode.freshness)}`).join("\n") : "- No Action impact is supported yet."}

## Relationships

${related.length > 0 ? related.map((relationship) => `- ${wiki(`Topics/${relationship.from}`, topicTitle(model, relationship.from))} _${relationship.type}_ ${wiki(`Topics/${relationship.to}`, topicTitle(model, relationship.to))}`).join("\n") : "- None declared."}

## Sources

${topic.sources.map((source) => `- ${sourceLink(repoRoot, source, source)}`).join("\n")}

## Continue

- ${wiki("Maps/00_Capability_Map", "Return to the capability map")}
- ${wiki("Timeline/00_Project_Evolution", "Open the full timeline")}`;
}

function renderEpisode(model: LivingSystemModel, episode: LivingSystemEpisode, repoRoot: string): string {
  const signals = model.signals.filter((signal) => signal.episodeId === episode.id);
  return `# ${episode.title}

> ${episode.id}${episode.id === model.currentEpisodeId ? " · **Current Action**" : ""}

## Why

${episode.why ?? "Not recorded in authoritative sources."}

## What changed

${episode.changed ?? "No explicitly linked Log result is available."}

## Affected capabilities

${episode.impacts.map((impact) => renderImpact(model, impact)).join("\n")}

## Proof and freshness

- **Status:** ${label(episode.status)}
- **Date:** ${episode.occurredOn ?? "Not recorded"}
- **Freshness:** ${freshnessLine(episode.freshness)}
${signals.length > 0 ? signals.map(renderSignal).join("\n") : "- **Evidence:** No operational Signal is linked."}

## Decisions

${episode.decisions.length > 0 ? episode.decisions.map((decision) => `- Decision ${decision}`).join("\n") : "- None named by the Action."}

## Continuation

- **Depends on:** ${episode.dependsOn.length > 0 ? episode.dependsOn.map((id) => wiki(episodePath(id), id)).join(", ") : "Nothing declared"}
- **What came next:** ${episode.nextAction ?? "Not recorded"}

## Sources

${episode.sources.map((source) => `- ${renderSource(source, repoRoot)}`).join("\n")}

## Continue

- ${wiki("Maps/00_Capability_Map", "Explore capabilities")}
- ${wiki("Timeline/00_Project_Evolution", "Return to evolution")}`;
}

function renderCanvas(model: LivingSystemModel, sourceHash: string, refreshedAt: string): string {
  return `${JSON.stringify({
    nodes: [
      { id: "capability-map", type: "file", file: "Maps/00_Capability_Map.md", x: 0, y: 0, width: 620, height: 760 },
      { id: "action-timeline", type: "file", file: "Timeline/00_Project_Evolution.md", x: 700, y: 0, width: 620, height: 760 },
      { id: "current-work", type: "file", file: "Timeline/Current_Work.md", x: 700, y: 840, width: 620, height: 420 }
    ],
    edges: [
      { id: "map-to-timeline", fromNode: "capability-map", fromSide: "right", toNode: "action-timeline", toSide: "left", label: "what ↔ why" },
      { id: "timeline-to-current", fromNode: "action-timeline", fromSide: "bottom", toNode: "current-work", toSide: "top", label: "now" }
    ],
    arcadiaLivingSystem: { version: GENERATED_VERSION, project: model.project, sourceHash, refreshedAt }
  }, null, 2)}\n`;
}

function inspectProjection(
  vaultRoot: string,
  projectRoot: string,
  project: string,
  sourceHash: string,
  desired: Map<string, string>
): LivingSystemProjectionEntry[] {
  const entries: LivingSystemProjectionEntry[] = [];
  for (const [relativePath, content] of desired) {
    const destination = path.join(vaultRoot, relativePath);
    assertSafeDestination(vaultRoot, destination);
    if (!existsSync(destination)) {
      entries.push({ path: relativePath, status: "created", reason: null });
      continue;
    }
    if (!lstatSync(destination).isFile()) {
      entries.push({ path: relativePath, status: "refused", reason: "Destination exists and is not a regular file." });
      continue;
    }
    const current = readFileSync(destination, "utf8");
    const owner = generatedOwner(current, relativePath.endsWith(".canvas"));
    if (!owner || owner.project !== project) {
      entries.push({ path: relativePath, status: "refused", reason: "Existing file is unmarked or owned by another Project." });
      continue;
    }
    const status = owner.sourceHash === sourceHash || current === content ? "unchanged" : "updated";
    entries.push({ path: relativePath, status, reason: null });
  }

  if (existsSync(projectRoot)) {
    for (const absolute of recursiveFiles(projectRoot)) {
      const relative = normalize(path.relative(vaultRoot, absolute));
      if (desired.has(relative)) continue;
      const content = readFileSync(absolute, "utf8");
      const owner = generatedOwner(content, relative.endsWith(".canvas"));
      if (owner?.project === project) {
        entries.push({ path: relative, status: "stale", reason: "Previously generated content is no longer part of the projection; retained for review." });
      }
    }
  }
  return entries.sort((left, right) => stableCompare(left.path, right.path));
}

function generatedOwner(content: string, canvas: boolean): { project: string; sourceHash: string } | null {
  if (canvas) {
    try {
      const parsed = JSON.parse(content) as { arcadiaLivingSystem?: { version?: string; project?: string; sourceHash?: string } };
      const marker = parsed.arcadiaLivingSystem;
      return marker?.version === GENERATED_VERSION && marker.project && marker.sourceHash
        ? { project: marker.project, sourceHash: marker.sourceHash }
        : null;
    } catch {
      return null;
    }
  }
  const version = content.match(/^arcadia_living_system_generated:\s*([^\n]+)$/m)?.[1]?.trim();
  const project = content.match(/^project:\s*"([^\n]+)"$/m)?.[1];
  const sourceHash = content.match(/^source_sha256:\s*"([0-9a-f]+)"$/m)?.[1];
  return version === GENERATED_VERSION && project && sourceHash ? { project, sourceHash } : null;
}

function resolveTarget(vaultPath: string, project: string): { vaultRoot: string; projectRoot: string } {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error(`Unsafe Project slug ${JSON.stringify(project)}.`);
  const vaultRoot = realpathSync(vaultPath);
  const projectRoot = path.join(vaultRoot, "Projects", project);
  assertSafeDestination(vaultRoot, projectRoot);
  return { vaultRoot, projectRoot };
}

function assertSafeDestination(vaultRoot: string, destination: string): void {
  const relative = path.relative(vaultRoot, destination);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Living-system destination escapes the vault: ${destination}`);
  }
  let current = path.dirname(destination);
  while (current !== vaultRoot && current.startsWith(`${vaultRoot}${path.sep}`)) {
    if (existsSync(current)) {
      const real = realpathSync(current);
      const realRelative = path.relative(vaultRoot, real);
      if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new Error(`Living-system destination escapes through a symlink: ${current}`);
      }
    }
    current = path.dirname(current);
  }
}

function mkdirSafe(vaultRoot: string, directory: string): void {
  assertSafeDestination(vaultRoot, directory);
  mkdirSync(directory, { recursive: true });
  assertSafeDestination(vaultRoot, path.join(directory, "placeholder"));
}

function atomicWrite(destination: string, content: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function recursiveFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Living-system Project subtree contains a symlink: ${absolute}`);
    return entry.isDirectory() ? recursiveFiles(absolute) : entry.isFile() ? [absolute] : [];
  });
}

function frontmatter(project: string, sourceHash: string, refreshedAt: string): string {
  return `---\n${GENERATED_MARKER}: ${GENERATED_VERSION}\nproject: ${JSON.stringify(project)}\nsource_sha256: ${JSON.stringify(sourceHash)}\nrefreshed_at: ${JSON.stringify(refreshedAt)}\n---`;
}

function currentEpisode(model: LivingSystemModel): LivingSystemEpisode | null {
  return model.episodes.find((episode) => episode.id === model.currentEpisodeId) ?? null;
}

function renderImpact(model: LivingSystemModel, impact: LivingSystemImpactProvenance): string {
  if (!impact.topicId) return "- **Unmapped** · No Topic impact is supported by current evidence.";
  const via = impact.viaRelationship ? ` via _${impact.viaRelationship.type}_ from ${topicTitle(model, impact.viaRelationship.from)}` : "";
  return `- ${wiki(`Topics/${impact.topicId}`, topicTitle(model, impact.topicId))} · **${label(impact.kind)}**${via}`;
}

function renderSignal(signal: LivingSystemSignal): string {
  return `- **${label(signal.kind)} · ${label(signal.state)}** — ${signal.summary} · ${freshnessLine(signal.freshness)}${signal.uncertainty ? ` · _${signal.uncertainty}_` : ""}`;
}

function renderSource(source: LivingSystemSourceReceipt, repoRoot: string): string {
  const reference = source.kind === "manifest" || source.kind === "project" || source.kind === "plan" || source.kind === "log" || source.kind === "decision"
    ? sourceLink(repoRoot, source.reference.split("#")[0]!, source.reference)
    : `\`${source.reference}\``;
  return `${label(source.kind)} · **${source.availability}** · ${reference} · observed ${source.observedAt ?? "not recorded"}`;
}

function sourceLink(repoRoot: string, relativePath: string, labelText: string): string {
  const absolute = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !existsSync(absolute)) {
    return `\`${labelText}\``;
  }
  return `[${labelText}](${pathToFileURL(absolute).href})`;
}

function freshnessLine(value: LivingSystemModel["freshness"]): string {
  return `**${label(value.state)}**${value.sourceUpdatedAt ? ` · source ${value.sourceUpdatedAt}` : ""}${value.observedAt ? ` · observed ${value.observedAt}` : " · observation not recorded"}${value.reason ? ` · ${value.reason}` : ""}`;
}

function topicTitle(model: LivingSystemModel, topicId: string | null): string {
  return model.topics.find((topic) => topic.id === topicId)?.title ?? topicId ?? "Unmapped";
}

function episodePath(id: string): string {
  return `Episodes/${episodeFileId(id)}`;
}

function episodeFileId(id: string): string {
  return id.replace("#", "--");
}

function wiki(target: string, labelText: string): string {
  return `[[${target}|${labelText}]]`;
}

function label(value: string): string {
  return value.split("_").map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function episodeDateCompare(left: LivingSystemEpisode, right: LivingSystemEpisode): number {
  return stableCompare(left.occurredOn ?? "", right.occurredOn ?? "") || stableCompare(left.id, right.id);
}

function normalize(value: string): string {
  return value.split(path.sep).join("/");
}

function count(entries: LivingSystemProjectionEntry[]): Record<LivingSystemProjectionStatus, number> {
  const counts: Record<LivingSystemProjectionStatus, number> = { created: 0, updated: 0, unchanged: 0, stale: 0, refused: 0 };
  entries.forEach((entry) => { counts[entry.status] += 1; });
  return counts;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
