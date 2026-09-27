---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia add two capability modules, seo-audit and copywriting, built on a site-neutral engine that Private Practice Now originated, so any governed Project can measure its website and get honest, gated copy?
---

# SEO audit and copywriting capability modules

## What this asks

Arcadia would gain two capability modules. Each is the "agent" the operator
asked for:

- **`seo-audit`** measures a Project's public website on every revision,
  compares runs, and turns findings into Agent Asks.
- **`copywriting`** audits the copy already on a page against a contract, a
  claim ledger and a domain pack. Later it drafts candidate copy. Nothing it
  writes is published without the `publication` gate.

Both sit on a **site-neutral engine** that Private Practice Now (PPN) built
for therapist websites. PPN filed the matching request, and it merged as
`pmark/private-practice-now#178`
(`docs/proposals/generalize-copy-and-seo-engine.md` there). This document is
the Arcadia side of that request, and it asks for the Decision.

This proposal authorizes nothing by itself. It changes no code and opens no
Plan.

## Why Arcadia needs it

- **The problem is the Way's own problem.** An SEO audit alone is a
  commodity: Lighthouse, Ahrefs and Semrush already do it. The part worth
  offering is governed copy:
  - claims checked against a ledger of what is true
  - wording grounded in real audience evidence
  - a human gate before anything ships
  - measured runs that can be compared across revisions

  That is exactly what Arcadia does for code, applied to the page that
  explains the code.
- **Every Arcadia user will need it.** Arcadia's audience builds software
  with coding agents, and each of them eventually ships a launch page, a
  waitlist, and a claim about what works. Mission Control is the proof:
  arcadiamissioncontrol.com needed a copy and SEO audit before it could
  reliably turn visitors into sign-ups.
- **The engine has already travelled once.** On 2026-09-27, PPN's
  `@ppn/seo-audit` measured arcadiamissioncontrol.com with no code changes
  (`pmark/mission-control-site#52`, audit at
  `docs/audits/2026-09-27-copy-discoverability-conversion-audit.md` there).
  - It found a real defect in itself: JSON-LD wrapped in `@graph` is not
    read (`pmark/private-practice-now#177`).
  - Most of the copy findings were checks that PPN's section contracts
    already encode: hero length, a single sentence, audience-inappropriate
    jargon, inconsistent naming, and an unsupported claim.

## What we would build locally otherwise

Without this, each Project grows its own audit scripts and copy checklists,
and each one drifts. Mission Control's audit was done by hand, from a PPN
checkout. That is the drift this proposal exists to prevent.

## How it fits the existing Capability Contract v1

Arcadia already has a capability-module boundary: `src/capabilities/core.ts`
and `registry.ts`, proven by `blogging` and `rebuster`, and designed in
`docs/capabilities-blogging-v1-plan.md`. Both modules fit that contract
unchanged:

- a deterministic `CapabilityModule` object
- module-owned migrations
- commands with a declared permission and approval gates
- artifact types
- dashboard surfaces as query functions

**No new plugin mechanism is proposed.**

### `seo-audit` module

| Field | Proposed value |
| --- | --- |
| `id` / `version` | `seo-audit` / `0.1.0` |
| Commands | `seo_audit.register_site` (autonomous)<br>`seo_audit.record_run` (autonomous: ingest collector output, such as Lighthouse JSON plus rendered HTML, into an immutable, checksummed run)<br>`seo_audit.report` (autonomous, read-only)<br>`seo_audit.propose_actions` (requires_review: turns findings into Agent Ask drafts, and never self-approves) |
| Approval gates | None for measurement: it only reads public pages. Any Action a finding proposes carries its own gates. |
| Artifact types | `seo_audit_run`, `seo_audit_report`, `seo_finding` |
| Migrations | `seo_sites` and an index of runs and findings. The runs themselves stay in the engine's content-addressed store, so the database is an index and never a second copy of the truth. |
| Dashboard surface | Per-site scorecard: indexability label, score trend across comparable runs only, and open findings |
| Model use | None |

### `copywriting` module

| Field | Proposed value |
| --- | --- |
| `id` / `version` | `copywriting` / `0.1.0` |
| Commands | `copywriting.register_profile` (autonomous: site profile plus domain-pack reference)<br>`copywriting.audit_page` (autonomous and deterministic: rendered HTML plus a section map, returning a check list per section)<br>`copywriting.draft_candidates` (agent: model-bearing, through an Intelligence route per `docs/model-selection.md`, producing candidate sets as artifacts)<br>`copywriting.approve_candidate` (requires_review, gate `publication`)<br>`copywriting.record_published` (requires_review) |
| Approval gates | `publication` on anything that ships. A candidate that fails the claim-ledger check cannot reach approval. |
| Artifact types | `site_profile`, `claim_ledger`, `copy_audit_report`, `copy_candidate_set` |
| Migrations | `copy_profiles`, `copy_audits`, `copy_candidates` |
| Dashboard surface | Per-page audit status, and candidates waiting for review |
| Model use | Audit: none. Drafting: one bounded Intelligence call per section, with evidence fenced as inert data, as PPN's chain already does. |

