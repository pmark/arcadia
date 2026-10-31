# Managed production readiness

This is the **single canonical checklist** for the remaining unattended-production acceptance gap. It is derived evidence, not an authority store: the [unattended-production acceptance Plan](plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md), the [current coordination Plan](plans/unify-interactive-and-unattended-coordination-with-safe-concurrent-actions.md), Decisions and canonical runtime receipts govern. Handoffs and coordinator wakeups point here rather than maintaining another checklist. Rowan is the sole release-manager contact; helper assignments do not transfer that custody.

**2026-10-31 adjacent Go delivery probe (parked):** [PR #1921](https://github.com/pmark/arcadia/pull/1921) and [PR #1926](https://github.com/pmark/arcadia/pull/1926) are source-merged; the guarded Off adoption (receipt `runs/20261031T181357Z-67869`) installed broker/worker at `24c4ee0`, and the failed-before-start successor was disposed append-only (receipt `runs/20261031T182448Z-92315`). The probe is parked per operator direction; its handoff is [PR #1927](https://github.com/pmark/arcadia/pull/1927); the earlier [Go 1921 continuation report](reports/go-1921-claude-continuation-2026-10-31.md) is historical evidence. It is not evidence for the acceptance record below.

## Operator view: the rover's route from here

**Production is Off. The original three-job acceptance record can no longer close as written.** Of its three jobs, one was delivered by the worker ([PR1779](https://github.com/pmark/arcadia/pull/1779)), one was finished by hand-assisted repair ([PR1787](https://github.com/pmark/arcadia/pull/1787), merged 2026-10-27 by the operator after assisted R2 review and source completion), and one was rejected ([PR1783](https://github.com/pmark/arcadia/pull/1783): the worker's review of `f412f5fd` returned needs-follow-up because its test duplicated the rmSync options instead of exercising the real teardown; closed 2026-10-29 under the operator's direct instruction to close or merge remaining PRs). `first-unattended-run` requires one run in which **every** in-scope Action reaches a merged PR with touches limited to activation and authority-adjacent merges, so it needs a **fresh run** of at least three ready Claude Actions. Choosing that scope is your decision; nothing below starts it.

Derived **2026-10-31** from fresh read-only observation and exact merged source. Production observed **2026-10-31T18:47:59Z**: **Off (`inactive_idle`) revision83 / epoch46 / zero live admissions**, scope and authority absent. This refresh performs no runtime operation.

| State | Evidence and remaining gate |
| --- | --- |
| Delivered by the worker | [PR1779](https://github.com/pmark/arcadia/pull/1779) (`isolate-launch-preview-tmux-name`, done) under the October25 START. A fresh run cannot reuse it; it remains evidence that the worker path can deliver. |
| Delivered, not unattended | [PR1787](https://github.com/pmark/arcadia/pull/1787) merged at `8d9ca9fb` by the operator; canonical `rebuild-cover-mail-ack-receipt-kind-collision` is done via `complete-mail-ack-source-concurrent-20261027-01a17e94`. It closes Issue1470's work but cannot count as an unattended delivery. The original Action `cover-mail-ack-receipt-kind-collision` (held PR1662, now **closed** 2026-10-29) is still `open` in the acceptance Plan although its work is delivered: it needs a governed supersession, not a rebuild. |
| Rejected; Action open | [PR1783](https://github.com/pmark/arcadia/pull/1783) closed without merge; `bound-guidance-test-teardown-retries` stays open and Issue1419 open. Its Plan criteria are satisfiable by the rejected shape (they only require the rmSync options), so a fresh candidate would meet the letter but fail review again. The criteria need a regression-detecting test before it is a credible run job. |
| Adopted | Broker and worker run `24c4ee020` (receipt `runs/20261031T181357Z-67869`: broker before `eb15d32c`, worker PID 72812 started 11:16PDT, loaded source inferred, production unchanged). That revision **contains** [PR1794](https://github.com/pmark/arcadia/pull/1794) (`76457a99` is an ancestor), so the 10-26 "merged, not installed" gate for PR1794 is **satisfied**. |
| Source ahead of runtime | Main is `1ac59bd`; [PR1926](https://github.com/pmark/arcadia/pull/1926) changes `src/sessions/launch.ts`, `launchPreview.ts`, `terminalClaimRecovery.ts` and adds recovery disposition (8 `src` files, +447/−15) after the installed revision. The Off disposition script already ran from the main checkout at `1ac59bd`; the worker still runs `24c4ee0`. Whether a fresh run needs `1ac59bd` adopted is unassessed; decide before START, and adopt only through an exact one-shot card. |
| Capacity unknown | Decision0141 permits at most one needed bounded renewal-and-worker-verification per America/Los_Angeles day within its class; Decision0143 records the small-usage class, requires each sequence to be needed and does not replenish0141's allowance. Decision0144 (2026-10-26) approved assisted Codex delivery while Claude was blocked and left strict acceptance unchanged. No fresh actual-worker capacity reading exists after 2026-10-26. Required before any START; no credential probe was made by this refresh. |
| Unproved | `first-unattended-run`: needs a fresh activation preview of at least three ready Claude Actions, one START card, every Action merged through the worker, and this document re-derived from that run. |

**Smallest route to closing `first-unattended-run`** (each step a separate gate; none is authorized by this refresh):

1. **Re-scope (your decision).** Pick at least three small, independent, self-checking Claude Actions for one fresh run: a tightened `bound-guidance-test-teardown-retries` whose test fails when the `afterEach` retries are removed, plus at least two further ready Actions. In the same governed amendment, supersede the delivered `cover-mail-ack-receipt-kind-collision` and update `first-unattended-run`'s dependencies. Prepared by Rowan as one reviewed Plan-amendment card.
2. **Runtime and capacity.** Assess whether `1ac59bd` must be adopted; run the Decision0141/0143 bounded capacity check for the day of START. Agent-run where a standing Decision covers it; otherwise one pinned card each.
3. **Activation preview + START (your press).** One card pinning the exact scope, Claude only, concurrency1, policy revision83 and expiry.
4. **Unattended delivery and acceptance.** Worker delivers; Rowan re-derives this document from the ledger and settles `first-unattended-run` only if every criterion is met.

Every press and host step on this route is recorded as friction toward one-click whole-Plan continuation ([Issue1929](https://github.com/pmark/arcadia/issues/1929)); the cheapest, checklist drift, is fixed by this refresh.

Evidence custody: the `runs/` receipts named above (main checkout, ignored, host-local), GitHub PR records and canonical Decisions. Rowan retains sole coordination.

<details>
<summary>Superseded October26 operator view — PR1783/PR1787 described as held</summary>

## Operator view: the rover’s route from here

**Production is Off. One of the three jobs has been delivered; the other two remain held.** The [current Journey](http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/arcadia/plan/current) is the operator's status view. The old October25 START buttons are historical: their allowances are consumed and the daily START/STOP delegation expired. They are not a next action to press.

Derived **2026-10-26** from the coordinator's retained receipts and exact merged source, with production last confirmed **Off revision83 / epoch46 / zero admissions**. This refresh records known state; it performs no new runtime observation or operation.

| State | Evidence and remaining gate |
| --- | --- |
| Delivered | [PR1779](https://github.com/pmark/arcadia/pull/1779) is the only delivered job in this three-job acceptance record. This does not prove the full unattended milestone. |
| Held | [PR1783](https://github.com/pmark/arcadia/pull/1783) and [PR1787](https://github.com/pmark/arcadia/pull/1787) retain their original candidates, exit records, attempts and review history. Source repairs do not accept or restart either candidate. Held PR1662 also stays untouched. |
| Source merged; not installed | [PR1794](https://github.com/pmark/arcadia/pull/1794) merged at `76457a9974fd3fbd6ab5e6270a844bcc894301d1`, following the merged completion-evidence and attribution repairs. It adds the bounded supplemental evidence producer and explicitly pinned verified consumer. Exact-head R3 review and all15 CI jobs passed. Source publication is not runtime adoption, producer execution or a live review result. |
| Next approval package | Prepare one exact guarded adoption that preserves the canonical pointer history and incorporates the merged fixes. Then retain the separate exact supplemental-producer authority, Artifact ID/hash pins, finite production-Active review authority and a fresh two-Action START scope. These operations remain unapproved; preparing this checklist or a preservation PR grants none of them. |
| Capacity authority; consumption unknown | [Decision0141](decisions/0141-record-standing-daily-claude-renewal-and-verification-approval.md) permits at most one needed bounded renewal-and-worker-verification sequence per America/Los_Angeles day, within its exact class. It explicitly counts0139/0140 as **October25 consumed**. **October26 consumption coverage is UNKNOWN:** the authoritative daily-ledger path/implementation has not been established in the known receipt locations. Absence of a found marker does not prove the day unused. Do not renew or probe until that coverage and fresh exact bindings are established; no additional human approval is required within the Decision's unchanged class. |
| Unproved | Both remaining real deliveries and the full `first-unattended-run` acceptance record, including allowed operator touches. Only their complete evidence can close the milestone. |

**The next operator gate is a concrete reviewed adoption/continuation package, not an old START button.** Runtime adoption, supplemental validation, Artifact-pinned Active reviews and a new two-Action START each retain their exact authority and evidence requirements. No new START is authorized by this status refresh. Failures and uncertain attempts remain consumed; no reset, reused nonce, credential inference or automatic retry is implied.

Evidence custody remains `artifacts/generated/session-closeouts/20261023-rowan-offline/READINESS-HANDOFF.md`, its retained renewal/verification and runtime receipts, canonical Decisions and the named PR records. Generated evidence is host-local and ignored; a repository link does not make it portable. Rowan retains sole coordination; no new watch or live operation is created here.

</details>

<details>
<summary>Superseded October25 executive readiness — historical source pins, consumed allowances and expired START advice</summary>

## Operator view: the rover’s route from here

**The rover has its route, three job cards and a working fuel gauge. It is still parked.** Production remains Off until you separately approve **START**. The live [Journey](http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/arcadia/plan/current) reports **“Parked: production is Off.”**

**Five milestones remain.** Practice-drive evidence is reconciled and independently reviewed. These are milestones, not five approvals. **Your next move is START:** the [reviewed button](http://arcadia-1.alpine-rattlesnake.ts.net:3020/actions/start-three-claude-actions-20261025) is live and ready.

| # | Milestone | What happens |
| --- | --- | --- |
| **1 — your move** | **Press START** | Press Run on the reviewed button to release exactly these three jobs on Claude, one at a time, within the agreed limits. Earlier approvals do not start the rover. |
| 2 | Deliver the first job | Keep a test from consulting the host’s terminal-session server. The rover validates the change, obtains independent review and delivers the PR. |
| 3 | Deliver the second job | Make test-directory cleanup tolerate a brief filesystem delay, with the same validation and review gates. |
| 4 | Deliver the third job | Build the fresh mail acknowledgment collision test. The older held PR stays untouched. |
| 5 | Confirm arrival | Check the full journey record: all three real deliveries landed, with operator involvement limited to START and any reserved change approvals. Record acceptance against the original goal. |

**What needs your attention now:** nothing further for sign-in renewal or the completed capacity check. Their approved sequence succeeded. Decision0141 records at most one needed bounded renewal/check per local calendar day until this milestone is proved, including its required records. Today’s allowance is consumed; failed attempts are never reset. The direct START-button notification was delivered on Discord at22:15:47UTC. The button expires at2026-10-26T00:00UTC; readiness is not permission to press it for you. Any unavoidable later approval also uses a remote actionable surface or an explicit chat approval; no host commands or native coding-agent interaction are required.

## Current readiness and limits

Derived **2026-10-25**, from current canonical Project/Plan state, production Off revision79/epoch44/zero admissions, queue282, installed worker release `13e9f3fcf82a849e09fe8356b3ab281510905e1c`, Decisions0134–0141 and retained receipts. This is preparation, not live unattended acceptance.

| State | Gate or milestone | Evidence / next move |
| --- | --- | --- |
| Proven | Restore the unattended Plan | PR1754 merged; the explicitly approved guarded restoration completed. The unfinished coordination track is preserved. Do not reask or reapply. |
| Proven | Prepare the exact three immutable packets | Decision0135 batch succeeded; its attempt is consumed forever. R438–R440 remain unapproved until the explicit START grant’s packet delegation handles them. Never rebuild/reset them merely to progress. |
| Proven | Install the reviewed worker source | PR1757 and PR1760 merged; explicitly approved guarded adoption succeeded. Actual owning worker50950 reports compiled release13e9 and its pinned handler. Adoption allowance consumed; no restart or reinstall implied by later governance-only commits. |
| Proven | Confirm sign-in and worker capacity | Explicit0139 renewal succeeded once; actual0140 worker check returned HTTP200 at21:08:59UTC, 5h5% / 7d20%, credential expiry2026-10-26T05:07:07.651Z. Both attempts are consumed. This is retained evidence, not a promise of fresh usage at launch: the Active worker must read fresh capacity before every admission and refuse unknown, stale or exhausted windows. |
| Proven | Apply agreed spending rule | Decision0134 records100%, no reserve; admission still requires both included windows strictly below100%, no paid fallback and all ordinary gates. Do not reask the percentage. |
| Proven | Correct the demonstrated wrong turn | Rehearsal v2 integrated the first simulated job then selected the old held Action outside scope. Independently reviewed canonical queue move `qorder_aa887af4823444b996` changed281→282: B → C → replacement A → held original. All27 keys and every other key’s relative order remain intact. No Plan criteria, immutable packet, PR1662, custody or attempt was changed. |
| Reconciled, with explicit limits | Full-chain and changed-path preflight evidence | v4 stopped after the corrected queue: first B validation exceeded its120s per-command lint cap; bounded continuation passed validation and independent review, then integration waited on an unarchived resumed-draft authority boundary. No3-integration current-source pass is claimed. The misleading900s total-budget message and lint workload mismatch are captured in Issue1765; the earlier Issue981 covers stray draft integration holds. Reuse historical three-Action v5 and current-source v2 first-integration evidence; Independent pre-press review accepted the composed evidence: historical v5 proves the exact trio; the published PR1684 repair report proves its observed changed-head recovery and two integrations; current-source B and PR1757 protected validation cover the changed paths. Core production policy/tick/review-repair/merge code is unchanged. The raw historical repair file is unavailable; its published signed report is retained as such. No fresh current-source full-trio pass is claimed, no timeout is treated as pass, and no new broad replay is required solely for freshness. Preserve v1’s missing-board fixture failure, v2’s routing refusal and v3’s pre-launch owner-socket refusal. No simulated result establishes real unattended acceptance. |
| Live and ready | One-shot START button | Draft passed independent Process Critic review and descriptor/shell checks. It pins the exact trio, queue282, worker/source, Off79/44/zero, expiry, fresh press-time previews and a durable one-shot activation allowance. Final evidence composition and hash-manifest lookup passed independent review; the whole library contract check passed137 entries with zero failures. Tailnet catalog/page returned200; browser showedReady and an enabledRun button. The activation allowance remains unconsumed; production remainsOff. No agent may press it. |
| Pending explicit human START | Release the rover | The eventual press authorizes exact scope, Claude only, concurrency1, packet approval and reviewed PR integration for24hours. The policy itself has no automatic expiry; already-approved packets may launch after delegation expiry, subject to admission gates. No PR integration after its grant expires. STOP remains available. |
| Unproved | Three live deliveries and unattended acceptance | Preserve held PR1662 and all earlier failures. Each future candidate needs its own validation, canonical completion, exact-head independent review and required CI. Settle `first-unattended-run` only from the complete live ledger and exhaustive operator-touch record. |

Current source changes to lint/tsc validation binding and workspace-wide read-only reservation inventory are published and adopted. Earlier twice-per-Action validator and bounded lint/tsc receipts remain reusable preflight evidence; they do not waive checks on future live candidates. Cached capacity may be stale before START: the established grant permits only this stale-only condition because the actual worker refreshes before admission; unknown/exhausted/unmetered states still refuse.

Evidence custody: `artifacts/generated/session-closeouts/20261023-rowan-offline/READINESS-HANDOFF.md`, `postrenewal-usage-worker-receipt.json`, `start-readiness-20261025/` and the canonical Decision records. Generated evidence is host-local, ignored and preserved separately; repository publication alone does not make it portable. One Rowan coordinator and one half-hour heartbeat remain; no duplicate watch. The Journey’s “Before START” visibility proposal is recorded and is not a launch prerequisite.

</details>

## Preserved earlier derivation

The collapsed record below is superseded by the current gates above. Its old next-step and approval requests are historical, not instructions to repeat completed work.

<details>
<summary>October25 12:45UTC derivation and its retained proof limits</summary>

## Operator view: the rover’s route from here

**The rover is parked. Production is Off.** Its route-restoration request is published and reviewed, but the route has not yet been changed. The destination is three real jobs completed, reviewed and delivered by the rover, followed by proof that it made the journey without manual rescue.

**Nine main checkpoints remain on the route below.** These are delivery checkpoints, not a promise of nine clicks. The systems check still has an unresolved obstacle, so the exact number of small repairs or approvals is not yet known. Preparation can happen in parallel where it is safe.

| # | Checkpoint | What must happen |
| --- | --- | --- |
| **1** | **Put the unattended route back on the map** | **Your next gate:** approve restoring that route, while saving the unfinished current route for later. This does not start the rover. |
| 2 | Load three clear job cards | Prepare the three specific jobs, with a clear finish line and an agreed way to check each one. |
| 3 | Clear the rover’s systems check | Prove that its real controls and fuel gauge can be trusted. Fuel rules are already agreed; a trustworthy current reading is still missing. This is the main unresolved obstacle. |
| 4 | Approve the exact journey | Agree which three jobs the rover may do, its limits, and when it must stop. Other unfinished work stays outside that drive. |
| 5 | Say **START** | You explicitly release the rover. Every earlier checkpoint leaves production Off. |
| 6 | Reach the first delivery waypoint | The rover completes the first job and delivers a reviewed, accepted change. |
| 7 | Reach the second delivery waypoint | It continues to the second job and delivers another reviewed, accepted change. |
| 8 | Reach the third delivery waypoint | It continues to the third job and delivers the third reviewed, accepted change. |
| 9 | Confirm the destination was reached | Check the journey record: all three deliveries landed, with your involvement limited to START and any change approvals reserved for you. Record the result against the original goal. |

**What you need to decide now:** whether to restore the unattended route at checkpoint1. I can carry out the reviewed, guarded step after your explicit approval. The remote button is not currently available; you do not need to operate a terminal. Clearing that gate does not clear the systems-check obstacle or authorize START.

Latest derivation: **2026-10-25**, from published main `d79aff4c94e5323fd1e1f341bc69783878a03ac2` (display-only [PR1752](https://github.com/pmark/arcadia/pull/1752), following inactive-input [PR1750](https://github.com/pmark/arcadia/pull/1750)), canonical Project/Plan state and Decision0134, and production observed **2026-10-25T12:45:57.625Z**: **Off**, revision **79**, epoch **44**, **zero live admissions**, scope/authority absent. **Not ready to present START:** a fresh approved three-Action scope, eligible immutable packets, and fresh actual-worker capacity/launch evidence are still missing. No unattended acceptance or universal startup failure is established. All earlier failed and partial proofs remain preserved below. Installed broker was last observed at `92437476d8be3fa35f2be9243c898cdf7fe6bd27` at07:41UTC; source publication is not runtime adoption, and the prior recovery allowance remains consumed. Observations expire when their inputs change.

## Remaining checklist

A checked box proves only the stated step. Every unchecked row needs its own observable result; no percentage or completion count substitutes for the milestone criteria. Owners below name responsibilities, not an assertion that every helper is running.

| Done | Remaining step / owner | Evidence needed to close; next permitted move |
| --- | --- | --- |
| [x] | Publish the confirmed capacity answer — Rowan | Operator chose A, authorized recording and explicitly approved PR1734 merge. [PR1734](https://github.com/pmark/arcadia/pull/1734) merged at `2ef3a17cc` on2026-10-24T20:10:40Z; canonical Decision [0134](decisions/0134-confirm-recording-the-operator-s-prior-2026-10-21-instruction-reported-in.md) is approved with the same A, receipt `decisionanswer_e696676331344908a3`. Only Decisions0111/0130 numeric20%/80% clauses are superseded. Fresh valid unexhausted included windows below100%, unknown/reset/exhausted refusal, no paid fallback and all other gates remain. Do not re-ask the percentage or merge. |
| [x] | Publish shared coordination instructions — Rowan | [PR1730](https://github.com/pmark/arcadia/pull/1730) published the operator's directive in vendor-neutral `AGENTS.md` at `c2d1af846`; Codex/OpenCode default discovery and Claude's import passed their checks. Root12236/shared8162 bytes meet their budgets. This closes shared-source publication only. Verify actual instruction retrieval in the next managed launch/session trace before claiming prompt delivery; already-running agents are not retroactively proved. One coordinator, Discord blocker alerts and portable handoff custody remain standing duties. |
| [ ] | Obtain actual-worker capacity evidence — Mira investigates; Ellis prepares source; Rowan coordinates | [PR1737](https://github.com/pmark/arcadia/pull/1737) merged after explicit approval, current-head independent review and all15CI jobs. It implements a fixed Claude-only one-shot diagnostic with canonical authority fences and sanitized receipts, using fake tests only. Actual worker capacity is still unproved. The inspected Off diagnostic requires protected compiled-release binding; [PR1741](https://github.com/pmark/arcadia/pull/1741) published startup/package support, but the current source-launched worker has no proved loaded revision. The exact migration draft still refuses before mutation because complete current handoff-reservation coverage has no established supported read-only inventory route (proposal `agentask_d4eb16be57b28134f5`). This is a limit of the inspected diagnostic route, not proof ordinary managed startup fails. Any necessary adoption and later one-shot credential read need separate exact approval; no migration card is ready. No credential probe, refresh or START follows from source publication. |
| [x] | Collect retained-candidate validator and command evidence — Ellis; Nadia critiques | Six protected validator calls passed (twice per retained Action). A/B exact materialized candidates passed lint/tsc. A separately bounded, independently reviewed C-only task passed lint127452ms and tsc9803ms, exit0, with outer and inner terminal proof. Its script SHA256 is `19b4deffc4d83318353a5b135e2cef573b632ed55738c41b67e15ed6c69effe8`; limits were lint240s/tsc120s, seven active/eight enclosing minutes, one invocation with no automatic retry. Preserve the earlier C120-second timeout and setup failures. These are trusted offline preflight results, not live Action completion, independent provider acceptance or required CI on a future candidate. |
| [ ] | Revalidate the final source/runtime and launch contract — Rowan / Vida | Runtime recovery succeeded once at `92437476`; that allowance is consumed. Compare final source with installed broker and fresh actual-worker start/command evidence, policy, queue, claims, scope, expiry, allowances and review gates. Revalidate immutable criteria/config/check binding for the final launch revision; the retained-candidate preflight above does not waive future candidate checks. Decide whether later changes actually require runtime adoption; prepare a precise new gate only if required. No inferred reinstall/restart or loaded-memory SHA attestation. |
| [x] | Record completed shared enrollment source proof — Rowan | [PR1743](https://github.com/pmark/arcadia/pull/1743) and canonical completion `complete-shared-enrollment-concurrency-one-20261024` closed `prove-shared-enrollment-at-concurrency-one`. This is the declared fixture/source proof; it grants no live concurrency, native adoption or START. |
| [ ] | Preserve the current coordination track while choosing production scope — Rowan | The active [unified coordination Plan](plans/unify-interactive-and-unattended-coordination-with-safe-concurrent-actions.md) now has **four** open Actions and pointer `preview-safe-concurrent-action-selection`. Only that Action and the native-adapter Action have completed document dependencies; neither is proved dispatch-ready. Do not make all remaining concurrency development an assumed prerequisite for a concurrency-one production attempt. Preserve historical owners, claims and candidates; idle/frozen chats do not release them. |
| [ ] | Approve the exact Plan transition, then accept a fresh three-Action scope/preview — operator; Rowan prepares | [PR1750](https://github.com/pmark/arcadia/pull/1750) merged only the inactive restoration Ask, after explicit human approval, independent R1/R2 review and all15CI jobs; [Issue1749](https://github.com/pmark/arcadia/issues/1749) is closed. No Plan activation occurred. The reviewed shared activation runner can select `rebuild-cover-mail-ack-receipt-kind-collision`, standard/medium, return unified coordination to draft, replace the **entire five-Action** Arcadia queue segment (including held original A and `first-unattended-run`), preserve all Action records and publish its canonical settlement. That exact effect needs separate approval. Its local contract and read-only `--describe` passed; the remote dashboard omits the entry and its detail route returns404, cause unproved. Independently reviewed execution through the same host shared runner after explicit chat approval is supported; the operator need not run a terminal. Later production scope must separately restrict the approved trio, provider `claude-code-cli`, concurrency1 and current bounds. The08:32UTC proposed draft-Plan preview had zero included Actions at queue280; never activate that empty scope. Revalidate custody, immutable criteria/config/packet fingerprints, expiry, reviews/checks and applicable rehearsal/pre-press critique. |
| [ ] | Obtain separate START approval — operator | Only after preceding gates are satisfied, present one remote-reachable activation card for at least three ready Claude Actions with explicit spend/concurrency/time/attempt bounds. Agents do not activate. Current instruction remains Off. |
| [ ] | Deliver A: native-mail collision test — managed Claude worker; independent reviewers | Preserved Action `rebuild-cover-mail-ack-receipt-kind-collision` remains open in the prior Plan; it is not the current pointer. Prove its exact three Plan criteria, including focused vitest, lint and tsc, same-candidate canonical completion, required checks and reviewed PR merge. Preserve held PR1662 at `cff844a22093fbbf4c0a29408502718ab91d047a`; do not ready, rerun, reset or borrow its acceptance evidence. |
| [ ] | Deliver B: preview tmux-name isolation — managed Claude worker; independent reviewers | `isolate-launch-preview-tmux-name` remains open. Meet its exact Plan criteria, canonical completion, current-head independent review, required CI and worker integration within the approved run. |
| [ ] | Deliver C: bounded guidance teardown retries — managed Claude worker; independent reviewers | `bound-guidance-test-teardown-retries` remains open. Meet its exact Plan criteria, canonical completion, current-head independent review, required CI and worker integration within the approved run. Offline timeout evidence cannot close this Action. |
| [ ] | Prove and settle `first-unattended-run` — Rowan integrates independent evidence | The canonical ledger must show every in-scope Action reached a merged PR, with an exhaustive list of operator touches limited to activation and authority-adjacent merges. Re-derive this document with verdict and **every observed failure**, add hermetic coverage for predictable failures, and settle only when all three verbatim Plan criteria are met. Hand repairs or simulated merges cannot establish unattended delivery. |

The remaining critical order is exact Plan/scope choice and immutable packet preparation, with independent actual-worker/runtime evidence → final preflight/rehearsal/critique → separate operator START → unattended A/B/C delivery → ledger-based acceptance. Confirmed capacity recording is already complete; neither optional unified-Action packet preparation nor all concurrency development is an automatic prerequisite for restoring the unattended Plan. Independent Off preparation may proceed concurrently within authority. A blocked row is escalated through the configured Discord channel; the coordinator continues any other authorized work that reduces this gap.

## Completed preparation and proof limits

- [x] Source preparation advanced through [PR1741](https://github.com/pmark/arcadia/pull/1741), [PR1743](https://github.com/pmark/arcadia/pull/1743), [PR1746](https://github.com/pmark/arcadia/pull/1746), [PR1748](https://github.com/pmark/arcadia/pull/1748) and the inactive input in [PR1750](https://github.com/pmark/arcadia/pull/1750). Source merges, canonical Action completion, installed runtime adoption and live unattended acceptance are separate facts. PR1748 preserves committed settlement truth across cleanup failure; it does not retroactively repair historical operational receipts or release old custody.
- [x] Bounded09:41–10:01UTC observations: supported active Runs/Sessions were zero; recurring inventory was available and empty; all four active repository paths matched fresh worker-published routes; reserved requests were absent on those observed routes; one preservation custody had an exact-token terminal receipt. These observations do not prove current reservation-set completeness, claim eligibility, absence of future requests or atomic exclusion. The worker handoff projection cannot by itself close that coverage predicate; `tidy` is not a read-only substitute because journal recovery precedes its assessment. No direct database script, custody reset, probe or migration was used.
- [x] Optional current-unified-Action packet-preparation guard had independent review and22fake cases, but was never approved or pressed. Its preparation would observe incidental Codex telemetry even with a Claude profile. The PR1750 input merge changes its original source allowance; do not reuse that guard without fresh review. This optional path is not a prerequisite for restoring the unattended Plan and is not a three-Action milestone preview.

<details>
<summary>Superseded October24 derivation — historical evidence only</summary>

Latest derivation: **2026-10-24**, from published main `6fdba64ebcfd152ef69d3f3c1cce1c6130668411` (operator-approved PR1737), canonical Decision0134 and the active unified coordination Plan, preserved offline evidence, and production observed **2026-10-25T01:13:17.513Z**. Production is **Off**, policy revision **79**, epoch **44**, **zero live admissions**. No START is authorized. The unattended-production Plan remains draft with live A/B/C and first-unattended-run unfinished. PR1737 publishes the fixed worker diagnostic source; it is not installed and grants no live credential read. Its exact reviewed head `731491059` passed178focused tests, lint, TypeScript and all15CI jobs in run40135789162. Installed broker was last observed at `92437476d8be3fa35f2be9243c898cdf7fe6bd27`; the previous runtime recovery is consumed. New source changes require an exact adoption assessment. Observations expire when their inputs change.

</details>

- [x] Fixed source diagnostic published by operator-approved [PR1737](https://github.com/pmark/arcadia/pull/1737) at `6fdba64`; live adoption, credential execution and START remain separate. Final runtime source `13117cc4` has composed offline evidence:43scenarios passed in the full invocation, then2failed suites passed a bounded serial rerun under Seatbelt with actual tmux. This is not one all-green final invocation. The original unproved drain refusal is retained; [Issue1739](https://github.com/pmark/arcadia/issues/1739) records harness cleanup losing owner receipts. No historical PID signalling, custody clearing or live acceptance occurred.
- [x] Stop/drain correction merged in [PR1725](https://github.com/pmark/arcadia/pull/1725), with exact-head independent review and required CI. Unknown drain retains custody; historical process-group identities are not kill authority.
- [x] Governed dependency amendment `asksettle_b4b1a0464ff34d9594` and canonical pointer `qpointer_087f06f8d3fc46cb8c` published. That earlier replacement pointer and queue revision279 are historical; the current pointer is `preview-safe-concurrent-action-selection`, as recorded in the canonical Project and active Plan. All live delivery criteria remain open.
- [x] One approved runtime recovery succeeded 2026-10-24 15:35:29–15:41:42Z at main/broker `92437476`; preservation/Go transports and brief self-tests passed. Four services recovered; actual worker child51133 started15:39:15Z from primary `src/cli.ts`. This is launch/start/command evidence, not a directly exposed loaded-memory SHA.
- [x] Offline v5 three-Action rehearsal passed at source `492627d945001fcb4a66a3c70a24fddf05eefe87`: 21 ticks, 620235ms, three fake PR merges, terminal ownership proof and shadow Off. Manifest SHA256 `38a08eb677b246102fdfba1d6dc675050cf394669486e45405438418eecc9925`. Reviewers/providers/GitHub writes were simulated; no live delivery acceptance follows.
- [x] Six protected `validateCompletionCandidate` calls passed against literal launch-base criteria and unchanged retained candidate heads. Existing materialization/dependency bridging produced disposable exact trees; A/B lint+tsc passed. All28 owners across the packages have terminal proof after the new C-only task (three additional owners). C now has actual lint127452ms/tsc9803ms passes; its earlier timeout/tsc-not-run and failed setup receipts remain preserved.
- [x] The single native heartbeat `arcadia-critical-path-release-manager` remains ACTIVE. Sole Rowan custody and the existing watch transferred to the current coordinator chat; at10:31UTC its saved schedule was verified at half-hour intervals including14:00UTC /07:00PDT, with no duplicate watch. The old `arcadia-overnight-critical-path` no longer exists. Scheduling/transfer receipts do not prove uninterrupted execution or prompt delivery.

Local evidence custody is `artifacts/generated/session-closeouts/20261023-rowan-offline/` (ignored, host-local): `READINESS-HANDOFF.md`, `OPERATOR-DIRECTIVE.md`, `SUCCESSOR-PROMPT.md`, hashed receipt, `runtime-and-risks/` and `capacity-answer-and-C-preflight/`. Cross-provider handoffs must retain or transfer those artifacts; a repository link does not make ignored evidence remotely recoverable. Temporary replay roots are supporting evidence, not portable custody. No credential values are retained in this checklist.

## Conditional risks and revival triggers

General hostile-candidate/HOME confinement tracked in #1682 remains unproved; this preparation covers only trusted narrowly bound self-check Actions. Reassess before any broader candidate or real-provider replay. The inherited #1724 dependency-snapshot ENOTDIR defect revives if an actual required check encounters it. Canonical pointer commit identity inherited the operator identity at the API runner boundary; preserve history and prepare the source correction/regression when that boundary is exercised again. The recovered descriptor's workspace mismatch needs a general source correction before its next general use; the consumed reviewed wrapper was specific to this recovery. Pending 80%-pause/Resume remains a separate propose-only deferred policy, revived by its recorded trigger; it is not part of the confirmed no-reserve baseline. None of these is silently declared resolved or expanded into new launch authority.


</details>

## Historical derivations

The following records preserve earlier failures and previous next-step advice. Their source pins, thresholds, Action names and recovery choices are historical; use the current checklist above for the next move.

This derived document answers how far Arcadia is from running software production unattended. It grants no authority. Checked-in Plans and Decisions, canonical policy and Session receipts, and live evidence take precedence.

Latest derivation: **2026-10-22**, from clean source/installed runtime `392f1ad6f`, the active Plan and current Action, fresh production/broker/service reads, [combined replay evidence](https://github.com/pmark/arcadia/pull/1684#issuecomment-6333834088), and [capacity blocker #1692](https://github.com/pmark/arcadia/issues/1692). This is a bounded preparation update, not a new live run or unattended acceptance.

## Historical answer, 2026-10-22: source recovery delivered; fresh capacity and QA recovery remain gated and Off

PRs [#1684](https://github.com/pmark/arcadia/pull/1684) and [#1689](https://github.com/pmark/arcadia/pull/1689) merged after exact-head independent review and green CI. The operator separately approved the local runtime/configuration refresh and service restart. The existing recovery script exited 0 at installed revision `b88341f20`; all four services, protected preservation/Go transports and brief self-tests passed. Intelligence health was OK and the dashboard returned HTTP 200. These local checks do not establish provider readiness.

The combined source-state failure-recovery replay at `873f3cfbb8a415be25b887b23dfeebd4222f8006` completed in **19m49s**, exit 0, 20 ticks. It accepted initial Action A, injected a review failure, automatically launched and accepted a changed repair, obtained fresh simulated code-review/QA passes, integrated locally, then admitted/completed/reviewed/integrated Action B. Three accepted completions and two local fake-origin integrations were observed. It then idled on the inherited #1662 QA hold. Reviewers and GitHub writes were simulated; edits were trusted scripted fixtures. Preservation, completion validation, settlement and orchestration were real. This proves neither live reviewer/provider acceptance nor every pinned Action's merge. Earlier failed and 90-minute partial runs remain retained. Phase benchmark improvements are not a controlled full-replay speed ratio.

### Current gates and critical path

| Gate | Evidence and next safe move |
| --- | --- |
| Production | Fresh `production status` at 2026-10-22T16:40:31Z: inactive, revision 79, epoch 44, zero live admissions. No new activation, reset or allowance was performed. |
| Host/runtime | Main and installed broker `392f1ad6f` from the successor checkpoint; approved runtime/configuration refresh exited 0, four services and both transports healthy. No reinstall or restart performed in this preparation. |
| Claude capacity | Retained worker-context forced Keychain reading at 2026-10-22T16:16:01Z succeeded: 5h 4%, 7d 1%. The shell's different inherited token returned 403. Earlier fallback comparisons could reuse the five-minute cooldown and do not establish fresh Keychain HTTP requests. #1692 is closed with revival trigger; no claim that desktop login caused the remedy. A new live helper verification was denied by host auto-review before any credential read/send; explicit approval is needed for that operation. Retained capacity is now stale for admission; obtain fresh actual worker-context windows under unchanged gates before On. |
| Shared helper / recovery preparation | Operator-directed #1693 adds isolated credential-aware diagnostics and a one-shot #1662 recovery-card candidate. Neither is installed/published by preparing a PR. See [exact sequence and limits](reports/shared-usage-1693-and-1662-recovery.md). #1691's HTTP diagnostic fix is merged, not pending. |
| First Action | [#1662](https://github.com/pmark/arcadia/pull/1662) remains draft at `cff844a22093fbbf4c0a29408502718ab91d047a`. Corrected exact-head QA plan and CI evidence are preserved, but the old failed QA verdict remains. Under separately approved Active in-scope authority, ready that exact candidate and perform one supported QA rerun; do not reset attempts or infer real exhaustion from the inherited escalation's stale wording. Fresh read confirms code-review next 6/limit 9 and QA next 4/limit 7; re-read again before admission. The prepared card pins this lineage and refuses drift. |
| Isolation/acceptance limits | #1682 bars real-provider replay/general hostile-candidate confinement claims. It does not by itself establish a blocker for the narrowly bound live self-check path; its immutable validation binding and lack of candidate hooks still require fresh proof. Unattended production remains unproved. |

The checked-in clean-run scoreboard remains **open** for all three pinned Actions: `cover-mail-ack-receipt-kind-collision` (current Action), `isolate-launch-preview-tmux-name`, and `bound-guidance-test-teardown-retries`. A simulated replay advances no live Plan status. The `first-unattended-run` acceptance gap remains actual reviewed/merged delivery with only allowed operator touches.

Next: review and deliver the credential-adjacent #1693 preparation, then obtain specific live credential-read approval and fresh worker-context capacity, revalidate installed-main/immutable validation/pre-press critique, and only then present the existing three-Action START card plus one-shot #1662 recovery. This is not approval to ready, rerun or activate. Decision 0131's credential-changing fallback is for a recorded 401 under the Active worker; it does not cover 403 or Off. Keep production Off. All three clean-run Actions and first-unattended-run remain open. Earlier replay failures, old QA failures and the original capacity diagnostic receipts remain retained.

Historical derivation: **2026-10-20**, from `origin/main` 1a84c392f, the second unattended Claude run's PR and Issue record (card `grant-production-unattended-claude-next-run-20261019`) and the [unattended-Claude Plan](plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md). The 2026-10-19 derivation used `origin/main` 9e6ff4aa1 and the [unattended-Claude Plan](plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md), the first unattended Claude run's worker log, ledger rows and PR record. The 2026-10-18 derivation used `origin/main` 4777543a7, the first supervised Claude run's worker log and receipts, and live `production status`. Historical observations below do not establish installed adoption or current live authority.

## Historical answer, 2026-10-20: not yet proven unattended. All three Actions of the second unattended Claude run reached merged PRs, but through many non-allowed touches

The second multi-Action run under the grant card `grant-production-unattended-claude-next-run-20261019` (live workspace `martianrover`, repository `pmark/arcadia`, provider `claude-code-cli`, Plan `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider`) ran 2026-10-20. Acceptance criterion 2 of `first-unattended-run` (every Action reaches a merged PR with only activation and authority-adjacent merges as operator touches) is **not met**, so the Action stays open. Unattended production on Arcadia's own repository is **not yet proven unattended**. The merged-PR count improved from 0 to 3 of 3, but the Release Manager (RM) hand-completed one Action, hand-repaired two candidates, and the operator pressed Off, RE-RUN and STOP repeatedly. GitHub shows every merge as `pmark`; attribution here is the run record's claim. Live policy revision, epoch and alerts were not re-read for this derivation.

### Run record by Action

| Action | Observed |
| --- | --- |
| 1 `test-transient-review-retry-after-exhaustion` | Completed by the RM by hand and merged as #1610 (merged 09:07Z). The Session-produced candidate #1601 was closed as a false fix. Not an unattended completion. |
| 2 `refresh-decision-0130-status-and-1559-fake` | Four Sessions. The validation wall (Sessions told to run validation their permission mode denies) was Issue #1619, fixed in #1622. Independent code review returned needs-follow-up (leftover Ask files); the RM hand-repaired it in de8c70f; an RM-launched fresh review passed; the operator merged #1617 (20:12Z). The hand repair broke the canonical-settlement binding, so the tick could not re-review the candidate itself (#1632, open: a terminal settlement-mismatch refusal is masked by a stale `review_repair_gated` escalation). |
| 3 `guard-repair-gate-upsert-role` | The real completion validator refused the Action's original criteria at its 900 s bound: `tests/review-repair-loop.test.ts` alone took 627 s. Criteria were amended to a focused test file (#1633, operator merge). The offline replay could not reach tick 2 because `gh project item-edit` was unsimulated (#1634, fixed). Run 1: four Sessions looped `incomplete_resumable` because headless Sessions could not run the named test (the allow-list was the Project `validationCommands` only; #1636, fixed by #1637, operator merged); the operator pressed STOP mid-run. Four false "complete" Asks held launch as `operator_gate_pending`; the RM rejected them with `agent-ask settle --disposition rejected`. RE-RUN: one Session reached `accepted_completion`. The tick's independent code review then FAILED #1635 (an `IS NOT` to `!= null` regression, and the test copied the SQL instead of exercising the real gate path). Repair was gated (Decision 0098), so the RM hand-repaired it in 96833eac6 at the operator's direction; a fresh RM review passed; the operator merged #1635 (23:48Z) while production was still Active. |

### What worked unattended

- Packet preparation, delegated packet approval and launch.
- Resume after an incomplete Session (once headless Sessions could run their named test).
- The worker readied its own PR and ran its own independent code review, which caught a real regression in Action 3 (#1635).

### Operator and RM touches (non-allowed ones in bold)

- **Consented Claude CLI sign-in refresh, 14:13Z** (Decision 0131, answered in #1631: CLI self-refresh).
- Operator presses: **Off ~15:03Z**, RE-RUN ~21:14Z, **STOP ~21:45Z**, RE-RUN ~22:18Z.
- **RM completed Action 1 by hand (#1610); RM hand repairs de8c70f (Action 2) and 96833eac6 (Action 3); RM-launched reviews for both.**
- **RM rejected four false completion Asks to release launch.**
- **Operator merges of #1633 (criteria amendment), #1637 (fix), #1617, #1635 (candidate with a hand repair).**
- The host denied `gh pr ready` to the agent. Restarting services under load needed `ARCADIA_READY_DEADLINE=360`, and a failed restart stops all services (known, #1129).

### Acceptance criteria of `first-unattended-run`

| Criterion | Status |
| --- | --- |
| 1. Preview for at least three ready Claude Actions, activation as one card, agents did not activate | Met earlier (2026-10-18); unchanged. |
| 2. Every Action reaches a merged PR with only activation and authority-adjacent merges as operator touches | **Not met.** 3 of 3 merged (#1610, #1617, #1635), but one by RM hand completion, two after RM hand repair, plus Off, STOP, RE-RUN, sign-in, criteria-amendment and fix merges. |
| 3. This document re-derived from the run with verdict and every failure | Met once this PR merges. |

### Failures observed, 2026-10-20

| # | Failure | Fix or tracking |
| --- | --- | --- |
| a | Headless Sessions were told to run validation their permission mode denied, so they self-certified or stalled. | #1619, fixed #1622 |
| b | Headless Sessions could not run the Action's named test (allow-list = Project `validationCommands` only); four Sessions looped `incomplete_resumable`. | #1636, fixed #1637 |
| c | The real validator's 900 s bound refused a slow test file (627 s alone); criteria had to be amended by hand. | #1633 (amended); Issue #1606 (synchronous tick work) is related |
| d | Replay could not reach tick 2 (unsimulated `gh project item-edit`). | #1634 |
| e | False "complete" Asks held launch as `operator_gate_pending`; rejected by hand. | #1640; see Next route |
| f | Hand repair of a candidate breaks canonical-settlement binding; the stale `review_repair_gated` escalation masks the terminal mismatch refusal and the ff-only remedy misleads. | #1632 (open) |
| g | An agent-written candidate regressed a gate (`IS NOT` to `!= null`) with a test that copied the SQL. Caught by the worker's own review; repair gated by design. | #1635 (merged after RM repair) |
| h | Claude usage parser read a 1% window as 100% spent. | #1620 (closed) |
| i | Independent code review counted governed settlement records against a "touches only" criterion. | #1625 (closed) |
| j | Other findings filed the same day: tick starvation (#1606), preservation Seatbelt can read home (#1607), host-fault validation refusal relaunches unbounded (#1613), grant precondition ignores worker source revision (#1614), stray untracked files and self-settled completions bypass checks (#1615), approving a PR code-review item queues an execution that can only fail (#1624), Decision proposals invisible to an offsite operator (#1627), flaky launch-preview CI test (#1628), operator-library hardening (#1638). | open unless noted above |

### Remaining gates to a genuinely unattended run

1. Agents must run their own named tests headlessly. Fixed by #1637; unproven live until a Session uses it.
2. Repair of a gate-listed `src/production` candidate is never unattended by design (Decision 0098). An Action that touches `src/production` can therefore never satisfy criterion 2. The next run needs Actions outside gate-listed paths, or an explicit Decision to change the design (an operator authority decision, not taken here).
3. The validation wall: the completion validator's 900 s bound versus slow test files and synchronous tick work (#1606, #1613). Actions must name focused test files.
4. Stale-escalation masking after any hand repair (#1632), and the hand repair's loss of canonical-settlement binding.
5. False completion Asks holding launch as `operator_gate_pending` (#1640).
6. The live worker's loaded revision against the grant precondition (#1614) and services restart under load.

### Cheapest next route

Do not press again with an Action that touches `src/production`. (1) Merge fixes for #1632, #1613 and #1615 (small, offline-reproducible; replay first per the checklist). (2) Fix the false-completion-Ask hold (#1640) so a rejected or superseded Ask does not hold launch. (3) Pick three Actions that touch only tests, docs or non-gated source with focused named tests under 900 s, run the Process Critic pre-mortem and replay (including a headless-test scenario), then one press. Success is criterion 2 with only activation and authority-adjacent merges. Replay obligation: failures b (headless named test) and e (false completion Ask) were predictable offline and have no hermetic replay scenario yet; #1637 carries its own unit test, but that is not a replay. This obligation stays **deferred** and is not done in this change.

**Verdict: not yet proven unattended.** The second run merged all three Actions, but not unattended, so criterion 2 is not met.

## Historical answer, 2026-10-19 (superseded): not yet. The review-repair loop ran unattended from the rerun verdict onward, but no Action of the first unattended Claude run reached a merged PR unattended

The first multi-Action run under the repeatable grant card `grant-production-unattended-claude-rerun-20261018` (valid to 2026-10-25; live workspace `martianrover`, repository `pmark/arcadia`, provider `claude-code-cli`) ran 2026-10-18/19 and was stopped by the operator. The standalone record is [first-unattended-claude-run-2026-10-19.md](reports/first-unattended-claude-run-2026-10-19.md). Acceptance criterion 2 of `first-unattended-run` is **not met**; the Action stays open.

**What is now proved.** From the rerun verdict onward, a failed independent review drives the whole repair loop without an operator: failed verdict, draft PR plus comment, repair Session launch, settlement, new PR, superseded PR closed, fresh review. Repair Session `session_c2387f0c86504224a4` launched 05:12:52Z, settled head a6e473d8f7c5, opened repair PR #1554, and the worker closed #1545 as superseded.

**What is not proved.** Action 1 merged as #1534 only after the Release Manager merged it and removed a stray Ask. Action 2 merged as #1535 by the operator despite a failed independent review (defect #1536). Action 3 (`implement-docs-reports-first-supervised-claude`, Session `session_9ebf706334ff4b4eb5`) produced #1545 (head 71d40eb99459), which failed independent code review (the report omitted #1512, plus refused not-applicable claims); #1545 was returned to draft by the Arcadia worker; its repair #1554 was gated authority-adjacent and left drafted with Do-not-merge. No Action reached a merged PR unattended, and operator touches exceeded activation plus authority-adjacent merges.

### Failures observed, in order

| # | Failure | Fix or tracking |
| --- | --- | --- |
| a | The repair loop gated #1545 on the stale verdict's refused authority not-applicable claim. `qa code-review` refuses while production is Off and refuses a draft PR, so a rerun ran only after the press; the operator approved marking #1545 ready briefly. | #1552 |
| b | The gated repair row (keyed session plus head, `ON CONFLICT DO NOTHING`) never re-judged on a newer verdict. | #1552 |
| c | A gate ping over 500 characters failed to queue. | #1552 (capped at 500) |
| d | A validated not-applicable claim on Security and authority still gated. | #1552 |
| e | The repair launch was refused "not ready to launch" by the candidate's own pending completion Ask `agentask_f3b1644fe08cf772fe`. | #1553 (includes resume path and exact target match) |
| f | `capacity_refused`: the Claude usage refresh returned 401 on the worker host, leaving the reading 6 hours stale. The operator signed in again. | Issue #1559 |
| g | `session_environment_wall`: the preservation heartbeat was 15s old against a 15s limit under load. | Issue #1558 |
| h | Fresh review of #1554 was needs-follow-up and gated authority-adjacent on patch-check defects: the Mission Log date-rollover bump was refused as non-append (#1555), the controller's retire-completion-draft commit 2bbc69665 was not attested (#1556), and settlement commits were authored under the operator's git identity (#1557). | Issues #1555, #1556, #1557 |
| i | An Action merged despite a failed independent review. | Defect #1536 |

Infrastructure PRs merged during the run: #1539 (production review-repair loop, Release Manager-merged on clean exact-head review and green CI), #1546 (pre-mortem fixes, Release Manager-merged; follow-ups #1549, #1550, #1551), #1552 and #1553 (operator-merged; the classifier blocked an agent commit of #1552, so the operator committed and pushed its gate change by hand). Earlier: #1531, #1533, #1537, #1541, #1543, #1548.

### Operator and Release Manager touches

Operator: START and RE-RUN presses (initial run plus RE-RUNs at epochs 34, 35, 36); STOP presses (before each fix merge and at the end); merges of #1535, #1552, #1553; the hand commit and push of #1552's gate change; approval to mark #1545 ready for a review rerun; Claude re-sign-in on the host; decisions on the gate narrowing and on stopping. Release Manager: merge of #1534 and its stray-Ask cleanup; merges of #1539 and #1546; the review rerun. (The Arcadia worker, not the Release Manager, returned #1545 to draft and drafted #1554.) GitHub shows every merge as `pmark`, so the Release Manager versus operator attribution here is the run record's claim, not something GitHub proves.

### Acceptance criteria of `first-unattended-run`

| Criterion | Status |
| --- | --- |
| 1. Production preview for at least three ready Claude Actions, activation presented as one card, agents did not activate | Met 2026-10-18, as recorded in the earlier sections below. |
| 2. Every Action reaches a merged PR with only activation and authority-adjacent merges as operator touches | **Not met.** One Action needed a Release Manager cleanup, one merged despite a failed review, one is unmerged; touches included STOP, RE-RUN, re-sign-in and a hand commit. |
| 3. This document re-derived from the run with verdict and every failure | Met once this PR merges, with the replay-scenario obligation deferred (see below). |

### Gates, critical path, live state and Plan scoreboard, 2026-10-19

**Gates.** The capacity gate stays on. No merge happens without exact-head independent review and green checks. Authority-adjacent PRs (including every repair PR the gate classifies so, such as #1554) wait for the operator. Production is Off after the operator's STOP, and the 2026-10-25 grant card remains the only activation path.

**Critical path.** (1) Land the live-state replay (separate session in progress): copy the live database and candidate refs into a throwaway workspace and run the worker tick offline to the launch or the stop. (2) Fix #1555 to #1559, whose live effects stopped this run. (3) Only then another press. (4) The run must reach merged PRs for all Actions with only activation and authority-adjacent merges as operator touches.

| Item | State at this derivation |
| --- | --- |
| Production | Off after the operator's STOP. Grant card `grant-production-unattended-claude-rerun-20261018`, valid to 2026-10-25. |
| Review-repair loop | Proven unattended from the rerun verdict onward once; the review rerun itself needed the operator's approval to mark #1545 ready, outside the loop (Session `session_c2387f0c86504224a4`, repair PR #1554, #1545 closed as superseded). |
| Open candidates | #1554 drafted with Do-not-merge; #1545 closed as superseded. |
| Open follow-ups | #1536, #1549, #1550, #1551, #1555 to #1559; replay proposal `agentask_f72f7a21bc28706079`. |
| Live state not re-read | Policy revision, epoch and red alerts were not re-read for this derivation; treat the 2026-10-18 table figures as stale. |

| Plan Action | Status |
| --- | --- |
| Seven Actions done as of 2026-10-18 (`launch-failure-keeps-cause`, `claude-worker-launch-replay`, `claude-capacity-evidence`, `credential-preflight`, `production-spend-budget`, `implement-a-hermetic-test-that-an`, `first-supervised-claude-run`) | Done; not re-verified here. |
| `worker-review-and-merge` | Source merged in #1496; settlement state not re-read here. |
| Run Actions 1 and 2 | Merged as #1534 and #1535 (see attribution caveats above). |
| `implement-docs-reports-first-supervised-claude` | Open; repair #1554 drafted. |
| `first-unattended-run` | **Open.** Criterion 1 met, criterion 2 not met, criterion 3 met once this PR merges. |

### Lesson and next step

Some defects were visible in live database rows before the presses: the stale gated repair row and the not-applicable authority gate (a, b, d) and the candidate's own pending completion Ask (e). Others appeared only at run time (ping length c, capacity 401 f, heartbeat g) or only after the repair Session ran (patch-check defects #1555 and #1556, identity #1557). Before any further press, replay live state offline: copy the live database and candidate refs into a throwaway workspace and run the worker tick to the launch or to the stop. The refresh contract's obligation to add a hermetic replay scenario for each predictable live failure is **deferred** to the live-state replay work (Agent Ask proposal `agentask_f72f7a21bc28706079`) and Issues #1555 to #1559. It is not done in this change. That replay is now in progress in a separate session.

Pre-press checklist: [process-critic-brief.md](agent-guidance/process-critic-brief.md) (run it before any press or merge batch once judgement, settlement, patch-check or tick code changed since the last green replay).

**Verdict: not yet.**

## Historical answer, 2026-10-18: the first supervised Claude run reached a reviewed, merged PR; unattended production remains unproved

With this refresh the production Plan has **seven done** Actions (`launch-failure-keeps-cause`, `claude-worker-launch-replay`, `claude-capacity-evidence`, `credential-preflight`, `production-spend-budget`, the supervised-run target `implement-a-hermetic-test-that-an`, and `first-supervised-claude-run`, settled alongside this refresh). Two remain: `worker-review-and-merge` (source merged in #1496; settlement pending) and `first-unattended-run`. Production is **Inactive**. The capacity gate is **on**: the operator ran the `enable-capacity-gate-20261017` card. Services and the go-broker run main 4777543a7.

### Run record: first supervised Claude run on Arcadia's own repository (2026-10-17/18)

| Stage | Observed |
| --- | --- |
| Activation | `grant-production-first-supervised-claude-run-20261017` was refused at preconditions because go-broker `managedSkill` was stale after merges. Fixed by build + `go-broker ensure` with production Off. The re-press activated scope: 1 Action, `claude-code-cli`, concurrency 1, remote preservation, 24h packet-approval delegation, no integration grant. |
| Capacity | The worker's read-only pre-admission refresh (#1492) turned a 220-hour-old Claude reading fresh (5h 0%, 7d 11%) without a refresh-token exchange. The 80% cap (#1495) admitted. |
| Selection | The tick tried the out-of-scope pointer Action `first-supervised-claude-run` for about 40 minutes, auto-preparing a packet for it and escalating it (#1512). A governed `make-next` was reverted by the scheduler. A whole-queue `arrange` needed an explicit operator freeze-window override. Fixed in #1514, merged and live. |
| Launch | Two attempts failed with `tmux new-session failed (1). Cause: command too long` (the full brief went through tmux argv), exhausting the repair budget. This is very likely the cause of the 2026-10-11 Codex red alert `ra-2bcf88b68759`. Fixed in #1513 (0600 self-deleting launcher file; 64 KiB replay). The fix needed STOP, a services restart, a repair-budget reset and a one-shot re-run card (#1515). |
| Session | `session_1e0a375c65854c1daf` launched 00:28Z, completed 00:42Z, session probe passed, candidate preserved to draft PR #1517 (22-line test). |
| Completion | The worker logged `accepted_completion` but the candidate carried no settlement: its Ask named the base as `candidate_revision` (#1518). The Release Manager settled a re-drafted completion inside the candidate. |
| Review & merge | An independent review of the exact head and a delta review of the settlement were clean. CI went red on every PR when Decision 0128's real Scout expiry passed (test date rot, fixed by test-only #1520). The operator merged #1517. |

**Operator touches:** enable gate, START (refused), START (re-run), freeze-window override for the queue arrange, STOP twice, merges of authority-adjacent PRs (#1479, #1480/#1491, #1496, #1497, #1501, #1514, #1515, #1517), and the Decision 0130 answer.

**Still blocking unattended production:** #1518 (the worker must settle completion in the candidate). The `worker-review-and-merge` opt-in is untested live, and its allowlist admits only tests and docs. Follow-ups: #1516, #1519. A multi-Action unattended run (`first-unattended-run`) has not been attempted.

## Historical answer, 2026-10-17: Claude worker replay is proven in a PR; reactivation and the Claude usage Decision await the operator; unattended production remains unproved

Claude is the only provider (Codex has no tokens). The production Plan `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider` has **one done and seven open** Actions. On main the native Release Manager coordination Plan is still active and the production Plan is a draft. The production Plan's reactivation at `claude-worker-launch-replay` was settled on the host (receipt `asksettle_2e04bdf9225e466ebd`) and waits for the operator to merge [PR #1479](https://github.com/pmark/arcadia/pull/1479). Until it merges and `arcadia docs sync --project arcadia --apply` runs, `advance queue` reports `orderValid: false` with 5 unpositioned Arcadia Actions, because the checked-in documents on main still name the old Plan. `native-rm-checkpoint-roundtrip` is parked with its state preserved. It resumes when `first-unattended-run` is done or the coordination gap blocks a production run.

| Stage | Evidence at this derivation |
| --- | --- |
| Launch diagnostics (`launch-failure-keeps-cause`) | Done and merged (#1416). |
| Claude worker launch replay | Proven in source in [PR #1481](https://github.com/pmark/arcadia/pull/1481) at head `43af0fc0d`. Independent review found no blocking findings ([review record](https://github.com/pmark/arcadia/pull/1481#issuecomment-6236945725)). The real worker tick drives the production tmux adapter on `claude-code-cli`. The Session reaches `running`, a draft PR is preserved, and the replay found no defect. The 2026-10-11 tmux failure was not reproduced on claude-code. A host check on 2026-10-17 found that under the live worker's launchd PATH (`com.arcadia.local.742852621.worker`), `tmux` resolves to `/opt/homebrew/bin/tmux` 3.7c and `claude` to `/opt/homebrew/bin/claude` 2.1.267. The Action is not yet settled; that waits for the reactivation and #1481 merges. |
| Claude usage credential and window cap | [Decision 0130](https://github.com/pmark/arcadia/pull/1480) is approved. The recommended option is read-only usage checks with no OAuth refresh-token exchange and an 80% cap per Claude window, which keeps Decision 0111's 20% reserve. As verified on main, the worker never refreshes Claude usage before admission: `refreshProviderCapacity` is called only by the manual capacity command. The refresher used to exchange the refresh token on a 401 without storing the result, which spent the single-use token and signed the host out (#1559); every caller is now read-only, and the first turn to `unauthorized` queues one attention ping with the sign-in remedy. |
| Credential preflight (#1155) | Implementation in progress by a Release Manager helper (no PR yet). It is read-only toward credentials and fails closed on unknown. |
| Installed adoption and live Claude run | Unproved. No activation and no real Claude production run has occurred. |
| Last live observation | `production status` at 2026-10-17T16:44:52Z read Inactive · Idle, policy revision 47 / epoch 28, and saved configuration revision 9 (Codex-only overlap scope from 2026-10-11, not current). Red alert `ra-2bcf88b68759` is still open from the 2026-10-11 Codex run, and its cause was discarded before #1416. The worker recorded a transient base advance and rewind of local main (`9062495af` ↔ `d0210d7f4`) at 16:38 UTC. That was the activation settlement being moved to its PR branch, and it left no other change. |

| Active Plan Action | Status / dependency | Remaining criterion |
| --- | --- | --- |
| launch-failure-keeps-cause | **Done** | None. |
| claude-worker-launch-replay | **Open, selected once #1479 merges**. Evidence is in #1481. | Merge #1481 and settle the completion Ask from its evidence. |
| claude-capacity-evidence | Open; after the replay | Needs the Decision 0130 answer. Then refresh Claude usage before admission, read-only and fail-closed, with a test that a stale snapshot is refreshed. The spend-bound card is criterion 2, met by Decision 0130 once it is answered. |
| credential-preflight | Open; after the replay | In progress (helper). |
| production-spend-budget | Open; after capacity | Permitted cut: a minimal admission check enforcing the 0130 cap, failing closed on unknown usage. Reserve release and burn rate are deferred. |
| first-supervised-claude-run | Open; after capacity | Permitted cut: the overlap-retirement criterion. Publish a one-Action claude-code preview and present its activation card. |
| worker-review-and-merge | Open; after the supervised run | Decision 0097 merge through the PR after exact-head review and green checks. |
| first-unattended-run | Open; after merge, spend budget and preflight | At least three Actions merged, with only activation and authority-adjacent merges as operator touches. |

**Operator touches now on the critical path:** merge #1479 (reactivation), merge #1480 and answer Decision 0130. The capacity gate stays on. No unattended run happens with the gate off, and no merge happens without exact-head independent review and green checks.

## Historical answer, 2026-10-15 (superseded): launch diagnostics are complete in the candidate; Claude worker replay is selected; unattended production remains unproved

The active Plan is `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider`. Its eight Actions contain **one done and seven open**. Both the Plan and `PROJECT.md` select **`claude-worker-launch-replay`**. `launch-failure-keeps-cause` is done through canonical completion commit [`5ece238d`](https://github.com/pmark/arcadia/commit/5ece238decf7851c3eca632b1ab4a7b67377fb4c), preserved in merge head `b5a27da3e4d7b5d45785b10610dc8e40a2b628f8`. Activation PR #1406 and this source completion establish neither installed adoption nor a live production result.

The real tmux adapter/worker-tick regression proves that bounded underlying launch errors reach red-alert evidence and `production status --json`, with credential redaction before the 2,048-character clip. The failing-first credential-boundary correction and preservation-input recovery retain their earlier failed receipts. The corrected suites passed 84 core tests, 42 scoped Session tests, 78 preservation tests and 14 manager replay cases, with lint, TypeScript, build and the 13-tick rehearsal. Independent round 4 and all seven required CI jobs passed on [PR #1416](https://github.com/pmark/arcadia/pull/1416) head `b5a27da3` ([review and CI summary](https://github.com/pmark/arcadia/pull/1416#issuecomment-6194077190), [CI run 38746922956](https://github.com/pmark/arcadia/actions/runs/38746922956)); these are source/PR proofs. This documentation push needs its own delta review and fresh CI before merge. See [diagnostic evidence](reports/launch-failure-keeps-cause-2026-10-14.md) and [preservation recovery evidence](reports/preservation-input-repair-2026-10-14.md).

Canonical completion documents committed successfully, then the command failed while removing its temporary publication directory. Trailer `asksettle_29fbccd3b7974288b0` identifies that canonical commit; a stored settlement receipt was not returned. Requery refused “Action is already done”; no completion was reapplied. The operational receipt/projection gap remains disclosed, with reconciliation after integration still pending. It does not undo the candidate's checked-in completion or prove the primary checkout's projection has advanced. Earlier local full-file Go-parity sandbox refusals remain historical failed evidence; the later CI result is separate proof, not a rewrite of those receipts.

| Stage | Evidence at this derivation |
| --- | --- |
| Diagnostic source, canonical completion and PR verification | Proven in the candidate; PR remains open. |
| Installed adoption of this candidate and preservation-input repair | Unproved; source, host-exception commit and CI are not installation receipts. |
| Production activation and live Claude run | Unproved by this work; no activation or real Claude production run was performed here. |
| Last retained live observation | Inactive · Idle, policy 47 / epoch 28, zero live admissions at 2026-10-15 00:56:14 UTC in the retained manager status receipt; this doc correction did not refresh that live reading. Historical alert `ra-2bcf88b68759` retains its discarded generic cause. |

| Active Plan Action | Governed status / dependency | Current evidence / remaining criterion |
| --- | --- | --- |
| launch-failure-keeps-cause | **Done**; no dependency | Canonical `5ece238d` completion, source proof and PR review/CI passed; PR integration and installed adoption remain separate. |
| claude-worker-launch-replay | **Open — selected**; after `launch-failure-keeps-cause` | Real worker-tick replay on `claude-code` must evidence a running Session and recorded draft PR with only external services faked; retain failing-first fixes and state whether the original tmux failure reproduces. |
| claude-capacity-evidence | Open; after `claude-worker-launch-replay` | Evidence unattended Claude usage refresh or an explicit status-visible gate-off path and consequence; raise the supervised Claude spend-bound Decision card. |
| first-supervised-claude-run | Open; after `claude-capacity-evidence` | Propose retirement or Claude rescope of the earlier overlap Action; publish a one-Action, concurrency-1, remote-preservation preview and activation card. Only after operator activation, evidence a real Session, reviewed draft PR and merge, then refresh this report. |
| worker-review-and-merge | Open; after `first-supervised-claude-run` | Evidence GitHub-only merge after independent exact-head review and green required checks; authority-adjacent PRs must wait on the batch-merge card, with moved-head/check/review refusals tested. |
| production-spend-budget | Open; after `claude-capacity-evidence` | Evidence enforcement of the approved percent-of-window budget and reserve (Decisions 0103/0111), same-tick refusal visibility and unknown usage failing closed. |
| credential-preflight | Open; after `claude-worker-launch-replay` | Evidence valid/expired/unreadable credential handling before launch, a named remedy card and one operator ping, without modifying host credentials. |
| first-unattended-run | Open; after `worker-review-and-merge`, `production-spend-budget` and `credential-preflight` | Publish a preview for at least three ready Claude Actions and an activation card; after operator activation, evidence every Action reaching a merged PR with only activation and authority-adjacent merge touches, then re-derive this report. |

The dependency frontier is now **Claude worker replay**. Its capacity branch runs `claude-capacity-evidence` → `first-supervised-claude-run` → `worker-review-and-merge`; `production-spend-budget` also follows capacity evidence. `credential-preflight` follows worker replay independently of that branch. The final unattended proof joins automated review/merge, spend-budget and credential-preflight evidence. Installation/adoption and the Plan's operator activation gates must be proven before a live attempt; this report grants neither. Decisions 0060/0080 still govern qualified merges, and important Decisions and authority changes remain operator-owned.

The dated derivations and run records below are **historical**. Their old Plan names, Action counts, gates, runtime states and operational advice describe their stated observation dates; they are not the current Plan's gate checklist. Only supported current Plan criteria and evidence are carried into the scoreboard above. The Refresh contract at the end remains applicable.

## Historical answer, 2026-10-10 (superseded): not yet; a supervised first run on Arcadia's own repository becomes possible once gates 1 to 6 below are cleared, and unattended production does not

**Proven.** One Action runs from a confirmed Launch to a draft PR in about 80 seconds (Claude Haiku and Codex, Decision 0096). Under Decisions 0097 (merge-then-next), 0100 and 0119 the disposable fixture ran all nine of its Actions to merged PRs (fixture PRs #11 to #19), with no operator step for the last five. Settlement now leaves a completed Action unambiguous (#1212), the deterministic review gate accepts that exact shape, and the reviewer pre-flight smoke is a maintained script with a spend guard (#1226). Nothing in this list has run on Arcadia's own repository.

**Not proven, and not built.** No production run has ever completed an Action on a non-disposable repository. The worker never merges a pull request: an operator-launched candidate stops at a draft PR (`src/production/tick.ts`, `sessionHandoff.ts`: "merge it through its pull request"), and the automated review-and-merge capability Decision 0097 names is not built. A first run therefore needs a supervising agent or the operator to review and merge each PR under Decisions 0060/0080 before the next launches. Expect those PRs to stop for the operator rather than merge on green: the Plan's Actions touch `src/ask`, `src/dispatch` and `src/sessions`, which the blast-radius assessment (`arcadia pr assess-blast-radius`) treats as authority-adjacent.

**Gates before the first run on Arcadia's own repository** (each is evidence-checked; the operator owns the ones marked *operator*):
1. *Operator.* Authority for this repository. Decisions 0100 and 0119 name the disposable fixture only, so each of the seven Actions needs its build packet approved by the operator, or a `packet_approval` delegation (Decision 0072; it expires, which ties to gate 5). A fresh `arcadia production preview --project arcadia --plan <the bug Plan> --concurrency 1 --remote-preservation` (add `--transitions validation,acceptance,pointer,packet_approval --packet-approval-expires-at <iso>` only if delegating) and the operator's own activation are required. **Do not add an integration grant for this repository**: the worker's integration path (`sessionHandoff.ts`) does a local `git merge --ff-only` into the base branch directly rather than through a pull request, so a grant would bypass the PR and its seven required CI jobs (and `main` keeps admin bypass on for governed settlement pushes). Use remote preservation (draft PR only) and merge through PRs.
2. *Operator.* A spend bound; see Decision 0123 for the options. Observed 2026-10-11: `capacityGateEnabled` is `false` in the workspace config, so every provider reads "unmetered by config". Enabling it today is not a bound for every provider: Codex is admitted from a live app-server read (7d window 4% used), Claude Code is refused `capacity_stale` (its usage snapshot is 71 hours old and nothing unattended refreshes it) and OpenCode is refused `manual_receipt_expired` (no probe), with no capacity-gate substitution once a launch is bound (the launch preview may select and record an alternate provider before a packet exists when hard provider evidence, such as a provider at 100 percent or a launch-precluding adapter gap, requires it, Decision 0063, but it never changes a bound provider) and a refusal that reaches `production status` only as a red alert after 5 consecutive ticks (10 minutes; a shorter wait is only in the worker log and the timeline). Decisions 0103 and 0111 (percent-of-window budget, 20% reserve) are approved but unbuilt: their Actions are all open in a draft Plan, so the only protection for your own interactive allowance on the shared accounts is the fixed 20% operator reserve (an 80% unattended ceiling per window) when the gate is on, and nothing when it is off. The bounds that really exist today are the provider and Project/Plan/Action allowlists, concurrency 1, a 120-minute Session limit (not settable on tick launches: the policy field exists but `production preview` has no flag for it), three development attempts per Action, the failed-Run budget (8 per Milestone), light-tier session start, and merge-by-supervisor pacing. A short Grant expiry does not bound spend: it stops only new packet approvals and delegated integration or review, and an already-approved Action is still admitted after it (#1012).
3. *Operator.* Answer Decisions 0116 (what runs when a Plan waits on the operator) and 0117 (how many unmerged PRs per repository). 0117's recorded recommendation is two unmerged candidates; a serial merge-then-next run (Decision 0097) needs only one. 0115 (Project share splitting) can wait because one Project is in scope, and 0118 (OpenCode daily cap) can wait if OpenCode stays out of the provider list.
4. Fixed, pending your merge or merged 2026-10-11: #1177 (a non-canonical hand-written Ask is committed and published by the host; PR #1245 makes preservation refuse it and name the file) and the small half of #1155 (a provider sign-in failure no longer spends the failed-Run budget or pauses the Project; PR #1244, merged, holds that Project's launches for 15 minutes instead). A sign-in failure also no longer consumes a development attempt (#1243): the exit did no work, so the live attempt stays live and the next launch resumes it, and a login that stays dead for any length of time holds one cheap relaunch per 15 minutes instead of stranding the Action. Still open before an unattended overnight run: the preflight cannot see an unrefreshable credential (#1155's large half).
5. Avoid, by Grant sizing: #1012 (an Action is admitted after the Grant's delegations have expired). Keep OpenCode out (#1165, Decision 0118 open).
6. Make the settlement fix live. Observed 2026-10-10 after #1212 and #1226 merged: the primary checkout was not fast-forwarded and services were not restarted. Restart once, outside any run, and avoid merging during a run (#1129: a restart under load can stop every service).

Optional, and not a prediction for this repository: `scripts/rehearsal-reviewer-smoke.ts --spend-approved` (three QA and three code-review calls, the operator's own yes) is pipeline sanity on the fixture's Action shape after #1212. A `--dry` run was green on 2026-10-10 (reported in #1226); it does not exercise this repository's review of the bug Plan's PRs.

**The Plan.** The seven-Action draft Plan `seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and` holds valid, small bugs on the unattended settlement path, ordered so each lands before the next touches the same files. The Plan itself was made active on 2026-10-11 (#1266); production stays Off, and pressing production activation is the operator's call. Excluded bugs and why are in its source Ask.

## Run record: first supervised run on Arcadia's own repository (2026-10-11)

Conditions recorded after the Plan was made active (#1266) and before production activation is pressed, so the data is read in context. Sources: the live preview and capacity read of 2026-10-11 and the operator's instruction as relayed by the release-manager session.

- **Scope.** Plan `seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and`, 7 Actions in dependency order, Action 1 `keep-claim-when-passed-attempt-receipt-is-unparseable` ready (pinned `gpt-5.6-terra` / medium); concurrency 1 (the concurrency gate holds it there, independent of the capacity gate); preview scope fingerprint `e34530b41eb2a96836de67c00b55d47c`, expected revision 43.
- **Provider policy.** `codex-cli` only. Remote preservation on (draft pull requests only); no integration grant, so the worker never merges and each PR is reviewed and merged by a supervisor before the next Action launches (Decision 0097).
- **The capacity gate is OFF for this run.** Decision 0123 was answered "Codex only, gate on, attended first run" (2026-10-11). The operator then chose to leave the workspace config alone, `codingAgent.capacityGateEnabled: false`, because running without it still collects valuable data (relayed 2026-10-11). So this run has no provider-window awareness: Codex reads "admitted (unmetered by config)", nothing refuses at 95%, and the only protection for the operator's own Codex allowance is the policy's provider list, concurrency 1, the 120-minute Session limit and the attempt and failed-Run budgets. Treat any usage-window observation from this run as data about an ungated run, not as evidence the gate works.
- **Known open gaps during the run.** A login that stays expired is retried every 15 minutes with no operator alert (#1249); per-Session token accounting is not built (the research closed in #1232), so cost per Action is unmeasured; the Session time limit is not settable on tick launches; capacity refusals (not applicable while the gate is off) would reach `production status` only after 10 minutes.
- **Authority.** The activation press, any packet approvals and merging each PR are the operator's; this record changes none of them.

## Earlier answer, 2026-10-02

The renewed bounded v6 trial completed both candidate Actions. Canonical Session exit receipts record accepted completion for the resumed split Action and its dependent Off/restart Action. The candidate Plan records both done. The first Action integrated before the dependent Session launched automatically. During that dependent Session, the host action turned production Off and restarted services; the admitted Session finished afterward.

Production is **Inactive at revision 29, with zero live admissions**. The operator pressed the fresh exact `/runs` Grant for the retained B candidate. Host validation passed, preservation receipt `presv_af1defad33604b5893` binds terminal Session `session_b82d2b412265419482` to the unchanged candidate, and the fixture base advanced exactly once from `a6b539d` to settlement commit `c6b4c4e`. The eight-Session set remained unchanged; no replacement coding Session launched. Off was restored at revision 29. The preservation receipt is `LOCAL ONLY`, so this fixture commit is recoverable on this host but not claimed as remotely published. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) and retained `/runs` receipt separate this live result from the original seven-Session A sequence.

## Issue #878 manual-preservation repair — candidate versus installed state

Candidate commit `d45b2fb922438d3cca3bc00f7b305a05838ee037` was protected as
manual-local-only receipt `presv_a47d71b5cf6740669c`; its host validation ran
`node scripts/preservation-self-check.mjs`. The host then settled the repair's
six criterion-exact completion Ask in this candidate at `1db14018c` (receipt
`asksettle_5cd514e1fee94d4097`), selecting
`persist-inactive-production-configuration` as the next governed Action.

Host validation separately passed the repair's full test set (50 passed, 2
skipped), lint, TypeScript, and the retained hermetic replay at
`/tmp/878-fixed-launcher-replay-result.json`. That replay invoked the literal
installed no-argument preservation launcher against a disposable manual
reservation, captured an initial snapshot and retry, made a canonical Log
settlement plus candidate documentation revision, then captured the revised
snapshot and retry. It retained distinct snapshot request/receipt identities,
unchanged original receipt bytes, `LOCAL ONLY` outcomes, and zero managed
Sessions.

This is evidence for the **candidate** repair and its installed-launcher
interface, not evidence that the reviewed repair is installed in the live
worker. It does not authorize installation, a service restart, production,
PPN execution, or publication. The operator explicitly authorized bounded host recovery after protected
preservation refused an incompatible main advance and fixed Go refused a
second dirty manual candidate. Exact pending narrative bytes were preserved
at `86853e2e5`; canonical Log `log-pr888-bounded-host-recovery-authority-2026-10-02`
records that direct instruction. Merge `26fa3c333` retains both original
histories and both canonical Mission Log append sets. PR #888 still requires
review and exact-head checks before the separate reviewed-installation gate.
The reconciled candidate passed 53 tests (two existing skips), lint, TypeScript
and the core build. Restricted validation captured tree `ac159db5e706169d6fa3d821fb69b01ae508c9b0`,
but the older installed runtime refused its reservation-only request ID at
`preserve.replay`. The original protected receipt remains intact; subsequent
document preservation and reconciliation used the explicit host exception.
No new protected receipt or live installation is claimed.

The scope repair (#855) and continuation/retry repair (#857) were merged and installed before the renewed trial. The original six incomplete split Sessions preceded a seventh that completed in the same candidate; this proves eventual continuation but not the fixture's literal second-Session completion. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) identifies the supported and missing parent-proof stages.

PR #860 merged at `953e41590b33f3437acf57a80168e9a5f8dcbdda` and is present in checkout HEAD `1f7d4a6a57111844e9a8173235142fd95d0e6970`. The supported service restart completed at 13:16 PDT; the new worker PID 44138 started from that checkout at 13:16:58 PDT and its status resolved `martianrover`. #860 is therefore installed in the running worker. `arcadia go-broker ensure` subsequently passed from the clean main checkout, including its host probe, candidate build, dashboard build and Vitest checks. No new Grant is claimed here.

PR #865 merged at `650fc23e339fdf541090f5dd58788b52ee09a824`. The supported restart completed after that merge; worker PID 56539 ran the merged checkout's `src/cli.ts`, and intelligence, dashboard and Discord services passed readiness. Policy read after that restart showed Inactive revision 27, epoch 18. The later exact B recovery exercised this installed integration path.

PR #866 merged at `eb959d54d66063580f402aded406225f61d888e0`. CodeRabbit approved head `185f54aa0`; all required lint, dashboard, four unit shards and e2e checks passed. Focused terminal recovery/refusal tests passed 25/25 and the core build passed. The supported restart installed #866 in worker PID 67663; all four services passed readiness. At that point policy remained Inactive revision 27, epoch 18 with zero live admissions. The repair Action's three criteria were settled through Agent Ask `complete-off-terminal-preservation-recovery-2026-10-01`; the later exact B recovery exercised the installed repair.

Rehearsal procedure, standard and failure catalog (runs 1 to 5, 2026-10-06):
[autonomous-production-rehearsal-runbook.md](autonomous-production-rehearsal-runbook.md).

## Vital few next steps

*Historical, from the 2026-10-02 derivation; superseded by the 2026-10-15 current answer above.*

1. Keep B's completed recovery closed: the exact Grant was consumed, the candidate integrated once, and production is Off. Reassess the remaining parent criteria without repeating B or reusing the succeeded button. The literal two-Session A completion remains unproven; browser closure and a complete operator-intervention ledger are also not established by current receipts.
2. Preserve the completed terminal repair and live evidence separately. #866 bound the accepted exit and exact settlement, validated the unchanged candidate, and created the canonical preservation receipt without reviving a Session; #865's pinned path integrated it. The recorded validation command exited 0, fixture main and candidate both resolve to `c6b4c4e`, and the one base-advance receipt records the transition.
3. Keep the present single-Project scope. The concrete restriction in `tests/production-tick.test.ts` passed in the full suite: a Project removed from the active policy receives no scheduling, pointer commit or new launch, even while its prior terminal Session is reconciled. This is fixture proof of that restriction, not authority or evidence to widen the live Grant to multiple Projects. Address any qualified-target gate inconsistency only if full-dispatch impact reproduces.
4. The governed `split-v6-b-recovery-evidenced-slice-2026-10-01` settlement marked only the integration-evidence criterion done and selected `prove-literal-split-browser-and-ledger` for the other three. A fresh live trial is warranted only for an exact still-missing criterion, with its own hermetic replay and exact Grant. Do not ask the operator to relay a receipt or inspect a database.

## What the evidence proves

| Stage | Renewed live result |
| --- | --- |
| Host replay before Grant | Passed: 17 hermetic tests. |
| Exact resumed candidate and branch | Reused the prior split candidate. |
| Resumed Action completion | Canonical accepted completion observed. |
| Concurrent candidate protection | Canonical competing preparation actually refused while the Session lease was live. |
| Dependent Action | Admitted automatically after first candidate integration, with a fresh candidate. |
| Off and supported worker restart during dependent work | Performed by the bounded host action; no duplicate or reactivation in its recorded observation window. |
| Dependent candidate completion after Off | Canonical accepted completion observed. |
| Dependent candidate preservation and final integration | Passed under the fresh one-shot Grant: host validation exited 0; `presv_af1defad33604b5893` pins the terminal candidate; fixture base advanced `a6b539d` → `c6b4c4e` once; no new Session; Off revision 29, zero live admissions. |
| Original parent proof split | The first split settled three criteria. The second settled only live integration evidence after PR #870; the literal split, browser/Off proof and exhaustive ledger remain open under `prove-literal-split-browser-and-ledger`. |

Exact identities, revisions, host/provider, receipts and refusal evidence remain in the local generated-script run evidence. A complete ledger of every earlier operator intervention has not been verified. Tests and source analysis are separate from live proof. Neither process exit nor a passing generic check proves arbitrary acceptance criteria.

## Governed state and deferrals

The active Plan remains `bootstrap-managed-production-to-build-flight-deck`. The first repair's canonical completion settlement marked `recover-terminal-integration-after-reconcile` done. After #865 merged, queue reorder revision 176 and pointer commit `f28fb2868` selected `finish-two-action-unattended-production-proof`. Discovery of B's missing preservation receipt led to accepted Agent Ask `recover-completed-candidate-unpreserved-after-off-2026-10-01`; queue revision 177 placed its Action first and pointer commit `eec7cf657` selected it. After #866 was installed, completion settlement commit `33c4dfb8e` marked that repair done and returned the pointer to `finish-two-action-unattended-production-proof`. After PR #870 merged, settlement commit `532691fb8` narrowed that Action to the proven integration-evidence criterion, marked it done, created `prove-literal-split-browser-and-ledger`, rewired 19 dependents and moved the pointer there. Provider concurrency remains deferred; no Plan was activated by inference.

The active Plan contains **154 Actions: 121 done and 33 open**, with zero Actions in other statuses at this derivation. This scoreboard counts each top-level `- id:` entry paired with its following `status:`. The original proof Action names its three proven criteria; its first remainder names the proven integration-evidence criterion; the new open remainder retains the other three and 19 dependents now wait for it.

The five historical proposals were rejected through the existing host approval surface. The retained Flight Deck proposal waits for later review after the narrow production proof succeeds. Retention grants neither acceptance nor activation. [Issue #852](https://github.com/pmark/arcadia/issues/852) records the operator UX improvement.

The original, renewed, and exact B-recovery one-shot Grants are consumed/revoked. A future live trial requires a fresh exact request and current revision preview under the existing authority contract; never reset an old succeeded button or treat its receipt as a new activation. The B-recovery operator action itself returned its own Grant to Off, as its reviewed descriptor specified; the Grant did not start a Session, restart a worker, merge, deploy, change credentials, or widen its scope.

The [hardening proposal](reviews/2026-10-01-production-hardening.md) and paired Agent Ask are a draft, not activated work or widened authority. Provider concurrency, independent approvers and Flight Deck expansion remain deferred under their recorded triggers.

## Literal-split receipt audit — 2026-10-02

The retained v6 B recovery is closed and was not replayed. A direct receipt
audit leaves all three criteria of `prove-literal-split-browser-and-ledger`
open: the split history contains seven A Sessions rather than a literal A1/A2
continuation; the retained Off/restart observation has no actual browser-close
event; and the receipt set identifies known interventions without proving an
exhaustive chronological operator ledger. Production remains **Inactive at
revision 29 with zero live admissions**.

Any new proof must use a fresh disposable single-Project fixture and a fresh
one-shot Grant. The Grant has to run its hermetic replay first and preview the
new fixture's exact candidate against the current inactive policy revision;
the succeeded v6 buttons and B candidate are consumed evidence, not reusable
authority. The present CLI-only production control does not emit a browser
close event, so a literal browser-close proof requires a supported reviewed
observation route before the conjunctive Off/browser criterion can close.

## Preservation and browser-audit gates

Merged PR #858 extends the #856 host preservation transport with stage and native-process limits, retained journals and partial validation receipts. Its real named-profile fixtures passed for manual and managed preservation, including a post-validation capture stall that retained passing Seatbelt evidence. This is candidate evidence: the repair has not been installed, and the cause of PPN's original stall remains unestablished. Merged PR #863 carries a follow-up 22-minute total bound to fit ten declared two-minute checks and preservation. The proof and limits are recorded in [the preservation and browser-audit report](reports/bounded-preservation-and-browser-audit-2026-10-01.md).

The installed `arcadia-unattended` profile still denies loopback HTTP and aborts headless Chrome; synthetic credential reads and external sockets are also denied. The merged repair retains a pre-dispatch capability refusal. No fresh PPN capture or comparable mobile/desktop Lighthouse matrix is claimed, and its verification Action remains open.

Merged PR #863 prepared an inactive host-owned alternative. Its fixed synthetic fixture rendered mobile and desktop HTTP pages while denying external, private and other-loopback TCP, unrelated Unix sockets, synthetic credential-file reads and external browser navigation. A deliberate post-launch stall stopped the supervised browser group without changing the fixture source. A separate probe found that native detached children can escape that group; the fixture's `ready` result does not establish containment for a live route. The operator selected Decision 0078's inactive preparation option; its canonical answer is committed on the new Issue #847 candidate branch, not yet integrated. Follow-up host experiments found that denying process creation also prevents Chrome launch, enabling Chrome's own sandbox fails during setup, and a temporary exact-loopback Codex profile override still aborts Chrome. The installed profile and production dispatch remain unchanged. [The host-browser report](reports/restricted-host-browser-audit-2026-10-01.md) retains the proof and limits, including platform-service review, broker integration, exact source/revision/expiry authority and native-descendant containment. Live activation and PPN Lighthouse measurement remain separate gates.

## Three-Action rehearsal preparation — 2026-10-02

The prerequisite settlement `asksettle_92f59561766c40079e` confirms
`applied:true` and commit `a5a6844e751a6441576871b8b20ae8ccf2ab9d6e`.
Run `20261002T164449Z-98726/publication.json` now proves publication of that
settlement and `ec53674aaaad0148e3ed7e6f3da3a9bb75ab3d64`, with
`settlementReapplied:false`. Remote main independently matched the settlement
commit. The live one-shot button is succeeded and must not be offered again.
Both accepted prerequisite Actions remain unproved; the canonical pointer is
still `prove-literal-split-browser-and-ledger`. The retained run's
`production-before.json` observes Inactive revision 29, epoch 19, zero live
admissions. Publication grants no production or pointer authority.

The original publication refusal compared an untracked source Ask's canonical
before-image with a parent Git blob that did not exist. Plan before/after bytes
matched, and the tracked archive preserved the source Ask's exact SHA-256.
The reviewed publication-only retry passed twelve original and seven additional
narrative-custody/refusal cases, retained every failed run, and published only
the original two commits. It left the revised pair, Notes, derived readiness
and other preparation unpublished.

Read-only planning and adversarial helpers identified the smallest honest
three-record scope: keep saved configuration unchanged, append durable serial
execution to the existing enrollment identity while preserving its six criteria,
and add one installed-host rehearsal Action. The finite revised design uses an
actual disposable GitHub repository, CodeRabbit's actor/reviewed head and existing
independent PR QA rather than a new local reviewer supervisor. As of Decision 0080,
the independent review gate (`docs/agent-guidance/pull-requests.md`) replaces that
reviewer actor and CodeRabbit is advisory. With that route,
the adversary judges the combined enrollment/durability slice plausibly one
heavy/high session; this is an estimate, not completion evidence. Draft-to-ready
PR waiting, five fixed-role attempt lineage, host-derived QA identity and exact
integration fencing remain missing behavior. Repository publication, PR readiness
and bounded integration require the later fresh exact Grant. Verify the
independent review gate and required checks before live dispatch; a missing or
rate-limited CodeRabbit review never blocks it.

The current enrollment candidate adds the host-owned replay contract and its
additive five-role lineage store. Real-fixture host tests drive strict `go`
preparation and `launchGuardedHostSession` (issue/commit admission) through
enrollment: exact replay, changed identity/mode refusal, a claimed Action,
Off, a mid-launch Off/On epoch change, capacity, packet approval, spawn
failure and restart reconciliation leave no duplicate principal or live
orphan admission, lease or enrollment row. Native adoption refuses without a
host-observed adapter. Store-level tests cover one mutation owner per
requirement, independent reviewer/QA identities, bounded terminal retries,
two-connection ordinal allocation and exact-head invalidation.

The lineage is now wired into the real executors (candidate, not installed):
the guarded launcher allocates or resumes the one development attempt after
its deterministic prerequisites and before admission; exit reconciliation
finishes it in the receipt's transaction; the tick's planning resolution
records planner and packet-critique attempts; code review and QA attempts
require a deterministic readiness binding (head, criteria, preserved
evidence) before any reviewer runs; `arcadia qa code-review` and
`arcadia qa pr` record the exact-head code review and QA for a lineage-bound
managed PR through separate read-only reviewers, refusing a developer
directory or binding, a stale head and Off before any reviewer runs; and the
tick integrates only with current, independent code review and QA verdicts on
the exact head, with no operator merge, clearing its
`awaiting_independent_verdicts` escalation. The hermetic three-Action
rehearsal proves serial selection, between-Action Off fencing and one lineage
per role per Action through the real tick, with simulated reviewers;
`tests/code-review-verdict-recorder.test.ts` drives both host commands
against a real rehearsal candidate with stubbed GitHub and reviewer model.
Missing at that candidate: nothing ran those commands unattended (the
operator or a host step invoked them), and both need a ready, non-draft PR
whose head is the candidate's settled head; the 2026-10-04 candidate below
closes that gap in code. This is candidate evidence only: it is not installed-host enrollment
proof, production activation, a rehearsal, or completion evidence.

### Remote-preservation grant option — 2026-10-03 candidate

Before this candidate, `scope.remotePreservation` was validated and read by
both preservation paths, but no command could set it, so every managed
preservation stayed `LOCAL ONLY` and no draft PR could exist. The candidate for
`let-production-grant-request-remote-preservation` adds
`arcadia production preview|activate --remote-preservation`. It is the only way
to set the field; no other flag, environment variable or dashboard control can
turn it on. The option authorizes exactly two things for an Action in the
active scope: pushing the preserved candidate branch and opening (or updating)
its **draft** pull request. It does not authorize marking a PR ready, merging,
or pushing the base branch; those stay separate gates and later work
(`ready-pr-and-run-independent-reviews-from-the-tick`). Without the option,
preservation stays `LOCAL ONLY`.

The option is bound into the scope fingerprint, printed as
`Remote preservation: on|off` by the preview, `production status` and the
activation receipt, and a replayed request id under a different setting is
refused. Off clears it from the active policy immediately; the saved reviewed
configuration keeps it, so a fingerprint-bound reactivation (CLI or the
dashboard On switch) restores exactly what was granted and never adds it to a
configuration granted without it. Coverage: the `remote preservation
(--remote-preservation)` block in `tests/managed-production-policy.test.ts`,
`tests/production-reactivation.test.ts`, and the dashboard contracts in
`apps/dashboard/app/api/production-control/route.test.ts` and
`apps/dashboard/lib/production-reactivation.test.ts`. This is candidate code
only: it grants nothing, no live policy was activated with it, and the live
Grant for any rehearsal remains an operator decision.

### Tick-driven PR readiness and independent reviews — 2026-10-04 candidate

The candidate for `ready-pr-and-run-independent-reviews-from-the-tick`
(`src/production/independentReview.ts`) lets the worker tick take a preserved
managed candidate from its host-created draft PR to integration with no
operator step. While the verdict gate waits, and only where integration is
otherwise authorized and would fast-forward, each tick advances at most one
side effect: push exactly the settled head commit when a settlement commit
landed after preservation (the PR head must be that settled head or an
ancestor of it; anything else is `review_head_moved` and never gets a
verdict), `gh pr ready` once (a PR returned to draft afterwards escalates
`review_paused_as_draft` instead of being readied again), poll required checks
(once a minute, one-hour deadline after ready; `BLOCKED` counts only once
checks are green; every rollup entry, CheckRun or StatusContext, is read by its
real state through the shared `normalizeStatusCheck`, an unrecognised entry
blocks by name, and only `ADVISORY_CHECK_CONTEXTS`, which is `CodeRabbit`
under Decision 0080, never gates), then `arcadia qa code-review` and on a later tick
`arcadia qa pr`, each reviewer bounded to 15 minutes under the worker's
30-minute tick ceiling, which is re-stamped right before the reviewer starts.
State is re-derived from GitHub, the role lineage and one
`production_review_steps` row per exact head, so a restarted worker resumes
mid-step without a second `gh pr ready` or a second verdict attempt. Every side
effect re-reads the policy at the current time and is withheld on Off, a new
epoch or a lapsed grant; integration re-checks the policy and the grant expiry
against a fresh clock after the gate, so a reviewer that finishes under Off or
after expiry never lands. Three consecutive GitHub, push or reviewer
capacity/sandbox/timeout failures per head exhaust a budget that survives
restart (`review_budget_exhausted`; a success resets it, and a total of nine
per head caps failures that alternate between steps; reset with
`arcadia production reset-repair-budget`); a GitHub rate limit backs off 15
minutes without spending it and escalates `review_rate_limited` after six
unbroken hours. A non-pass verdict is re-run automatically only when its own
lineage receipt records `reviewerUnavailable`, which `arcadia qa pr` derives
from deterministic evidence only (never from model-written findings); a real non-pass
verdict is never retried automatically and never integrates
(`independent_verdict_failed`).

What authorizes each step: every step, including the push of the settled
head, requires `policyAuthorizesPullRequestReadiness`: an Active policy with
**both** `--remote-preservation` and a current Decision 0058 integration grant
naming the Action. This is stricter than `--remote-preservation` alone, which
still never readies a PR or runs a reviewer. Whether Decision 0058's grant
should be read to cover the push, readying a host-created PR and the
reviewer-model spend, or a separate grant option should exist, is an operator
question this candidate does not settle. Merging on GitHub and pushing the
base branch remain out of scope; integration stays the local fast-forward.

Coverage: `tests/tick-independent-review.test.ts` (exact head, settled head
pushed as an exact commit after preservation, moved head, pending/failed/
timed-out checks, BLOCKED while checks run, poll interval and stable
escalations, Off, epoch change and grant expiry mid-step, consecutive and
total failure budgets, rate-limit backoff, its escalation and replay of an open
escalation, reviewer timeout, exhaustion and reset, an unavailable-then-real
failed verdict, model-spoofed unavailability titles, a PR returned to draft,
no grant, LOCAL ONLY remedy, migration including an earlier table shape) and the `"tick"` variant of
`tests/rehearsal-three-action.test.ts`, which drives preserve, ready, both
reviews and local integration for three Actions through the tick with only the
GitHub CLI and reviewer model stubbed, Off between Actions, and in-process
aborts (thrown exceptions, not process death) after `gh pr ready` and inside a
code-review call, each resumed by a later tick on fresh connections from
persisted state. Candidate code only: it is not installed, and no live grant
was activated with it.

### Three-Action rehearsal operator pairs — 2026-10-04 candidate

`prepare-three-action-rehearsal-operator-runbooks` drafts four pairs in
`artifacts/generated/operator-scripts/`: G1 fixture preparation (one
operator-supplied private repository, one ubuntu-latest CI job, Project
`three-action-rehearsal`, Plan `autonomous-three-action-rehearsal`, serial
Actions `write-start-marker`, `transform-start-marker`, `verify-final-rehearsal`,
provider `claude-code-cli`), G6 read-only preflight, the one-shot G7 Grant (12-hour
packet-approval and Decision 0058 expiries, `--remote-preservation`,
concurrency one, current revision and installed release, hermetic replay first),
and G8 terminal Off (governed deactivate first, only of G7's own policy with the
exact fixture scope, three quiet observations before
and after the hash-pinned `recover-arcadia-host-services` restart with its
override variables unset, work
reconciliation, restart receipt and intervention ledger).
This PR also publishes the reviewed `recover-arcadia-host-services` pair into
the tracked library at its exact existing bytes, because G8 pins and runs it.
G6 and G7 require a fresh bounded `git ls-remote` of origin main equal to local main.
`tests/three-action-rehearsal-operator-scripts.test.ts` covers the contract,
static safety and refusals against fake CLIs. They are unpublished candidate
files: none was run, no repository was created and no Grant exists. G6 observes
Codex capacity ignoring `capacityGateEnabled: false`, so an unmetered-only
observation refuses as unknown. Whether Decision 0058 covers PR readiness and
reviewer spend (#925) stays an operator acknowledgement stated in G7's
always-visible title and effect.

`fix-rehearsal-g1-plan-and-operator-guidance` (candidate, 2026-10-04): a
read-only smoke found G1's generated Plan invalid YAML, which docs sync would
only have reported after the repository was created, pushed and imported. G1
now renders the fixture into its run directory and runs the real `discoverDocs`,
a dry-run `syncProjectDocs` in a throwaway workspace and `resolveReadySet`
before any GitHub, push, import or manifest write, and reports a half-registered
earlier attempt with an exact recovery (no governed command removes a registered
Project, so that recovery is an Agent Ask). `recover-arcadia-host-services` needs
`ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover` inline,
never exported; G8's pin of its descriptor moved with the new text. G6 now
reports an unreadable check-runs read once and judges Codex availability by its
real enum. Still unrun live: no repository was created and no Grant exists.

### Three-Action rehearsal run 2 — 2026-10-05 candidate

`prepare-run-2-rehearsal-scripts` drafts the run-2 pairs. None was run. They
were tested only with `--describe` and against fakes. Run 1 left a passed
development attempt and a failed code review for `write-start-marker`, plus
its preserved candidate (branch `claude/write-start-marker-20261004T170245861Z`,
PR #1, tip `58bcd915…`). A passed attempt for an unchanged requirement input is
never relaunched. `requirementIdentity` hashes `next_action`, the acceptance
criteria, the responsibility and the execution; the title is not part of it.

- **Reset.** `reset-three-action-rehearsal-fixture-2026-10-05` is one-shot.
  It rewrites only that Action's `next_action` and adds a run-2 note. It also
  bumps the Plan's `updated:` date, because otherwise docs sync skips the
  change as older than the record.
- **Validation and evidence.** Before its single commit, the reset validates
  with G1's rules plus a requirementIdentity diff. It also reads the live
  lineage read-only. It refuses unless run 1's G8 succeeded and the branch and
  PR are still at their tip. It pushes fixture main without force, runs docs
  sync and records `previousMain`, `newHead`, `candidateTip` and `prTip`.
- **G6 and G7.** `preflight-three-action-rehearsal-2026-10-05` and
  `grant-production-three-action-rehearsal-2026-10-05` bind that head instead
  of genesis. Each takes it from the latest succeeded reset receipt for the
  exact repository. G7 has a new request id and keeps every 2026-10-04 G7
  property. Its card cites the operator's #925 answer (Log
  `operator-answers-rehearsal-run2-2026-10-05`). The 2026-10-04 G6 and G7 are
  retired from use; their files are unchanged.
- **Dispatch fix.** The pairs alone were not enough. Two runtime guards
  would have stopped the amended Action behind run 1's unmerged candidate:
  - The tick's terminal handoff deferred every admission.
  - The Action claim refused the dispatch.

  Both now skip a finished candidate only when its own passed development
  attempts were all for a superseded input. The candidate is never touched,
  and its claim stays while its worktree is dirty.
  `tests/rehearsal-run-2-amended-action.test.ts` proves it through
  `requirementIdentity`, the launch gate and the real tick.

The run-2 G8 variant is `restore-terminal-off-three-action-rehearsal-2026-10-05`.
It is the merged G8 (#955, settled-descendant reconciliation) with one change:
it also owns the run-2 request id, still only with the exact fixture scope. Its
reconciliation and hash pins are unchanged. Operator order: merge this pull
request → rerun run 1's G8 → reset → recover only if main moved again → G6 →
G7 within 30 minutes → G8 variant (START_HERE.md lists the commands).

### Three-Action rehearsal run 3 — 2026-10-05 candidate

`prepare-run-3-rehearsal-scripts` drafts the run-3 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 2 ended with
production Inactive at revision 33 and its G8 terminal Off proven (run
`20261005T160050Z-46759`). Fixture main is run 2's reset head `0d3d2ced…`. Run 2's
candidate is preserved on branch `claude/write-start-marker-20261005T155147519Z`
and PR #2 at `7f139037…`, beside run 1's PR #1 at `58bcd915…`. Every
2026-10-04 and 2026-10-05 pair is retired from use and left byte-unchanged.

- **Reset.** `reset-three-action-rehearsal-fixture-run3-2026-10-05` rewrites
  write-start-marker's `next_action` a third time. Its input revision moves
  from `959a3b12c686…` (original) and `7a8dd4f5960f…` (run 2) to a third. An
  equal `updated:` date applies in docs sync and only an older one is
  skipped, a rule a test proves with the real docs sync. So the Plan carries the
  reset's UTC date, and a host date before 2026-10-05 refuses. Before any
  commit, the reset also runs a read-only dry-run docs sync against the live
  workspace, which must report the Action as an update. A test proves the
  same-day sync reopens the record run 2 left `done`. The new text also names
  the completion request id `complete-write-start-marker-run3-2026-10-05`,
  because the packet template's `complete-<action-id>-<date>` would reuse run
  2's settled id on 2026-10-05 and stall completion. The reset refuses if that
  id is already used.
- **Issue #968.** In run 2, run 1's pending complete proposal naming the
  Action made `resolveProjectTransition` answer `decision` for 33 minutes, and
  nothing launched. The reset reads the gate through Arcadia's own
  `resolveOperatorGate`. It refuses on any pending fixture proposal or
  Decision except run 2's `complete-write-start-marker-2026-10-05`, which must
  match the descriptor's `agentAsk` declaration. Live, the tick accepted that
  one on run 2's candidate branch (fixture main untouched), so it no longer
  gates and the reset leaves it as it is. Only if it were still pending would
  the reset reject it through `arcadia agent-ask settle --disposition
  rejected`, preview then apply with that fingerprint, with
  `ARCADIA_WORKSPACE` inline on that one command, before the commit; the
  preview must write no document and place no queue entry. In every case the
  gate must then read clear.
- **Evidence.** The receipt records the new head, all six candidate tips
  before and after, and the superseded proposal with its fingerprint.
  `tests/rehearsal-run-3-amended-action.test.ts` proves the dispatch path with
  the real transition resolver and tick. With both earlier lineages present,
  the pending proposal blocks dispatch. After the rejection the run-3 input
  launches as development ordinal 1.
- **G6, G7 and G8.** The run-3 G6 and G7 bind the run-3 reset head: one commit
  on run 2's head, two on genesis. G6 adds the read-only `operator_gate` check.
  G7 is the run-2 G7 line for line apart from ids, binding and wording, which a
  test compares, and it carries the `next_after` hint. The run-3 G8 also owns
  the run-3 request id. Its reconciliation and hash pins are byte-identical to
  run 2's.
- **Order.** PR #969 merged and reinstalled → merge this pull request → reset →
  recover only if main moved on a runtime path → G6 → freeze (no push to main,
  reinstall, restart or G8) → G7 within 30 minutes → G8 from the Terminal panel
  or `/runs`.
- **Run 3 evidence to capture.** Keep the live QA reviewer's verdict on the
  "Operator QA plan" criterion for the run's pull request
  (`artifacts/qa/pull-requests/.../qa-report.md`). It proves the remainder
  Action `verify-operator-qa-plan-with-live-qa`.

Live state reported before the run: run 2's proposal is accepted, run 1's is
rejected, and `arcadia advance` answers `launch` for the fixture. The reset
re-reads all of this itself and refuses on any other pending fixture item.

### Three-Action rehearsal run 4 — 2026-10-05 candidate

`prepare-run-4-rehearsal-scripts` drafts the run-4 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 3 ended with its
G8 terminal Off proven (run `20261005T194025Z-26232`). Fixture main is run 3's
reset head `4375aafe…`, one commit on run 2's `0d3d2ced…` and two on genesis
`5e0e183f…`. Run 3's candidate is preserved on branch
`claude/write-start-marker-20261005T184707757Z` and PR #3 at `50d1eab8…`,
beside PR #2 at `7f139037…` and PR #1 at `58bcd915…`. Every 2026-10-04,
2026-10-05 and run-3 pair is retired from use and left byte-unchanged (a test
pins their sha256).

- **Reset.** `reset-three-action-rehearsal-fixture-run4-2026-10-05` clones the
  run-3 reset. It requires run 3's reset receipt (`newHead` `4375aafe…` on run
  2's head) and run 3's G8 terminal Off. It rewrites write-start-marker's
  `next_action` a fourth time: its input revision moves off `959a3b12c686…`,
  `7a8dd4f5960f…` and `e22c8cfadd0b…` with an unchanged criteria fingerprint.
  The text keeps the original sentence and names the unused completion id
  `complete-write-start-marker-run4-2026-10-05`. The reset refuses at
  `proposal_gate`, before any settle or commit, if that id already exists. It
  checks all three earlier candidates (local branch, GitHub branch and PR head
  each) before the push and after it. Run 3's date rule and the read-only
  live dry-run docs sync are kept, and a test proves the same-day sync reopens
  the record run 3 left `done`.
- **Issue #968.** Unchanged from run 3, with run 3's
  `complete-write-start-marker-run3-2026-10-05` as the one proposal the reset
  may reject (declared in its descriptor's `agentAsk`): pending → governed
  rejected settle before the commit; rejected or accepted elsewhere → left as
  it is, only with fixture main at run 3's reset head and the gate clear; any
  other pending fixture item (run 1's or run 2's included) → refuse. Live, run
  3's proposal is accepted.
- **Evidence.** The receipt records the new head, the three candidates' tips
  before and after, every fixture proposal's state before and after, and the
  superseded proposal. `tests/rehearsal-run-4-amended-action.test.ts` runs the
  real transition resolver and tick through three earlier runs and shows the
  run-4 input launching as development ordinal 1.
- **G6, G7 and G8.** The run-4 G6 and G7 bind the run-4 reset head: one commit
  on run 3's head, three on genesis. G6 keeps every run-3 check. G7 is the
  run-3 G7 line for line apart from ids, binding and wording, which a test
  compares, and its `next_after` voids on every rehearsal G8, reset, recover
  and reinstall. The run-4 G8 also owns the run-4 request id. Its
  reconciliation and hash pins are byte-identical to run 3's.
- **Order.** Validation-evidence repair PR merged and reinstalled by the
  release manager → merge this pull request → reset → G6 → freeze (no push to
  main, reinstall, restart or G8) → operator presses G7 within 30 minutes → G8
  from the Terminal panel or `/runs`.
- **Run 4 evidence to capture.** Keep the live QA reviewer's verdicts on the
  run's pull request (PR #4), in `artifacts/qa/pull-requests/.../qa-report.md`,
  especially the "Operator QA plan", "Tests and evidence" and "Approval
  boundaries" criteria.

### Three-Action rehearsal run 5 — 2026-10-06 candidate

`prepare-run-5-rehearsal-scripts` drafts the run-5 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 4 admitted
write-start-marker and rendered the Validation evidence section into PR #4,
then stalled about three hours at integration (#981): the agent's drafted
complete Ask was never archived, the worker's terminal-recovery preservation
committed it on top of the settlement, and the integration guard refused in a
silent loop. Its G8 proved terminal Off (run `20261006T011557Z-3871`, policy
revision 37). Fixture main is run 4's reset head `9642005f…`, one commit on run
3's `4375aafe…`, on run 2's `0d3d2ced…`, on genesis `5e0e183f…`. Run 4's
candidate is preserved on branch `claude/write-start-marker-20261005T220000438Z`
and PR #4 at `79c6bae9…`, beside PRs #3, #2 and #1. Every 2026-10-04,
2026-10-05, run-3 and run-4 pair is retired from use and left byte-unchanged
(a test pins the sha256 of all 30 files).

- **Reset.** `reset-three-action-rehearsal-fixture-run5-2026-10-06` clones the
  run-4 reset. It requires run 4's reset receipt (`newHead` `9642005f…` on run
  3's head) and run 4's G8 terminal Off. It rewrites write-start-marker's
  `next_action` a fifth time: its input revision moves off `959a3b12c686…`,
  `7a8dd4f5960f…`, `e22c8cfadd0b…` and `7843e2eb12f9…` with an unchanged
  criteria fingerprint. The text keeps the original sentence, names the
  unused completion id `complete-write-start-marker-run5-2026-10-06` (refused
  at `proposal_gate`, before any settle or commit, if it already exists) and
  tells the agent to leave `git status` clean after settling. It checks all
  four earlier candidates (local branch, GitHub branch and PR head each) before
  the push and after it. The date rule is run 4's: the reset writes its own
  UTC date and docs sync applies an equal or later one. Run 4's Plan says
  2026-10-05, so a reset on 2026-10-06 bumps the date; tests prove that bump
  with the real docs sync, including reopening a record run 4 left `done`.
- **Issue #968.** Unchanged, with run 4's
  `complete-write-start-marker-run4-2026-10-05` as the one proposal the reset
  may reject (declared in its descriptor's `agentAsk`): pending → governed
  rejected settle before the commit; rejected or accepted elsewhere → left as
  it is, only with fixture main at run 4's reset head and the gate clear; any
  other pending fixture item (runs 1 to 3 included) → refuse. Live, run 4's
  proposal is accepted.
- **Evidence.** The receipt records the new head, the four candidates' tips
  before and after, every fixture proposal's state before and after, the
  superseded proposal and the completion id.
  `tests/rehearsal-run-5-amended-action.test.ts` runs the real transition
  resolver and tick through four earlier runs and shows the run-5 input
  launching as development ordinal 1.
- **G6, G7 and G8.** The run-5 G6 and G7 bind the run-5 reset head: one commit
  on run 4's head, four on genesis. G6 keeps every run-4 check. G7 is the
  run-4 G7 line for line apart from ids, binding and wording, which a test
  compares, and its `next_after` voids on every rehearsal G8 (runs 1 to 5),
  reset (runs 2 to 5), recover and reinstall. Both also require the #983
  merge commit `bb83f70c…` (the #981 fix) on main beside #922 and #924, so
  they refuse until it is merged. The run-5 G8 also owns the run-5
  request id. Its reconciliation and hash pins are byte-identical to run 4's.
- **Order.** Stray-Ask archive fix (#981) merged and reinstalled by the
  release manager → merge this pull request → reset → G6 → main quiet (no push
  to main, reinstall, restart or G8) → operator presses G7 within 30 minutes
  → G8 from the Terminal panel or `/runs`.
- **Run 5 evidence to capture.** Keep the live QA reviewer's verdicts on the
  run's pull request (PR #5), in `artifacts/qa/pull-requests/.../qa-report.md`:
  "Operator QA plan", "Tests and evidence" and "Approval boundaries". If
  integration is refused, keep the new escalation text `arcadia production
  status` shows for it, with its blocker and remedy.

Fresh v2 amendment and rehearsal-creation Asks preserve the earlier drafts and
all twelve accepted prerequisite criteria. They are validated inputs, not
accepted scope. Optional preview is blocked by configured `martianrover`
workspace-write access; no alternate workspace, repeated same-proposal write or
direct database editing was used. The shared one-existing-Action Plan-amendment
runner, separate ordinary Action Ask and fingerprinted `advance queue make-next`
are the existing governed writers. None may infer authority from queue order or
silently rebind an immutable packet.

The first remaining preparation gate is custody of mixed dirty main. Protected
Go refuses the modified library pair, readiness, AGENTS/Notes and narrative
reports; its narrow Ask exemptions do not evacuate them. Preservation needs an
already registered candidate and the shared amendment runner requires entirely
clean primary state. The documented operator recovery playbook can preserve the
exact understood preparation on a recovery branch and publish its review PR;
it is operator-owned recovery, not a fabricated broker reservation or a new
implementation Action. Preserve the learning contribution and validated Log
Ask with that handoff. The five pre-existing unrelated library-contract failures
remain recorded; isolated valid pairs do not make the whole library green.

[The bounded scope/custody design](reports/three-action-managed-production-scope-design-2026-10-02.md)
records exact identities, coverage, seams, required external setup and writer
boundaries. After preparation is reviewed, obtain exact scope acceptance and
pointer transition, then use one protected candidate/Session per implementation
Action with compliant immutable provider/model/effort, deterministic checks,
independent exact-head verdicts, same-candidate completion, PR/check/merge and
installed-service evidence. Prepare/pass the hermetic three-Action rehearsal
before requesting its fresh exact Grant. No installed-host autonomous rehearsal
has run here, and the older literal split/browser/ledger Action stays open.

## Single-Action path: operating tips for agents — 2026-10-09

These are field notes from making one Action run headless from a confirmed Launch to a draft PR (#1131, #1138, #1141, #1145). The rest of this document has not yet been re-derived against them; refresh it under the contract below.

**The path.**
1. A confirmed Launch, from `/production` or `arcadia session launch --operator-launch` at a TTY, mints a one-shot authorization (Decision 0096).
2. A headless session runs.
3. On exit, the worker tick validates on the host, commits, pushes and reconciles, and opens one draft PR only on `accepted_completion`.

It never merges. Integration is refused for operator-launched candidates unless production itself delegates validation. Manual `arcadia session reconcile` records the exit only; it does not commit or push.

**Launch and observe.**
- Fingerprint launches are headless by default. `arcadia go --launch --interactive` keeps the old TUI.
- Every session writes `<workspace>/.arcadia/sessions/<id>.log` and records its exit code in `agent_sessions.exit_status`, with 128+n for a signal.
- Watch live sessions with `arcadia dashboard runs --sessions 8 --json`, the `/production` log tail, and `.arcadia/worker.log`.
- A preflight refuses a launch before reserving anything when the provider binary is missing (`provider_binary_missing`), the provider is not signed in (`provider_not_signed_in`), or the required headless flags are missing (`permission_posture_missing`).
- A Session that dies on an expired login the preflight could not see (`Provider sign-in failure` receipt) spends no failed-Run budget and cannot pause the Project. The tick records the `provider_sign_in_failed` launch blocker (shown by `arcadia production status`) and launches nothing for that Project for 15 minutes (`SIGN_IN_FAILURE_HOLD_MS`); sign in again, then the tick retries and a further sign-in failure renews the hold. It also consumes no development attempt (#1243): the exit did no work, so the Action's live attempt stays live and the next launch resumes it for the same input revision, however long the login stays expired. Any other failed exit still fails the attempt and an Action allows three.

**Models.**
- Every session starts on the light tier (`sessionStartTier`): Codex `gpt-6-luna`, Claude `haiku`. The brief names the plan's tier as the escalation target.
  - Claude escalates through an Agent-tool subagent.
  - Codex escalates through `spawn_agent` with a model override.
  - OpenCode drafts a relaunch proposal instead.
- An explicit `--model` wins, and a workspace can override the start tier in `config/coding-agent-models.json`.
- Light starts run at low effort even for `e3_deep` Actions. Expect more repair attempts.

**Provider quirks seen live.**
- **Codex** (`exec --json --sandbox workspace-write`):
  - Its sandbox keeps `.git` read-only, so a real repository's worktree usually cannot be committed by the agent. The host commits on exit; this is expected, not a failure.
  - If the worker's preservation heartbeat is stale (over 15s, or no worker at all), `arcadia-preserve-broker-codex` refuses. The agent then correctly drafts its completion Ask and leaves the candidate for the host.
  - Codex persists a project-trust entry for each new directory in `~/.codex/config.toml`. Decision 0099 rules that for experiment temp folders this is not a Decision 0082 stop condition.
- **Claude** (`--print --output-format stream-json --verbose --settings <per-session> --setting-sources ""`):
  - Only the per-session allow list (the Project's declared validation commands plus `arcadia agent-ask draft`) and managed policy apply.
  - It loads no user or project settings and no `CLAUDE.md`/`AGENTS.md`, and runs without the operator's OS sandbox (#1139).
- **OpenCode** (`opencode run`):
  - It auto-rejects any permission that would prompt.
  - The operator's config allowlists `~/.opencode/**`, where real worktrees live. A worktree elsewhere, such as a macOS temp folder, needs a per-process `OPENCODE_CONFIG_CONTENT` grant.

**Bounded lifetime.**
- The default limit is 120 minutes; override it per launch with `--time-limit-minutes`.
- A stuck session is stopped when the limit passes, or when an auth or provider-limit signal persists past the 20-minute stall deadline. Permission-prompt text is ignored for headless sessions.
- The stop only ends tmux. The worktree survives, and reconcile runs on the next tick.

**Prove cheaply before going live.**
1. Run the fast-rehearsal harness offline.
2. Press the `/runs` "Test headless Codex single-Action run, OpenCode on failure (experiment fixture)". It reports the agent part and the host part separately and diagnoses from the receipt.
3. Then launch one small real Action from `/production`.

Each live defect should be reproduced offline before it is fixed.

**Services.**
- The dev dashboard (:3020) runs `next dev`, so pre-load the pages after every restart.
- The stable demo (:3030, https://arcadia-1.alpine-rattlesnake.ts.net/) serves a prebuilt `rel-*` release, and dev restarts never touch it.
- Under heavy load, a restart can stop every service (#1129). Recover as `docs/agent-guidance/pull-requests.md` describes.

## Refresh contract

Refresh whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is found. Read canonical Project/Plan state, policy, queue, relevant Decisions, Session receipts and retained run evidence. Run the applicable read-only checks, then revise the executive summary, gates, critical path, live-state table and Plan Action scoreboard from their results. For every live failure the replay could have predicted, add a hermetic replay scenario that reproduces the failure and passes after repair. Run the hermetic rehearsal before every live rehearsal, including rehearsals under an existing Grant, and before each new live Grant. Separate observed stages from unperformed criteria and preserve earlier failures.

The operator contract remains: Arcadia progresses deterministically, presents one genuine bounded decision through the existing operator surface, or reports a concrete external blocker. No terminal command, database inspection, receipt copy/paste or manual relay should be required. Do not adapt a refusing operator script by hand; follow its failure handoff for the safe recovery route.
