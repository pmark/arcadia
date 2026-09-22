---
arcadia: v1
type: reference
slug: martianrover-arcadia-mission-control-site-prd
project: arcadia
status: draft
updated: 2026-09-22
---

# PRD — MartianRover Arcadia Mission Control (public website)

**Working name:** MartianRover Arcadia Mission Control
**Artifact type:** small public marketing + market-learning website
**Status:** draft, pre-launch
**Owner:** P. Mark Anderson (MartianRover)

### Evidence labels used throughout

| Label | Meaning |
| --- | --- |
| **FACT** | True today, verifiable now. No forecast. |
| **HYP** | A belief we hold that the site exists to test. Numbered `H#`. |
| **DEC** | A decision already made for this build. Reversible unless stated. |
| **EXP** | A designed experiment with a variant set and a stop condition. |
| **EVID** | The specific observation that would settle a hypothesis. |

---

## 1. Executive Summary

**FACT** Arcadia is an experimental, actively dogfooded system for governing AI-assisted
software production. It has an operating workflow — Intent → Decision → Plan →
Prioritized Action → Governed Execution → Evidence → Adaptation — and working session
management across replaceable coding-agent providers (Codex, Claude Code, OpenCode).

**FACT** Arcadia has no customers, no revenue, no external users, and no measured
productivity outcomes. Nothing on the website may imply otherwise.

**DEC** This website is a *market-learning instrument* first and a brochure second. Its
primary output is not signups; it is **structured evidence** about who feels the problem,
which framing they recognize, what they expect the product to do, and what they would pay
for. Signup volume is an input to that evidence, not the goal.

**DEC** Scope is deliberately tiny: one landing page, one two-step registration flow, one
confirmation page, four to six durable SEO/AEO content pages, variant instrumentation, and
an operator-only registration review. Nothing else ships in v1.

**HYP (H0, the master hypothesis)** As coding agents commoditize, the binding constraint
for serious AI-assisted builders shifts from *writing code* to *deciding, sequencing,
supervising, and verifying work* — and a meaningful number of them will pay for a system
that holds that layer.

**EVID that would justify continued investment** ≥100 qualified registrations where ≥40%
self-describe the orchestration/supervision bottleneck *in their own words* before seeing
our framing, ≥5 early-access testers who complete a real install and return structured
feedback, and ≥3 unprompted willingness-to-pay signals at or above a credible price point.

**EVID that would justify repositioning or stopping** High traffic with low qualified
conversion; qualified registrations that overwhelmingly want a *coding agent* rather than a
governance layer; or early-access testers who install and do not return.

---

## 2. Problem

**FACT (observable in the market)** Capable coding agents are now numerous, cheap relative
to engineering labor, and increasingly interchangeable. Switching between them is a
configuration change, not a migration.

**HYP (H1) — The bottleneck moved.** For people running several agent sessions across
several repositories, the scarce resource is no longer code production. It is:

- deciding what should be built next, and why, against real business priorities;
- keeping plans, issues, bugs, and half-finished branches coherent;
- supervising autonomous work without becoming its full-time project manager;
- verifying that what an agent claims it did actually happened;
- carrying context across sessions, agents, and days without re-explaining everything.

**HYP (H2) — The pain is felt as overhead, not as a missing tool.** The symptom people
report is "I spend more time managing agents than building." They may not have a name for
the category, which is both the SEO opportunity and the positioning risk.

**HYP (H3) — Existing answers are adjacent but not aimed here.** Coding agents execute.
Orchestration frameworks route and parallelize. Issue trackers store intent but do not
govern execution. None of them decide *what is next* against a maintained view of intent,
or hold evidence that approved work actually completed.

**EVID required** Unprompted free-text on the registration form naming coordination,
prioritization, supervision, or verification — not "I want a better agent."

---

## 3. Product Hypothesis

**HYP (H4) — The product hypothesis the site tests**

> A single governed layer that converts human intent into prioritized, inspectable,
> agent-executable work — and verifies the result — is worth paying for by people who
> already run multiple AI coding sessions.

Sub-hypotheses the site is instrumented to separate:

| ID | Hypothesis | How the site tests it |
| --- | --- | --- |
| H5 | The problem is *recognizable* without education | Bounce/scroll depth on hero variants; time-to-CTA |
| H6 | "Mission Control" is the resonant frame | Terminology EXP-2 variant conversion |
| H7 | Prolific multi-project builders convert best | Segment conversion by `active_projects` and `role` |
| H8 | Governance/verification is desired, not just orchestration | Capability ranking question in step 2 |
| H9 | Users want to grant meaningful autonomy under gates | Autonomy-comfort question; correlation with intent |
| H10 | Buyers want hosted, not just local software | Delivery-preference question + pricing EXP-5 |
| H11 | There is willingness to pay above $0 | Priced early-access EXP-6 |
| H12 | High-quality testers are recruitable at this stage | Early-access qualification completion rate |

**DEC** Every one of these is written on the site as a question we are answering *with*
early users, not as a claim we have already proven.

---

## 4. Target Users

**DEC — Initial focus (v1 messaging aims here):**

- **Prolific solo builders / indie developers** running 2+ active products with AI agents.
- **Technical founders** who are the bottleneck between product direction and execution.
- **Small software businesses (2–15 engineers)** adopting agents faster than their process.

**Secondary (tracked, not targeted in v1 copy):**

- Consultants and agencies juggling multiple client repositories.
- Platform/DevEx engineers evaluating agent governance for a larger org.
- Autonomous-agent experimenters and tool builders (high signal, low willingness to pay).

**Explicit anti-audience (stated on the page — see §10.8):**

