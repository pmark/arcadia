import { ArcadiaError, validationError } from "../cli/errors.js";
import { enclosingProjectRoot } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { DEFAULT_BUDGET_BYTES, DEFAULT_LIMIT, MAX_LIMIT, lookup, resolveWayRoot, type LookupResult } from "../way/lookup.js";

export interface WayLookupOptions {
  question: string;
  budget?: string | number;
  limit?: string | number;
}

export interface WayLookupData extends LookupResult {
  /** The directory the corpus was read from. */
  root: string;
  /** `project`: the enclosing Project; `package`: Arcadia's own checkout. */
  rootSource: "project" | "package";
  /** The enclosing Project, if any, whether or not it supplied the guidance. */
  projectRoot: string | null;
}

function wholeNumber(value: string | number | undefined, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const text = String(value).trim();
  if (!/^\d{1,9}$/.test(text)) throw validationError(`--${name} must be a whole number from ${minimum} to ${maximum}.`, { [name]: value });
  const parsed = Number(text);
  if (parsed < minimum || parsed > maximum) throw validationError(`--${name} must be a whole number from ${minimum} to ${maximum}.`, { [name]: value });
  return parsed;
}

/** Read-only: ranks passages of the checked-in guidance for a question. Opens no database and writes nothing. */
export function runWayLookupCommand(options: WayLookupOptions): CommandSuccess<WayLookupData> {
  if (!options.question.trim()) throw validationError("Give a question to look up in the Way.", {});
  const budget = wholeNumber(options.budget, "budget", DEFAULT_BUDGET_BYTES, 0, 1_000_000);
  const limit = wholeNumber(options.limit, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const projectRoot = enclosingProjectRoot();
  const found = resolveWayRoot({ projectRoot, moduleUrl: import.meta.url });
  if (!found) {
    throw new ArcadiaError(
      "VALIDATION_ERROR",
      "The Way's guidance was not found: neither the enclosing Project nor this Arcadia installation holds docs/agent-guidance/index.json. Run this inside an Arcadia checkout or an adopting Project.",
      1,
      {}
    );
  }
  const result = lookup(found.root, options.question, { budget, limit });
  return createSuccess({ command: "way.lookup", data: { ...result, root: found.root, rootSource: found.source, projectRoot }, warnings: result.warnings });
}

function describeRoot(data: WayLookupData): string {
  if (data.rootSource === "project") return `Way root: ${data.root} (the enclosing Project's guidance)`;
  if (data.projectRoot) {
    return `Way root: ${data.root} (Arcadia's own checkout, NOT the Project's: ${data.projectRoot} has no docs/agent-guidance/index.json)`;
  }
  return `Way root: ${data.root} (Arcadia's own checkout; no enclosing Project)`;
}

/**
 * The excerpts and their addresses, with the root they came from. A match is
 * only a statement about wording, so the first line says so; when nothing
 * matched, only that and the nearest addresses are shown.
 */
export function renderWayLookupSuccess(response: CommandSuccess<WayLookupData>): string[] {
  const { data } = response;
  if (!data.matched) {
    return [
      "The Way does not clearly answer this question.",
      describeRoot(data),
      ...(data.nearest.length ? ["Nearest passages by wording (not an answer):", ...data.nearest.map((hit) => `  ${hit.address}  ${hit.heading}`)] : [])
    ];
  }
  const lines: string[] = [
    "These are the closest passages by wording and may not answer the question; read them before relying on them.",
    describeRoot(data),
    ""
  ];
  for (const hit of data.results) {
    lines.push(`${hit.address} (line ${hit.line}, ${hit.sourceClass}${hit.truncated ? ", truncated: read the address for the rest" : ""})`);
    if (hit.excerpt) lines.push(hit.excerpt);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
