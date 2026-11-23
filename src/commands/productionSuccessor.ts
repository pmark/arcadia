import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  SUCCESSOR_PREFLIGHT_TIMEOUT_MS, SUCCESSOR_REPLAY_TIMEOUT_MS, SUCCESSOR_STATE_SCHEMA, emptySuccessorState, runSuccessorPressStep, type SuccessorOutcome, type SuccessorPorts, type SuccessorState
} from "../production/successorPress.js";
import { failedBatchClearancePath, parseFailedBatchClearance } from "../operatorActions/startRunDerive.js";
import { checkReplayReceipt, replayCardIdentity, replayReceiptPath } from "../operatorActions/startRunReplayReceipt.js";
import { runProductionDeactivateCommand } from "./production.js";
import { dashboardLink, type LivenessPingInput } from "./productionLiveness.js";
import { runPingSendCommand } from "./ping.js";
import { mainCheckout, realStartRunPinsDeps, runStartRunGrantStatusCommand, type StartRunPinsDeps } from "./startRun.js";
import { runStartRunDeriveCommand, type StartRunDeriveData } from "./startRunDerive.js";

/**
 * The real ports of the successor-press step (`src/production/successorPress.ts`), run from the existing liveness timer with
 * `--successor-press`: no agent session, no model call. Every port reuses a command that already exists (`start-run grant-status`
 * and `derive`, `production deactivate --rowan-off`, the card's own `preflight`, `pnpm production-replay --card`, `arcadia ping`
 * and the /actions runner's delegated press), so the step adds no check and removes none.
 */
const STATE_FILE = "successor-press.json";
const PING_AGENT = "Successor press";
const DELEGATION = { decision: "0173", agent: "rowan" } as const;
/** The dashboard on this host: a delegated press carries no browser proof, so loopback is the route the runner already accepts. */
export const SUCCESSOR_PRESS_DASHBOARD = "http://127.0.0.1:3020";

export interface ProductionSuccessorOptions { workspace?: string; repository?: string; library?: string; dashboardUrl?: string; pressUrl?: string }
export interface ProductionSuccessorDependencies {
  now?: () => number;
  /** Replaces every real port; the fixture tests drive the step through this seam. */
  ports?: (now: Date) => SuccessorPorts;
  queuePing?: (input: LivenessPingInput) => { id: string };
  pins?: StartRunPinsDeps;
}
export interface ProductionSuccessorData { outcome: SuccessorOutcome }

const statePath = (workspacePath: string): string => path.join(workspacePath, ".arcadia", STATE_FILE);

export function readSuccessorState(workspacePath: string): SuccessorState {
  try {
    const value = JSON.parse(readFileSync(statePath(workspacePath), "utf8")) as Partial<SuccessorState>;
    if (value.schema !== SUCCESSOR_STATE_SCHEMA || !Array.isArray(value.pressed) || !Array.isArray(value.offs)) throw new Error("malformed");
    return { schema: SUCCESSOR_STATE_SCHEMA, grant: value.grant ?? null, ended: value.ended ?? null, pressed: value.pressed, offs: value.offs, ...(value.mainMoved ? { mainMoved: value.mainMoved } : {}) };
  } catch {
    // An unreadable record restarts the step: the cost is a repeated check, never a repeated press, because a pressed card is consumed.
    return emptySuccessorState();
  }
}

function writeSuccessorState(workspacePath: string, state: SuccessorState): void {
  const target = statePath(workspacePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  try { renameSync(temporary, target); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

const readOrNull = (file: string): string | null => { try { return readFileSync(file, "utf8"); } catch { return null; } };
const tail = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: Buffer | string }).stderr;
  return `${text}${stderr ? ` ${String(stderr).trim().split("\n").slice(-3).join(" ")}` : ""}`.slice(0, 400);
};

/** Main's check runs, required contexts when the branch protection can be read, else every run: green when none is pending or failing. */
function readMainChecks(repository: string): { green: boolean; detail: string } {
  try {
    const gh = (args: string[]): string => execFileSync("gh", args, { cwd: repository, encoding: "utf8", timeout: 30_000 });
    const runs = JSON.parse(gh(["api", "repos/{owner}/{repo}/commits/main/check-runs?per_page=100", "--jq", "[.check_runs[] | {name, status, conclusion}]"])) as Array<{ name: string; status: string; conclusion: string | null }>;
    let required: string[] | null = null;
    try { required = JSON.parse(gh(["api", "repos/{owner}/{repo}/branches/main/protection/required_status_checks", "--jq", ".contexts"])) as string[]; } catch { required = null; }
    const judged = required && required.length > 0 ? runs.filter((run) => required.includes(run.name)) : runs;
    if (judged.length === 0) return { green: false, detail: "main has no check runs to read" };
    const bad = judged.filter((run) => run.status !== "completed" || !["success", "skipped", "neutral"].includes(String(run.conclusion)));
    return bad.length === 0 ? { green: true, detail: `${judged.length} checks green on main` } : { green: false, detail: `main's ${bad.map((run) => `${run.name} (${run.status}${run.conclusion ? `/${run.conclusion}` : ""})`).join(", ")} not green` };
  } catch (error) {
    return { green: false, detail: `main's checks could not be read: ${tail(error)}` };
  }
}