### What stays data, not code

These are the same seams as PPN's design. They are what make white-labelling
possible:

- **Domain pack**, one per kind of business: house rules, banned language,
  route kinds and section doctrine, evidence mappings. PPN's
  `therapy-private-practice` pack is the first. `software-product-waitlist`
  is the second, and its first user is Mission Control.
- **Site profile**, one per site: brand and product naming, audience,
  conversion goals and funnel steps, the **claim ledger**, and the
  search-intent map.
  - For a governed Project, the claim ledger can be derived from Arcadia's
    own record of what works. Mission Control already publishes a
    capability status board that plays this role.

## Dependency direction

```text
site engine (neutral package — knows nothing of Arcadia or therapy)
   ▲                         ▲
   │ imports                 │ imports
Arcadia modules:            PPN (white-label therapy vertical;
seo-audit, copywriting       therapists never see Arcadia)
```

- **The engine never imports Arcadia.** PPN's delivered sites must not
  depend on Arcadia running.
- **Arcadia never imports PPN.** Both import the engine.
- **The seed of the Arcadia adapter already exists.** `@ppn/seo-audit`
  exports `./arcadia` (`createFindingActionDraft`). It moves into the
  `seo-audit` module, and the engine keeps no Arcadia code.

## Sequencing and triggers

1. **PPN groundwork, in PPN, already proposed there:**
   - the `@graph` fix (#177)
   - a copy-audit mode built on a generic section checker
   - rules loaded from domain packs
   - the claim-ledger check

   Therapy output stays byte-for-byte unchanged.
2. **Extract the engine into a neutral package.**
   - Trigger: PPN's copy-audit mode has run clean against Mission Control
     for one release.
   - Recommended home: its own repository, published as a package that both
     Arcadia and PPN depend on. This also settles the question of renaming
     the `@ppn/` scope.
3. **Build `seo-audit` first.** It is model-free and read-only.
   - It has one audited non-therapy run: arcadiamissioncontrol.com on
     2026-09-27 (`pmark/mission-control-site#52`).
   - PPN's site studio already renders its report for PPN's pilot client
     (`apps/keystatic-host/src/pages/site-studio/nagel/seo-report.astro` in
     PPN).
4. **Build `copywriting` audit commands next, then drafting.**
   - Trigger for drafting: the audit commands have caught at least one real
     finding on a governed Project other than Mission Control.

### Deferred, with triggers

- **Blogging integration.** The `blogging` module's review stage would run
  `copywriting.audit_page` on drafts.
  - Trigger: `copywriting` audit commands ship, and a blog post fails a
    claim or naming check in review.
- **A standalone hosted service or website.** Trigger, whichever comes
  first:
  - a paying request from outside both therapy and Arcadia;
  - Mission Control's waitlist answers show real demand for help with launch
    sites;
  - a second white-label partner besides PPN asks for it.

  The cheapest test is a one-page offer on its own domain. It must never go
  on Mission Control, because Decision 0069 keeps that site minimal.

## What not to do

- Do not add a new plugin framework. Capability Contract v1 already fits.
- Do not store audit runs twice. The engine's store is the record, and the
  module's tables index it.
- Do not let `copywriting` publish, deploy, or message anything outside the
  `publication` gate. Do not let a claim of customers, results, or ratings
  pass without ledger evidence.
- Do not make Mission Control depend on the engine at build time. It is
  audited from outside, against its rendered pages.
- Do not build either module before step 2's trigger fires. Until then this
  is a recorded direction, not queued work.

## Decision requested

Gate question: `reasonable_disagreement`. This is portfolio shape: whether
Arcadia grows its first non-code capability, and where the engine lives.

- **Adopt both modules on the sequence above (recommended).** Arcadia
  commits to Capability Contract v1 modules `seo-audit` and `copywriting`.
  The engine is extracted into a neutral package when step 2's trigger
  fires. PPN stays the white-label vertical. Nothing is built in Arcadia
  until then.
- **Adopt `seo-audit` only.** It is the proven, model-free half. `copywriting`
  is revisited when an Arcadia-governed Project other than Mission Control
  asks for help with its copy.
- **Keep it in PPN.** The engine stays a PPN library, and Arcadia gains
  nothing. Revisit if a second Arcadia Project needs a site audit.