- People looking for a better code-generating agent.
- People with one repo, one project, and no coordination pain.
- Enterprises needing SSO, audit certification, or procurement-grade security today.

**EVID required** Conversion rate and qualified-rate *by segment*, not in aggregate. A
segment converts "qualified" only when it reports ≥2 active projects and ≥weekly
AI-assisted development.

---

## 5. Jobs to Be Done

Written as the visitor would say them. The landing page must echo at least three verbatim.

1. "Tell me what to work on next, and why, without me rebuilding the whole picture first."
2. "Keep five agent sessions from stepping on each other and on my main branch."
3. "Let work continue while I'm away, but stop at the decisions that are actually mine."
4. "Show me evidence the work is really done, not an agent's summary of itself."
5. "Stop making me re-explain my project to every new session."
6. "Turn a vague idea into a plan something can actually execute."
7. "Keep my agents pointed at what matters to the business, not at whatever is easiest."

**EVID required** Which of these visitors select when asked "which of these is most true for
you?" — a low-friction, high-signal question placed in registration step 2.

---

## 6. Positioning Hypotheses

**DEC** No final positioning is chosen before launch. The site ships with a variant set and
picks a winner on evidence.

**Candidate P1 (default / control)**
> Your coding agents can build software. Mission Control decides what they should build
> next — and keeps the work moving.

**Candidate P2 — Category claim**
> Mission control for AI software production.

**Candidate P3 — Operating-system frame**
> An operating system for AI-assisted product development.

**Candidate P4 — Role-shift frame**
> Stop prompting agents. Start operating a production system.

**Candidate P5 — Governance/verification frame**
> Turn intent into verified software. Autonomous execution, human authority over what
> matters.

**Candidate P6 — Pain-first frame**
> You hired five coding agents and became their project manager. Fix that.

**DEC** P1 is control. P4 and P6 are the highest-variance challengers and are tested first.
**EVID** Qualified-conversion rate per variant, minimum 250 sessions per arm before any call
(see §13 for the honest-statistics constraint at this traffic volume).

---

## 7. Product Principles

1. **Honesty is the differentiator.** No invented testimonials, customer counts, revenue,
   adoption, or productivity statistics. Where we have no proof, we say what we are testing.
   A visitor who later becomes a tester must find nothing they were misled about.
2. **Evidence over impressions.** Every section earns its place by producing a measurable
   signal or removing a measurable objection.
3. **Small and reversible.** Prefer a copy change over a feature. Prefer a question over a
   build. Nothing in v1 should take more than a day to undo.
4. **Sell the problem and the direction, not a finished feature list.**
5. **Respect the visitor's time.** The whole landing page should be readable in 90 seconds.
6. **Participation as the offer.** The invitation is to help determine what this becomes.
7. **Boring technology.** This site must never become a second software project.

---

## 8. MVP Scope

**DEC — In scope (v1, target: shippable in ~3–5 focused days):**

| # | Item | Why it is in the 20% |
| --- | --- | --- |
| 1 | One landing page, variant-driven hero/terminology | The entire positioning test |
| 2 | Registration step 1 — email + 3 required fields | Converts attention into contact |
| 3 | Registration step 2 — progressive profiling, skippable | Converts contact into evidence |
| 4 | Confirmation page with early-access opt-in + interview slot link | Separates interest from commitment |
| 5 | Transactional confirmation email | Deliverability proof + trust |
| 6 | 4–6 static SEO/AEO pages + `/faq` | Durable acquisition, answer-engine legibility |
| 7 | Variant assignment + attribution stored on each registration | Makes every experiment readable |
| 8 | Operator review: registration list, filters, CSV export | Turns rows into decisions |
| 9 | Pricing-research section (no checkout) | Price signal without a billing system |
| 10 | Privacy page + minimal trust language | Prerequisite for asking about repos |

**DEC — Explicitly deferred (with triggers, per "if not now, then when?"):**

| Deferred | Trigger that reactivates it |
| --- | --- |
| Real payment collection | First 3 unprompted "I would pay for this today" signals |
| Public product demo/video | First stable end-to-end Arcadia flow that survives a cold run |
| User accounts / login | First tester who needs to return to their own data |
| Blog / CMS | Fifth content page written, or first organic ranking |
| Community (Discord/forum) | ≥10 active early-access testers |
| Changelog / roadmap page | First shipped change an outside user is waiting on |

---

## 9. User Journey

```
Source (HN / X / newsletter / search / direct invite)
  → Landing (variant assigned, stored in cookie + first-party event)
  → Scroll: problem → approach → workflow → use cases → who it's for → pricing research → FAQ
  → CTA: "Join the waitlist"
  → Step 1 (30 seconds): email, role, active projects, agents used            [REQUIRED]
  → Submitted → row written, confirmation email queued                        [COMMITMENT #1]
  → Step 2 (90 seconds, skippable): biggest problem, desired outcome,
      capability ranking, autonomy comfort, delivery preference, price signal  [OPTIONAL]
  → Confirmation page:
      • "You're on the list" + what happens next, honestly stated
      • Early-access opt-in (explicit, higher commitment)                      [COMMITMENT #2]
      • Interview booking link for those who opt in                            [COMMITMENT #3]
  → Email: confirmation now; low-frequency honest updates thereafter
  → (Later) Early-access invitation → install → structured feedback → UAT loop
```

**DEC** Step 1 writes the row *before* step 2 is offered. A visitor who abandons step 2 is
still a registration, and abandonment itself is a measured signal.

---

## 10. Landing Page Requirements

One page. Target ≤1,400 words of body copy. Every section below is required in v1 unless
marked optional.

