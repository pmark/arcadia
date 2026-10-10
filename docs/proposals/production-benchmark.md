---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia adopt this production benchmark to test inexpensive, high-quality websites and reliable delivery of deeper applications across a constrained portfolio?
---

# Arcadia production benchmark and commercial direction

Date: 2026-10-10

State: proposed benchmark; no execution results or spending authority

Intake: [Issue #1207](https://github.com/pmark/arcadia/issues/1207)

Companion corpus: [production-benchmark-corpus.json](production-benchmark-corpus.json)

Origin: operator-directed research; [Arcadia-led development](../arcadia-development-orchestration-vision.md) and [operator-scale production boundary](operator-scale-managed-production-boundary.md)

## Purpose and commercial hypothesis

Arcadia should make recurring website work inexpensive through deterministic
assembly and tested components, while concentrating deeper production effort on
the Projects that need it. A managed website is the first commercial workload.
Portfolio management, continuity, and reliable custom application delivery are
the larger opportunity.

The initial customer hypothesis is a small agency or service-business operator
with several websites and occasional custom tools. The candidate offer is a
managed service plus explicitly funded production and application usage. The
previous $19/month website and $99 launch-assistance figures are pricing
hypotheses, not approved prices or revenue forecasts. Hosting infrastructure
alone does not establish willingness to pay or profitable support.

This benchmark asks:

1. Can a constrained website family produce accepted, visually varied, technically
   sound sites at very low machine cost, with little human correction?
2. Does a narrow decision model improve total accepted-result economics over
   deterministic assembly plus a conventional generative model?
3. Can the same Arcadia control loop preserve correctness, history and budget
   boundaries during a deeper application change and across other Projects?
4. Which costs remain in onboarding, verification, maintenance and operator
   attention after generation becomes cheap?

Success is evidence for a bounded paid pilot. It is not proof of market demand,
search rankings, arbitrary application competence, or unlimited portfolio size.

## Scope and authority

This document defines a protocol and a synthetic corpus. It does not implement
a runner, activate a Plan, move the Project pointer, provision an account, use
credentials, start paid calls, deploy, publish, collect payment or message a
customer. Execution requires its own governed Actions and explicit authority
for spending, accounts, publication and production.

Use existing Arcadia commands and the providers' standard harnesses. A missing
measurement or execution capability is a proposal, not permission to invent a
second orchestrator. Synthetic local tests use disposable, explicitly selected
fixtures; never default an experiment to the live workspace. Resolve the
applicable experiment rules and current authority when execution is approved.

The bounded initial stack is the existing Astro/static-first delivery direction
with approved component versions. Custom backends, payment collection, sensitive
customer records, invented testimonials and unsupported ranking promises are
outside the website offer. Original factual content remains customer supplied
or explicitly marked missing.

## Comparators and staged enrollment

Freeze the protocol, corpus, source facts, component versions, evaluator
version, model IDs, tools, rate card and runtime image before scoring.

- **A — agent-led baseline:** the currently supported coding-agent website
  workflow with the same dependency cache, supplied assets, factual content and
  tools. It may use existing public starters; log their versions and usage.
- **B — deterministic assembly:** a validated website specification, versioned
  components/design presets, exact transformations and conventional
  generative-model calls only for interpretation, copy and unusual changes.
- **C — assembly plus Jev:** the identical B workflow and assets, with Jev
  replacing named, narrow text classification/routing/scoring calls. All other
  models and steps remain identical. Rules run first; Jev is never required
  for an exact operation that code can perform.

An explicit operation such as a known business-hours field edit follows the
same deterministic path in B and C. Jev should earn its place by improving
cost, latency or escalation quality, not by adding a paid classification call
to every action.

First use the four development cases to make the smallest usable B/C pipeline.
They are excluded from scored results. Only proceed to the scored corpus when
all arms meet the same quality floor on development cases. Keep the held-out
customer facts out of examples and tuning. This is held-out factual content
within known website families, not evaluation on unseen task families. Before scored runs,
independently check that the existing site family can meet the prescribed
inputs; unsupported capability must be reported before randomization.

Run the twelve scored website cases in A/B/C, twice each: 72 initial production
trials. Randomize arm order within each case/repetition using a recorded seed
and use fresh independent candidates. No output, repair diagnosis, generated
copy or model response from one arm may seed another. Shared dependency caches
are allowed; generated artifacts and semantic caches are not. Record the
primary cold-production result; report later warm updates separately.

### Frozen Jev intervention and input isolation

Before any scored run, freeze this intervention table with concrete input
fields, B's named generative model/call, C's versioned Jev primitive, ground
truth, calibrated escalation threshold and fallback cost. These are candidate
interventions; remove those ordinary code already resolves correctly.

| ID | Narrow decision | B / C replacement | Ground truth |
| --- | --- | --- | --- |
| I1 | Route a semantic request to a supported operation, clarification or out-of-scope proposal | Conventional structured classification / Jev Choice | Independent curator's permitted route set |
| I2 | Select among the three approved presets from a textual preference | Conventional bounded selection / Jev Choice | Curated acceptable preset set, with ambiguous input requiring clarification |
| I3 | Select the relevant page/section from a supplied content inventory | Conventional bounded selection / Jev Choice | Source-linked target section IDs |
| I4 | Decide whether a particular required field is specified clearly enough | Conventional rubric judgment / Jev Noul | Frozen field-level supplied/missing/ambiguous label |
| I5 | Flag a textual marketing claim unsupported by the supplied source facts | Conventional rubric judgment / Jev Noul | Independent source-linked supported/unsupported/unclear label |

For both arms log every eligible decision, chosen route, model/rule used,
abstention, escalation, false acceptance, false refusal, latency, usage and
downstream repairs. Preserve the complete input and result. The scored manifest
must name at least 24 distinct context/question pairs, each observed in both
repetitions in B and C. Duplicate calls or more questions about the same fact
do not manufacture independent evidence. If fewer eligible pairs remain after
deterministic rules, the Jev adoption verdict is **inconclusive**, even if C is
cheaper. Do not invent AI-dependent work to satisfy the minimum.

Freeze fallback to at most one conventional-model attempt, then the defined
clarification/refusal; include its cost and waiting time. A classifier's answer
cannot substitute for an authority grant. R01–R12 contain accepted, refused
and ambiguous requests; score confusion by class so excessive refusal cannot
look safe merely by preventing delivery.

Prepare physically separate packages:
- Builder: initial brief, released source facts/assets, approved reusable code.
- Evaluator: source assertions, ground truth, withheld clarification answers,
  expected routing outcomes and rubric examples.

The checked-in inventory is public design material, not builder input.
Scored builders receive isolated workspaces containing only their package;
their tools cannot read the evaluator package, inventory, prior trial outputs,
or prior repetition feedback. Record the exact prompt, file allowlist and
package hashes. If the runtime cannot enforce this separation, report leakage
and make scored conclusions inconclusive. Within-trial repair feedback is
permitted and logged; across-trial feedback is not.

For W04/W08, release the fixed answer only after the relevant clarification
question, with a scripted 60-second response delay in every arm. Record the
question and response. Missing facts remain absent in the initial builder
package. Builder packages for repeated cases have identical hashes.

Use identical authority, hardware class, evaluator and trial caps. Freeze
model settings and provider version where possible, recording any observed
version changes. An unavailable provider produces an interruption receipt,
not a zero-cost success. A complete block affected by a material model,
template or evaluator change must be rerun under a new experiment ID; retain
the earlier evidence and label it exploratory.

## Website corpus

The JSON companion is the inventory of cases and exact stimulus operations.
It deliberately includes complete facts, awkward content, incomplete inputs
and requests that must stop. Development cases D01–D04 are separate from
W01–W12. Fixture owners must turn the source-fact recipes into concrete UTF-8
text/assets and checksum them before the freeze; the inventory is not yet an
executable website generator.

| Scored cases | Family | Required delivery |
| --- | --- | --- |
| W01–W04 | Professional service | Four pages: home, services, about, contact; inquiry form and supplied booking link |
| W05–W08 | Event or community | Four pages: home, event details, schedule, contact; supplied registration link |
| W09–W12 | Creator or product launch | Four pages: home, work/product, about, contact; supplied signup or checkout link |

Each case carries two post-acceptance updates. They are scored as separate
maintenance trials from that arm's own accepted revision: one exact fact edit
and one content/layout request. U1 and U2 branch independently from the initial
accepted revision, with isolated candidates; U1 failure does not prevent U2. An initial failure makes both updates
unavailable and remains visible; never silently replace it with a successful
site from another arm. Each arm has 48 planned updates (12 cases × 2 repetitions × 2 operations),
144 across all arms. Apply decision gates to each arm separately; also report
the conditional completion rate on initially accepted sites.

Keep W01–W12 within the advertised website family. Out-of-scope requests are
the distinct R01–R12 routing cases, not deliverable websites counted
as successes. Missing facts in W04 and W08 have a fixed clarification response
supplied after the required question; timing includes that interaction.

Design variation must use at least three named presets with different
typography, composition and spacing. No more than half the scored cases may
use one preset. The content is synthetic and explicitly labelled so fictitious
business proof cannot be mistaken for real customer evidence.

## Independent website acceptance

Use a frozen deterministic checker and an independent reviewer who did not
generate or repair the candidate. Give reviewers the source facts, brief and
rendered candidate with arm/provider names concealed. Automation failure is
not evidence that a page is accessible or a form works. Store the exact head,
tool versions, logs, screenshots and review record.

All mandatory gates must pass:

- **Facts and completeness:** required pages and supplied facts are present;
  hours, prices, addresses, dates and links match the source; absent facts are
  asked for or labelled, never fabricated. No invented testimonials,
  credentials, affiliations, statistics or claims.
- **Function:** navigation and all internal links resolve; inquiry submission
  reaches the local test inbox exactly once with its fields intact; invalid
  input has an understandable error; external booking/registration/checkout
  links match supplied URLs and are tested with local stubs.
- **Responsive design:** inspect 360×800, 768×1024 and 1440×900 viewports.
  No unintended horizontal overflow, clipped important content, obscured
  controls or unreadable contrast. Long and missing-content cases must pass.
- **Accessibility:** no critical/serious automated accessibility findings;
  independent keyboard checks cover navigation, focus visibility, form errors
  and the main journey. Heading structure and informative-image alternatives
  are checked manually. This bounded test is not a certification of complete
  WCAG compliance.
- **Technical discovery:** production HTML contains the primary text; every
  canonical page has a unique descriptive title, one canonical URL and correct
  status; sitemap entries and internal links agree; robots/noindex policy
  distinguishes preview from production. Any structured data is syntactically
  valid, relevant and consistent with visible, supplied facts.
- **Performance:** median of three Lighthouse mobile runs on the pinned local
  served build and machine profile: performance >=90, accessibility >=95,
  best practices >=95 and SEO >=95. Initial home-page transferred bytes <=1 MB
  with the fixed supplied asset set. Save raw reports and serve/cache settings.
  These are laboratory gates, not claims of real-user Core Web Vitals.
- **Presentation and usability:** two independent reviewers each score four
  dimensions 1–5: hierarchy, legibility/responsiveness, brand fit and task
  clarity. Both reviewers must individually average >=4, every dimension must
  be >=3, and neither may identify a material obstructed journey. A difference
  of >=2 on any dimension, a pass/fail disagreement, or a journey veto invokes
  one independent adjudicator. Retain all original scores. After adjudication,
  require at least two of the three reviewer means >=4, a median >=3 in every
  dimension, and no reproduced material journey defect. Clearing a veto
  requires the adjudicator's recorded reproduction and reason; confirmed
  defects require repair and new exact-head acceptance. Use two human reviewers
  with responsive-web/accessibility experience for this research assessment;
  they inspect screenshots and perform browser/keyboard journeys. Before the
  freeze, on four calibration outputs they must agree on pass/fail for all
  four and differ by no more than one point in >=14/16 dimensional scores;
  otherwise revise the rubric and repeat calibration. Freeze examples of
  scores 1/3/5 first. Preset diversity supports visual variation, not a claim
  of bespoke design or customer-perceived distinctiveness.
- **Release and evidence:** preview URL and candidate hash agree, approved
  publication cannot precede acceptance, approved release has a health/journey
  probe, and a rollback restores the preceding accepted revision. Offline
  phase verifies a local staging equivalent only; public reachability requires
  the separately approved live phase and stays labelled untested until then.

A reviewer may flag a defect that automated checks miss. Record it, run the
bounded repair path, and judge the resulting head again. A model's confidence
or self-review is never independent acceptance.

## SEO and AEO: controlled inputs and observable outcomes

Technical eligibility is a release gate. Search ranking, indexing, answer
citation and customer acquisition are observational outcomes.

Google's guidance says foundational SEO applies to AI Overviews/AI Mode,
additional AI files or special schema are unnecessary, and indexing/serving
is not guaranteed. Do not extrapolate that into a universal rule for all
answer engines. [Google AI features guidance][google-ai]

After an authorized paid/live pilot, observe at 30, 60 and 90 days:

- indexing/status and impressions/clicks for the agreed site/search queries;
- identifiable AI referrals and a fixed set of dated answer-engine observations;
- inquiry/registration conversions where lawful instrumentation is authorized;
- competing explanations: domain history, prior traffic, content changes,
  campaign spend and public mentions.

Do not condition initial acceptance on traffic or citations. Publish the
exact observational method, include sites with no visibility, and never
claim causal SEO/AEO superiority from this small uncontrolled pilot.
Original useful content and real business evidence are requirements;
bulk generic pages are not the benchmark's strategy.

## Cost, time, failures and economic accounting

Every trial starts at receipt of its initial builder package and ends at
independent acceptance or a terminal failure. The clock includes the scripted
clarification when needed; distinguish machine-active, scripted-wait and
human-active time. Record required content preparation before the trial as
setup/intake labor rather than deleting it from delivery economics.
Record source intake, assembly, model calls, builds, tests, screenshots,
review, repairs, release verification and human touches separately.

Report three money views without conflating them:

1. **Actual incremental charges:** model/API/build/hosting charges actually
   incurred; included subscription capacity can be zero incremental dollars.
2. **Replacement cost:** measured input/output/cache tokens multiplied by the
   frozen published rate card, plus runner resource costs. If a comparable API
   price does not exist, mark it unknown; never invent equivalence.
3. **Fully loaded delivery cost:** actual charges plus disclosed allocation
   of subscriptions, human labor and amortized template/evaluator development.
   Report the assumed amortization volumes of 10, 100 and 1,000 accepted sites;
   do not pretend speculative future volume has already paid for development.

Record background/hidden provider work when reported. Missing usage means cost
unknown and an economics verdict of inconclusive. Staff work, critic sessions,
failed attempts and operator assistance must remain in the ledger.

Tag labor as (a) research-only corpus/blinded-comparison/calibration work,
(b) production-required intake, factual checking, keyboard/visual/functional
verification, independent review and release work, or (c) reusable pipeline
development/maintenance. Freeze the mapping before results; required production
verification cannot be relabelled research-only. Report the experimental bill
with all three and customer-delivery economics with (b), allocated (c), and the
real production review method. The research's two-human visual panel is not a
promise of free everyday review; any cheaper production grader must separately
demonstrate the same quality floor against the frozen human judgments.

Freeze development ceilings of 16 staff-hours for the shared B pipeline,
four additional hours for C, and eight hours for corpus/evaluator setup.
Existing baseline/shared-tool investment is disclosed as sunk/unknown where
unavailable; compare measured incremental work honestly. Exceeding a ceiling
stops confirmatory enrollment pending a revised/narrowed proposal. These
labor ceilings are screening assumptions, not estimates of work already done.

Primary economics:
`total cost of all assigned initial trials / independently accepted sites`.
Show actual and replacement-cost versions. With zero accepted sites, the
metric is undefined and the arm fails; do not report zero. Show trial-count
failure rates, per-case paired differences, median and nearest-rank p95
accepted-site trial cost/time, total spend and the most expensive failure.
The p95 of 24 trials per arm is descriptive, not a reliable tail estimate.
Bootstrap intervals must resample whole cases, preserving repetitions;
avoid treating 24 repetitions as 24 different customers.

A repair is one new candidate submission after grader feedback, including its
new review. Each trial allows one initial submission and at most two repair
submissions, a 30-minute active execution limit and an equal $10
replacement-cost cap across arms. Every maintenance and routing trial has an
equal $2 replacement-cost cap and the same submission/time limits. A metered charged-cost cap and reservation
must also be enforced; do not start a call whose reserved ceiling would exceed
the approved budget. Stop at the next safe checkpoint and keep the candidate.
Human-judgment waiting has a separate elapsed clock and a 24-hour limit.
Record exhaustion as failure, not a smaller deliverable.

Proposed maximum charged budgets, pending explicit approval: development
$120, website initial/maintenance/routing phase $1,200, deeper application
$180; total $1,500. The website phase reserves $720 for 72 initial trials, $288 for 144 updates,
$144 for 72 routing trials (12 cases × 3 arms × 2 repetitions), and $48 for
coordination/release evidence. Review costs stay inside their trial reservation.
These are maximum actual-charge allocations; do not let initial trials consume
maintenance/routing reserves. Freeze the metering/reservation implementation
before starting; an unenforceable ceiling is a stop, not a best-effort promise. Replacement-cost limits do not authorize billed overages. If these
ceilings are too low to finish, report the unfinished denominator and ask for
a new experiment budget rather than retroactively changing the protocol.

Track autonomous machine minutes, paid staff minutes, operator minutes,
clarification count, model escalation count, repair count and end-to-end
elapsed time. Human time is priced at both $30/hour and $75/hour in the
sensitivity report. The website offer must be assessed against its total
support cost, not only inference fees.

## Decision rules for the website experiment

These are proposed thresholds to ratify before execution:

- **Quality floor:** >=22/24 initial trials independently accepted in each arm;
  every accepted site passes every mandatory gate. A wrong fact, unauthorized
  publication or invented business proof cannot be averaged away.
- **Economics for B/C:** replacement-cost aggregate per accepted site <=$2,
  accepted-trial p95 <=$5, and aggregate at least 50% below A while satisfying
  the same quality floor.
- **Attention:** total production-required human minutes across all assigned
  initial trials / accepted sites <=15 minutes; accepted-site p95 <=30 minutes.
  Include intake, factual verification, required keyboard/visual checks,
  review, approvals and repairs. Also report correction-only median <=5 and
  p95 <=15 minutes, but that secondary metric cannot override the aggregate.
  Publish failed-site minutes and customer content preparation separately.
- **Maintenance:** >=44/48 planned updates completed in each arm (>=90%),
  counting updates unavailable after initial failure as incomplete; no wrong
  changes to another site. Per arm, total cost of all assigned maintenance
  trials / accepted updates <=$0.50 replacement cost, accepted-update median
  <=$0.25, and accepted-update p95 <=$1. Zero accepted updates makes the cost
  undefined and the arm fails. Every accepted update passes affected gates
  and journey regression checks.
- **Boundaries:** all R01–R12 follow their ground-truth allowed routes, including
  legitimate requests that must be accepted and ambiguous requests that need
  clarification. No publication,
  spending, secret disclosure or external send without its applicable grant.
- **Jev adoption:** preregister aggregate replacement cost per accepted site
  as the primary endpoint; active time is secondary and cannot independently
  trigger adoption. C must meet the quality/economics/attention/maintenance/
  boundary gates and intervention minimum, improve the primary endpoint >=20%
  versus B, and have no lower observed acceptance or routing correctness.
  Report paired case-level discordance and a 95% case-bootstrap interval.
  If that interval includes no benefit, or removing any one case reverses the
  direction, verdict is promising/inconclusive; retain B pending confirmation.
  Otherwise provisional C adoption is justified within the tested family.
  This is screening evidence, not proof of general model superiority.
- **Economic feasibility:** separately report break-even launch fee and monthly
  service fee at both labor rates and each amortization volume. A proposed
  commercial offer must price initial production, required recurring review,
  hosting and support explicitly, using its disclosed gross-margin target.
  Production can be funded separately from the service fee. Unknown recurring
  support or customer-preparation effort means commercial feasibility remains
  conditional until a paid pilot measures it; machine-cost success alone does
  not authorize a claim of profitable $19/month delivery.

If A also fails quality, the experiment cannot support superiority over a
working baseline. Investigate the corpus/evaluator/workflow, preserve results,
and register a new protocol. If B succeeds but C does not, the website business
can proceed without Jev. If cost succeeds and attention fails, test onboarding
or service scope before lowering prices. If development requires excessive
bespoke machinery, reject or narrow the website family before confirmation.

## Deeper application and portfolio demonstration

Use a synthetic service-request portal: clients submit jobs, staff triage them,
and an operator sees work, evidence and Decisions. Roles have distinct access.
A local notification stub receives idempotent events. Tests hold synthetic
client records, never personal/customer data.

Three separately versioned repositories represent the marketing site, portal
and notification adapter. Only the portal/adapter need bespoke application
work; maintain the website with the proven deterministic path. Freeze the
starting implementation, API contract and acceptance fixtures before the run.

The prescribed change introduces scheduled requests into an existing portal:

1. Clarify the outcome and record the schema/API compatibility constraint.
2. Add a migration preserving existing jobs and ownership.
3. Implement permissions and scheduling behavior; keep client/staff isolation.
4. Update the adapter with a backward-compatible event and idempotency key.
5. Inject a timeout after the adapter accepts an event but before acknowledgement;
   retry must not create a second notification.
6. Interrupt an implementation Session after a preserved intermediate candidate;
   a second Session resumes that candidate without duplicate writers or
   operator relay of Git state.
7. Gather independent exact-head review and functional proof.
8. Exercise staged integration and backward compatibility in local staging.
9. After migration, acknowledge creation of two new scheduled jobs and a
   modification to an old job; record IDs, values, ownership and event IDs.
   Terminate the process immediately after the job/outbox transaction is
   durable but before its notification is acknowledged. Recover and compare
   every acknowledged record and effect with the frozen oracle.
10. Rehearse old-code rollback against the changed schema. Preserve all
    acknowledged post-migration work. If safe rollback is impossible, refuse
    it and demonstrate forward recovery; restoring an old snapshot that loses
    acknowledged work is a failure. No production database is involved.

A separate security-oriented reviewer checks authorization and the migration;
a separate functional grader checks the user journeys and durable state.
Neither can be the implementer. One successful example demonstrates this
bounded lifecycle, not general competence at complex software.

Populate a synthetic portfolio of 50 idle Projects plus those three repositories.
Two unrelated ready website updates must progress while the portal is blocked
on one scripted operator Decision. Keep concurrency at one admitted writer;
a read-only reviewer is separate and resource-accounted. Record selection,
blocked reasons, reserve/budget accounting and interruption recovery.

Mandatory demonstration evidence:

- the frozen authorization matrix denies unauthenticated access, client-to-
  staff escalation and cross-client reads/writes, including guessed IDs;
- pre-migration records and ownership survive, and invalid schedules are refused;
- old and new event consumers obey the frozen compatibility contract;
- timeout/retry/recovery eventually emits exactly one durable effect per
  expected event, with no silently missing notifications;
- interruption resumes the preserved candidate, with one live writer and
  complete history;
- readiness/authority gates prevent an unauthorized transition, and the
  operator Decision advances only its intended Project;
- other eligible Projects progress without blocked-project starvation of
  the whole portfolio;
- recovery preserves every acknowledged pre/post-migration record and change,
  ownership, event identity and expected notification effect; unsafe down-
  migration/old-code rollback is refused with tested forward recovery.
  Irreversible external effects are never claimed undone;
- operator never manually repairs a branch/worktree or relays a session prompt;
- all costs, reviewer work, elapsed time and human touches are recorded.

Use deterministic fixture probes to compare portfolio reads at 3 and 53
Projects under the same host profile. Record query latency, bytes read,
idle-Project model calls and work-selection time. Require zero idle-Project
model calls and no missed/duplicate ready Actions. Report throughput and
latency; do not label 53 Projects as proof of unlimited scale.
A 1,000-Project read-only probe is deferred until the 53-Project behavior is
correct and a real portfolio makes that scale material.

## Evidence package and reproducibility

Each experiment has one immutable manifest and a results directory in the
existing Artifact/evidence path chosen by its governed execution Action.
A row is keyed by experiment ID, case ID, arm, repetition and operation.

Required files:

- frozen manifest, corpus/assets checksums, rate card, randomized order and
  tool/model/template revisions;
- per-trial input facts, clarification receipts, candidate hashes, call usage,
  cost reservations/actuals, exit status and stage timings;
- exact-head grader reports, screenshots, browser/check logs and repair lineage;
- accepted-site and planned-update denominators with failures/cancellations;
- release/rollback receipts, or an explicit offline/publication-not-tested label;
- application migration/security/compatibility/recovery reports;
- portfolio selection/block/resumption evidence;
- aggregate actual/replacement/fully-loaded costs, distributions and paired
  differences; unknown fields and missing evidence listed prominently;
- a short verdict against each preregistered gate, with dissent and limitations.

The manifest names who may generate, judge, authorize and operate each phase.
The results use the canonical Project/Plan/Action/Artifact vocabulary, while
customer-facing reporting emphasizes outcomes and live evidence.

## Recommended sequence and deferrals

1. Operator considers the benchmark proposal and commercial hypotheses.
2. A governed planning Action defines execution authority, independent graders,
   concrete source assets and allocation, using existing Arcadia capabilities.
3. Development cases calibrate the reusable family and evaluator.
4. Freeze and execute the paired website/maintenance/routing experiment.
5. Execute the bounded deeper application/portfolio demonstration.
6. Only successful evidence justifies a paid pilot with separately approved
   customer outreach, hosting, spend and publication.
7. Observe renewals, support and discovery outcomes before adopting prices or
   expanding the offer.

Defer universal app scaffolding until two delivered applications need the same
module. Defer a marketplace until repeated paid template demand exists.
Defer enterprise/multi-operator controls until a paying customer's needs require
them. Defer broader hosting stacks until a repeated paid workload cannot fit
the supported path. Each deferral returns on its stated trigger.

## Evidence and current-source references

Published claims below were checked 2026-10-10. Refresh rates/model behavior
before any benchmark run.

- [Jev with coding agents][jev-agents]: typed judgments, no text/code generation.
- [Jev model reference][jev-models]: Jev 1.13 at $0.042/million input tokens;
  output free, text-only inputs. One thousand 2,000-input-token evaluations
  total $0.084 in model fees; this excludes orchestration and verification.
- [Jev known limitations][jev-limits]: numeric reasoning, adversarial inputs,
  irrelevant state, option order and generation limitations. Evaluate narrow
  classifications on development/held-out cases; keep arithmetic and authority
  enforcement deterministic.
- [Google AI features guidance][google-ai]: search eligibility and observation.
- [Workers for Platforms pricing][cf-pricing]: $25/month base, 20M requests,
  60M CPU-ms and 1,000 scripts included. A hypothetical 100 apps × 100,000
  dynamic requests × 10ms CPU gives $25.80/month runtime; it excludes databases,
  storage, build runners, inference, support and payment costs.
- [Cloudflare for SaaS plans][cf-domains]: 100 included hostnames and
  $0.10/additional hostname; hostname behavior and account eligibility must
  be validated for the approved live topology.

These rates are context for feasibility, not benchmark results. The primary
savings hypothesis is removal of repeated generation and repair through tested
assets, reliable intake and exact transformations.

[jev-agents]: https://docs.typesafe.ai/introduction/coding-agents
[jev-models]: https://docs.typesafe.ai/models
[jev-limits]: https://docs.typesafe.ai/model-jaggedness/jev-1.13
[google-ai]: https://developers.google.com/search/docs/appearance/ai-features
[cf-pricing]: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/
[cf-domains]: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
