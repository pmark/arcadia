/**
 * arcadia-decision-card-v1: the one contract for every operator touch (PR
 * merge, /actions run button, /todo answer). Pure and dependency-free so the
 * dashboard can import it; no fs, db, commander or CLI imports belong here.
 *
 * Policy: unknown keys are REJECTED (`unknown_key`), never silently ignored,
 * because an ignored key could be read by a later surface as authority.
 * The validator never mutates input and returns a fresh copy.
 */

export const DECISION_CARD_SCHEMA = "arcadia-decision-card-v1" as const;

export const DECISION_CARD_VERBS = ["merge", "run", "answer", "veto"] as const;
export type DecisionCardVerb = (typeof DECISION_CARD_VERBS)[number];

/** Kinds that can never carry a policy match or a default action. */
export const DECISION_CARD_EXCLUDED_KINDS: ReadonlySet<string> = new Set([
  "credentials",
  "grant",
  "spend",
  "cap",
  "constitution",
  "approval",
  "decision-answer",
]);

export const DECISION_CARD_LIMITS = {
  id: 128,
  kind: 64,
  what: 500,
  optionId: 64,
  label: 200,
  consequence: 1000,
  evidenceLabel: 200,
  url: 2048,
  pin: 256,
  policyMatch: 128,
  receipt: 512,
  maxOptions: 20,
  maxEvidence: 50,
} as const;

export interface DecisionCardOption {
  id: string;
  label: string;
  consequence: string;
}

export interface DecisionCardEvidence {
  label: string;
  url?: string;
  fingerprint?: string;
}

export interface DecisionCardPins {
  stateHash?: string;
  headSha?: string;
  previewFingerprint?: string;
}

export interface DecisionCard {
  schema: typeof DECISION_CARD_SCHEMA;
  id: string;
  kind: string;
  what: string;
  options: DecisionCardOption[];
  evidence: DecisionCardEvidence[];
  verb: DecisionCardVerb;
  pins: DecisionCardPins;
  expires: string;
  policy_match: string | null;
  receipt: string | null;
  /** Option id taken on expiry; only for verb "veto" and non-excluded kinds. */
  defaultAction?: string;
}

export type DecisionCardErrorCode =
  | "not_object"
  | "unknown_key"
  | "bad_schema"
  | "bad_field"
  | "too_long"
  | "empty_what"
  | "no_options"
  | "too_many_options"
  | "missing_consequence"
  | "duplicate_option_id"
  | "no_pins"
  | "empty_pin"
  | "padded_pin"
  | "unknown_verb"
  | "bad_expires"
  | "expired"
  | "bad_policy_match"
  | "policy_match_on_excluded_kind"
  | "policy_match_kind_not_eligible"
  | "bad_clock"
  | "expiry_too_far"
  | "default_action_not_allowed"
  | "default_action_unknown_option";

export interface DecisionCardError {
  code: DecisionCardErrorCode;
  path: string;
  message: string;
}

export type DecisionCardValidation =
  | { ok: true; card: DecisionCard }
  | { ok: false; errors: DecisionCardError[] };

const TOP_KEYS = new Set([
  "schema",
  "id",
  "kind",
  "what",
  "options",
  "evidence",
  "verb",
  "pins",
  "expires",
  "policy_match",
  "receipt",
  "defaultAction",
]);
const OPTION_KEYS = new Set(["id", "label", "consequence"]);
const EVIDENCE_KEYS = new Set(["label", "url", "fingerprint"]);
const PIN_KEYS = ["stateHash", "headSha", "previewFingerprint"] as const;
const KIND_RE = /^[a-z][a-z0-9_-]*$/;
/** Strict slug for ids, option ids and policy ids: no whitespace or control chars. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const INVISIBLE_RE = /[\p{White_Space}\p{Cf}\p{Cc}⠀ㅤﾠᅟᅠ]/gu;
const CONTROL_RE = /\p{Cc}/u;
const EDGE_SPACE_RE = /^[\p{White_Space}\p{Cf}]|[\p{White_Space}\p{Cf}]$/u;

/** True when the string has no visible content (whitespace, format, invisible). */
function isBlank(value: string): boolean {
  return value.replace(INVISIBLE_RE, "") === "";
}