**10.1 Hero** — Positioning variant headline, one-sentence subhead naming the audience
("for people running more than one AI-assisted project"), primary CTA, and one line of
honest status: *"Arcadia is real software in active development. It is not finished, and
early users help decide what it becomes."* No logos, no counters, no social proof.

**10.2 The emerging problem** — 3–5 short lines in the visitor's voice (drawn from §5). The
job of this section is recognition, not persuasion. Success looks like "how do you know
about my Tuesday."

**10.3 How Mission Control approaches it** — Four short blocks, each naming a *mechanism*,
not a benefit: maintained intent; governed decisions and approval gates; a prioritized
queue that answers "what next"; evidence that an action actually completed.

**10.4 The workflow** — One diagram, semantic and accessible (inline SVG with a text
equivalent), of Intent → Decision → Plan → Prioritized Action → Governed Execution →
Evidence → Adaptation. This is the single strongest asset for AEO: it is the concrete,
quotable model of what Arcadia is.

**10.5 Example use cases** — Three concrete scenarios, written as narratives, clearly
labelled as *what Arcadia is built to do*, not as case studies: (a) five concurrent agent
sessions across three repos, (b) a week away with work continuing under gates, (c) a vague
idea becoming an executable plan with acceptance criteria.

**10.6 Expected relationship with coding agents** — Explicit: Arcadia does not replace
Claude Code, Codex, or OpenCode. It decides what they work on, holds the session and
worktree discipline around them, and verifies what came back. **This section doubles as the
key AEO differentiator** (see §15).

**10.7 What early access means** — Plain terms: what you get, what we ask, what we do not
promise. Links to §12's program page content (may be inline).

**10.8 Who it is for / who it is not for** — Two honest columns. The "not for" column is a
qualification instrument: it should visibly cost us signups we do not want.

**10.9 Experimental capabilities** — Labelled clearly as in-development or planned, with
status tags (`working`, `in progress`, `planned`, `exploring`). **Constraint:** any item
tagged `working` must actually work in the dogfooded system today.

**10.10 Pricing research** — Not a pricing table. A short section: "We don't know what this
should cost yet. Here's what we're considering — tell us what's credible." Links into the
price question in step 2, or presents a variant-driven price card (see §14).

**10.11 FAQ** — 8–10 questions, answered in 40–80 words each, marked up as `FAQPage`
structured data. Doubles as the AEO surface.

**10.12 Closing CTA** — Repeat of hero CTA with the honest-status line restated.

**Non-functional:** LCP < 1.5s on 4G mobile, no layout shift, works without JavaScript for
reading (JS only for variant assignment and form enhancement), WCAG 2.2 AA, mobile-first.

---

## 11. Registration & Qualification

**DEC — Step 1 — all four fields are required.** This is the single required-field
contract referenced by §8, §9, the form validation, the `signup_completed` event, and the
qualification definition below. `active_projects` in particular cannot be optional, because
qualification is defined on it.

| Field | Type | Purpose |
| --- | --- | --- |
| `email` | email, **required** | Contact |
| `role` | select, **required**: indie dev / technical founder / small-team lead / consultant-agency / platform-DevEx / other | Segmentation (H7) |
| `active_projects` | select, **required**: 1 / 2–3 / 4–6 / 7+ | Primary qualification axis (H7) |
| `agents_used` | multi-select, **required** (≥1, "none yet" is a valid answer): Claude Code / Codex / Cursor / OpenCode / Copilot / Aider / other / none yet | Integration priority + seriousness proxy |

**DEC — Step 2 (optional, progressive, skippable at any point):**

| Field | Type | Purpose |
| --- | --- | --- |
| `ai_dev_frequency` | daily / several times a week / weekly / occasionally | Qualification |
| `biggest_problem` | free text, 2–3 lines, **placed before any of our framing is repeated** | H2 evidence; the single most valuable field |
| `desired_outcome` | free text | Distinguishes throughput seekers from control seekers |
| `top_jobs` | pick up to 2 from §5 list | H8 |
| `capability_ranking` | rank/pick 3 of ~8 capability statements | Feature emphasis evidence |
| `autonomy_comfort` | 1–5 scale, anchored in plain language | H9 |
| `delivery_preference` | local/self-hosted / hosted service / either / unsure | H10 |
| `price_expectation` | select bands + "I wouldn't pay for this" | H11 |
| `interview_willing` | yes / no | UAT recruiting |
| `install_willing` | yes / no / depends | Early-access qualification (H12) |
| `company_size` | select | Secondary segmentation |

**DEC — Qualification definition (used everywhere "qualified" appears in this PRD):**
A registration is **qualified** when `active_projects ≥ 2` **and** `ai_dev_frequency ≥
weekly` **and** `biggest_problem` is non-empty and substantive. This definition is fixed
before launch so it cannot be moved to flatter the numbers.

**Anti-friction rules:** all four required fields are a single tap each — no phone, no
company name, no required free text in step 1, no
CAPTCHA unless abuse appears (rate-limit + honeypot first), and step 2 shows progress and an
explicit "skip — you're already on the list."

**EVID required** Step-1 completion rate ≥25% of CTA clicks; step-2 *start* rate ≥50% of
step-1 completions. Lower means the form is the problem, not the message.

---

## 12. Early Access Program

**DEC — Two distinct tiers, never conflated in copy or in data.**

**Waitlist (low commitment)** — Email + step 1. Gets: occasional honest progress notes, and
first notice when access opens. Asked for: nothing.

**Early Access (high intent)** — Explicit opt-in on the confirmation page.

*Qualification criteria (all must hold):*
- ≥2 active software projects and ≥weekly AI-assisted development;
- already using at least one coding agent seriously;
- willing to install/run experimental software in a real (non-critical) repository;
- willing to do one 30–45 minute interview;
- able to articulate a current orchestration problem in their own words.

