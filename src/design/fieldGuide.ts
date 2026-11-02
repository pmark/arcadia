import { Findings, isDate, isObj, items, requireEnum, requireText, text, type Obj } from "./common.js";

export const FIELD_GUIDE_SCHEMA = "arcadia-design-field-guide-v1";

const ENTRY_KINDS = ["element", "question", "probe", "attack"] as const;
const PROVENANCE_KINDS = ["operator_statement", "observation", "inference", "imported"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

/**
 * Validates a field guide (references/field-guide-format.md). It catches missing
 * labels, not wrong advice. `fileName` is the base name without `.yaml`.
 */
export function checkFieldGuide(data: Obj, fileName: string): Findings {
  const findings = new Findings();
  const f = findings;

  const field = requireText(f, "field", data.field, "field");
  if (field !== null && field !== fileName) f.problem("field", `"${field}" must match the file name "${fileName}".`);
  requireText(f, "title", data.title, "title");
  if (!(Number.isInteger(data.revision) && (data.revision as number) >= 1)) f.problem("revision", "revision is required and must be a positive integer.");
  if (!isDate(data.review_date)) f.problem("review_date", "review_date is required and must be a YYYY-MM-DD date.");

  if (data.review !== undefined && data.review !== null) {
    if (!isObj(data.review)) f.problem("review", "review must be null or a mapping with date, by and ref.");
    else {
      if (!isDate(data.review.date)) f.problem("review.date", "date is required and must be a YYYY-MM-DD date.");
      requireText(f, "review.by", data.review.by, "by");
      requireText(f, "review.ref", data.review.ref, "ref");
    }
  }

  if (!isObj(data.scope)) f.problem("scope", "scope is required and must be a mapping with applies and limits.");
  else {
    requireText(f, "scope.applies", data.scope.applies, "applies");
    requireText(f, "scope.limits", data.scope.limits, "limits");
  }

  const seen = new Set<string>();
  const checkId = (where: string, value: unknown): void => {
    const id = requireText(f, where, value, "id");
    if (id === null) return;
    if (seen.has(id)) f.problem(where, `duplicate id ${id}.`);
    seen.add(id);
  };
  const checkProvenance = (where: string, value: unknown): void => {
    if (!isObj(value)) { f.problem(where, "provenance is required (kind, confidence, reason)."); return; }
    requireEnum(f, `${where}.provenance`, value.kind, "kind", PROVENANCE_KINDS);
    requireEnum(f, `${where}.provenance`, value.confidence, "confidence", CONFIDENCE);
    requireText(f, `${where}.provenance`, value.reason, "reason");
    if ((value.kind === "imported" || value.kind === "operator_statement") && text(value.source) === null) {
      f.problem(`${where}.provenance`, `source is required for ${String(value.kind)}.`);
    }
  };

  if (data.frameworks !== undefined && !Array.isArray(data.frameworks)) f.problem("frameworks", "frameworks must be a list.");
  items(data.frameworks).forEach((entry, index) => {
    const where = `frameworks[${isObj(entry) && text(entry.id) ? String(entry.id) : index}]`;
    if (!isObj(entry)) { f.problem(where, "must be a mapping."); return; }
    checkId(where, entry.id);
    requireText(f, where, entry.name, "name");
    checkProvenance(where, entry.provenance);
  });

  const entries = items(data.entries);
  if (!Array.isArray(data.entries) || entries.length === 0) f.problem("entries", "at least one entry is required.");
  entries.forEach((entry, index) => {
    const where = `entries[${isObj(entry) && text(entry.id) ? String(entry.id) : index}]`;
    if (!isObj(entry)) { f.problem(where, "must be a mapping."); return; }
    checkId(where, entry.id);
    requireEnum(f, where, entry.kind, "kind", ENTRY_KINDS);
    requireText(f, where, entry.text, "text");
    checkProvenance(where, entry.provenance);
  });

  const examples = items(data.validation_examples);
  if (!Array.isArray(data.validation_examples) || examples.length === 0) f.problem("validation_examples", "at least one validation example is required.");
  examples.forEach((example, index) => {
    const where = `validation_examples[${index}]`;
    if (!isObj(example)) { f.problem(where, "must be a mapping with given and expect."); return; }
    requireText(f, where, example.given, "given");
    requireText(f, where, example.expect, "expect");
  });

  return findings;
}
