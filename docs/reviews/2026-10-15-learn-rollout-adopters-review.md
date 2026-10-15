PPN — PASS at `97f1a6a59a2cd26e4641e0ac86eeb8cd11f24e10`.

Rebuster — PASS at `121af1695c63574f1b34f5355e12df39a755830b`.

Validated:

- Exact base-to-head diffs contain only `AGENTS.md`, `docs/agent-guidance/index.json`, and `docs/agent-guidance/learning.md`; no whitespace errors, new files, Constitution, pointer, or authority changes.
- Both managed blocks state direct capture, observation/high default, inference/low/evidence flags, exact-retry dedupe versus distinct wording, evidence-only status, and on-demand bounded Notes.
- Canonical trimmed-body fingerprints match index entries; delivery validation has no missing/stale guidance or budget problems. PPN is 12 bytes below the 12 KiB root limit.
- PPN retains its existing recovery paragraph. Rebuster’s missing recovery paragraph is inherited from its base and has no index dependency.
- Live read-only exports confirm fresh scoped lessons for both projects, with retained evidence/observations/receipts and `back_burner_item_id: null`; this is consistent with project-scoped captures not projecting into Back Burner.
- Focused regressions passed: `pnpm exec vitest run tests/way-propagation.test.ts tests/learn-lossless.test.ts` — 29/29.
- Candidate heads remained exact and clean after review.

Remaining boundary: Rebuster has no `docs/notes-to-self.md`; reported as required, with no substitute invented. Nominal `arcadia way` and Back Burner status reads require a writable workspace DB in this sandbox, but direct read-only Learn search/export worked and provided the evidence above. No blocking findings.
