import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { resolveActivePlan } from "../docs/dispatch.js";
import { readProductionPolicySafely } from "../production/policy.js";
import { listOpenRedAlerts } from "../production/redAlerts.js";
import { listOperatorEscalations } from "../production/tick.js";
import { sha256, type CapsuleBudget, type CapsulePr, type CapsuleSources } from "./capsule.js";
import { ensureCoordinatorDirectories, type CoordinatorPaths } from "./paths.js";

/** PR reads are cached this long (design section b: "each tick, cached 5 min"). */
export const PR_CACHE_MS = 5 * 60 * 1000;
const RECENT_ANSWERED = 10;

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim() || null;
  } catch {
    return null;
  }
}

function gh(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("gh", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function summarizeChecks(rollup: Array<{ conclusion?: string | null; status?: string | null; state?: string | null }> | undefined): CapsulePr["checks"] {
  if (!rollup) return "unknown";
  if (rollup.length === 0) return "none";
  const states = rollup.map((check) => (check.conclusion || check.state || check.status || "").toUpperCase());
  if (states.some((state) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(state))) return "fail";
  if (states.every((state) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state))) return "pass";
  return "pending";
}

/** One PR's durable facts from `gh`: head, newest verdict-marker head, checks, merge state. Ids only, never tokens or bodies. */
export function readPrFromGh(repoRoot: string, number: number): CapsulePr {
  const view = gh(repoRoot, ["pr", "view", String(number), "--json", "number,headRefOid,mergeStateStatus,statusCheckRollup"]);
  if (!view) return { number, headSha: null, verdictMarkerHead: null, checks: "unknown", mergeState: null, gate: null };
  const parsed = JSON.parse(view) as { headRefOid?: string; mergeStateStatus?: string; statusCheckRollup?: Array<{ conclusion?: string; status?: string; state?: string }> };
  const markers = gh(repoRoot, ["api", "--paginate", `repos/{owner}/{repo}/issues/${number}/comments`, "--jq", ".[].body | select(test(\"Independent review, head [0-9a-f]{7,40}\")) | capture(\"Independent review, head (?<sha>[0-9a-f]{7,40})\").sha"]);
  const heads = (markers ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    number,
    headSha: parsed.headRefOid ?? null,
    verdictMarkerHead: heads.at(-1) ?? null,
    checks: summarizeChecks(parsed.statusCheckRollup),
    mergeState: parsed.mergeStateStatus ?? null,
    gate: null
  };
}

function cachedPrs(paths: CoordinatorPaths, numbers: number[], read: (number: number) => CapsulePr, now: Date): CapsulePr[] {
  if (numbers.length === 0) return [];
  ensureCoordinatorDirectories(paths);
  let cache: { entries: Record<string, { at: string; pr: CapsulePr }> } = { entries: {} };
  if (existsSync(paths.prCache)) {
    try { cache = JSON.parse(readFileSync(paths.prCache, "utf8")); } catch { /* rebuilt below */ }
  }
  const result = numbers.map((number) => {
    const hit = cache.entries[String(number)];
    if (hit && now.getTime() - Date.parse(hit.at) < PR_CACHE_MS) return hit.pr;
    const pr = read(number);
    cache.entries[String(number)] = { at: now.toISOString(), pr };
    return pr;
  });
  const temporary = `${paths.prCache}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  renameSync(temporary, paths.prCache);
  return result;
}

function decisionsFromRepository(repoRoot: string): { open: string[]; recentlyAnswered: string[]; pendingMerge: string[] } {
  const directory = path.join(repoRoot, "docs", "decisions");
  if (!existsSync(directory)) return { open: [], recentlyAnswered: [], pendingMerge: [] };
  const open: string[] = [];
  const answered: string[] = [];
  for (const name of readdirSync(directory).filter((file) => /^\d{4}-.*\.md$/.test(file)).sort()) {
    const head = readFileSync(path.join(directory, name), "utf8").slice(0, 4_000);
    const status = /^status:\s*(\S+)/m.exec(head)?.[1];
    const id = name.slice(0, 4);
    if (status === "open") open.push(id);
    else if (status === "approved") answered.push(id);
  }
  // Decisions on open PRs are not read here: that needs a `gh` listing the relay does not yet make.
  return { open, recentlyAnswered: answered.slice(-RECENT_ANSWERED), pendingMerge: [] };
}

function readBudget(paths: CoordinatorPaths): CapsuleBudget | null {
  if (!existsSync(paths.budget)) return null;
  try {
    return JSON.parse(readFileSync(paths.budget, "utf8")) as CapsuleBudget;
  } catch {
    return null;
  }
}

/** The relay-owned sources, read from their canonical homes. */
export function defaultCapsuleSources(input: { db: Database.Database; repoRoot: string; project: string; paths: CoordinatorPaths; now: Date }): CapsuleSources {
  const { db, repoRoot, project, paths, now } = input;
  return {
    plan() {
      const resolution = resolveActivePlan(repoRoot, project);
      return {
        activePlan: resolution.plan?.relativePath ?? resolution.project?.activePlan ?? null,
        currentAction: resolution.project?.currentAction ?? resolution.plan?.currentAction ?? null,
        mainSha: git(repoRoot, ["rev-parse", "origin/main"])
      };
    },
    production() {
      const read = readProductionPolicySafely(db);
      return {
        status: read.status === "ok" ? read.policy.desiredState : `unavailable: ${read.reason}`,
        revision: read.status === "ok" ? read.policy.revision : null,
        epoch: read.status === "ok" ? read.policy.epoch : null,
        openEscalations: read.status === "ok" ? listOperatorEscalations(db).map((escalation) => ({ actionKey: escalation.actionKey, kind: escalation.kind })) : [],
        redAlerts: read.status === "ok" ? listOpenRedAlerts(db).map((alert) => ({ id: alert.id, trigger: String(alert.trigger) })) : []
      };
    },
    prs(numbers) {
      return cachedPrs(paths, numbers, (number) => readPrFromGh(repoRoot, number), now);
    },
    sessions() {
      const rows = db.prepare(`SELECT id, provider, model, status, updated_at FROM agent_sessions
        WHERE status IN ('prepared', 'running', 'needs_input') ORDER BY prepared_at DESC LIMIT 50`).all() as Array<{ id: string; provider: string; model: string; status: string; updated_at: string }>;
      return rows.map((row) => ({ id: row.id, owner: `${row.provider}:${row.model}`, status: row.status, lastProgressAt: row.updated_at }));
    },
    decisions() {
      return decisionsFromRepository(repoRoot);
    },
    pings() {
      const pending = db.prepare("SELECT id, kind, created_at FROM operator_pings WHERE status = 'pending' ORDER BY created_at").all() as Array<{ id: string; kind: string; created_at: string }>;
      const recent = db.prepare("SELECT id, kind, message, created_at FROM operator_pings ORDER BY created_at DESC LIMIT 5").all() as Array<{ id: string; kind: string; message: string; created_at: string }>;
      return {
        pending: pending.map((ping) => ({ id: ping.id, kind: ping.kind, createdAt: ping.created_at })),
        // A signature, not the text: the capsule carries ids, never message bodies.
        recent: recent.map((ping) => ({ id: ping.id, kind: ping.kind, signature: sha256(ping.message).slice(0, 16), createdAt: ping.created_at }))
      };
    },
    budget() {
      return readBudget(paths);
    }
  };
}
