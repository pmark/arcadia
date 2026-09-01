import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectMetadata, listProjects, resolveProjectContextFromRequest } from "../db/repositories.js";
import type { Project } from "../domain/types.js";
import { getDefaultRegistryPath } from "../intent/registries.js";
import { getWorkspacePaths } from "../workspace/paths.js";

const RULE_KEYS = new Set([
  "id", "enabled", "prefix", "boundaries", "destinationProject", "processingProfile", "sourceRef", "examples"
]);
const REGISTRY_KEYS = new Set(["version", "rules"]);
const EXAMPLE_KEYS = new Set(["matches", "misses"]);
const REQUIRED_BOUNDARIES = ["colon", "whitespace", "end"] as const;

export interface AskRuleRegistry {
  version: number;
  rules: AskRuleDefinition[];
}

export interface AskRuleDefinition {
  id: string;
  enabled: boolean;
  prefix: string;
  boundaries: Array<(typeof REQUIRED_BOUNDARIES)[number]>;
  destinationProject: string;
  processingProfile: string;
  sourceRef: string;
  examples: {
    matches: string[];
    misses: string[];
  };
}

export interface AskProcessingProfile {
  id: string;
  processors: string[];
  proposedWrites: string[];
  nonActions: string[];
  approvalGates: string[];
}

export interface ValidatedAskRule extends AskRuleDefinition {
  destination: Project;
  sourceSha256: string;
}

export interface ValidatedAskRuleRegistry {
  version: 1;
  rules: ValidatedAskRule[];
  normalized: string;
}

export interface AskRuleMatch {
  rule: ValidatedAskRule;
  boundary: "colon" | "whitespace" | "end";
  matchedText: string;
  payload: string;
}

export interface AskRouteCandidate {
  source: "explicit_destination" | "exact_prefix" | "reply_context" | "extracted_project" | "general_intent_registry";
  projectId: string;
  projectName: string;
}

export interface AskRoutingDecision {
  selected: AskRouteCandidate | null;
  ignored: Array<AskRouteCandidate & { reason: "lower_precedence" | "same_destination" }>;
}

export interface AskProcessingReceipt {
  ruleId: string;
  ruleVersion: number;
  matchEvidence: {
    prefix: string;
    boundary: AskRuleMatch["boundary"];
    matchedText: string;
    position: 0;
  };
  destination: {
    projectId: string;
    projectName: string;
  };
  routing: AskRoutingDecision;
  originalText: string;
  strippedPayload: string;
  extractedFields: Record<string, string>;
  submittedLinks: string[];
  canonicalLinkCandidates: Array<{ submitted: string; candidate: string; reason: string }>;
  attachmentInventory: Array<Record<string, unknown>>;
  orderedProcessors: string[];
  proposedWrites: string[];
  nonActions: string[];
  approvalGates: string[];
}

const PROCESSING_PROFILES: Record<string, AskProcessingProfile> = {
  "living-songbook-v1": {
    id: "living-songbook-v1",
    processors: ["selector-strip-v1", "link-candidates-v1", "attachment-inventory-v1", "living-songbook-intent-v1"],
    proposedWrites: ["Living Songbook governed Project records after an exact operator-approved preview"],
    nonActions: [
      "Does not fetch or copy linked content",
      "Does not interpret attachment contents",
      "Does not write to a Project repository",
      "Does not publish, message, deploy, or start a coding-agent Run"
    ],
    approvalGates: ["Operator approval is required before proposed Project writes or external effects"]
  }
};

