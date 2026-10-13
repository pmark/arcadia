/**
 * The digest a Decision approval can be pinned to: what the operator was shown, in order, and what applying it
 * would touch. Dependency-free (node:crypto only) so the dashboard route and the CLI writer compute it with the SAME
 * function and no commander, database or filesystem import follows it.
 *
 * Canonical form: JSON of `[question, action ?? null, project ?? null, [[label, consequence, effect ?? null], ...]]`,
 * options in file order. `action` and `project` are the Decision's own fields: a `defer` effect parks THAT Action in
 * THAT Project, so they are part of what is pinned.
 */
import { createHash } from "node:crypto";

export interface DigestOption {
  label: string;
  consequence: string;
  effect?: string | null;
}

export interface DigestTarget {
  action?: string | null;
  project?: string | null;
}

export function decisionOptionsDigest(question: string, options: ReadonlyArray<DigestOption>, target: DigestTarget = {}): string {
  const canonical = JSON.stringify([
    question,
    target.action ?? null,
    target.project ?? null,
    options.map((option) => [option.label, option.consequence, option.effect ?? null])
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
