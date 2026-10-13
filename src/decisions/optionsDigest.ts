/**
 * The digest a Decision approval can be pinned to: what the operator was shown, in order, and nothing else.
 * Dependency-free (node:crypto only) so the dashboard route and the CLI writer compute it with the SAME function
 * and no commander, database or filesystem import follows it.
 *
 * Canonical form: JSON of `[question, [[label, consequence, effect ?? null], ...]]`, options in file order.
 */
import { createHash } from "node:crypto";

export interface DigestOption {
  label: string;
  consequence: string;
  effect?: string | null;
}

export function decisionOptionsDigest(question: string, options: ReadonlyArray<DigestOption>): string {
  const canonical = JSON.stringify([question, options.map((option) => [option.label, option.consequence, option.effect ?? null])]);
  return createHash("sha256").update(canonical).digest("hex");
}