export function loadAskRuleRegistry(workspace: string): AskRuleRegistry {
  const workspacePath = path.join(getWorkspacePaths(workspace).config, "ask-rules.json");
  const filePath = existsSync(workspacePath) ? workspacePath : getDefaultRegistryPath("ask-rules.json");
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as AskRuleRegistry;
  } catch (error) {
    throw validationError("Ask rules must be valid JSON.", {
      filePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export function validateAskRuleRegistry(
  workspace: string,
  db: Database.Database,
  registry: AskRuleRegistry
): ValidatedAskRuleRegistry {
  if (!isRecord(registry) || registry.version !== 1 || !Array.isArray(registry.rules)) {
    throw validationError("Ask rules must use version 1 and include a rules array.", { reason: "unsupported-version" });
  }
  assertOnlyKeys(registry, REGISTRY_KEYS, "Ask rule registry");

  const seenIds = new Set<string>();
  const seenPrefixes = new Set<string>();
  const validated = registry.rules.map((candidate, index) => {
    validateRuleShape(candidate, index);
    const rule = candidate as unknown as AskRuleDefinition;
    const normalizedPrefix = normalizePrefix(rule.prefix);
    if (seenIds.has(rule.id)) {
      throw validationError("Ask rule ids must be unique.", { reason: "duplicate", ruleId: rule.id });
    }
    if (seenPrefixes.has(normalizedPrefix)) {
      throw validationError("Ask rule prefixes must be unique case-insensitively.", {
        reason: "duplicate",
        prefix: rule.prefix
      });
    }
    seenIds.add(rule.id);
    seenPrefixes.add(normalizedPrefix);

    const destination = resolveProjectReference(db, rule.destinationProject);
    if (!destination) {
      throw validationError("Ask rule destination Project was not found.", {
        reason: "unknown-Project",
        ruleId: rule.id,
        destinationProject: rule.destinationProject
      });
    }
    if (!PROCESSING_PROFILES[rule.processingProfile]) {
      throw validationError("Ask rule processing profile is not registered.", {
        reason: "unknown-processing-profile",
        ruleId: rule.id,
        processingProfile: rule.processingProfile
      });
    }
    const sourceSha256 = validateSourceRef(db, destination, rule);
    return { ...rule, prefix: rule.prefix.trim(), destination, sourceSha256 };
  });

  for (let left = 0; left < validated.length; left += 1) {
    for (let right = left + 1; right < validated.length; right += 1) {
      const a = validated[left];
      const b = validated[right];
      if (!a.enabled || !b.enabled) continue;
      const samples = [a.prefix, b.prefix, `${a.prefix} x`, `${b.prefix} x`];
      if (samples.some((sample) => Boolean(matchOne(sample, a)) && Boolean(matchOne(sample, b)))) {
        throw validationError("Enabled Ask rule prefixes are ambiguous.", {
          reason: "ambiguous",
          ruleIds: [a.id, b.id]
        });
      }
    }
  }

  for (const rule of validated) {
    for (const example of rule.examples.matches) {
      const matching = validated.filter((candidate) => candidate.enabled && matchOne(example, candidate));
      if (matching.length !== 1 || matching[0].id !== rule.id) {
        throw validationError("Ask rule positive example does not match exactly one declared rule.", {
          ruleId: rule.id,
          example
        });
      }
    }
    for (const example of rule.examples.misses) {
      if (matchOne(example, rule)) {
        throw validationError("Ask rule negative example unexpectedly matches.", { ruleId: rule.id, example });
      }
    }
  }

  const normalizedRules = [...validated].sort((a, b) => a.id.localeCompare(b.id)).map((rule) => ({
    id: rule.id,
    enabled: rule.enabled,
    prefix: rule.prefix,
    boundaries: [...REQUIRED_BOUNDARIES],
    destinationProject: rule.destination.id,
    processingProfile: rule.processingProfile,
    sourceRef: rule.sourceRef,
    sourceSha256: rule.sourceSha256,
    examples: {
      matches: [...rule.examples.matches],
      misses: [...rule.examples.misses]
    }
  }));

  return {
    version: 1,
    rules: validated,
    normalized: `${JSON.stringify({ version: 1, rules: normalizedRules }, null, 2)}\n`
  };
}

export function matchAskRule(request: string, registry: ValidatedAskRuleRegistry): AskRuleMatch | null {
  const matches = registry.rules.filter((rule) => rule.enabled).flatMap((rule) => {
    const match = matchOne(request, rule);
    return match ? [match] : [];
  });
  if (matches.length > 1) {
    throw validationError("Ask request matched more than one enabled rule.", {
      reason: "ambiguous",
      ruleIds: matches.map((match) => match.rule.id)
    });
  }
  return matches[0] ?? null;
}

export function resolveProjectReference(db: Database.Database, reference: string | null | undefined): Project | null {
  if (!reference?.trim()) return null;
  const normalized = reference.trim().toLowerCase();
  const matches = listProjects(db).filter((project) =>
    [project.id, project.slug, project.name].some((value) => value.toLowerCase() === normalized)
  );
  if (matches.length > 1) {
    throw validationError("Project reference is ambiguous.", { reference, projectIds: matches.map((project) => project.id) });
  }
  return matches[0] ?? null;
}

export function resolveGeneralProjectReference(db: Database.Database, request: string): Project | null {
  return resolveProjectContextFromRequest(db, request)?.project ?? null;
}

export function buildAskRoutingDecision(input: {
  explicit?: Project | null;
  prefix?: Project | null;
  reply?: Project | null;
  extracted?: Project | null;
  general?: Project | null;
}): AskRoutingDecision {
  const ordered: AskRouteCandidate[] = [];
  const add = (source: AskRouteCandidate["source"], project: Project | null | undefined) => {
    if (project) ordered.push({ source, projectId: project.id, projectName: project.name });
  };
  add("explicit_destination", input.explicit);
  add("exact_prefix", input.prefix);
  add("reply_context", input.reply);
  add("extracted_project", input.extracted);
  add("general_intent_registry", input.general);
  const selected = ordered[0] ?? null;
  return {
    selected,
    ignored: ordered.slice(1).map((candidate) => ({
      ...candidate,
      reason: candidate.projectId === selected?.projectId ? "same_destination" : "lower_precedence"
    }))
  };
}

export function buildAskProcessingReceipt(input: {
  match: AskRuleMatch;
  routing: AskRoutingDecision;
  originalRequest: string;
  extractedFields?: Record<string, string>;
  adapterMetadata?: Record<string, unknown>;
}): AskProcessingReceipt {
  const profile = PROCESSING_PROFILES[input.match.rule.processingProfile];
  const submittedLinks = extractSubmittedLinks(input.originalRequest);
  return {
    ruleId: input.match.rule.id,
    ruleVersion: 1,
    matchEvidence: {
      prefix: input.match.rule.prefix,
      boundary: input.match.boundary,
      matchedText: input.match.matchedText,
      position: 0
    },
    destination: input.routing.selected
      ? {
          projectId: input.routing.selected.projectId,
          projectName: input.routing.selected.projectName
        }
      : {
          projectId: input.match.rule.destination.id,
          projectName: input.match.rule.destination.name
        },
    routing: input.routing,
    originalText: input.originalRequest,
    strippedPayload: input.match.payload,
    extractedFields: sortStringRecord(input.extractedFields ?? {}),
    submittedLinks,
    canonicalLinkCandidates: submittedLinks.flatMap((submitted) => {
      const candidate = canonicalLinkCandidate(submitted);
      return candidate === submitted ? [] : [{ submitted, candidate, reason: "known redirect-wrapper parameter" }];
    }),
    attachmentInventory: attachmentInventory(input.adapterMetadata),
    orderedProcessors: [...profile.processors],
    proposedWrites: [...profile.proposedWrites],
    nonActions: [...profile.nonActions],
    approvalGates: [...profile.approvalGates]
  };
}

export function renderAskProcessingPreview(receipt: AskProcessingReceipt | null): string[] {
  if (!receipt) return ["Matched rule: None", "Writes: None (test mode)"];
  return [
    `Matched rule: ${receipt.ruleId} v${receipt.ruleVersion}`,
    `Evidence: ${JSON.stringify(receipt.matchEvidence.matchedText)} at start (${receipt.matchEvidence.boundary})`,
    `Destination: ${receipt.routing.selected?.projectName ?? receipt.destination.projectName} via ${receipt.routing.selected?.source ?? "exact_prefix"}`,
    `Ignored routes: ${receipt.routing.ignored.map((candidate) => `${candidate.source} -> ${candidate.projectName} (${candidate.reason})`).join("; ") || "None"}`,
    `Processing payload: ${receipt.strippedPayload || "(empty)"}`,
    `Extracted fields: ${Object.keys(receipt.extractedFields).length > 0 ? JSON.stringify(receipt.extractedFields) : "None"}`,
    `Processors: ${receipt.orderedProcessors.join(" -> ")}`,
    `Submitted links: ${receipt.submittedLinks.join("; ") || "None"}`,
    `Canonical link candidates: ${receipt.canonicalLinkCandidates.map((candidate) => candidate.candidate).join("; ") || "None"}`,
    `Attachments: ${receipt.attachmentInventory.length > 0 ? JSON.stringify(receipt.attachmentInventory) : "None"}`,
    `Proposed writes: ${receipt.proposedWrites.join("; ") || "None"}`,
    `Non-actions: ${receipt.nonActions.join("; ") || "None"}`,
    `Approval gates: ${receipt.approvalGates.join("; ") || "None"}`,
    "Writes: None (test mode)"
  ];
}

function validateRuleShape(candidate: unknown, index: number): void {
  if (!isRecord(candidate)) throw validationError("Each Ask rule must be an object.", { index });
  assertOnlyKeys(candidate, RULE_KEYS, `Ask rule ${index}`);
  if (typeof candidate.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(candidate.id)) {
    throw validationError("Ask rule id must be a lowercase kebab-case identifier.", { index });
  }
  if (typeof candidate.enabled !== "boolean") throw validationError("Ask rule enabled must be boolean.", { ruleId: candidate.id });
  for (const key of ["prefix", "destinationProject", "processingProfile", "sourceRef"] as const) {
    if (typeof candidate[key] !== "string" || !candidate[key].trim()) {
      throw validationError(`Ask rule ${key} is required.`, { ruleId: candidate.id });
    }
  }
  const prefix = candidate.prefix as string;
  if (prefix !== prefix.trim() || prefix.includes(":")) {
    throw validationError("Ask rule prefix must be trimmed and must not contain the boundary colon.", { ruleId: candidate.id });
  }
  const boundaries = candidate.boundaries;
  if (!Array.isArray(boundaries) || boundaries.length !== REQUIRED_BOUNDARIES.length ||
      !REQUIRED_BOUNDARIES.every((boundary) => boundaries.includes(boundary))) {
    throw validationError("Ask rule boundaries must explicitly be colon, whitespace, and end.", { ruleId: candidate.id });
  }
  if (!isRecord(candidate.examples)) throw validationError("Ask rule examples are required.", { ruleId: candidate.id });
  assertOnlyKeys(candidate.examples, EXAMPLE_KEYS, `Ask rule ${candidate.id} examples`);
  if (!isStringArray(candidate.examples.matches) || candidate.examples.matches.length === 0 || !isStringArray(candidate.examples.misses)) {
    throw validationError("Ask rule examples must include non-empty matches and a misses array.", { ruleId: candidate.id });
  }
}

function validateSourceRef(db: Database.Database, project: Project, rule: AskRuleDefinition): string {
  const metadata = getProjectMetadata(db, project.id);
  const repoPath = metadata?.repo_path;
  const sourcePathPart = rule.sourceRef.split("#", 1)[0];
  if (!repoPath || path.isAbsolute(sourcePathPart) || !sourcePathPart || sourcePathPart.split(/[\\/]/).includes("..")) {
    throw validationError("Ask rule source reference is stale or unsafe.", {
      reason: "stale-source",
      ruleId: rule.id,
      sourceRef: rule.sourceRef
    });
  }
  const candidate = path.resolve(repoPath, sourcePathPart);
  if (!existsSync(candidate)) {
    throw validationError("Ask rule source reference does not exist.", {
      reason: "stale-source",
      ruleId: rule.id,
      sourceRef: rule.sourceRef
    });
  }
  const realRepo = realpathSync(repoPath);
  const realSource = realpathSync(candidate);
  if (realSource !== realRepo && !realSource.startsWith(`${realRepo}${path.sep}`)) {
    throw validationError("Ask rule source reference escapes the destination Project repository.", {
      reason: "stale-source",
      ruleId: rule.id,
      sourceRef: rule.sourceRef
    });
  }
  return createHash("sha256").update(readFileSync(realSource)).digest("hex");
}

function matchOne(request: string, rule: ValidatedAskRule | AskRuleDefinition): AskRuleMatch | null {
  if (!request.toLocaleLowerCase("en-US").startsWith(rule.prefix.toLocaleLowerCase("en-US"))) return null;
  const next = request.slice(rule.prefix.length, rule.prefix.length + 1);
  let boundary: AskRuleMatch["boundary"];
  if (!next) boundary = "end";
  else if (next === ":") boundary = "colon";
  else if (/\s/u.test(next)) boundary = "whitespace";
  else return null;
  const consumed = boundary === "end" ? rule.prefix.length : rule.prefix.length + 1;
  return {
    rule: rule as ValidatedAskRule,
    boundary,
    matchedText: request.slice(0, consumed),
    payload: request.slice(consumed).replace(/^\s+/u, "")
  };
}

function extractSubmittedLinks(value: string): string[] {
  const found = value.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  return found.map((link) => link.replace(/[),.;!?]+$/u, ""));
}

function canonicalLinkCandidate(submitted: string): string {
  try {
    const url = new URL(submitted);
    if ((url.hostname === "google.com" || url.hostname.endsWith(".google.com")) && url.pathname === "/url") {
      const wrapped = url.searchParams.get("q") ?? url.searchParams.get("url");
      if (wrapped && /^https?:\/\//iu.test(wrapped)) return wrapped;
    }
  } catch {
    return submitted;
  }
  return submitted;
}

function attachmentInventory(metadata: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const attachments = metadata?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment, index) => {
    if (!isRecord(attachment)) return { index, value: String(attachment) };
    const result: Record<string, unknown> = { index };
    for (const key of ["filename", "mediaType", "byteSize", "sha256", "storageRef"] as const) {
      const value = attachment[key];
      if (typeof value === "string" || typeof value === "number") result[key] = value;
    }
    return result;
  });
}

function sortStringRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizePrefix(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) throw validationError(`${label} contains unsupported fields.`, { unsupported });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
