import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { readProductionPolicySafely } from "../production/policy.js";

/**
 * The run window, as a visible signal for `arcadia work monitor`.
 *
 * Merging to origin/main while a live run or a waiting START card depends on
 * it makes the card refuse (`origin main is ..., not the reviewed revision`)
 * or disturbs the run. This is a read-only signal: it blocks nothing, adds no
 * gate and grants no authority. It reads the same two sources everyone
 * already trusts: the production policy (as `arcadia production status`
 * does) and the operator-script library (descriptor plus consumed marker).
 * A source that cannot be read makes the state `unknown`, never an error.
 */

export interface RunWindowReason {
  kind: "production_active" | "start_card_waiting";
  /** Production: the policy state; card: the card id. */
  subject: string;
  /** ISO instant the window is known to hold until; null when it has no known end (Active production). */
  until: string | null;
  detail: string;
}

export interface RunWindow {
  /** `open`: merging to main now would disturb a run or a waiting card. `unknown`: a source could not be read. */
  state: "open" | "closed" | "unknown";
  reasons: RunWindowReason[];
  /** One line per source that could not be read. */
  unknown: string[];
  observedAt: string;
}

export interface RunWindowDeps {
  now(): Date;
  /** The operator-script library directory (descriptors and `<id>.consumed.json` markers). */
  libraryDir(): string;
  /** The local view of origin/main, or null when it cannot be resolved. */
  originMain(): string | null;
}

/** Same resolution order as /actions: an explicit override, else the main checkout's library, never a worktree's copy. */
export function defaultRunWindowDeps(repositoryPath: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): RunWindowDeps {
  return {
    now: () => new Date(),
    libraryDir: () => {
      const override = env.ARCADIA_OPERATOR_SCRIPT_LIBRARY?.trim();
      if (override) return override;
      try {
        const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
          cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000
        }).trim();
        const candidate = path.join(path.dirname(common), "artifacts", "generated", "operator-scripts");
        if (existsSync(candidate)) return candidate;
      } catch {
        // fall through to the same default /actions uses
      }
      return path.join(os.homedir(), "Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts");
    },
    originMain: () => {
      try {
        const sha = execFileSync("git", ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"], {
          cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000
        }).trim();
        return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
      } catch {
        return null;
      }
    }
  };
}

export function observeRunWindow(db: Database.Database, deps: RunWindowDeps = defaultRunWindowDeps()): RunWindow {
  const now = deps.now();
  const reasons: RunWindowReason[] = [];
  const unknown: string[] = [];

  try {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") {
      unknown.push(`managed production state could not be read (${oneLine(read.reason)})`);
    } else if (read.policy.desiredState === "active") {
      reasons.push({
        kind: "production_active",
        subject: "managed production Active",
        until: null,
        detail: `managed production is Active (policy revision ${read.policy.revision}, epoch ${read.policy.epoch}); the window closes at the run's terminal production Off`
      });
    }
  } catch (error) {
    unknown.push(`managed production state could not be read (${oneLine(error)})`);
  }

  try {
    reasons.push(...waitingStartCards(deps, now, unknown));
  } catch (error) {
    unknown.push(`the operator-script library could not be read (${oneLine(error)})`);
  }

  const state = reasons.length > 0 ? "open" : unknown.length > 0 ? "unknown" : "closed";
  return { state, reasons, unknown, observedAt: now.toISOString() };
}

function waitingStartCards(deps: RunWindowDeps, now: Date, unknown: string[]): RunWindowReason[] {
  const library = deps.libraryDir();
  const names = readdirSync(library).filter((name) => name.endsWith(".json") && !name.endsWith(".consumed.json")).sort();
  const candidates: Array<{ id: string; reviewedRevision: string; expiresAt: string; expiry: number }> = [];
  let unreadable = 0;
  for (const name of names) {
    let descriptor: { startRun?: { reviewedRevision?: unknown }; expires_at?: unknown };
    try {
      descriptor = JSON.parse(readFileSync(path.join(library, name), "utf8"));
    } catch {
      unreadable += 1;
      continue;
    }
    const pins = descriptor?.startRun;
    if (!pins || typeof pins !== "object") continue;
    const id = name.slice(0, -".json".length);
    if (typeof pins.reviewedRevision !== "string" || typeof descriptor.expires_at !== "string") {
      unreadable += 1;
      continue;
    }
    const expiry = Date.parse(descriptor.expires_at);
    if (!Number.isFinite(expiry)) {
      unreadable += 1;
      continue;
    }
    if (expiry <= now.getTime() || existsSync(path.join(library, `${id}.consumed.json`))) continue;
    candidates.push({ id, reviewedRevision: pins.reviewedRevision, expiresAt: new Date(expiry).toISOString(), expiry });
  }
  if (unreadable > 0) unknown.push(`${unreadable} operator-script descriptor${unreadable === 1 ? "" : "s"} could not be read, so a waiting START card may be hidden`);
  if (candidates.length === 0) return [];

  const origin = deps.originMain();
  if (!origin) {
    unknown.push("the local origin/main revision could not be resolved, so waiting START cards cannot be matched");
    return [];
  }
  return candidates
    .filter((card) => card.reviewedRevision === origin)
    .map((card) => ({
      kind: "start_card_waiting" as const,
      subject: card.id,
      until: card.expiresAt,
      detail: `START card ${card.id} is ready to press at origin/main ${origin.slice(0, 12)} and expires ${card.expiresAt}`
    }));
}

/** Lines for the top of the text output; empty when the window is closed. */
export function formatRunWindowLines(window: RunWindow): string[] {
  if (window.state === "closed") return [];
  if (window.state === "unknown") return [`Run window: UNKNOWN (${window.unknown.join("; ")}).`];
  const lines = ["Run window: OPEN. Do not merge to main now: it will make a waiting START card refuse or disturb a live run."];
  for (const reason of window.reasons) {
    lines.push(`- ${reason.detail}${reason.until ? ` (until ${reason.until})` : ""}.`);
  }
  for (const item of window.unknown) lines.push(`- Also unknown: ${item}.`);
  return lines;
}

function oneLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/g, " ").trim().slice(0, 160);
}
