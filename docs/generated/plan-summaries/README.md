# Plan summaries (generated)

Each file here is a plain-language reading aid for one Plan and its Actions. It says why the Plan exists, why each Action exists, and what "done" looks like.

The files are derived and never authoritative. The Plan document in `docs/plans/` governs, and Arcadia never reads these files as intent (Decision 0004). They carry no `arcadia: v1` marker, so `docs sync` ignores them.

The design is in [purpose-first Plans](../../design/purpose-first-plans.md).

## Shape

One JSON file per Plan, named `<plan-slug>.json`, with `schema: arcadia-plan-summary-v1`. The Plan-level fields are:

- `title`: a plain-language name for the Plan;
- `purpose`: why the Plan exists;
- `serves`: which outcome, goal or milestone it advances;
- `done_when`: what "done" looks like;
- `reading_note` (optional): anything a reader would otherwise get wrong;
- `actions`: one entry per Action.

Each Action entry has:

- `id`;
- `title`;
- `why`: one sentence, tied to the Plan's purpose;
- `done_when`: one observable sentence;
- `note` (optional).

Live state is never written here, because it changes faster than prose: status, progress, owner, current Action and gates. The UI reads those from Arcadia.

## Freshness

Each summary records a `source_fingerprint`: the first 16 hex characters of SHA-256 over compact, key-sorted JSON.

- **Plan:** `{slug, milestone, actions: [ids in order], body: <SHA-256 hex of the text after the closing frontmatter line>}`. The body is included because purposes and reading notes draw on it.
- **Action:** `{id, title, acceptance_criteria, why, depends_on}`, taken from the Plan frontmatter.

[`src/docs/planSummaries.ts`](../../../src/docs/planSummaries.ts) is the single implementation. Run `pnpm -s check:plan-summaries` for a read-only report; add `--enforce` to fail when anything is missing or stale.

If the current fingerprint differs from the recorded one, the summary is stale. The UI then shows it as "written before this changed", or falls back to the record, and the summary is queued for rewriting.

## Authorship

The pilot summaries were written by Clara, the technical-writing specialization, on 2026-10-28 from each Plan's current record. They distinguish inference from recorded fact, as `reading_note` shows.