*What participants receive:*
- direct access to the builder, and real influence over what gets built;
- hands-on setup help for the first repository (this is also our highest-value learning);
- free use through the early-access period, with pricing decided transparently afterwards;
- named credit as an early contributor, if they want it.

*What we ask:*
- one structured feedback form after first real use;
- bug reports and workflow observations as they occur;
- one interview at start, one after ~2 weeks of use;
- honesty when it does not work.

*What we do not promise:* stability, data durability across versions, support SLAs,
continuity of any feature, or that the product will ever exist commercially.

**DEC** Cap early access at **10–15 participants** initially. Learning quality over volume:
a cohort we cannot personally support produces no evidence.

**EVID required** Of those who opt in, what fraction actually install and return feedback.
That ratio — not the opt-in count — is the real H12 measurement.

---

## 13. Messaging Experiments

**DEC — This table is the canonical experiment registry.** Every `EXP-#` used anywhere in
this document is defined here exactly once, including the three whose detail lives in other
sections (EXP-6 and EXP-9 in §14, EXP-8 in §25). No identifier is reused.

**DEC** Build the smallest possible experiment mechanism: a variant chosen per-visitor at
first load from a fixed list, persisted in a first-party cookie for 30 days, stamped onto
every event and every registration row. **No third-party A/B platform. No feature-flag
service. No client-side flicker** — variants are resolved server-side or at the edge and
rendered in the HTML.

