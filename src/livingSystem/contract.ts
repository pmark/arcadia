import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  LIVING_SYSTEM_VERSION,
  type LivingSystemManifest,
  type LivingSystemManifestResult,
  type LivingSystemRelationship,
  type LivingSystemTopic,
  type LivingSystemValidationError,
  type LivingSystemView,
  type LivingSystemViewOrder,
  type LivingSystemViewSelector
} from "./types.js";

export const LIVING_SYSTEM_MANIFEST_PATH = "docs/living-system.yaml";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIEW_ORDERS = new Set<LivingSystemViewOrder>(["declaration", "id", "title"]);
const TOP_LEVEL_FIELDS = new Set(["arcadia_living_system", "project", "purpose", "topics", "relationships", "views"]);
const TOPIC_FIELDS = new Set(["id", "title", "why", "use_when", "summary", "sources", "tags"]);
const RELATIONSHIP_FIELDS = new Set(["from", "to", "type", "summary"]);
const VIEW_FIELDS = new Set(["id", "title", "purpose", "selectors", "order"]);
const SELECTOR_FIELDS = new Set(["all", "topic", "tag"]);

class Problems {
  public readonly errors: LivingSystemValidationError[] = [];

  public add(field: string, message: string): void {
    this.errors.push({ field, message });
  }
}

export function parseLivingSystemManifest(
  repoRoot: string,
  expectedProjectSlug: string
): LivingSystemManifestResult {
  const manifestPath = path.join(repoRoot, LIVING_SYSTEM_MANIFEST_PATH);
  const problems = new Problems();
  let raw: unknown;

  try {
    raw = parseYaml(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    problems.add("manifest", error instanceof Error ? error.message : String(error));
    return { manifest: null, errors: problems.errors };
  }

  if (!isMapping(raw)) {
    problems.add("manifest", "The living-system manifest must be a YAML mapping.");
    return { manifest: null, errors: problems.errors };
  }

  rejectUnknownFields(problems, raw, TOP_LEVEL_FIELDS, "manifest");
  const version = requiredString(problems, raw, "arcadia_living_system");
  if (version && version !== LIVING_SYSTEM_VERSION) {
    problems.add(
      "arcadia_living_system",
      `Unsupported living-system version ${JSON.stringify(version)}; expected ${JSON.stringify(LIVING_SYSTEM_VERSION)}.`
    );
  }
  const project = slugField(problems, raw, "project");
  if (project && project !== expectedProjectSlug) {
    problems.add("project", `Project slug ${JSON.stringify(project)} does not match ${JSON.stringify(expectedProjectSlug)}.`);
  }
  const purpose = conciseString(problems, raw, "purpose");
  const topics = parseTopics(problems, repoRoot, raw.topics);
  const relationships = parseRelationships(problems, raw.relationships, topics);
  const views = parseViews(problems, raw.views, topics);

  if (problems.errors.length > 0 || !version || !project || !purpose) {
    return { manifest: null, errors: stableErrors(problems.errors) };
  }

  return {
    manifest: {
      arcadiaLivingSystem: LIVING_SYSTEM_VERSION,
      project,
      purpose,
      topics: [...topics].sort((a, b) => stableCompare(a.id, b.id)),
      relationships: [...relationships].sort((a, b) =>
        stableCompare(`${a.from}\0${a.type}\0${a.to}`, `${b.from}\0${b.type}\0${b.to}`)
      ),
      views: [...views].sort((a, b) => stableCompare(a.id, b.id))
    },
    errors: []
  };
}

/** Canonical JSON for hashing, fixtures, and byte-stable downstream projection. */
export function serializeLivingSystem(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function parseTopics(problems: Problems, repoRoot: string, raw: unknown): LivingSystemTopic[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add("topics", "`topics` must be a non-empty list.");
    return [];
  }

  const topics: LivingSystemTopic[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const field = `topics[${index}]`;
    if (!isMapping(entry)) {
      problems.add(field, "Each Topic must be a mapping.");
      return;
    }
    rejectUnknownFields(problems, entry, TOPIC_FIELDS, field);
    const id = slugField(problems, entry, "id", field);
    const title = conciseString(problems, entry, "title", field);
    const why = conciseString(problems, entry, "why", field);
    const useWhen = conciseString(problems, entry, "use_when", field);
    const summary = conciseString(problems, entry, "summary", field);
    const sources = stringList(problems, entry.sources, `${field}.sources`, { nonEmpty: true });
    const tags = entry.tags === undefined
      ? []
      : stringList(problems, entry.tags, `${field}.tags`, { slugs: true });

    if (id) {
      if (seen.has(id)) problems.add(`${field}.id`, `Duplicate Topic id ${JSON.stringify(id)}.`);
      seen.add(id);
    }
    for (const [sourceIndex, source] of sources.entries()) {
      validateSourcePath(problems, repoRoot, source, `${field}.sources[${sourceIndex}]`);
    }
    if (id && title && why && useWhen && summary && sources.length > 0) {
      topics.push({
        id,
        title,
        why,
        useWhen,
        summary,
        sources: [...new Set(sources)].sort(stableCompare),
        tags: [...new Set(tags)].sort(stableCompare)
      });
    }
  });
  return topics;
}

