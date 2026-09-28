---
arcadia: v1
type: proposal
project: arcadia
question: Should every Arcadia website module follow one integration contract — a neutral library, a CLI printing versioned schema-defined JSON, a Capability Contract v1 module that alone holds governance, and an MCP facade generated from the same JSON — with Uplink (copywriting) and Downlink (SEO) as the first worked example, and MCP built only when its trigger fires?
---

# Module integration contract

## What this asks

Arcadia's main job is producing websites to a production standard. Decision
0073 adopted its first two "common pieces", the `copywriting` and `seo-audit`
capability modules designed in
[`site-copy-and-seo-capability-modules.md`](site-copy-and-seo-capability-modules.md)
(#744). This proposal uses their working names:

- **Uplink** — governed copywriting (`copywriting`).
- **Downlink** — SEO and discovery measurement (`seo-audit`).

More modules will follow: imagery, deploy, analytics, forms. Decision 0073
settled *whether* to build Uplink and Downlink. It did not settle *how any
website module plugs into Arcadia*. Without an answer, each module picks its
own shape, and the first one's accidents become everyone's precedent.

This proposal asks the operator to ratify a **module integration contract**:
four layers, one authority rule, a rule for choosing a layer, and an MCP policy.

It authorizes nothing by itself. It changes no code, and it opens no Plan and
no Action. Decision 0073's sequencing still holds: **nothing is built in
Arcadia until PPN's copy-audit mode has run clean against
arcadiamissioncontrol.com for one release.** The contract governs the work
that trigger releases. It does not move the trigger.

## Why a contract, and why now

- **The first module sets the precedent anyway.** The engine extraction (step
  2 of 0073) is where the library, CLI and adapter boundaries get drawn. If
  they are drawn without a rule, the rule becomes whatever Uplink happened to
  do.
- **The seams already exist and point this way.**
  - `@ppn/seo-audit` is already site-neutral and already exports `./arcadia`
    (`createFindingActionDraft`) — a library with an adapter seed beside it.
  - PPN's merged #182 already requires `add-copy-audit-mode`'s JSON output to
    carry a schema version, a committed JSON Schema, and a test validating
    output against it. That is layer 2, already demanded.
  - `CapabilityModule` in `src/capabilities/core.ts` already has an optional
    `mcp: { tools, resources }` field. That is layer 4's slot, already
    reserved.
- **Deciding now costs a document. Deciding later costs a migration.** Once a
  second module exists, retrofitting a contract means changing two modules
  and every caller of both.

## 1. The four layers

These are **layers, not alternatives**. Every module has layers 1–3. Layer 4
is built when its trigger fires (section 4). Each layer depends only on the
layer beneath it.

```text
 4. MCP facade          generated from the layer-2 schemas; no logic
        │ calls
 3. Arcadia capability  Capability Contract v1; the ONLY layer with
    module              governance: Agent Asks, artifacts, approval gates
        │ calls (subprocess or import), validates against the layer-2 schema
 2. CLI                 prints versioned, schema-defined JSON; the stable contract
        │ imports
 1. Library             neutral; never imports Arcadia; knows no vertical
```

### Layer 1 — Neutral library

- **Does the work.** Parsing, checking, measuring, drafting prompt chains.
- **Never imports Arcadia**, and knows nothing of therapy, Mission Control or
  any other single vertical. Vertical knowledge arrives as data: domain packs,
  site profiles, claim ledgers.
- **Is what white-label verticals import.** PPN keeps shipping Uplink and
  Downlink to therapists under its own brand by importing this layer.
  Therapists never see Arcadia.

### Layer 2 — CLI with versioned, schema-defined JSON

This is **the stable contract**. Tests, CI and every adapter build on it, not
on the library's internal types.

- Every JSON document the CLI prints carries a `schema_version`, and its JSON
  Schema is committed next to the code. A test validates real output against
  it (PPN #182's criterion, generalized to every module).
- **stdout is JSON only; diagnostics go to stderr.** An adapter must never
  have to scrape text.
- **Exit status separates "ran and found things" from "could not run".**
  Findings are data, not failure. An adapter treats a clean run with 40
  findings and a crash as different events.
- **Versioning.** Adding an optional field is a minor version. Removing or
  retyping a field, or changing its meaning, is a major version, and the
  adapter refuses a major version it does not know rather than guessing.
- **Deterministic by default.** A mode that needs a model (Uplink drafting)
  says so in its output and in the schema, and is a separate subcommand, so
  a deterministic caller can never trigger inference by accident.

### Layer 3 — Arcadia capability module (Contract v1)

- A `CapabilityModule` object registered in `src/capabilities/registry.ts`,
  exactly like `blogging` and `rebuster`. **No new plugin mechanism.**
- **Governance lives here and only here:** commands with declared permissions
  and approval gates, artifact types, migrations that *index* layer-2 output
  rather than copying it, dashboard surfaces, and conversion of findings into
  Agent Ask drafts.
- It consumes layer 2's JSON and validates it against the committed schema
  before it records anything.
- The `./arcadia` adapter seed that `@ppn/seo-audit` exports today moves here
  at extraction. Layer 1 keeps no Arcadia code.

### Layer 4 — MCP facade

- **Generated from the layer-2 schemas**: each tool's input and output
  schema is the CLI's, and each resource is a layer-2 document.
- **Holds no logic of its own.** If a behavior cannot be expressed as "call
  the CLI (or the layer-3 command) and return its JSON", it belongs in a lower
  layer, not in the facade.
- It fills the existing `CapabilityModule.mcp` field, so Arcadia's own MCP
  surface lists it without a new registry.

## 2. The authority rule

> **The module does the work. Arcadia holds the authority.**

- A module returns **findings** and **candidates**. It never approves,
  publishes, deploys, spends, uses credentials against production, or messages
  anyone.
- This holds **in every layer, MCP included.** Layers 1, 2 and 4 have no
  entrypoint that crosses an approval boundary. Layer 3 is the only place such
  an entrypoint exists, and there it is a Contract v1 command with
  `requires_review` and a named gate (for Uplink, `publication`).
- **A finding becomes work only through an Agent Ask**, which the operator
  settles. A module drafts Asks; it never settles them. No wording in a
  finding or a candidate approves anything.
- **Model output is a candidate, never a fact.** Uplink drafting fences
  evidence as inert data and must answer `INSUFFICIENT EVIDENCE` rather than
  invent. A candidate that fails the claim-ledger check cannot reach the
  approval gate at all.

This is the Constitution's "capability never grants authority" applied to
modules: being able to run a module, from any surface, confers nothing.

## 3. How to choose a layer for a call

Decide from four things, in this order.

1. **Where authority sits.** If the call's result could approve, publish,
   deploy, spend or message, it goes through layer 3's gated command, from
   every caller. Nothing below layer 3 can do it.
2. **Whether a model is needed.** Deterministic first, per the Constitution's
   Economy section. Use the deterministic subcommand unless the task is
   genuinely generative (drafting). A model-bearing call goes through an
   Intelligence route per `docs/model-selection.md`, never a module's own API
   key.
3. **Who is calling.**

   | Caller | Layer | Why |
   | --- | --- | --- |
   | Operator (dashboard, Discord, `arcadia` CLI) | 3 | Needs governance: artifacts, review items, gates |
   | Deterministic worker (managed production) | 3 | Records runs and drafts Asks; no model unless the command declares one |
   | CI | 2 | Needs a stable exit status and schema-valid JSON, not governance; no Arcadia workspace required |
   | Coding agent building a site | 2 now; 4 once built | Needs to audit its own output mid-build; shells to the CLI until MCP's trigger fires |
   | White-label vertical (PPN) | 1 | Imports the library under its own brand; no Arcadia |

4. **Failure isolation.** **Delivered sites must never depend on a module
   running.** Modules run while a site is being *built*, audited or
   reviewed — never while it *serves visitors*. A module being down, slow or
   uninstalled may delay a release; it must never take a live page down.
   Decision 0069 already applies this to Mission Control: no build-time
   dependency on any engine, audited from outside against its rendered pages.

   Two future modules test this rule, and it decides their shape:

   - **Forms and analytics** have a runtime half (a form submits; a page
     view is counted). That half belongs to the site and its host. The module
     generates or validates configuration at build time and ingests exported
     data afterward. It is never in the request path.
   - **Deploy** is the hard case: deploying *is* an approval boundary. The
     module prepares and verifies (build, diff, preflight, smoke checks); the
     act of deploying happens only in layer 3 behind the `deploy` gate. This
     is recorded here so the deploy module's own proposal starts from it.

## 4. MCP policy

**Design for MCP now; build it on a trigger.**

- **Designed now** means layer 2's schemas are written so a facade can be
  generated from them: self-describing, versioned, with no output that only a
  human can parse. That costs nothing extra, because #182 already requires it.
- **Built on a trigger.** Trigger: **Uplink's copy-audit mode ships AND a
  coding-agent session needs to call it while building a site.** Until both
  hold, coding agents shell to the CLI, which works today and needs nothing new.
- **First version is read-only**:
  - tools: audit a page (Uplink), read a Downlink report;
  - resources: domain packs, a site's claim ledger.
- **Drafting candidates is allowed** in the first version, because a candidate
  is not a publication: it returns a candidate set, and it cannot reach the
  `publication` gate except through layer 3.
- **Never exposed over MCP:** approve, publish, record-published, deploy,
  settle an Ask, or anything else behind an approval gate. This is permanent,
  not a first-version limit. A facade that could approve would make "has an
  MCP client" a form of authority, which the authority rule forbids.

Building MCP now, with no caller, was considered and rejected: it would add a
surface to maintain before anything can exercise it (YAGNI), and the
trigger above names exactly when that changes.

## Worked example: Uplink and Downlink

| | Uplink (copywriting) | Downlink (SEO) |
| --- | --- | --- |
| Layer 1 today | `@ppn/copy-studio`: prompt chain, `checkHeroOutput`, `parseBannedLanguage`. Becomes neutral after `extract-generic-section-checker` and `load-house-rules-from-domain-pack` | `@ppn/seo-audit`: already site-neutral; `@graph` JSON-LD bug fixed (#179) |
| Layer 2 | `add-copy-audit-mode`: versioned JSON, committed Schema, validation test (#182). Drafting is a separate, model-bearing subcommand | Run ingestion and scorecard as JSON: immutable checksummed runs, comparable-only comparisons, indexability label, stated limitations |
| Layer 3 | `copywriting` module per #744: `audit_page` autonomous; `draft_candidates` agent; `approve_candidate` and `record_published` `requires_review`, gate `publication` | `seo-audit` module per #744: `record_run`, `report` autonomous; `propose_actions` `requires_review`, drafts Agent Asks. The `./arcadia` export (`createFindingActionDraft`) moves here |
| Layer 4 | On trigger: `audit_page`, `draft_candidates`; resources for packs and the claim ledger | On trigger: `report` read-only; `record_run` stays off MCP in v1, since v1 is read-only |
| Model use | Audit: none. Drafting: one bounded Intelligence call per section | None |
| Authority | Never publishes; claim-ledger failures cannot reach approval | Never acts on a finding; findings become Agent Asks the operator settles |

Where the pieces stand (2026-09-28): the five PPN groundwork Actions sit in
PPN's draft, inactive plan
`docs/plans/prepare-ppn-s-copy-and-seo-engine-for-arcadia-s-seo-audit-and-copywriting.md`
(PPN #181). PPN's pointer is still `client-site-growth-platform` /
`deliver-first-client-pilot`, and the operator decides when to activate the
groundwork plan. Mission Control's audit that proved the engine travels is
`pmark/mission-control-site#52`.

## Open condition, to resolve at extraction: a public Arcadia and a private engine

**What I checked.** On 2026-09-28, `pmark/arcadia` is **public**
(`visibility: public`, MPL-2.0 license, one fork). Mission Control's site
links to it as source, so outside readers are expected to clone and build it.
PPN's packages, and the engine extracted from them, are to stay **private**
for now: the operator is not ready to open-source them. (PPN's repository was
outside this session's access, so its visibility is as the operator stated,
not independently checked.)

**Why it matters.** If a layer-3 module in this public repository declares a
hard dependency on a private package, `pnpm install --frozen-lockfile` fails
for every outside clone and fork, and Arcadia's own CI needs private-registry
credentials to install at all. The public repository would stop building for
anyone but the operator.

**Options to weigh at extraction, not now:**

1. **Depend on the layer-2 contract, not the package (leading candidate).**
   The layer-3 module invokes the module's CLI as an external executable and
   validates its JSON against a schema committed *in Arcadia*. Arcadia's
   lockfile never names the private package. When the CLI is absent, the
   module reports itself unavailable instead of failing. The four-layer
   contract makes this nearly free: it turns a private-dependency problem into
   a runtime-availability problem.
2. **Optional dependency with a guarded dynamic import.** Declared in
   `optionalDependencies`; the module registers as unavailable when the import
   fails. Simpler call path, but the lockfile still names a private package,
   and pnpm's handling of an unreachable optional registry must be proven in CI.
3. **Keep the layer-3 module out of this repository** until the engine can be
   published. This needs an external-module registration path that Contract
   v1 does not have today, so it is the most expensive option.
4. **Publish the engine publicly.** This dissolves the problem, and it is the
   operator's licensing call, which the operator has said is not yet.

**Whichever is chosen, extraction must prove it:** a fresh clone of
`pmark/arcadia` with no private-registry credentials installs, builds and
passes its test suite. For options that register a layer-3 module, verify it
reports "unavailable" rather than erroring when its CLI or package is absent.
For option 3, verify the clone passes with no module registered. These checks
become part of the extraction Action's acceptance.

**Trigger:** the engine-extraction step of Decision 0073 starts. Until then
nothing in this repository depends on the engine, so nothing is broken.

## Names

- **Uplink** (copywriting) and **Downlink** (SEO) are **working names**. They
  are used in conversation and in this proposal; the module ids stay
  `copywriting` and `seo-audit` as #744 and Decision 0073 recorded them.
- **Formal adoption waits for engine extraction.** That is when package names,
  CLI binary names and module ids are fixed at once, so a rename happens once.
- **The neutral package's home is still pending.** #744 recommends its own
  repository, published as a package both Arcadia and PPN depend on; that
  choice, and whether the `@ppn/` scope is renamed, is made at extraction. It
  interacts directly with the open condition above.

## Known defects this contract leans on

- **#512** — `agent-ask settle --apply` fails to commit when a Project
  gitignores `.arcadia/asks/`. PPN hits this every time. Layer 3 turns findings
  into Agent Asks, so Downlink's `propose_actions` inherits this defect in every
  Project shaped like PPN. It should be fixed before `seo-audit` ships; not a
  blocker for ratifying this proposal.
- **#746** — `decision approve` leaves the body's "Resolution: Open." in place
  after a Decision is answered. The Decision that ratifies this proposal will
  show it; correct the body by hand as document hygiene until #746 is fixed.

## What not to do

- Do not put governance (Asks, gates, artifacts) anywhere but layer 3.
- Do not give the MCP facade logic, or any approval-bearing tool, ever.
- Do not let an adapter parse CLI text instead of schema-validated JSON.
- Do not let a delivered site call a module at request time.
- Do not add a module dependency that stops a public clone of Arcadia from
  installing and building.
- Do not build anything here before Decision 0073's extraction trigger fires.

## Decision requested

Gate question: `reasonable_disagreement`. This sets the precedent every
future website module follows, and a reasonable person could weigh the
MCP timing, or whether to fix a shape at all before the second module exists,
differently.

1. **Adopt the four-layer contract, with MCP on its trigger (recommended).**
   Every website module ships layers 1–3; governance lives only in layer 3; the
   authority rule binds every layer, MCP included; MCP is built read-only
   (plus drafting) when Uplink's copy-audit mode ships AND a coding-agent
   session needs it mid-build, and never exposes publish or approve.
   *Consequence:* the engine extraction draws its boundaries to this shape;
   Downlink, imagery, deploy, analytics and forms start from it instead of
   re-deciding it; no MCP maintenance until a real caller exists.
2. **Adopt layers 1–3 only; no MCP policy.** Coding agents keep shelling to
   the CLI indefinitely, and MCP is a fresh proposal whenever someone wants it.
   *Consequence:* less to agree on today, but nothing binds the facade's
   authority when it arrives, and layer-2 schemas are not held to "generatable"
   in the meantime; revisit when a coding-agent session needs a module mid-build.
3. **No general contract; decide per module.** Uplink and Downlink follow
   #744 as written, and each later module chooses its own shape.
   *Consequence:* no precedent to maintain, but the first module's accidents
   become the de facto rule, and the public-repository dependency question is
   answered separately for each module; revisit when a second module proposal
   (imagery, deploy, analytics or forms) is filed.
