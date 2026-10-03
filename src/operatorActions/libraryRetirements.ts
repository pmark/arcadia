import { createHash } from "node:crypto";

/** A legacy library entry the CI gate may skip (legacyRetirements.json); /runs never reads it. */
export interface OperatorScriptRetirement {
  id: string;
  descriptorSha256: string;
  scriptSha256: string;
  outcome: string;
  reason: string;
}
export class RetirementManifestError extends Error {
  readonly reason = "INVALID_RETIREMENT_MANIFEST";
}
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha = /^[0-9a-f]{64}$/;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const fail = (message: string): never => { throw new RetirementManifestError(message); };

/** Exact id -> pinned hashes; no globs, prefixes or id-only entries. */
export function parseRetirementManifest(value: unknown): Map<string, OperatorScriptRetirement> {
  const m = value as { schema?: unknown; retirements?: unknown } | null;
  if (!m || typeof m !== "object" || m.schema !== "arcadia-operator-script-retirements-v1" || !Array.isArray(m.retirements)) {
    fail("Retirement manifest must be an arcadia-operator-script-retirements-v1 object with a retirements list.");
  }
  const entries = new Map<string, OperatorScriptRetirement>();
  for (const raw of (m as { retirements: unknown[] }).retirements) {
    const e = raw as OperatorScriptRetirement;
    if (!e || typeof e !== "object" || Object.keys(e).sort().join(",") !== "descriptorSha256,id,outcome,reason,scriptSha256" ||
        !slug.test(e.id) || !sha.test(e.descriptorSha256) || !sha.test(e.scriptSha256) || !text(e.outcome) || !text(e.reason)) {
      fail("Each retirement needs exactly an id slug, descriptor and script sha256, outcome and reason.");
    }
    if (entries.has(e.id)) fail(`Duplicate retirement id ${e.id}.`);
    entries.set(e.id, e);
  }
  return entries;
}

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Returns the retirement only when both files are byte-identical to the pinned pair. */
export function matchRetirement(entries: Map<string, OperatorScriptRetirement>, id: string, descriptor: Buffer, script: Buffer): OperatorScriptRetirement | undefined {
  const e = entries.get(id);
  return e && e.descriptorSha256 === sha256(descriptor) && e.scriptSha256 === sha256(script) ? e : undefined;
}