/**
 * Kinds that MAY carry a policy_match or defaultAction. This is an allow-list:
 * any kind not named here is operator-only. The policy evaluator extends it
 * deliberately; the deny-list above remains a second guard.
 */
export const DECISION_CARD_POLICY_ELIGIBLE_KINDS: ReadonlySet<string> = new Set([
  "pr-merge",
  "docs-only",
  "plan-handoff",
  "split-remainder-placement",
]);

/** Maximum distance between now and a card's expiry (30 days). */
export const DECISION_CARD_MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

function policyEligible(kind: string | null): boolean {
  return (
    kind !== null &&
    DECISION_CARD_POLICY_ELIGIBLE_KINDS.has(kind) &&
    !DECISION_CARD_EXCLUDED_KINDS.has(kind)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Strict ISO-8601 with an explicit offset; rejects calendar overflow (Feb 30). */
export function parseCardExpiry(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  if (tz !== "Z") {
    if (Number(tz.slice(1, 3)) > 23 || Number(tz.slice(4, 6)) > 59) return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function str(
  errors: DecisionCardError[],
  path: string,
  value: unknown,
  max: number,
): string | null {
  if (typeof value !== "string") {
    errors.push({ code: "bad_field", path, message: `${path} must be a string` });
    return null;
  }
  if (value.length > max) {
    errors.push({ code: "too_long", path, message: `${path} exceeds ${max} characters` });
    return null;
  }
  if (CONTROL_RE.test(value)) {
    errors.push({ code: "bad_field", path, message: `${path} must not contain control characters` });
    return null;
  }
  return value;
}

function slug(
  errors: DecisionCardError[],
  path: string,
  value: unknown,
  max: number,
): string | null {
  const v = str(errors, path, value, max);
  if (v === null) return null;
  if (!SLUG_RE.test(v)) {
    errors.push({ code: "bad_field", path, message: `${path} must be a slug (letters, digits, . _ : -)` });
    return null;
  }
  return v;
}

function unknownKeys(
  errors: DecisionCardError[],
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string,
): void {
  // Own enumerable keys only: "__proto__" from JSON.parse appears here and is
  // rejected; inherited keys are never consulted.
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_key",
        path: `${prefix}${key}`,
        message: `unknown key ${JSON.stringify(key)}`,
      });
    }
  }
}

