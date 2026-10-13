/**
 * Frozen shared records: append-only files that collided across PRs are listed in
 * docs/reports/frozen-records.json with the sha256 of their exact bytes. Hash-based, so
 * no base ref is needed. New entries go in one file each under the named directory.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const FROZEN_MANIFEST = "docs/reports/frozen-records.json";
export interface FrozenRecord { path: string; sha256: string; record_new_entries_in: string }

export const sha256 = (content: Buffer | string): string => createHash("sha256").update(content).digest("hex");

export function checkFrozenRecords(repoRoot: string, manifestText?: string): string[] {
  const manifestPath = path.join(repoRoot, FROZEN_MANIFEST);
  let text = manifestText;
  if (text === undefined) {
    if (!existsSync(manifestPath)) return [`${FROZEN_MANIFEST}: manifest is missing`];
    text = readFileSync(manifestPath, "utf8");
  }
  let manifest: { frozen?: FrozenRecord[] };
  try { manifest = JSON.parse(text) as { frozen?: FrozenRecord[] }; } catch { return [`${FROZEN_MANIFEST}: invalid JSON`]; }
  if (!Array.isArray(manifest.frozen)) return [`${FROZEN_MANIFEST}: missing frozen array`];
  const errors: string[] = [];
  for (const entry of manifest.frozen) {
    const file = path.join(repoRoot, entry.path);
    const remedy = `record new entries as one file under ${entry.record_new_entries_in}; do not edit frozen files`;
    if (!existsSync(file)) { errors.push(`${entry.path}: frozen file is missing; ${remedy}`); continue; }
    if (sha256(readFileSync(file)) !== entry.sha256) errors.push(`${entry.path}: frozen file changed; ${remedy}`);
  }
  return errors;
}
