# Flight Deck: continuously managed production

> Latest sequencing: [18](./18-bootstrap-then-dogfood.md) separates Managed
> Production bootstrap from Flight Deck. Build and prove the controller through
> the existing Work Queue first; use it to produce the real Flight Deck Actions.

Operator direction, 2026-09-05. Proposed expansion of the Flight Deck delivery
contract, pending review of this revised scope. This takes precedence over the
prior manual-only Session launch and continuous-scheduling deferral in 11–16.
No service was enabled or real provider Session launched by this design change.

## The required experience

Flight Deck shows which Plans are in production, their order, their Actions and
dependencies, what is running, what comes next and what needs the operator.
The operator switches **Production: Active / Inactive**. When Active, Arcadia
keeps advancing eligible approved work with available configured coding agents,
without a new chat, manual Session launch, terminal command or repeated approval
of already-authorized mechanics between Actions. This is the primary delivery
objective, not a future enhancement to a read-only board.

First prove: enable → choose → dispatch → validate/reconcile → advance → dispatch
again → disable. Use existing worker, queue, Session and provider mechanisms.
The full board/rail polish, capture improvements and default-home migration must
not delay that proof. Keep the first UI small but usable: plan order, production
switch, current execution, next admission/reason and Needs operator.

## What exists and what must be proved

Source baseline remains main ff59851; inspected 2026-09-05.

| Mechanism | Existing code and behavior | Work required |
| --- | --- | --- |
| Persistent host worker | `src/commands/worker.ts`: runWorkerIteration recovers orphan Runs, claims an already pending Run and executes its approved Decision; two-second tick and heartbeat, service install/start/stop exist. | Extend this host owner to admit/supervise Sessions; do not add another daemon or browser timer scheduler. Its synchronous execution can block a tick: prove switch and heartbeat responsiveness during work. |
| Priority/readiness | `src/dispatch/queue.ts`, `order.ts`, `pointer.ts`: canonical Action order, pointer authority, dependency/readiness, preview/undo. | Map approved Plan priorities to explicit dependency-safe Action segments. Persist admitted scope and recheck after edits; no competing Plan scheduler. |
| Session and launch | `src/sessions/index.ts`, `src/commands/go.ts`, existing idea-to-managed-build launch/reconcile Actions. | Reuse packet-bound identity, worktree and leases; prove supervision, terminal receipts, provider parity and automatic next admission. |
| Provider telemetry | `src/codingAgents/availability.ts`: Codex app-server limits; Claude status-line/cache and usage refresh; capturedAt, rate windows/reset information, availability states. | Test actual host receipts and freshness/paid-mode coverage. A reader's existence is not proof of durable worker access or supported account behavior. No new provider scraper. |
| Availability selection | `isCodingAgentAvailable` currently treats absent/unknown observation as eligible; `selectCompliantCodingAgent` applies capability/effort/cost requirements. | Add unattended admission policy with truthful unknown/stale stops; reuse the selector after admission, preserving compliant alternate-provider choice. |
| Completion | Run outcome/validation and Session transition resolution exist; `work done` updates database status. | Ensure automatic accepted completion, Log and pointer changes use canonical managed-document writers and exact evidence. Database-only done or exit zero is insufficient. |
| Existing scope plans | `provider-capacity-harvesting`, `agent-advance-queue`, `idea-to-managed-build`, `arcadia-development-orchestration-vision`. | Pull the essential admission/supervision proof into this active proposal; link evidence back, do not duplicate implementations or mark those Plans done. The operator has now explicitly prioritized unattended operation. |

This pass inspects source; it does not use credentials to refresh provider
accounts, install services, spend quota or assert a live unattended rehearsal.

## Active is permission; current activity is an observation

Persist desired production state, scope, policy revision and authority receipt
in the existing workspace operational store. Default to Inactive on first setup.
A valid active authorization survives browser closure and ordinary worker restart;
restart first reconciles existing leases and revalidates its current policy.
Revocation/expiry remains inactive and cannot be undone by a stale process.

Display desired state separately from actual activity:

- Active · Building (with each admitted Action/provider)
- Active · Waiting for capacity (observed windows and next check/reset)
- Active · Needs operator / No eligible work (with exact reason and links)
- Inactive · Current work finishing, or Inactive · Idle
- Worker unavailable / Observation stale (never an inferred Inactive)

The switch controls Arcadia's managed production, not unrelated native agent
sessions or independent Intelligence jobs. It must gate launch commitments in
both the producer and consumer paths so already-queued production work cannot
start after Off. A production epoch/revision fences stale ticks and delayed
launch retries. Confirmed Off establishes an observable cutoff; a launch already
committed before that cutoff is identified as existing work, not concealed.