function parseRelationships(
  problems: Problems,
  raw: unknown,
  topics: LivingSystemTopic[]
): LivingSystemRelationship[] {
  if (!Array.isArray(raw)) {
    problems.add("relationships", "`relationships` must be a list (use `[]` when none are declared).");
    return [];
  }
  const topicIds = new Set(topics.map((topic) => topic.id));
  const relationships: LivingSystemRelationship[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const field = `relationships[${index}]`;
    if (!isMapping(entry)) {
      problems.add(field, "Each Relationship must be a mapping.");
      return;
    }
    rejectUnknownFields(problems, entry, RELATIONSHIP_FIELDS, field);
    const from = slugField(problems, entry, "from", field);
    const to = slugField(problems, entry, "to", field);
    const type = slugField(problems, entry, "type", field);
    const summary = optionalConciseString(problems, entry, "summary", field);
    if (from && !topicIds.has(from)) problems.add(`${field}.from`, `Relationship source ${JSON.stringify(from)} is not a Topic id.`);
    if (to && !topicIds.has(to)) problems.add(`${field}.to`, `Relationship target ${JSON.stringify(to)} is not a Topic id.`);
    if (from && to && type) {
      const identity = `${from}\0${type}\0${to}`;
      if (seen.has(identity)) problems.add(field, `Duplicate Relationship ${from} -[${type}]-> ${to}.`);
      seen.add(identity);
      relationships.push({ from, to, type, summary });
    }
  });
  return relationships;
}

function parseViews(problems: Problems, raw: unknown, topics: LivingSystemTopic[]): LivingSystemView[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add("views", "`views` must be a non-empty list.");
    return [];
  }
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const declarationIndex = new Map(topics.map((topic, index) => [topic.id, index]));
  const views: LivingSystemView[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const field = `views[${index}]`;
    if (!isMapping(entry)) {
      problems.add(field, "Each View must be a mapping.");
      return;
    }
    rejectUnknownFields(problems, entry, VIEW_FIELDS, field);
    const id = slugField(problems, entry, "id", field);
    const title = conciseString(problems, entry, "title", field);
    const purpose = conciseString(problems, entry, "purpose", field);
    const orderRaw = requiredString(problems, entry, "order", field);
    const order = orderRaw && VIEW_ORDERS.has(orderRaw as LivingSystemViewOrder)
      ? orderRaw as LivingSystemViewOrder
      : null;
    if (orderRaw && !order) {
      problems.add(`${field}.order`, "`order` must be one of: declaration, id, title.");
    }
    const selectors = parseSelectors(problems, entry.selectors, field, topics);
    if (id) {
      if (seen.has(id)) problems.add(`${field}.id`, `Duplicate View id ${JSON.stringify(id)}.`);
      seen.add(id);
    }
    const selected = selectTopics(selectors, topics);
    if (selectors.length > 0 && selected.length === 0) {
      problems.add(`${field}.selectors`, "View selectors match no Topics.");
    }
    if (id && title && purpose && order && selectors.length > 0 && selected.length > 0) {
      const topicIds = [...selected].sort((left, right) => {
        if (order === "declaration") return (declarationIndex.get(left) ?? 0) - (declarationIndex.get(right) ?? 0);
        if (order === "title") {
          return stableCompare(byId.get(left)?.title ?? left, byId.get(right)?.title ?? right) || stableCompare(left, right);
        }
        return stableCompare(left, right);
      });
      views.push({ id, title, purpose, selectors, order, topicIds });
    }
  });
  return views;
}

function parseSelectors(
  problems: Problems,
  raw: unknown,
  viewField: string,
  topics: LivingSystemTopic[]
): LivingSystemViewSelector[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add(`${viewField}.selectors`, "`selectors` must be a non-empty list.");
    return [];
  }
  const topicIds = new Set(topics.map((topic) => topic.id));
  const tags = new Set(topics.flatMap((topic) => topic.tags));
  const selectors: LivingSystemViewSelector[] = [];
  raw.forEach((entry, index) => {
    const field = `${viewField}.selectors[${index}]`;
    if (!isMapping(entry)) {
      problems.add(field, "Each selector must be a mapping with exactly one of `all`, `topic`, or `tag`.");
      return;
    }
    rejectUnknownFields(problems, entry, SELECTOR_FIELDS, field);
    const present = [...SELECTOR_FIELDS].filter((key) => entry[key] !== undefined);
    if (present.length !== 1) {
      problems.add(field, "A selector is ambiguous unless it has exactly one of `all`, `topic`, or `tag`.");
      return;
    }
    const kind = present[0];
    if (kind === "all") {
      if (entry.all !== true) problems.add(`${field}.all`, "`all` must be `true`.");
      else selectors.push({ kind: "all" });
      return;
    }
    const value = slugField(problems, entry, kind, field);
    if (!value) return;
    if (kind === "topic") {
      if (!topicIds.has(value)) problems.add(`${field}.topic`, `Selector references missing Topic ${JSON.stringify(value)}.`);
      selectors.push({ kind: "topic", topicId: value });
    } else {
      if (!tags.has(value)) problems.add(`${field}.tag`, `Selector references unused tag ${JSON.stringify(value)}.`);
      selectors.push({ kind: "tag", tag: value });
    }
  });
  if (selectors.some((selector) => selector.kind === "all") && selectors.length > 1) {
    problems.add(`${viewField}.selectors`, "The `all` selector cannot be combined with another selector.");
  }
  return selectors;
}

