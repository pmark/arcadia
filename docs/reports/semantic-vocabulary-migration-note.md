# Semantic Vocabulary Migration Note

Date: 2026-06-24

Arcadia now uses the canonical vocabulary from `docs/arcadia-semantics.md` on public surfaces: Outcome, Action, Responsibility, Decision, and Run.

Compatibility preserved:

- Existing database table and column names remain unchanged.
- Existing command groups remain valid, including `arcadia work` and `arcadia review`.
- Legacy flags remain valid: `--goal` and `--classification`.
- Legacy JSON fields remain present, including `goal`, `workItemId`, `reviewItemId`, `workClassification`, and `work_classification`.
- Mission Log, Back Burner, Codex goal, weekly review, and runtime log wording remain intentional context-specific labels.

New aliases:

- `--outcome` is available anywhere project import/update previously accepted `--goal`.
- `--responsibility` is available anywhere Action ownership previously used `--classification`.
- JSON/API payloads expose `outcome`, `responsibility`, `decisionId`, `decisionSlug`, `actionId`, and `actionTitle` beside legacy fields where practical.

Validation:

- Supplying both `--goal` and `--outcome` in one command now fails.
- Supplying both `--classification` and `--responsibility` in one command now fails.

Deferred:

- Schema/table/column renames are deferred to a later major migration.
- TypeScript internal domain/interface renames are deferred until consumers have adopted the aliases.
- Domain storage/UI remains documented only; no Domain persistence was added in this milestone.