export function validateDecisionCard(
  input: unknown,
  options: { now?: Date } = {},
): DecisionCardValidation {
  const errors: DecisionCardError[] = [];
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) {
    return {
      ok: false,
      errors: [{ code: "bad_clock", path: "now", message: "now must be a valid time" }],
    };
  }
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "not_object", path: "", message: "card must be an object" }],
    };
  }
  unknownKeys(errors, input, TOP_KEYS, "");
  if (input.schema !== DECISION_CARD_SCHEMA) {
    errors.push({
      code: "bad_schema",
      path: "schema",
      message: `schema must be ${DECISION_CARD_SCHEMA}`,
    });
  }

  let id: string | null = null;
  if (!has(input, "id")) {
    errors.push({ code: "bad_field", path: "id", message: "id is required" });
  } else {
    id = slug(errors, "id", input.id, DECISION_CARD_LIMITS.id);
  }

  let kind: string | null = null;
  if (!has(input, "kind")) {
    errors.push({ code: "bad_field", path: "kind", message: "kind is required" });
  } else {
    kind = str(errors, "kind", input.kind, DECISION_CARD_LIMITS.kind);
    if (kind !== null && !KIND_RE.test(kind)) {
      errors.push({
        code: "bad_field",
        path: "kind",
        message: "kind must be lowercase letters, digits, - or _",
      });
      kind = null;
    }
  }

  let what: string | null = null;
  if (input.what === undefined || (typeof input.what === "string" && isBlank(input.what))) {
    errors.push({ code: "empty_what", path: "what", message: "what must be a non-empty sentence" });
  } else {
    what = str(errors, "what", input.what, DECISION_CARD_LIMITS.what);
  }

  const optionOut: DecisionCardOption[] = [];
  const rawOptions: unknown = input.options;
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    errors.push({
      code: "no_options",
      path: "options",
      message: "options must be a non-empty array",
    });
  } else if (rawOptions.length > DECISION_CARD_LIMITS.maxOptions) {
    errors.push({
      code: "too_many_options",
      path: "options",
      message: `at most ${DECISION_CARD_LIMITS.maxOptions} options`,
    });
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < rawOptions.length; i++) {
      const p = `options[${i}]`;
      // Index loop, not forEach: sparse holes must be rejected, not skipped.
      const raw: unknown = i in rawOptions ? rawOptions[i] : undefined;
      if (!isRecord(raw)) {
        errors.push({ code: "bad_field", path: p, message: `${p} must be an object` });
        continue;
      }
      unknownKeys(errors, raw, OPTION_KEYS, `${p}.`);
      const oid = slug(errors, `${p}.id`, raw.id, DECISION_CARD_LIMITS.optionId);
      const label = str(errors, `${p}.label`, raw.label, DECISION_CARD_LIMITS.label);
      let consequence: string | null = null;
      if (typeof raw.consequence !== "string" || isBlank(raw.consequence)) {
        errors.push({
          code: "missing_consequence",
          path: `${p}.consequence`,
          message: `${p} needs a non-empty consequence`,
        });
      } else {
        consequence = str(
          errors,
          `${p}.consequence`,
          raw.consequence,
          DECISION_CARD_LIMITS.consequence,
        );
      }
      if (oid !== null) {
        if (seen.has(oid)) {
          errors.push({
            code: "duplicate_option_id",
            path: `${p}.id`,
            message: `duplicate option id ${JSON.stringify(oid)}`,
          });
        }
        seen.add(oid);
      }
      if (label !== null && isBlank(label)) {
        errors.push({
          code: "bad_field",
          path: `${p}.label`,
          message: `${p}.label must not be empty`,
        });
      }
      if (oid !== null && label !== null && consequence !== null) {
        optionOut.push({ id: oid, label, consequence });
      }
    }
    if (optionOut.length === 0 && !errors.some((e) => e.path.startsWith("options"))) {
      errors.push({ code: "no_options", path: "options", message: "no valid options" });
    }
  }

  const evidenceOut: DecisionCardEvidence[] = [];
  if (!Array.isArray(input.evidence)) {
    errors.push({ code: "bad_field", path: "evidence", message: "evidence must be an array" });
  } else if (input.evidence.length > DECISION_CARD_LIMITS.maxEvidence) {
    errors.push({
      code: "too_long",
      path: "evidence",
      message: `at most ${DECISION_CARD_LIMITS.maxEvidence} evidence items`,
    });
  } else {
    const rawEvidence: unknown[] = input.evidence;
    for (let i = 0; i < rawEvidence.length; i++) {
      const p = `evidence[${i}]`;
      const raw: unknown = i in rawEvidence ? rawEvidence[i] : undefined;
      if (!isRecord(raw)) {
        errors.push({ code: "bad_field", path: p, message: `${p} must be an object` });
        continue;
      }
      unknownKeys(errors, raw, EVIDENCE_KEYS, `${p}.`);
      const label = str(errors, `${p}.label`, raw.label, DECISION_CARD_LIMITS.evidenceLabel);
      if (label !== null && isBlank(label)) {
        errors.push({ code: "bad_field", path: `${p}.label`, message: `${p}.label must not be empty` });
      }
      const item: DecisionCardEvidence = { label: label ?? "" };
      if (has(raw, "url")) {
        const url = str(errors, `${p}.url`, raw.url, DECISION_CARD_LIMITS.url);
        if (url !== null) {
          if (!/^https?:\/\/\S+$/.test(url)) {
            errors.push({
              code: "bad_field",
              path: `${p}.url`,
              message: `${p}.url must be an http(s) URL`,
            });
          } else item.url = url;
        }
      }
      if (has(raw, "fingerprint")) {
        const fp = str(errors, `${p}.fingerprint`, raw.fingerprint, DECISION_CARD_LIMITS.pin);
        if (fp !== null) {
          if (isBlank(fp) || EDGE_SPACE_RE.test(fp)) {
            errors.push({
              code: "bad_field",
              path: `${p}.fingerprint`,
              message: `${p}.fingerprint must not be empty`,
            });
          } else item.fingerprint = fp;
        }
      }
      evidenceOut.push(item);
    }
  }

  let verb: DecisionCardVerb | null = null;
  if (
    typeof input.verb === "string" &&
    (DECISION_CARD_VERBS as readonly string[]).includes(input.verb)
  ) {
    verb = input.verb as DecisionCardVerb;
  } else {
    errors.push({
      code: "unknown_verb",
      path: "verb",
      message: `verb must be one of ${DECISION_CARD_VERBS.join(", ")}`,
    });
  }

  const pins: DecisionCardPins = {};
  if (!isRecord(input.pins)) {
    errors.push({
      code: "no_pins",
      path: "pins",
      message: "pins must be an object with at least one pin",
    });
  } else {
    unknownKeys(errors, input.pins, new Set<string>(PIN_KEYS), "pins.");
    let pinProblem = false;
    for (const key of PIN_KEYS) {
      if (!has(input.pins, key) || input.pins[key] === undefined) continue;
      const v = str(errors, `pins.${key}`, input.pins[key], DECISION_CARD_LIMITS.pin);
      if (v === null) {
        pinProblem = true;
      } else if (isBlank(v)) {
        pinProblem = true;
        errors.push({
          code: "empty_pin",
          path: `pins.${key}`,
          message: `pins.${key} must not be empty`,
        });
      } else if (EDGE_SPACE_RE.test(v)) {
        pinProblem = true;
        errors.push({
          code: "padded_pin",
          path: `pins.${key}`,
          message: `pins.${key} must not have leading or trailing whitespace`,
        });
      } else pins[key] = v;
    }
    if (Object.keys(pins).length === 0 && !pinProblem) {
      errors.push({ code: "no_pins", path: "pins", message: "at least one pin is required" });
    }
  }

  let expires: string | null = null;
  const expiresMs = parseCardExpiry(input.expires);
  if (expiresMs === null) {
    errors.push({
      code: "bad_expires",
      path: "expires",
      message: "expires must be ISO-8601 with a Z or +/-HH:MM offset",
    });
  } else if (expiresMs <= now) {
    errors.push({ code: "expired", path: "expires", message: "card is expired" });
  } else if (expiresMs - now > DECISION_CARD_MAX_HORIZON_MS) {
    errors.push({
      code: "expiry_too_far",
      path: "expires",
      message: "expires is more than 30 days away",
    });
  } else expires = input.expires as string;

  let policyMatch: string | null = null;
  if (input.policy_match !== null) {
    if (
      typeof input.policy_match !== "string" ||
      input.policy_match.length > DECISION_CARD_LIMITS.policyMatch ||
      !SLUG_RE.test(input.policy_match)
    ) {
      errors.push({
        code: "bad_policy_match",
        path: "policy_match",
        message: "policy_match must be null or a policy id slug",
      });
    } else policyMatch = input.policy_match;
  }

  let receipt: string | null = null;
  if (input.receipt !== null) {
    receipt = str(errors, "receipt", input.receipt, DECISION_CARD_LIMITS.receipt);
    if (receipt !== null && isBlank(receipt)) {
      errors.push({ code: "bad_field", path: "receipt", message: "receipt must be a path or null" });
      receipt = null;
    }
  }

  const excluded = kind !== null && DECISION_CARD_EXCLUDED_KINDS.has(kind);
  if (policyMatch !== null && kind !== null) {
    if (excluded) {
      errors.push({
        code: "policy_match_on_excluded_kind",
        path: "policy_match",
        message: `kind ${kind} can never match a delegation policy`,
      });
    } else if (!policyEligible(kind)) {
      errors.push({
        code: "policy_match_kind_not_eligible",
        path: "policy_match",
        message: `kind ${kind} is not on the policy-eligible allow-list`,
      });
    }
  }

  let defaultAction: string | undefined;
  if (has(input, "defaultAction") && input.defaultAction !== undefined) {
    const da = slug(errors, "defaultAction", input.defaultAction, DECISION_CARD_LIMITS.optionId);
    if (da !== null) {
      if (verb !== "veto" || excluded || !policyEligible(kind)) {
        errors.push({
          code: "default_action_not_allowed",
          path: "defaultAction",
          message: "defaultAction is only allowed for verb veto on a policy-eligible kind",
        });
      } else if (!optionOut.some((o) => o.id === da)) {
        errors.push({
          code: "default_action_unknown_option",
          path: "defaultAction",
          message: "defaultAction must name an option id",
        });
      } else defaultAction = da;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const card: DecisionCard = {
    schema: DECISION_CARD_SCHEMA,
    id: id as string,
    kind: kind as string,
    what: what as string,
    options: optionOut,
    evidence: evidenceOut,
    verb: verb as DecisionCardVerb,
    pins,
    expires: expires as string,
    policy_match: policyMatch,
    receipt,
  };
  if (defaultAction !== undefined) card.defaultAction = defaultAction;
  return { ok: true, card };
}

export type DecisionCardCurrentState = DecisionCardPins;

export type DecisionCardPinReason =
  | "expired"
  | "no_pins"
  | "bad_clock"
  | "malformed_card"
  | "stale_state_hash"
  | "stale_head_sha"
  | "stale_preview_fingerprint"
  | "missing_current_state_hash"
  | "missing_current_head_sha"
  | "missing_current_preview_fingerprint";

export type DecisionCardPinCheck =
  | { ok: true }
  | { ok: false; reason: DecisionCardPinReason; field?: keyof DecisionCardPins };

const PIN_REASONS: Record<
  keyof DecisionCardPins,
  { stale: DecisionCardPinReason; missing: DecisionCardPinReason }
> = {
  stateHash: { stale: "stale_state_hash", missing: "missing_current_state_hash" },
  headSha: { stale: "stale_head_sha", missing: "missing_current_head_sha" },
  previewFingerprint: {
    stale: "stale_preview_fingerprint",
    missing: "missing_current_preview_fingerprint",
  },
};

/**
 * Use-time gate: every pin the card carries must equal the current value
 * exactly, and the card must not be expired. Fails closed and never throws:
 * a malformed card, malformed pin, bad clock or missing current value returns
 * a named refusal. Cards should be validated with validateDecisionCard first;
 * this function re-checks only what it needs, it is not a validator.
 */
export function checkPins(
  card: unknown,
  current: DecisionCardCurrentState,
  now: Date = new Date(),
): DecisionCardPinCheck {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "bad_clock" };
  if (!isRecord(card) || !isRecord(card.pins)) {
    return { ok: false, reason: "malformed_card" };
  }
  const expiresMs = parseCardExpiry(card.expires);
  if (expiresMs === null || expiresMs <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  const liveState: Record<string, unknown> = isRecord(current) ? current : {};
  let pinned = 0;
  for (const field of PIN_KEYS) {
    const want = card.pins[field];
    if (want === undefined) continue;
    if (typeof want !== "string" || isBlank(want) || EDGE_SPACE_RE.test(want)) {
      return { ok: false, reason: "malformed_card", field };
    }
    pinned++;
    const live = liveState[field];
    if (typeof live !== "string" || live === "") {
      return { ok: false, reason: PIN_REASONS[field].missing, field };
    }
    if (live !== want) {
      return { ok: false, reason: PIN_REASONS[field].stale, field };
    }
  }
  if (pinned === 0) return { ok: false, reason: "no_pins" };
  return { ok: true };
}
