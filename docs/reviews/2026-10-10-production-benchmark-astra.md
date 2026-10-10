# Astra adversarial review: production benchmark

Date: 2026-10-10  
Reviewer: independent read-only Codex subagent, `gpt-6-astra`, high effort  
Author/editor: Cody Atlas; operator-directed work, [Issue #1207](https://github.com/pmark/arcadia/issues/1207)  
Reviewed draft: [benchmark](../proposals/production-benchmark.md) and [corpus](../proposals/production-benchmark-corpus.json)

## Original review boundary and verdict

Astra reviewed the saved draft without editing files, Git state, workspaces or
policies. It did not execute a benchmark. Input SHA-256:

- Markdown: `efcfef337ef15411e8d45da65b5c06562f03dc4d02a450b2e13702a6c06c702c`
- Corpus: `a3b7d178e20816ddb900fccd68d27c951913b1d960bd7454e026353e08c1e925`

Original verdict: **revise before freezing the experiment**.

Astra identified three central risks: an unidentifiable Jev intervention,
machine-cost success that omits necessary delivery labor, and rollback that
could lose newly acknowledged data. The author accepted all seven findings
and revised the documents. The table records author dispositions; it is not
a claim that the reviewer has cleared the resulting head. Final exact-head
independent review and CI evidence belong in the pull request.

## Findings and integrated remedies

| # | Reviewer severity | Finding | Integrated remedy |
| --- | --- | --- | --- |
| 1 | Blocking for Jev adoption | C could make few/no Jev calls and appear better through variance; refusal-only routing hides excessive abstention. | Freeze I1–I5 intervention details, B/C implementations, ground truth and fallbacks; require 24 distinct context/question pairs in both repetitions; score accepted/refused/ambiguous requests and downstream repair; insufficient intervention yields inconclusive. |
| 2 | Material | Required intake/review/verification and setup could remain expensive while machine and correction-only gates passed. | Separate research-only, production-required and reusable-development labor; require aggregate production human minutes, development labor ceilings, amortization sensitivity and explicit break-even/conditional commercial verdict. |
| 3 | Material | Maintenance could pool arms and hide costly failures in a median. | Each arm has 48 planned updates; failures/unavailable updates stay in its denominator; aggregate cost includes failed work; median/p95 are secondary; U1/U2 independently branch from the accepted initial revision. |
| 4 | Material | Recovery could restore a snapshot while losing acknowledged new jobs or notification effects. | Add a named durable job/outbox interruption, new jobs and old-job modification; verify ownership and every acknowledged record/effect; require safe refusal and forward recovery when rollback would lose work; freeze unauthenticated/cross-client/escalation matrix. |
| 5 | Material | Corpus contains withheld answers and assertions that could leak to builders. | Physically separate builder/evaluator packages, tool-readable allowlists and input hashes; scripted clarification release/delay; no across-trial feedback; unenforceable isolation makes confirmation inconclusive. |
| 6 | Material | Reviewer averaging, adjudication and distinctiveness were ambiguous. | Per-reviewer means, dimension floors, explicit third-reviewer rule and journey-veto reproduction; human reviewer qualifications/calibration; claim visual variation rather than bespoke/customer-perceived distinctiveness. |
| 7 | Advisory | Either cost or time could be selected after results; small/noisy gains could trigger adoption. | Preregister cost as the primary endpoint; case-level discordance/bootstrap uncertainty and leave-one-case-out sensitivity; uncertain results retain B pending confirmation. |

Additional author clarification: initial trial timing begins at the initial
builder package, including clarification; the corpus now uses exact per-family
page names. The proposed website allocation explicitly reserves initial,
maintenance, routing and coordination money. These are still proposed limits,
not spending grants.

Astra praised the all-assigned-trials cost denominator, retained failures,
repair limits, separate actual/replacement/fully-loaded accounting,
independent exact-head acceptance, and bounded application/portfolio claims.
Its primary-source check confirmed the Jev rate, Cloudflare calculation and
hostname pricing, and the technical-eligibility/discovery distinction.

## Scope and local validation

This PR defines a proposed protocol and corpus inventory. It does not claim
fixture materialization, a functioning runner, website/application delivery,
benchmarked costs, market demand or public reachability.

Local evidence:

- Existing `parseDoc(relativePath, absolutePath, content)` accepts the proposal
  frontmatter with zero errors.
- JSON parses; IDs and per-family page lists are unique/consistent; four
  development cases, twelve scored website cases, twelve balanced routing
  cases, one application case, and two updates per website case.
- Arithmetic: 72 initial trials; 48 planned updates per arm, 144 total; 72
  routing trials. Website budget allocation: 720 + 288 + 144 + 48 = 1,200 USD.
- `pnpm exec vitest run tests/upstream-proposals.test.ts`: 8/8 passed.
- Existing source/check scripts remain unchanged. Final diff/whitespace/link
  checks are recorded in the PR.
- Primary checkout reflog was unchanged after Astra's first read-only review:
  `041715e75`, `118c1a2e2`, `5ab110ff1`. Unrelated peer work was preserved.

No governed Action exists for this operator-directed request. No Plan/pointer
or queue was amended; no completion Ask or benchmark execution was claimed.
The registered advisory inputs are `agentask_4f08c5910d54b743d3` and
`agentask_80bb28c16821d33994`.

## Retrieval and friction evidence

Previously loaded: Constitution, Project/pointer and exact current Action,
context policy and index; continuation, learning, principles and Agent Ask
guidance; Arcadia Agent Ask skill. Before this PR work: working-copy safety,
Git identity, operator-directed work, PR procedure, proposal filing, standard
harness, repository PR QA/working-copy sections, and model-selection delegation
sections. Targeted Notes To Self reads covered worktree/dependency bridging,
identity, preservation and permission failures.

Full-file byte sizes at retrieval (partial sections are named below; these
numbers are not a claim that entire procedural files entered context):

- `CONSTITUTION.md`: 3,320; `PROJECT.md`: 31,700.
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539; `repo-context.md`: 703;
  `context-policy.json`: 870.
- `docs/agent-guidance/index.json`: 6,393.
- `docs/agent-guidance/continuation.md`: 6,239;
  `operator-directed-work.md`: 4,494; `learning.md`: 1,636;
  `principles.md`: 13,789 (scope/capture sections);
  `agent-asks.md`: 22,884 (capture/permission/settlement sections).
- `docs/agent-guidance/arcadia-repository.md`: 30,174
  (Orientation, Semantics, PR QA and Working-Copy Safety sections).
- `docs/notes-to-self.md`: 33,108 (targeted matching entries).
- Active Plan: `docs/plans/governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a.md`,
  43,005 (exact `define-governed-role-registry` Action).
- `arcadia-agent-ask/SKILL.md`: 3,452.

Additional PR-operation full-file byte sizes: working-copy-safety.md 15,818;
git-identity.md 5,248; pull-requests.md 16,922; proposals.md 1,995;
standard-harness.md 5,569; model-selection.md 9,476 (delegation sections).
Paths are the indexed authoritative homes, not a new instruction store.

Observed friction and recovery:

1. Candidate `pnpm arcadia identity resolve` hit mise trust-link filesystem
   denial. Identity was resolved from the configured main checkout; candidate
   validation used direct Node/module entry points and the canonical dependency
   bridge. No provider/host configuration was changed.
2. Sandboxed GitHub Issue creation could not connect to api.github.com.
   The same bounded operation succeeded through ordinary host escalation:
   Issue #1207.
3. An initial ad hoc parser probe omitted parseDoc's required third argument
   and reported no frontmatter. Reading its signature and passing all three
   arguments produced zero errors; this was a probe error, not a document
   defect.
4. Sandboxed Vitest could not create `node_modules/.vite-temp`.
   The same focused suite passed via ordinary host escalation (8/8).
5. Earlier research proposal captures encountered configured-workspace SQLite
   write denial; supported CLI capture succeeded through ordinary host
   permission recovery. Existing nine unrelated Ask replay/content conflicts
   were reported separately and left untouched.

These permission/dependency remedies already have authoritative Notes To Self
entries. This documentation candidate does not edit a peer's live notes file.
