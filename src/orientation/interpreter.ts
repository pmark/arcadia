import type Database from "better-sqlite3";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceJob, IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import { localDateStamp } from "../utils/time.js";
import { createTimeEntry } from "../activity/repository.js";
import {
  completeOrientationEntry,
  confirmOrientationEntry,
  createOrientationEntry,
  findOrientationEntry,
  reprioritizeOrientationEntry,
  setDailyCapacity,
  updateOrientationEntry
} from "./repository.js";
import {
  ORIENTATION_EFFORTS,
  type LedgerOp,
  type OrientationEffort,
  type OrientationEntry,
  type ReplyInterpretation
} from "./types.js";

export class OrientationInterpreterUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OrientationInterpreterUnavailableError";
  }
}

export class OrientationReplyUnparseableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OrientationReplyUnparseableError";
  }
}

export class OrientationOpTargetMissingError extends Error {
  public constructor(public readonly entryId: string) {
    super(`Reply referenced an orientation entry that does not exist: ${entryId}`);
    this.name = "OrientationOpTargetMissingError";
  }
}

const REPLY_INTERPRETATION_TIMEOUT_MS = 180_000;

const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["add", "update", "complete", "reprioritize", "confirm", "capacity", "log_time", "context"]
          },
          entryId: { type: "string" },
          entry: { type: "object" },
          fields: { type: "object" },
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          note: { type: "string" },
          sessionBlocks: { type: "number" },
          fragmentMinutes: { type: "number" },
          minutes: { type: "number" },
          description: { type: "string" },
          startedAtLocal: { type: "string" },
          text: { type: "string" }
        },
        required: ["op"]
      }
    },
    echo: { type: "string" },
    confidence: { type: "number" },
    ambiguousQuestion: { type: "string" }
  },
  required: ["ops", "echo", "confidence"]
};

/**
 * Capturing effort from free text is the ONE place a model is involved in
 * this feature — "register the kids for baseball, quick" and "the disposal's
 * a whole afternoon" already read as effort to a human. Everything
 * downstream (fit-to-gap, the day slate, the packet) is pure deterministic
 * logic over the stored value.
 */
const EFFORT_GUIDANCE =
  "effort is an OPTIONAL coarse time cost, and you must only set it when the operator actually implied one — " +
  'never guess a size for an entry they said nothing about. "quick" = 15 minutes or less (a phone call, one form); ' +
  '"short" = up to an hour; "session" = a 1-3 hour block ("a whole afternoon", "a real chunk of time"); ' +
  '"project" = multi-session work that needs breaking down. Phrases like "that\'s a quick one", "ten minutes", ' +
  '"takes an afternoon", or "that\'s a big one" are effort, not priority. ';

/**
 * The daily capacity note. `note` must stay the operator's own words — it is
 * what gets read back to them — while the two numbers are what the packet
 * budgets against. Omit a number rather than inventing one; unknown is a
 * meaningful, safe state, whereas a wrong number silently defers real work.
 */
const CAPACITY_GUIDANCE =
  'Use "capacity" only when the operator is describing how much time TODAY holds (e.g. "one client session plus about an hour of gaps, ' +
  'evening is gone", "today is packed", "I have a free afternoon"). note is their own wording, lightly cleaned up. ' +
  "sessionBlocks is how many protected 1-3 hour blocks the day holds (0 is a valid and useful answer). " +
  "fragmentMinutes is the total minutes of small gaps between commitments. Omit either number if they did not imply it. ";

/**
 * Time logging has to survive being vague, because vague is how people
 * actually remember their own day. "Spent the morning on the website" is a
 * usable fact; refusing it until the operator produces exact clock times is
 * how a tracker dies in its first week.
 */
const TIME_LOG_GUIDANCE =
  'Use "log_time" when the operator is describing work they ALREADY did, with any sense of how long ' +
  '("spent the morning on the website", "an hour on the disposal", "I was at the taxes for about 90 minutes"). ' +
  "minutes is your best reading of the duration they implied. description is their own words. " +
  'startedAtLocal is the operator\'s LOCAL wall-clock time in "YYYY-MM-DDTHH:MM" form with NO timezone suffix — ' +
  "never a UTC instant, never a trailing Z. Resolve it against the local date and time given below, and only when " +
  'they indicated roughly when ("this morning" -> around 09:00, "after lunch" -> around 13:00, "last night" -> ' +
  "around 20:00 of the previous day). Omit it rather than guessing a time they did not imply. " +
  "Set entryId when the work clearly maps to a ledger entry. Note the difference from \"capacity\": capacity is " +
  "time the operator EXPECTS TO HAVE today, log_time is work they have ALREADY DONE. ";