function selectTopics(selectors: LivingSystemViewSelector[], topics: LivingSystemTopic[]): string[] {
  const selected = new Set<string>();
  for (const selector of selectors) {
    if (selector.kind === "all") topics.forEach((topic) => selected.add(topic.id));
    if (selector.kind === "topic") selected.add(selector.topicId);
    if (selector.kind === "tag") {
      topics.filter((topic) => topic.tags.includes(selector.tag)).forEach((topic) => selected.add(topic.id));
    }
  }
  return [...selected];
}

function validateSourcePath(problems: Problems, repoRoot: string, source: string, field: string): void {
  if (source.includes("\\") || path.posix.isAbsolute(source) || path.isAbsolute(source)) {
    problems.add(field, "Source paths must be repository-relative POSIX paths, not absolute paths.");
    return;
  }
  const segments = source.split("/");
  if (segments.includes("..")) {
    problems.add(field, "Source paths must not traverse outside the repository.");
    return;
  }
  const normalized = path.posix.normalize(source);
  if (normalized === "." || normalized.startsWith("../") || normalized !== source) {
    problems.add(field, "Source paths must be normalized repository-relative paths.");
    return;
  }

  const candidate = path.resolve(repoRoot, ...segments);
  if (!existsSync(candidate)) {
    problems.add(field, `Source path ${JSON.stringify(source)} does not exist.`);
    return;
  }
  try {
    const realRoot = realpathSync(repoRoot);
    const realCandidate = realpathSync(candidate);
    const relative = path.relative(realRoot, realCandidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      problems.add(field, `Source path ${JSON.stringify(source)} escapes the repository through a symlink.`);
    }
  } catch (error) {
    problems.add(field, `Source path ${JSON.stringify(source)} cannot be resolved: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

function requiredString(problems: Problems, value: Record<string, unknown>, key: string, prefix?: string): string | null {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    problems.add(prefix ? `${prefix}.${key}` : key, `\`${key}\` is required.`);
    return null;
  }
  return raw.trim();
}

function conciseString(problems: Problems, value: Record<string, unknown>, key: string, prefix?: string): string | null {
  const result = requiredString(problems, value, key, prefix);
  if (result && result.length > 500) {
    problems.add(prefix ? `${prefix}.${key}` : key, `\`${key}\` must be concise (500 characters or fewer).`);
  }
  return result;
}

function optionalConciseString(
  problems: Problems,
  value: Record<string, unknown>,
  key: string,
  prefix?: string
): string | null {
  if (value[key] === undefined || value[key] === null || value[key] === "") return null;
  return conciseString(problems, value, key, prefix);
}

function slugField(problems: Problems, value: Record<string, unknown>, key: string, prefix?: string): string | null {
  const result = requiredString(problems, value, key, prefix);
  if (result && !SLUG.test(result)) {
    problems.add(prefix ? `${prefix}.${key}` : key, `\`${key}\` must be kebab-case, got ${JSON.stringify(result)}.`);
    return null;
  }
  return result;
}

function stringList(
  problems: Problems,
  raw: unknown,
  field: string,
  options: { nonEmpty?: boolean; slugs?: boolean } = {}
): string[] {
  if (!Array.isArray(raw) || (options.nonEmpty && raw.length === 0)) {
    problems.add(field, options.nonEmpty ? "A non-empty string list is required." : "A string list is required.");
    return [];
  }
  const values: string[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      problems.add(`${field}[${index}]`, "A non-empty string is required.");
      return;
    }
    const value = entry.trim();
    if (options.slugs && !SLUG.test(value)) {
      problems.add(`${field}[${index}]`, `Expected a kebab-case value, got ${JSON.stringify(value)}.`);
      return;
    }
    values.push(value);
  });
  return values;
}

function rejectUnknownFields(
  problems: Problems,
  value: Record<string, unknown>,
  allowed: Set<string>,
  prefix: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      problems.add(`${prefix}.${key}`, `Unsupported field ${JSON.stringify(key)}; operational status and history do not belong in this manifest.`);
    }
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableErrors(errors: LivingSystemValidationError[]): LivingSystemValidationError[] {
  return [...errors].sort((a, b) => stableCompare(a.field, b.field) || stableCompare(a.message, b.message));
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isMapping(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}