/**
 * The holds that still block a press: one line per `<id>.held.json` whose card can still be pressed. A hold on a consumed card, on a
 * card whose descriptor is gone (a retired card leaves its hold behind) or whose `expires_at` has passed blocks nothing, the same
 * cards the run window skips. A descriptor that cannot be judged (unreadable, no valid `expires_at`) keeps the hold: fail closed.
 */
export function blockingHolds(library: string, files: string[], now: Date): string[] {
  const pressable = (id: string): boolean => {
    if (existsSync(path.join(library, `${id}.consumed.json`))) return false;
    try {
      const expiresAt = (JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8")) as { expires_at?: unknown } | null)?.expires_at;
      const expiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
      return Number.isFinite(expiry) ? expiry > now.getTime() : true;
    } catch (error) {
      // Only a descriptor that is absent (ENOENT) is gone; any other read error (EACCES, EISDIR, EIO) or bad JSON cannot be judged.
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  };
  return files.filter((name) => name.endsWith(".held.json")).map((name) => name.slice(0, -".held.json".length)).filter(pressable).map((id) => `START card ${id} is held`);
}

/** The real ports, over one workspace, repository and card library. Derivation is read once per run and shared by `batch` and `derive`. */
export function realSuccessorPorts(options: ProductionSuccessorOptions, now: Date, queuePing: (input: LivenessPingInput) => { id: string }, pins: StartRunPinsDeps = realStartRunPinsDeps): SuccessorPorts {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repository = realpathSync(options.repository ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const library = options.library ?? path.join(mainCheckout(repository, pins), "artifacts", "generated", "operator-scripts");
  const base = { repository, workspace: workspacePath, library };
  let derivation: CommandSuccess<StartRunDeriveData> | null = null;
  const derivedOnce = (): CommandSuccess<StartRunDeriveData> => derivation ??= runStartRunDeriveCommand(base, pins);
  const release = (id: string): string[] => [path.join(library, `${id}.json`), path.join(library, `${id}.sh`), path.join(library, "reviewed", `${id}.json`)];

  return {
    now,
    grant: () => {
      const status = runStartRunGrantStatusCommand(base, pins).data;
      return { open: status.open, plan: status.plan, approvalCard: status.approvalCard, approvalRun: status.approvalRun };
    },
    production: () => {
      const production = pins.production(workspacePath);
      const scopeComplete = production.desiredState === "active" && withReadOnlyDatabase(workspacePath, (db) =>
        db.prepare("SELECT 1 FROM events WHERE event_type = 'managed_production.scope_complete' AND json_extract(payload_json, '$.policyRevision') = ? LIMIT 1").get(production.revision) !== undefined);
      return { desiredState: production.desiredState === "active" ? "active" : production.desiredState === "inactive" ? "inactive" : "unknown", liveAdmissions: production.liveAdmissions, scopeComplete, revision: production.revision };
    },
    batch: () => {
      const data = derivedOnce().data;
      if (!data.derived && /PREVIOUS_UNSETTLED/.test(data.message ?? "")) return { press: "unknown", kind: "unsettled" };
      const latest = data.observations.latestPress;
      return latest ? { press: latest.press, kind: latest.kind as "failed-attempt" | "clean-batch" | "no-session" } : null;
    },
    originMain: () => {
      try { return execFileSync("git", ["ls-remote", "--exit-code", "origin", "refs/heads/main"], { cwd: repository, encoding: "utf8", timeout: 30_000 }).split(/\s+/)[0] || null; } catch { return null; }
    },
    mainChecks: () => readMainChecks(repository),
    holds: () => blockingHolds(library, pins.listFiles(library) ?? [], now),
    clearance: (press) => parseFailedBatchClearance(readOrNull(failedBatchClearancePath(library, press))),
    // The derive command reads a failed press's recorded clearance itself, so the argument is the step's own bookkeeping.
    derive: () => {
      const data = derivedOnce().data;
      return data.derived && data.card ? { ok: true, card: data.card } : { ok: false, reason: (data.reason ?? "CARD_INVALID") as never, message: data.message ?? "no card was derived" };
    },
    mint: (card) => {
      mkdirSync(path.join(library, "reviewed"), { recursive: true });
      const [descriptor, launcher, manifest] = release(card.id);
      writeFileSync(descriptor, card.descriptorBytes);
      writeFileSync(launcher, card.launcher, { mode: 0o755 });
      writeFileSync(manifest, card.manifestBytes);
    },
    replay: (card) => {
      try {
        execFileSync("pnpm", ["production-replay", "--source-workspace", workspacePath, "--card", card.id], { cwd: repository, stdio: ["ignore", "pipe", "pipe"], timeout: SUCCESSOR_REPLAY_TIMEOUT_MS });
      } catch (error) {
        return { ok: false, code: "REPLAY_REQUIRED", detail: `the replay did not complete: ${tail(error)}` };
      }
      const identity = replayCardIdentity(readFileSync(path.join(library, `${card.id}.json`), "utf8"));
      return identity ? checkReplayReceipt(readOrNull(replayReceiptPath(library, card.id)), identity.identity) : { ok: false, code: "REPLAY_REQUIRED", detail: "the minted card is not a START card" };
    },
    recordPrePress: (card, pointer) => {
      const manifest = release(card.id)[2];
      writeFileSync(manifest, `${JSON.stringify({ ...JSON.parse(card.manifestBytes) as Record<string, unknown>, premortem: pointer }, null, 2)}\n`);
    },
    preflight: (card) => {
      try {
        execFileSync(path.join(library, `${card}.sh`), ["preflight"], { cwd: library, stdio: ["ignore", "pipe", "pipe"], timeout: SUCCESSOR_PREFLIGHT_TIMEOUT_MS });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: "PREFLIGHT_FAILED", message: tail(error) };
      }
    },
    press: (card) => {
      // The runner answers 202 with the run id, or 409 with the executor's own refusal code.
      try {
        const body = JSON.stringify({ id: card, delegation: DELEGATION });
        const raw = execFileSync("curl", ["-sS", "-m", "60", "-X", "POST", "-H", "content-type: application/json", "-d", body, "-w", "\n%{http_code}", `${(options.pressUrl ?? SUCCESSOR_PRESS_DASHBOARD).replace(/\/+$/, "")}/api/operator-script`], { encoding: "utf8", timeout: 70_000 });
        const split = raw.lastIndexOf("\n");
        const status = Number(raw.slice(split + 1));
        const json = JSON.parse(raw.slice(0, split)) as { runId?: string; error?: string; reason?: string };
        return status === 202 && json.runId ? { ok: true, runId: json.runId } : { ok: false, code: json.reason ?? `PRESS_HTTP_${status}`, message: json.error ?? "the runner refused the press" };
      } catch (error) {
        return { ok: false, code: "PRESS_UNREACHABLE", message: tail(error) };
      }
    },
    retire: (card) => { for (const file of release(card)) rmSync(file, { force: true }); },
    ping: ({ message, key }) => queuePing({ workspace: workspacePath, message, kind: "attention", link: dashboardLink(options.dashboardUrl, "/actions"), agent: PING_AGENT, episodeKey: key, now }).id,
    off: (slug) => { runProductionDeactivateCommand({ workspace: workspacePath, rowanOff: slug, reason: "Successor press: the batch reached scope complete; the standing grant stays open." }); }
  };
}

/** One timer run of the step: reads its state, decides, writes the state back. Never throws for a refusal; it pings once and ends. */
export function runProductionSuccessorCommand(options: ProductionSuccessorOptions, dependencies: ProductionSuccessorDependencies = {}): CommandSuccess<ProductionSuccessorData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = new Date((dependencies.now ?? Date.now)());
  const queue = dependencies.queuePing ?? ((input: LivenessPingInput) => runPingSendCommand(input).data.ping);
  const ports = dependencies.ports ? dependencies.ports(now) : realSuccessorPorts({ ...options, workspace: workspacePath }, now, queue, dependencies.pins);
  const prior = readSuccessorState(workspacePath);
  const result = runSuccessorPressStep(ports, prior);
  if (JSON.stringify(result.state) !== JSON.stringify(prior)) writeSuccessorState(workspacePath, result.state);
  return createSuccess({ command: "production.successor-press", workspace: workspacePath, data: { outcome: result.outcome } });
}

export function renderSuccessorLines(data: ProductionSuccessorData, stamp = new Date().toISOString()): string[] {
  const outcome = data.outcome;
  if (outcome.kind === "pressed") return [`${stamp} successor press: pressed ${outcome.card} (${outcome.actions.length} Action${outcome.actions.length === 1 ? "" : "s"}) as run ${outcome.runId}${outcome.offIssued ? "; issued the scope-complete Off first" : ""}`];
  if (outcome.kind === "refused") return [`${stamp} successor press: refused (${outcome.code}): ${outcome.message}${outcome.pingId ? `; queued ping ${outcome.pingId}` : ""}`];
  // A skip is quiet unless it did something; the reason is on the data for the JSON caller.
  return outcome.offIssued ? [`${stamp} successor press: issued the scope-complete Off; skipped the press (${outcome.reason})`] : [];
}
