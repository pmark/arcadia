# PR control sibling-key repair — 2026-10-13

Operator-directed [Issue #1373](https://github.com/pmark/arcadia/issues/1373), repair to the lightweight PR page. Candidate `codex/fix-pr-control-keys` at `/Users/pmark/.codex/worktrees/lightweight-pr-inventory/arcadia`, base `62acc053bfe83c3430258e29f02183e46f9bda13`. No governed Action or pointer change is claimed. Sole implementer depth 1 under Lead depth 0; no further delegation.

## Verified defect and fix

Details and audio were sibling children using the same `repository:number:updatedAt` key. Managed development React reported repeated duplicate-key warnings, although the prior production preview did not expose them. The repair prefixes the details identity with `details:` and the audio identity with `audio:`. Both retain the repository, number and update revision so existing controls keep identity until the PR changes, then both reset.

The regression renders the actual page with mocked inventory and control children. It records keys emitted by both JSX development and production factories, asserts separate non-empty identities, checks stability on an unchanged render and verifies both change when `updatedAt` changes. It also captures console errors. Server rendering does not run client reconciliation and does not itself emit the duplicate-key warning; the sibling-key invariant is the meaningful red/green check rather than a false claim of browser-console reproduction.

Before the page repair, the regression failed with `expected 1 to be 2` for the distinct-key set. After repair, `node_modules/.bin/vitest run apps/dashboard/app/admin/pull-requests/page.test.tsx apps/dashboard/components/pull-request-audio.test.tsx apps/dashboard/components/pull-request-details.test.tsx` passed: 3 files / 13 tests, exit 0. The final test-only key-normalization check reran the page suite: 1 file / 2 tests, exit 0. Touched page/test ESLint exited 0. Dashboard `node_modules/.bin/next build` exited 0 (9.5-second compile; types and static generation passed). Whitespace and ledger checks are run before the repair commit. Independent review and required CI remain Lead responsibilities.

## Retrieval and bounds

The implementer reused the already loaded AGENTS, Constitution, operator-directed, learning, preservation, identity, PR and role/guardrail guidance for this same bounded request. Targeted Notes To Self lookup covered duplicate keys, PRs and Vitest; relevant focused-test/dependency-bridge guidance was already retrieved. The mandatory `node dist/src/cli.js work monitor --no-pull-requests --json` completed before the page repair: 4 Projects / 132 working copies. Other reported vulnerable work was left untouched.

Initial test instrumentation captured only the production JSX factory and observed zero controls; the development factory wrapper corrected that harness gap before producing the exact pre-repair duplicate-key failure. The guard now covers both factories, so another build-mode-only preview cannot conceal this identity collision from the unit check. No services, settings, production state or model changes were made.

Lead separately measured warm managed-page reload cards at 1,108 ms with zero default summary GETs. Cold development API reads after restart exceeded the 65-second request timeout and eventually returned 200 around 68/103 seconds under compilation/concurrent reads; this remains existing [Issue #1339](https://github.com/pmark/arcadia/issues/1339), not fixed or expanded into service work by this key repair. No latency improvement is claimed here.

Operator/end-user QA is the same: on the managed `/admin/pull-requests` page after authorized delivery, verify no duplicate-key console warnings, then open details and summary/audio independently. An inventory refresh that leaves the update revision unchanged should preserve both controls; a changed revision should reset both. Live restart and service QA belong to Lead's authorized delivery, not this implementer handoff.