| ID | Tests | Variants | Primary metric |
| --- | --- | --- | --- |
| EXP-1 | Hero positioning | P1 (control), P4, P6 | Qualified registrations / session |
| EXP-2 | Terminology | "Mission Control" vs "operating system for AI development" vs "governed autonomous development" | Qualified conv. + step-2 start rate |
| EXP-3 | Audience callout | "for indie builders" vs "for technical founders" vs none | Qualified rate by segment |
| EXP-4 | CTA wording | "Join the waitlist" vs "Request early access" vs "Help shape it" | CTA click → step-1 completion |
| EXP-5 | Autonomy promised | "runs while you sleep" vs "never acts without your approval" vs balanced | Qualified conv.; autonomy_comfort mix |
| EXP-6 | Price credibility (detail in §14) | $29/mo anchor vs $99/mo anchor vs "we don't know yet" | Conv. delta + price-band selection |
| EXP-7 | Feature emphasis | prioritization-led vs verification-led vs session-management-led | Capability ranking + conv. |
| EXP-8 | Naming (detail in §25 #1) | "Arcadia Mission Control" vs "MartianRover Arcadia Cloud" | Qualified conv. + delivery_preference mix |
| EXP-9 | Delivery model (detail in §14) | hosted-led vs "your machine, your repos, your data" | Qualified conv. + delivery_preference mix |

**Honest-statistics constraint (important at our traffic volume):** at a few hundred
sessions per arm, only *large* effects are detectable. **DEC** An *arm count* in this document always includes the control arm. We will (a) run at
most **two concurrent experiments**, (b) require ≥250 sessions and ≥15 qualified registrations per arm
before reading a result, (c) treat differences under ~50% relative as *not measured*, and
(d) weight qualitative free-text evidence more heavily than variant deltas until volume
supports otherwise. A variant test that cannot reach these thresholds is a directional
signal, and the PRD says so rather than pretending to significance.

**EVID required** Every registration row carries `variant_set`, `source`, `referrer`,
`utm_*`, and `landing_path`. A registration that cannot be attributed to a message is a
missing data point, and attribution coverage should exceed 95%.

---

## 14. Pricing Experiments

**DEC** Pricing is discovery, not a commercial decision. **No checkout ships in v1.**

**DEC (2026-09-22)** Open Decision §25 #5 settled the posture as **open core plus a paid
hosted service**, which this section was explicitly waiting on. The structures below stay
listed because the site still asks about them, but the field has narrowed: the local core
is intended to be free and open, so the realistic revenue candidates are the **hosted
service**, a **setup/onboarding package**, and a **founder-assisted program**. Per-project
and usage-based pricing remain plausible, but as shapes for the hosted tier rather than for
the software itself. §25 #6 separately settled that early access is **free**, so no price is
charged during the learning period and level-4 evidence is deliberately deferred.

**Structures under consideration (shown or tested, never presented as final):**

| Structure | What it would mean | Evidence that supports it |
| --- | --- | --- |
| Free developer preview | Adoption-first, monetize later | High install rate, low price tolerance |
| Paid early access (one-time, ~$100–300) | Filters for real intent | Anyone actually paying pre-product |
| Monthly subscription ($20/$50/$100 tiers) | Standard SaaS | Band selection clustering + stated frequency |
| Per-project pricing | Scales with the pain we claim | Multi-project users preferring it over flat |
| Usage-based | Aligns with agent spend | Users who already track agent token spend |
| Open-source core + paid hosted service | Trust + distribution, revenue on convenience | Strong self-host preference *and* hosted willingness |
| Hosted Mission Control | Lowest friction, highest trust burden | Hosted preference in `delivery_preference` |
| Onboarding/setup package ($500–2,000) | Monetizes the hardest part first | Repeated "help me set this up" in free text |
| Founder-assisted program | Highest-touch, highest learning | Interview acceptance + willingness to schedule |

**EXP-9 (delivery model)** — Variant landing copy emphasizing *hosted* vs *your machine,
your repos, your data*. Metric: qualified conversion and `delivery_preference` distribution.

**EXP-6 (price credibility)** — Variant pricing-research card showing a candidate anchor
($29/mo vs $99/mo vs "we don't know yet — tell us"). Metric: conversion delta and price-band
selection. **Ethical constraint:** every variant is framed as a *candidate under
consideration*, never as an active price. No fake discount, no fake deadline, no fake
scarcity, no "price goes up soon."

**Strongest possible pre-product price evidence, in ascending order of weight:**
1. Selecting a price band in a form (weak — costs nothing).
2. Unprompted mention of budget or current agent spend in free text (moderate).
3. Agreeing to a paid pilot conversation (strong).
4. Actually paying for early access or a setup package (decisive).

**EVID required** At least 3 signals at level 3 or above before any pricing page ships.

---

## 15. SEO/AEO Strategy

**DEC** No blog. Four to six *durable, answer-shaped* pages that will still be correct in a
year, plus the FAQ.

**Proposed pages (each ~800–1,500 words, each answering one question completely):**

1. `/how-to-manage-multiple-ai-coding-agents` — the highest-intent practical query.
2. `/ai-coding-agent-orchestration` — category page; defines the term and distinguishes
   *orchestration* (routing/parallelizing execution) from *governance* (deciding and
   verifying).
3. `/governed-autonomous-development` — the concept page; the workflow model in prose.
4. `/coding-agent-session-management` — worktrees, branch safety, context continuity; the
   most concrete and most searchable operational pain.
5. `/ai-software-development-workflow` — Intent → … → Adaptation as a reusable model,
   written to be quotable by answer engines.
6. `/vs` *(optional, v1.1)* — how Mission Control differs from coding agents, from
   orchestration frameworks, and from issue trackers.

**AEO requirements — the site must let a model state, unambiguously and from a single
page each:**

- **What Arcadia is:** a governance and prioritization layer for AI-assisted software
  production.
- **What problem it solves:** deciding what agents should build next and verifying that
  approved work completed.
- **How it differs from a coding agent:** it does not generate code; it directs and verifies
  the agents that do.
- **How it differs from orchestration frameworks:** those route execution; Arcadia governs
  intent, approval, priority, and evidence.
- **Who it is for:** people running multiple AI-assisted projects who are the bottleneck.

Each of these gets a short, self-contained, directly quotable paragraph — answer engines
extract passages, not pages.

**Structured data (JSON-LD):** `Organization`, `SoftwareApplication` (with honest
`applicationCategory` and no fabricated `aggregateRating`), `FAQPage` on the FAQ,
`WebSite` + `SearchAction` only if search exists, `BreadcrumbList` on content pages.

**Technical fundamentals (no more):** server-rendered or fully static HTML; one `<h1>` per
page; semantic headings; descriptive `<title>` and meta description per page; canonical
URLs; OG/Twitter cards; `sitemap.xml`; a permissive `robots.txt` that explicitly allows
reputable answer-engine crawlers; `llms.txt` describing the site in plain text; fast LCP;
no client-side-only content.

**EVID required** Indexation of all content pages within 14 days; first organic qualified
registration within 60 days; and — the AEO test — asking three major assistants "how do I
manage multiple AI coding agents?" and observing whether the site is retrievable and
correctly summarized.

---

## 16. Analytics & Evidence Model

**DEC** Privacy-conscious, first-party, cookieless-where-possible analytics (Plausible,
Fathom, or a self-hosted equivalent). No Google Analytics, no ad pixels, no session
recording of form fields, no cross-site tracking.

**Event taxonomy (complete — do not add without deleting something):**

| Event | Properties |
| --- | --- |
| `landing_view` | variant_set, source, referrer, utm_*, path |
| `section_view` | section_id (workflow, pricing, who-its-for, faq) |
| `cta_click` | cta_id, position (hero/mid/footer), variant_set |
| `signup_started` | variant_set |
| `signup_completed` | role, active_projects, agents_used, variant_set |
| `qualification_started` | — |
| `qualification_completed` | completeness (fields answered / offered) |
| `qualification_skipped` | last_field_seen |
| `early_access_opt_in` | qualified (bool) |
| `interview_accepted` | — |
| `pricing_interaction` | price_variant, band_selected |
| `content_page_view` | page, source |
| `early_access_activated` | *(deferred until access opens)* |

**The funnel, named honestly:**

| Stage | Meaning | Primary measure |
| --- | --- | --- |
| **Attention** | Someone arrived | Sessions by source |
| **Interest** | They read and scrolled to the workflow or use cases | `section_view` depth ≥60% |
| **Intent** | They started the form | `signup_started` / `cta_click` |
| **Commitment** | They gave an email, then answered research questions, then opted into early access | Three distinct rates |
| **Usage** | They installed and ran Arcadia | *(post-launch)* activation rate |
| **Retention** | They came back and used it again | *(post-launch)* week-2 return |

**Decision metrics — the small set that determines what we do next:**

1. **Qualified conversion rate** (qualified registrations / sessions). *Continue* above ~2%;
   *reposition* below ~0.5% with meaningful traffic.
2. **Problem-recognition rate** (share of `biggest_problem` free text describing coordination
   /prioritization/supervision/verification without our prompting). This is the truest read
   on H1–H2.
3. **Early-access activation rate** (installed / opted in). The honesty check on all stated
   interest.
4. **Interview acceptance rate.** The cheapest proxy for real pain.
5. **Willingness-to-pay signal count** at evidence level 3+ (§14).

**Vanity metrics explicitly not tracked as goals:** raw pageviews, total email count, social
impressions, time-on-page absent scroll depth.

---

## 17. UAT / Feedback Loop

**DEC** The website is the front door of the testing program; the testing itself happens in
Arcadia and in direct conversation. Keep the site's role to recruiting, scheduling, and one
structured intake.

**Feedback channels (v1, minimal):**

- **Structured first-use form** (a single hosted form, linked from the invitation email):
  what you tried, what you expected, what happened, where you got stuck, what you'd do next.
- **Bug reports** → GitHub Issues in the owning repository, per the Arcadia Way. The
  invitation email tells testers exactly where.
- **Workflow observations** → a short recurring prompt ("what did you do manually this week
  that Arcadia should have done?").
- **Expectation-vs-reality** → one question asked twice: at signup ("what do you expect this
  to do for you?") and after two weeks ("what did it actually do?"). The delta between those
  two answers is the highest-value artifact this whole program produces.
- **Interviews** → 30–45 minutes, booked from the confirmation page, recorded with consent,
  notes synthesized into the Arcadia Project record.

**What UAT must specifically measure (the core Arcadia claim):**

- **Operator work reduced?** Self-reported time spent coordinating agents, before and after.
- **Throughput improved?** Actions completed per week, measured from Arcadia's own records —
  not self-report.
- **Governance preserved?** Did anything ship that the operator did not approve, and did the
  operator ever feel out of control or surprised?

**FACT** All three of the above are currently unmeasured. The PRD asserts nothing about
their values; it specifies how they will first be observed.

---

## 18. Technical Architecture

**DEC — Recommended stack (boring, cheap, fast, exportable):**

| Concern | Choice | Rationale |
| --- | --- | --- |
| Framework | **Astro** + TypeScript | Static/SSR HTML by default, near-zero JS, excellent SEO, trivial to keep small. (Next.js is an acceptable alternative given existing familiarity — see Open Decisions.) |
| Styling | Tailwind, or plain CSS with custom properties | Speed; no design system needed at this size |
| Hosting | Cloudflare Pages (+ Workers for the form endpoint) | Free/near-free, fast globally, no lock-in on static output |
| Variant assignment | Cloudflare Worker / Astro middleware, cookie-persisted | Server-resolved, no flicker, no third-party platform |
| Registration storage | **Cloudflare D1 (SQLite)**, one `registrations` table + one `events` table | Familiar SQLite; trivially exportable; matches Arcadia's own storage model |
| Email | Cloudflare Email Service, Resend, or Postmark | Transactional confirmation only; no marketing automation |
| Analytics | Plausible / Fathom (hosted) or self-hosted alternative | Privacy-conscious, cookieless, cheap |
| Operator review | A single password-protected `/ops` route: table, filters, CSV export | Smallest possible thing that turns rows into decisions |
| Forms | Progressive enhancement — native HTML POST that works without JS | Accessibility + resilience |
| Abuse control | Honeypot field + rate limiting; Turnstile only if abuse appears | Avoid friction until needed |

**Hard constraints:**
- Total JS shipped to the landing page: **< 20 KB** gzipped.
- No CMS, no database migrations tooling beyond a single SQL file, no build step beyond the
  framework's own.
- **Data export must be one command or one button** from day one. Every registration row and
  every event must be exportable as CSV/JSON. Vendor lock-in is measured as "how long to move
  this site and its data" — the answer must stay under a day.
- The entire site should be deployable from a single repository with a single command, and
  should cost under ~$10/month at expected volume.

**Non-goal reinforced:** this site must not accumulate framework surface area. Any proposed
addition that requires a new service, a new database, or a new build stage is deferred by
default.

---

## 19. Privacy & Trust

**FACT** Arcadia has no security certifications, no formal audit, no SOC 2, and no
enterprise security program. The site will not imply otherwise.

**DEC — Minimum required at this stage:**

- A short, human-readable privacy page: what we collect (email + your answers + basic
  analytics), why (to decide what to build and who to talk to), how long (until you ask us
  to delete it), and how to get deleted (one email address, honored within 7 days).
- **A named processor list is required, not a blanket claim.** Data is seen by MartianRover
  **and by the named processors below, and nobody else.** The privacy page must name each
  one and the data it receives, and must be updated whenever §18's stack choices change:

  | Processor | Data it receives |
  | --- | --- |
  | Cloudflare (Pages, Workers, D1) | Hosting and storage of every registration row and event; request metadata including IP at the edge |
  | Transactional email provider (Cloudflare Email Service / Resend / Postmark — whichever §18 selects) | Email address and delivery metadata for the confirmation email only |
  | Analytics provider (Plausible / Fathom, or self-hosted) | Aggregate, cookieless page and event data; no email address and no free-text answers |
  | Interview scheduling tool, *if* Open Decision §25 #7 selects one | Name and email of people who book an interview |
- **No selling, sharing, or enriching data.** Stated plainly.
- No third-party trackers or ad pixels. Cookieless analytics. The only cookie is the variant
  cookie, and it is first-party and functional.
- **Clear boundary statement on the landing page:** the website collects no code, no
  repository access, and no credentials. Arcadia itself runs locally, on the operator's own
  machine and repositories.
- **Honest forward-looking trust language for the eventual product:** state the *design
  intent* — local-first, operator-owned data, approval gates for consequential actions, no
  autonomous spend or deployment without explicit authorization — and explicitly label it as
  design intent for a system in development, not a certified guarantee.
- GDPR-shaped basics because they are cheap and right: explicit consent language at the
  form, no pre-checked boxes, easy unsubscribe, and a real deletion path.

---

## 20. Success Metrics

Milestones are **evidence gates**, not vanity thresholds. Each names what it would take to
justify continuing.

**Gate A — First 25 qualified registrations**
- *Supports continuing if:* ≥40% describe the coordination/supervision/verification problem
  unprompted; ≥30% report 4+ active projects; ≥5 accept an interview.
- *Suggests repositioning if:* most want a better coding agent, or most have one project.
- *Action either way:* run 5 interviews before writing another line of product code.

**Gate B — First 100 qualified registrations**
- *Supports continuing if:* qualified conversion ≥2%; one positioning variant shows a large
  (≥50% relative) advantage; a clear top-two capability emerges from the ranking; ≥15
  early-access opt-ins.
- *Suggests narrowing if:* one segment converts 3× better — narrow the site to that segment.
- *Suggests stopping/repositioning if:* volume arrives but qualified rate stays under 0.5%.

**Gate C — First 5 serious early-access testers**
- *Definition of "serious":* installed Arcadia, used it on a real repository for ≥3 sessions,
  and returned structured feedback.
- *Supports continuing if:* ≥3 of 5 report the tool changed what they worked on next.
- *This is the single most important gate in the document.* Registrations are cheap;
  installation is not.

**Gate D — First active users (week-2 return)**
- *Supports continuing if:* ≥50% of activated testers use it again in week 2 unprompted.
- *Suggests a product problem, not a market problem, if:* they install, praise it, and stop.

**Gate E — First willingness-to-pay signals**
- Target: ≥3 evidence-level-3+ signals (§14) within the first 100 qualified registrations.

**Gate F — First actual payment**
- Any real money — paid early access, a setup package, or a pilot — is the first
  non-speculative evidence in this entire document, and it reframes everything after it.

**DEC** Registration volume alone never advances a gate. Each gate requires a *qualitative*
condition alongside its count.

---

## 21. Non-Goals

Explicitly out of scope. Each would be a mistake at this stage, not merely a later item.

1. **Building any part of the Arcadia product through this website.** The site recruits and
   learns; the product lives in its own repository.
2. **Generalized user accounts, login, or profiles.** Nobody needs to return to data here yet.
3. **Social or community features.** No forum, no comments, no public member list.
4. **Customer dashboards.** `/ops` is an operator table, not a product surface.
5. **A CMS or content publishing platform.** Six static pages in the repo.
6. **A blog with a posting cadence.** Cadence obligations outlive their usefulness.
7. **Billing, subscriptions, or checkout.** Deferred until Gate E.
8. **A generalized A/B testing framework.** Two concurrent hardcoded variant sets, no more.
9. **Enterprise features** — SSO, SCIM, audit logs, compliance pages, procurement collateral.
10. **Polishing speculative product features before demand exists.** No screenshots or demos
    of things that do not work, at all, ever.
11. **Fabricated social proof of any kind** — testimonials, counts, logos, statistics,
    "trusted by", or implied adoption.
12. **A design system, brand guidelines, or illustration commission.** One typeface, one
    accent color, one diagram.

---

## 22. Risks & Unknowns

| Risk | Nature | Mitigation / what would reveal it |
| --- | --- | --- |
| The category has no recognition yet | **HYP** | Lead with the pain, not the category name; measure unprompted problem language |
| Audience is small (people running many AI projects) | **HYP** | Even a small TAM may support a high-touch product; measure price tolerance early, not volume |
| Agent vendors absorb this layer | **HYP**, plausible | Positioning stays agent-neutral; neutrality is the defensible ground if it happens |
| Traffic too low for statistical experiments | **FACT** at launch | Weight qualitative evidence; run few, large-contrast experiments (§13) |
| Registrations skew to experimenters who never pay | **HYP** | Qualification definition weights active projects and frequency, not enthusiasm |
| Honesty constraint reduces conversion vs. competitors' hype | **HYP**, accepted | We accept lower volume for higher truth; the tester cohort is what matters |
| The site becomes a software project | **RISK, known failure mode** | Hard constraints in §18; non-goals in §21; any addition needs a deletion |
| Arcadia isn't ready when testers arrive | **RISK, real** | Gate early-access invitations on a cold-start install actually working; a waitlist can wait, a disappointed tester cannot |
| Legal/privacy exposure from research data | **Low** | Minimal collection, clear consent, real deletion path |
| Builder time is the scarcest resource | **FACT** | 3–5 day build cap; anything longer is descoped, not extended |

---

## 23. Launch Sequence

| Phase | Work | Exit condition |
| --- | --- | --- |
| **0 — Decide** (0.5 day) | Settle the Open Decisions in §25; write final v1 copy for hero variants P1/P4/P6 | Copy approved; framework chosen |
| **1 — Build** (2–3 days) | Landing page, two-step form, confirmation page, email, D1 schema, variant middleware, `/ops` table + CSV | All events fire; a test registration round-trips end to end |
| **2 — Content** (1 day) | 4 SEO/AEO pages + FAQ + privacy page, JSON-LD, sitemap, `llms.txt` | Pages pass a read-aloud test: a model can answer the five §15 questions from them |
| **3 — Quiet launch** (3–5 days) | Deploy; share with 10–20 people directly; watch the funnel; fix friction | ≥5 registrations from direct sharing; no broken steps |
| **4 — Public launch** | HN / X / relevant newsletters / dev communities, with an honest "building this in the open" framing | Gate A reached |
| **5 — Learn** (ongoing) | Run EXP-1 and EXP-4 first; interview every willing registrant; synthesize into the Arcadia Project record | Gate B reached; positioning decided on evidence |
| **6 — Open early access** | Only once a cold-start Arcadia install works end to end for someone who is not the builder | Gate C reached |

**DEC** Phase 6 is gated on the product, not the calendar. Inviting testers into a broken
install destroys the scarcest asset this program has.

---

## 24. Definition of Done (v1)

The website is done when all of the following are true:

1. A visitor on a phone can read the entire landing page and understand — without prior
   context — what Arcadia is, what problem it solves, how it relates to their coding agents,
   and whether it is for them.
2. A visitor can complete registration step 1 in under 30 seconds, and step 2 in under 90.
3. Every registration row carries its variant set, source, and attribution, with >95%
   coverage.
4. All **twelve pre-launch** events in §16 fire correctly and are verifiable in the
   analytics tool. The thirteenth, `early_access_activated`, is deferred until access opens
   and is excluded from this count.
5. A confirmation email arrives within 60 seconds and does not land in spam for the three
   major providers.
6. The operator can open `/ops`, filter to qualified registrations, read the free-text
   answers, and export everything to CSV.
7. Lighthouse: ≥95 performance on mobile, 100 accessibility, ≥95 SEO. LCP < 1.5s on
   simulated 4G.
8. Every page is server-rendered HTML, readable with JavaScript disabled.
9. JSON-LD validates; sitemap, robots.txt, and llms.txt are present and correct.
10. **The honesty audit passes:** a reviewer reads every word on the site and finds zero
    claims of results, customers, revenue, adoption, or productivity gains that have not
    occurred. Every forward-looking statement is labelled as such.
11. The privacy page is accurate about what is actually collected and stored.
12. EXP-1 is live with all three of its arms (P1 control, P4, P6) and EXP-4 with all three
    of its arms, correctly assigned and stamped on every registration. Those two are the
    maximum concurrent experiments §13 permits.
13. The whole site deploys from one repository with one command, and all data exports with
    one command.

---

## 25. Open Decisions

These need an answer before or during Phase 0. Each states its consequence.

**Four were settled by the operator on 2026-09-22** and are marked `DEC` below with the
reasoning. They are recorded here rather than left in a conversation because each one
changes what the site says or which experiments are worth running, and a decision that
lives only in a chat log gets made again, differently, in three months.

1. **Domain and naming.** Candidates: "MartianRover Arcadia Mission Control", "Arcadia
   Mission Control", "Mission Control", or **"MartianRover Arcadia Cloud"**. *Consequence:*
   determines the domain, every page title, all structured data, and the SEO surface —
   expensive to change after indexation. **Noted trade-off on the "Cloud" variant:** it names
   a deployment model rather than a value, and it pre-answers Open Decision #6 (hosted vs.
   local) in the direction that conflicts with the local-first trust language in §19 — which
   may itself be worth measuring. It is also strong as a future *hosted tier* name if the
   umbrella brand stays "Mission Control". **EXP-8 (naming):** run the leading two candidates
   as a landing-page naming variant under §13's rules, with qualified conversion and
   `delivery_preference` distribution as the metrics, and decide on evidence rather than
   instinct.
2. **Framework: Astro or Next.js?** *Consequence:* Astro ships less JS and is a better fit
   for a content site; Next.js reuses existing familiarity and the admin patterns already in
   Arcadia. Recommendation: Astro, unless operator velocity argues otherwise.
3. **Relationship to the Arcadia repository.** Same repo (a `site/` directory) or its own?
   *Consequence:* same repo shares CI and governance but couples the marketing cadence to
   product releases; separate repo keeps the site disposable. Recommendation: separate.
4. **DEC (2026-09-22) — Dogfooding is shown live to early-access candidates only.** Real
   Arcadia records — actual plans, Decisions, completion evidence from building Arcadia with
   Arcadia — are shown in the interview and the invitation, not published on the site.
   *Consequence:* full credibility at the point where it converts, with no public exposure
   of unfinished work and no curation pass before every publish. The cost is accepted
   knowingly: the landing page's claim stays a claim rather than evidence, so it does
   nothing for the conversion rate the experiments measure. *Revisit if:* qualified
   conversion stalls below 0.5% and interviews say the dogfooding story was what made it
   credible.
5. **DEC (2026-09-22) — Open core plus a paid hosted service.** The CLI and governance
   engine are intended to be public; the hosted Mission Control is the paid product.
   *Consequence:* this unblocks §14, which was explicitly waiting on it. The credible
   pricing structures narrow to a free and open local core, a paid hosted service, and a
   setup package; per-project and usage-based pricing stay plausible for the hosted tier
   only. It also strengthens §19 — the local-first, operator-owned-data claim becomes
   verifiable by reading the code rather than asserted, which matters for an audience that
   is rightly suspicious of closed software touching their repositories. What is sold
   becomes convenience and operation rather than capability, and that is the accepted
   trade. *Still open underneath this:* which licence, and where exactly the core/hosted
   line falls. Neither blocks the website.
6. **DEC (2026-09-22) — Early access is a free preview.** It costs nothing during the
   early-access period. *Consequence:* maximizes tester count and learning volume at the
   stage where learning is the entire point. Gate C needs five people who actually install,
   already the hardest number in §20 to reach, and charging now would shrink that pool
   against the one gate that matters most. The cost is that decisive willingness-to-pay
   evidence (§14 level 4) is deferred; §14's levels 2 and 3 carry the pricing signal until
   then. *Revisit when:* Gate C is met, or three unprompted "I would pay for this today"
   signals arrive first.
7. **Interview scheduling tool.** A booking link (Cal.com/Calendly) or manual email?
   *Consequence:* a booking link raises acceptance and adds a third-party dependency and one
   more privacy processor to disclose.
8. **DEC (2026-09-22) — Quiet ramp first, HN after Gate A.** Share directly with 10–20
   people, fix the friction that shows up, and let the first 25 qualified registrations tune
   the copy before spending the HN attempt. *Consequence:* HN is a one-shot asset, and
   spending it on untested copy wastes both the traffic and the only sample large enough to
   power EXP-1 to significance. This makes §23 Phase 3 a real gate rather than a formality:
   Phase 4 does not start until Gate A's qualitative condition is met, not merely its
   count.
