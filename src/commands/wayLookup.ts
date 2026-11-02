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
  const found = resolveWayRoot({ projectRoot: enclosingProjectRoot(), moduleUrl: import.meta.url });
  if (!found) {
    throw new ArcadiaError(
      "VALIDATION_ERROR",
      "The Way's guidance was not found: neither the enclosing Project nor this Arcadia installation holds docs/agent-guidance/index.json. Run this inside an Arcadia checkout or an adopting Project.",
      1,
      {}
    );
  }
  const result = lookup(found.root, options.question, { budget, limit });
  return createSuccess({ command: "way.lookup", data: { ...result, root: found.root, rootSource: found.source }, warnings: result.warnings });
}

/** The excerpts and their addresses, and nothing else; when the Way does not clearly answer, only that, and where the nearest text is. */
export function renderWayLookupSuccess(response: CommandSuccess<WayLookupData>): string[] {
  const { data } = response;
  if (!data.confident) {
    return [
      "The Way does not clearly answer this question.",
      ...(data.nearest.length ? ["Nearest passages (not an answer):", ...data.nearest.map((hit) => `  ${hit.address}  ${hit.heading}`)] : [])
    ];
  }
  const lines: string[] = [];
  for (const hit of data.results) {
    lines.push(`${hit.address} (line ${hit.line}, ${hit.sourceClass}${hit.truncated ? ", truncated: read the address for the rest" : ""})`);
    if (hit.excerpt) lines.push(hit.excerpt);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