/** "YYYY-MM-DDTHH:MM" in the operator's own timezone — the only clock they think in. */
function localWallClock(date: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildInterpretationRequest(
  replyText: string,
  entries: OrientationEntry[],
  focusedEntryId?: string
): IntelligenceRequest {
  const ledgerSummary = entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    entryType: entry.entryType,
    priority: entry.priority,
    horizon: entry.horizon,
    effort: entry.effort,
    status: entry.status
  }));

  const focusedEntry = focusedEntryId ? entries.find((entry) => entry.id === focusedEntryId) : undefined;
  const focusHint = focusedEntry
    ? ` The operator currently has this specific entry open: {"id":"${focusedEntry.id}","title":"${focusedEntry.title}"}. ` +
      "Assume the reply refers to THIS entry — not any other similarly-worded entry in the ledger — unless the reply " +
      "unambiguously names or describes a different one."
    : "";

  const instructions =
    "You maintain a small personal orientation ledger (not a task manager). " +
    "Given the current ledger and a reply from the operator, produce ledger operations." +
    focusHint +
    ' Valid ops: {"op":"add","entry":{"title":string,"entryType":"active_concern"|"standing_responsibility"|"time_bound"|"parked_idea","area"?:string,"priority"?:"low"|"normal"|"high"|"critical","horizon"?:"now"|"soon"|"later"|"someday","dueAt"?:string,"effort"?:"quick"|"short"|"session"|"project","detail"?:string}}, ' +
    '{"op":"update","entryId":string,"fields":{...same optional fields as add.entry excluding entryType}}, ' +
    '{"op":"complete","entryId":string}, {"op":"reprioritize","entryId":string,"priority":string}, ' +
    '{"op":"confirm","entryId":string}, ' +
    '{"op":"capacity","note":string,"sessionBlocks"?:number,"fragmentMinutes"?:number}, ' +
    '{"op":"log_time","minutes":number,"description":string,"startedAtLocal"?:string,"entryId"?:string}, {"op":"context","text":string}. ' +
    "entryId MUST be one of the ids in the provided ledger — never invent one. " +
    EFFORT_GUIDANCE +
    CAPACITY_GUIDANCE +
    TIME_LOG_GUIDANCE +
    "If the reply is too ambiguous to confidently produce ops, return ops: [] and set ambiguousQuestion to a short clarifying question. " +
    "confidence is 0..1. echo is a one-sentence human-readable summary of what you understood.";

  return {
    idempotencyKey: `orientation-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operationId: "arcadia.orientation.interpret-reply",
    clientApp: "arcadia-orientation",
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    // "This morning" is only resolvable against the operator's own clock, and
    // a model handed a UTC instant will anchor to UTC and land the block
    // hours away from when the work actually happened.
    input: { instructions, ledger: ledgerSummary, reply: replyText, nowLocal: localWallClock(new Date()) },
    outputContract: {
      schemaId: "arcadia.orientation.reply-interpretation.v1",
      schemaVersion: 1,
      jsonSchema: REPLY_JSON_SCHEMA
    },
    template: { id: "arcadia.orientation.reply-interpretation", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

/**
 * Submits and runs one Intelligence job in-process (mirrors the smoke-command
 * pattern in src/commands/intelligence.ts) rather than waiting on the separate
 * worker daemon's poll loop — the CLI process already holds the DB handle.
 */
export async function interpretOrientationReply(
  db: Database.Database,
  workspacePath: string,
  replyText: string,
  liveEntries: OrientationEntry[],
  focusedEntryId?: string
): Promise<ReplyInterpretation> {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const liteLlmClient = createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    // A background correction loop can tolerate the extra latency of a cold
    // local model load (weights not yet resident in memory) far better than
    // an outright failure asking the operator to just retry. The default
    // 60s client timeout is tuned for interactive requests, not this.
    timeoutMs: REPLY_INTERPRETATION_TIMEOUT_MS
  });
  const worker = new IntelligenceWorker(repository, liteLlmClient, config, artifactStore);

  const request = buildInterpretationRequest(replyText, liveEntries, focusedEntryId);
  const { job: submitted } = await submitIntelligenceRequest(repository, request);
  const finished = await worker.runOnce();
  const job: IntelligenceJob | undefined =
    finished?.id === submitted.id ? finished : await repository.findById(submitted.id);

  if (!job) {
    throw new OrientationInterpreterUnavailableError("Orientation reply job disappeared after submission.");
  }

  if (job.status === "blocked") {
    throw new OrientationInterpreterUnavailableError(
      `Cannot reach the local model right now (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
    );
  }

  if (job.status !== "completed") {
    throw new OrientationReplyUnparseableError(
      `Could not interpret the reply (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
    );
  }

  const result = job.result as JsonValue as {
    ops: LedgerOp[];
    echo: string;
    confidence: number;
    ambiguousQuestion?: string;
  };

  return {
    ops: result.ops ?? [],
    echo: result.echo,
    confidence: result.confidence,
    ambiguousQuestion: result.ambiguousQuestion
  };
}

/**
 * Guards against a model returning a plausible-sounding size that isn't one
 * of the four ("medium", "1h"). An unrecognized value is dropped rather than
 * stored — an un-sized entry degrades cleanly, a garbage-sized one would
 * quietly corrupt every fit-to-gap answer after it.
 */
function normalizeEffort(value: unknown): OrientationEffort | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const candidate = String(value).trim().toLowerCase();
  return (ORIENTATION_EFFORTS as readonly string[]).includes(candidate) ? (candidate as OrientationEffort) : undefined;
}

/**
 * Reads a local wall-clock string into a real instant.
 *
 * Any timezone suffix is stripped first: the model is asked for local time and
 * has no basis for an offset, so a trailing "Z" is a formatting tic rather
 * than a claim about UTC — honoring it would silently move the work by hours.
 * A zone-less string is parsed by JS in the local timezone, which is exactly
 * what is wanted.
 */
function normalizeLocalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const local = value.trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "");
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

/**
 * Validates every op against the current ledger before writing any (per
 * 01-spec.md's all-or-nothing rule), then applies them. Every touched entry's
 * last_confirmed_at is refreshed by the underlying repository calls.
 */
export function applyLedgerOps(
  db: Database.Database,
  ops: LedgerOp[],
  source: "cli" | "discord" | "admin",
  now: Date = new Date()
): OrientationEntry[] {
  for (const op of ops) {
    // Only ops that MUTATE a specific entry are all-or-nothing. A time entry
    // whose suggested link happens to be wrong is still a true fact about the
    // operator's day, so it must not be able to abort the whole reply — it
    // just loses the link below.
    if (op.op === "log_time" || !("entryId" in op) || op.entryId === undefined) {
      continue;
    }
    if (!findOrientationEntry(db, op.entryId)) {
      throw new OrientationOpTargetMissingError(op.entryId);
    }
  }

  const touched: OrientationEntry[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "add":
        touched.push(
          createOrientationEntry(db, {
            entryType: op.entry.entryType,
            title: op.entry.title,
            area: op.entry.area ?? null,
            priority: op.entry.priority,
            horizon: op.entry.horizon,
            dueAt: op.entry.dueAt ?? null,
            effort: normalizeEffort(op.entry.effort) ?? null,
            detail: op.entry.detail ?? null,
            source
          })
        );
        break;
      case "update":
        touched.push(
          updateOrientationEntry(db, op.entryId, { ...op.fields, effort: normalizeEffort(op.fields.effort) })
        );
        break;
      case "capacity":
        setDailyCapacity(db, {
          localDate: localDateStamp(now),
          note: op.note,
          sessionBlocks: normalizeCount(op.sessionBlocks),
          fragmentMinutes: normalizeCount(op.fragmentMinutes),
          source
        });
        break;
      case "log_time": {
        const minutes = normalizeCount(op.minutes);
        if (!minutes) {
          // A duration is the one thing a time entry cannot do without; a
          // zero-minute block would silently distort every total after it.
          break;
        }
        const startedAt = normalizeLocalTimestamp(op.startedAtLocal);
        const entry = op.entryId ? findOrientationEntry(db, op.entryId) : null;
        createTimeEntry(db, {
          // The day the work happened, which is not always the day it gets
          // mentioned — "I was at it last night" lands on last night.
          localDate: localDateStamp(startedAt ? new Date(startedAt) : now),
          startedAt,
          endedAt: startedAt ? new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString() : null,
          minutes,
          description: op.description,
          focus: entry?.title ?? null,
          entryId: entry?.id ?? null,
          projectId: entry?.projectId ?? null,
          area: entry?.area ?? null,
          source
        });
        break;
      }
      case "complete":
        touched.push(completeOrientationEntry(db, op.entryId));
        break;
      case "reprioritize":
        touched.push(reprioritizeOrientationEntry(db, op.entryId, op.priority));
        break;
      case "confirm":
        touched.push(confirmOrientationEntry(db, op.entryId));
        break;
      case "context":
        // Free-form context with no structured target: recorded via the caller's
        // event emission (see commands/orientation.ts); nothing to touch here.
        break;
      default:
        break;
    }
  }
  return touched;
}
