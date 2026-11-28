import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { classifyCard, type CardClassification, type HeldEvent } from "./operator-card-state";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Classify every card of one operator-script library from its recorded files. Read-only: nothing in the library is
 * created, renamed or rewritten. An unreadable entry is skipped (it stays actionable, so a read problem never hides a card).
 */
export async function readCardStates(library: string, now: Date = new Date()): Promise<CardClassification[]> {
  const ids = (await readdir(library)).filter(name => name.endsWith(".json") && !name.endsWith(".consumed.json")).map(name => name.slice(0, -5)).filter(id => SAFE_ID.test(id));
  const states = await Promise.all(ids.map(async id => {
    const descriptor = parseJson<{ title?: string; expires_at?: string }>(await readText(path.join(library, `${id}.json`)));
    if (!descriptor) return null;
    const history = (await readText(path.join(library, `${id}.held-history.jsonl`)) ?? "").split("\n").map(line => parseJson<HeldEvent>(line.trim() || null)).filter((e): e is HeldEvent => e !== null);
    return classifyCard({ id, title: descriptor.title, consumed: parseJson(await readText(path.join(library, `${id}.consumed.json`))), heldHistory: history, expiresAt: descriptor.expires_at ?? null }, now);
  }));
  return states.filter((s): s is CardClassification => s !== null);
}
