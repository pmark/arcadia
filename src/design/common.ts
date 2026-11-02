export type Obj = Record<string, unknown>;

/** Collects every problem and warning, so a check reports all of them rather than the first. */
export class Findings {
  readonly problems: string[] = [];
  readonly warnings: string[] = [];
  problem(where: string, message: string): void { this.problems.push(`${where}: ${message}`); }
  warn(where: string, message: string): void { this.warnings.push(`${where}: ${message}`); }
}

export function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The string itself when it has non-whitespace content; whitespace-only counts as missing. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Items of a list field; anything else reads as empty (the type problem is reported by the caller). */
export function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Requires a non-blank string and returns it. */
export function requireText(findings: Findings, where: string, value: unknown, field: string): string | null {
  const found = text(value);
  if (found === null) findings.problem(where, `${field} is required and must not be blank.`);
  return found;
}

/** Requires one of the allowed values and returns it. */
export function requireEnum<T extends string>(findings: Findings, where: string, value: unknown, field: string, allowed: readonly T[]): T | null {
  if (oneOf(value, allowed)) return value;
  findings.problem(where, `${field} must be one of ${allowed.join(", ")}${value === undefined ? " (missing)" : ""}.`);
  return null;
}
