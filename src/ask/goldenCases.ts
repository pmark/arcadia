import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The checked-in golden set of Ask routing (Plan Action ask-golden-set-and-vanish-report): paraphrased or synthetic
 * Ask texts, never raw operator Ask text, each with the type Arcadia must hear. An agent proposes cases in a PR and a
 * reviewed merge is their approval. `tests/ask-golden.test.ts` replays every case through the pure routing functions.
 */
export const GOLDEN_RELATIVE_PATH = path.join("tests", "fixtures", "ask-golden.jsonl");

export const GOLDEN_TYPES = ["work", "idea", "status", "unclear", "answer"] as const;
export type GoldenType = (typeof GOLDEN_TYPES)[number];

export interface GoldenCorrection {
  /** The text the operator corrected (synthetic). It is the memo's key. */
  text: string;
  type: "work" | "idea" | "status";
  source?: "cli" | "discord" | "answer" | "model";
}

export interface GoldenCase {
  id: string;
  /** A paraphrase or synthetic Ask text. Never copy a real Ask. */
  text: string;
  expected_type: GoldenType;
  /** The execution path the stewardship must recommend. */
  expected_path?: string;
  /** True when the Ask must be routed by a memo of one of `corrections`. Default false. */
  expected_memo?: boolean;
  /** Operator corrections that exist before the Ask is sent, seeded in the test only. */
  corrections?: GoldenCorrection[];
  /** Why the case exists, in a few words. */
  note?: string;
}

export class GoldenSetError extends Error {}

/** Parses the JSONL set, failing loudly on any malformed line so a bad case can never be skipped silently. */
export function parseGoldenCases(content: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const where = `ask-golden.jsonl line ${index + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new GoldenSetError(`${where} is not valid JSON.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoldenSetError(`${where} must be a JSON object.`);
    const record = value as Record<string, unknown>;
    for (const key of ["id", "text", "expected_type"] as const) {
      const field = record[key];
      if (typeof field !== "string" || !field.trim()) {
        throw new GoldenSetError(`${where} needs a non-empty string "${key}".`);
      }
    }
    if (!(GOLDEN_TYPES as readonly string[]).includes(record.expected_type as string)) {
      throw new GoldenSetError(`${where}: expected_type must be one of ${GOLDEN_TYPES.join(", ")}.`);
    }
    if (record.expected_path !== undefined && typeof record.expected_path !== "string") {
      throw new GoldenSetError(`${where}: expected_path must be a string.`);
    }
    if (record.expected_memo !== undefined && typeof record.expected_memo !== "boolean") {
      throw new GoldenSetError(`${where}: expected_memo must be a boolean.`);
    }
    if (record.corrections !== undefined) {
      const ok =
        Array.isArray(record.corrections) &&
        record.corrections.every(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof (entry as GoldenCorrection).text === "string" &&
            ["work", "idea", "status"].includes((entry as GoldenCorrection).type)
        );
      if (!ok) throw new GoldenSetError(`${where}: corrections must be a list of {text, type: work|idea|status}.`);
    }
    const id = record.id as string;
    if (seen.has(id)) throw new GoldenSetError(`${where}: duplicate id "${id}".`);
    seen.add(id);
    cases.push(record as unknown as GoldenCase);
  });
  return cases;
}

/** The golden set under `repoRoot`, or null when the file is absent (a packaged CLI run outside a checkout). */
export function loadGoldenCases(repoRoot: string): GoldenCase[] | null {
  const file = path.join(repoRoot, GOLDEN_RELATIVE_PATH);
  if (!existsSync(file)) return null;
  return parseGoldenCases(readFileSync(file, "utf8"));
}