Working default for Off, pending the operator's requested clarification: **stop
new admissions and launches immediately; let already-running work finish and
preserve/reconcile its result.** Off never silently kills a process or deletes
work. If the operator selects checkpoint-and-stop or immediate interruption,
extend and prove provider-specific stop/receipt behavior before claiming support.
Show the exact Off consequence beside the switch. It must be reachable even
while queue, provider or review sources are slow. Do not stop the entire worker
service as a substitute: it still owes observation and cleanup of existing work.

## Scope and priority

Activation previews included Projects/Plans, approved Action scope, current order,
providers, concurrency, included-usage policy, validation/completion authority,
and explicit stops. Activation is one standing bounded authorization for repeated
mechanics, not a per-Action Launch approval. New draft Plans, expanded scope,
changed consequential authority or unapproved spending require new judgment.

Plan ordering is implemented through existing queue segment operations; show the
resulting Action order and exceptions. Retain one active-plan/current-action
pointer per Project. Advance that pointer deterministically within the approved
Plan after acceptance. Transition to another Plan automatically only if that Plan
and its activation are explicitly included in the production authorization; else
surface one actionable approval. Never activate a dormant/draft Plan just because
it is next on screen. Preserve reorder previews, receipts, conflicts and Undo.

On each admission choose the highest-priority eligible Action for an available
compliant agent. Show why higher work is waiting and allow unrelated ready work
to progress. A blocked Project must not idle every configured provider. Reserve
capacity/worker slots atomically, at most one conflicting execution per canonical
repository. Run independent Projects concurrently up to the configured host and
provider limits; there is no promise of one slot per provider when they share an
account/window. Reordering affects unclaimed work, never silently preempts a Run.

## Capacity and waiting

Reuse provider observations and the intended normalized receipt from
provider-capacity-harvesting. Record source, account/window scope, observation
time, limits/reset, and included versus paid/unknown usage policy independently.
Token Impact and context remaining are not subscription remaining capacity.

First prove one supported provider end to end, then demonstrate automatic
admission with the other configured provider when the first is unavailable or
limited. Do not wait for fictional comparable daily/weekly numbers: use each
provider's actually supported windows. Precision forecasting, weekly optimization
and new Back Burner slicing are not prerequisites for this loop.

For unattended admission, unavailable/stale/unknown capacity cannot mean unlimited
or free. Refresh through supported existing observation paths, with deadlines and
backoff. An explicit, bounded operator-confirmed receipt is an honest fallback,
but manual refresh cannot be called proof of indefinitely unattended operation.
Prove automatic observations for the configured providers before final acceptance.
Do not invoke a model merely to poll for capacity. Reserve a configured margin
where measurable; stop new admission at the boundary. Mid-Session exhaustion
preserves work, releases/retains leases according to proven process state and
waits or resumes from checkpoint through a fresh admitted attempt—never reruns
already-applied work blindly with another provider.

When capacity resets, refresh observations and resume admission automatically
while Active. An elapsed reset time alone is not proof of renewed allowance.
Do not purchase credits, enable overages/API billing, redeem banked resets or
change account plans to keep busy. If a configured provider's included-only mode
cannot be established, name that admission gap instead of promising zero spend.

## Completion, QA and continuation

Each Session receives a bounded Action and immutable packet plus the production
policy identity. After exit, collect deterministic validation and the strongest
existing proof; invoke independent QA only when evidence is ready and its scope
is already authorized. Failed work may enter a bounded repair attempt under the
same authorization; deduplicate failures and cap repeated attempts so token
availability cannot create an infinite failure loop.

Acceptance may be automatic only where the standing policy explicitly delegates
that mechanical, evidence-based transition. Subjective product judgment and
consequential operations remain Needs operator. Preserve exact revision, evidence,
acceptance disposition, Log and next pointer via canonical core writers; do not
fabricate managed state in dashboard code. A missing core completion path is an
implementation requirement of this slice, not an operator command to remember.

After completion/blocked disposition, recalculate from current order and scope
and launch the next eligible Action without a new operator Session. Keep partial
work preserved and visible. PR merge, deployment, publication, credential use and
external communication still require their specific authority. If a dependency
requires an unapproved merge, that Action waits while independent authorized
work can continue. Production Active never supplies these missing permissions.

## First real proof and final acceptance

The urgent proof uses a disposable or explicitly approved Project with two small
linked Actions. Activate once; A finishes, canonical evidence/pointer advance,
then B starts with no operator launch or chat in between. Add an independent
Project to show an unavailable provider or blocked Plan does not stop all work.
Switch Off during work; prove no subsequent launch and preservation of the current
result. Restart worker/browser and prove no duplicate or resurrection after Off.

Deterministic fixtures additionally cover a second worker, stale policy epoch,
provider depletion/reset/recovery, interrupted process, ambiguous launch response,
failed validation, approval boundary and queue change mid-run. Real evidence
must identify host, source revision, Action/Session ids, provider, timing,
receipts and exact operator interventions. Simulated limits are labeled fixtures.
The full feature is not accepted until both configured providers, automatic
capacity recovery and the production switch are demonstrated. A read-only board
or a single manually launched Session is not the claimed product.
