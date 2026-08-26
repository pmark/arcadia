---
arcadia: v1
type: plan
slug: arcadia-ask-active-sessions
project: arcadia
status: draft
milestone: Every Arcadia Ask becomes a visible, corrigible working session that preserves text, links, and files, explains special processing, and commits only the operator-approved destinations and triggers
token_impact: large
token_budget: "Rule matching, URL extraction, attachment receipts, routing precedence, preview/apply, and regression tests are deterministic and make zero model calls. Use one bounded coding-agent implementation pass per Action. Any intent refinement is separately labelled, uses the configured local-preferred route, and never replaces the deterministic extraction or original capture."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-08-25
actions:
  - id: make-special-routing-visible
    title: Make deterministic special routing explicit and inspectable
    status: open
    responsibility: codex
    effort: session
    next_action: "Define and implement the validated Ask-rule contract, exact-prefix matcher, routing precedence, processing receipt, and no-write test path, beginning with the `songbook` selector."
    expected_artifact: A zero-model Ask-rule layer that explains exactly why a special route matched, what it extracted, which processing profile it selected, and what authority that processing has
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-08-25, Living Songbook dogfood, and Decision 0035
    acceptance_criteria:
      - "The operator workspace may declare `config/ask-rules.json` v1 rules with a unique id, enabled state, one exact start-of-message prefix, an explicit colon/whitespace/end boundary, destination Project, named processing profile, source reference, and examples; v1 admits no regular expressions, arbitrary code, nested conditions, or hidden priority ordering."
      - "Routing precedence is explicit destination override, exact enabled prefix, unambiguous reply context, extracted Project reference, then general intent registry; lower-precedence disagreements remain visible as ignored candidates rather than silently changing the route."
      - "`songbook`, `songbook ...`, and `songbook: ...` match case-insensitively at the beginning only; ordinary prose, larger words, URLs, and attachment filenames containing `songbook` do not match. The original text remains unchanged and only the processing payload omits the selector."
      - "Every match emits a stable processing receipt naming the rule id and version, match evidence, destination, stripped payload, extracted fields, submitted and canonical link candidates, attachment inventory, ordered processors, proposed writes, non-actions, and approval gates."
      - "A no-write rule test exercises the same matcher and extractor as live Ask and returns Arcadia's standard JSON envelope plus a readable processing preview."
      - "An explicit `--project arcadia` request whose payload mentions Living Songbook remains routed to Arcadia; regression coverage preserves the real precedence failure observed while capturing this plan."
      - "Malformed, duplicate, ambiguous, stale-source, unsupported-version, unknown-Project, and unknown-processing-profile rules fail before capture-side writes, and unchanged rule inputs produce byte-stable normalized results with zero model calls."
    decisions: ["0035"]
    references:
      - docs/decisions/0035-ask-active-session-sequencing.md
      - src/intent/registries.ts
      - src/intent/resolver.ts
      - src/commands/ask.ts
      - apps/dashboard/app/capture/page.tsx
    depends_on: []
  - id: unify-ask-capture-envelope
    title: Preserve text, links, and attachments as one capture envelope
    status: open
    responsibility: codex
    effort: session
    next_action: "Converge Dashboard text Ask and file ingress on one immutable capture-envelope contract with URL and attachment receipts plus separately labelled derived content."
    expected_artifact: One auditable capture response for text-only, attachment-only, and combined submissions, with originals and derivations independently preserved
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-08-25 and the existing `/api/ask` versus `/api/ingress` behavior gap
    acceptance_criteria:
      - "Text-only, attachment-only, and combined submissions create one capture id and envelope containing original text, ingress source, capture time, submitted URLs, attachment receipts, and every derived record without choosing between `/api/ask` richness and `/api/ingress` file handling."
      - "Each submitted URL is preserved verbatim; known redirect wrappers may yield a separately labelled canonical candidate without discarding the wrapper, following arbitrary redirect chains, bypassing access controls, or implying permission to copy linked content."
      - "Each attachment receipt records original filename, media type, byte size, SHA-256, storage reference, proposed role, and derivation status; large, licensed, private, audio, video, and binary inputs remain outside Git while safe Project-owned text may be proposed for repository storage."
      - "Text extraction, metadata extraction, transcription, OCR, and media analysis are separate named processors with source, time, confidence, and result; a failed or unavailable derivation never loses the original attachment or blocks unrelated valid inputs."
      - "Envelope creation is atomic and idempotent for a submitted request id, reports partial downstream processing visibly, and never treats attachment content as authority to execute commands, publish, message, or mutate another Project."
      - "Focused tests cover zero, one, and multiple files; text plus files; duplicate filenames; unsafe names; a Google-wrapped target URL; unreadable links; failed derivation; retry; and byte-stable receipts."
    decisions: ["0035"]
    references:
      - apps/dashboard/app/capture/page.tsx
      - apps/dashboard/app/api/ask/route.ts
      - apps/dashboard/app/api/ingress/route.ts
      - src/commands/ask.ts
      - src/commands/ingress.ts
      - src/intelligence/artifacts/store.ts
      - docs/AGENT_ORIENTATION.md
    depends_on: [make-special-routing-visible]
  - id: build-guided-understanding-session
    title: Turn the capture receipt into a guided understanding session
    status: open
    responsibility: codex
    effort: project
    next_action: "Replace the post-submit receipt with the guided understanding interaction: durable acknowledgment, editable shared interpretation, proposed destinations, activation conditions, correction conversation, and one atomic commit preview."
    expected_artifact: A phone-usable Arcadia Ask session that feels present while keeping deterministic extraction, uncertainty, authority, and resulting records legible
    clarification: clarified
    confidence: high
    source: Operator approval of the guided understanding session direction on 2026-08-25
    acceptance_criteria:
      - "Immediately after submit, the page confirms the immutable capture and begins a visible working session; deterministic extraction appears without waiting for optional model refinement, and ongoing processors report meaningful state instead of a blank `Working...`."
      - "The primary surface is a structured editable interpretation of enduring intent, desired outcome, confidence, missing information, matched Project, proposed Actions, Artifacts, Decisions, Log entries, incubating items, and activation conditions; a conversational channel exists to correct the structure rather than replacing it."
      - "Arcadia asks at most one question before preserving the capture, and only when its answer would materially change routing, safety, or the committed records; unknown values remain visibly unknown."
      - "The matched-rule card is always visible for special processing and offers Continue, Use normal Ask, and Edit rule. Safe read-only work may proceed with the card visible; every consequential write waits for an exact commit preview."
      - "The commit boundary states every create, update, unchanged, deferred, skipped, and refused result plus what will not happen; apply is atomic for approved records and returns direct links and receipts without creating a second truth store."
      - "Activation is phrased as `When should Arcadia bring this forward?` and supports immediate work, explicit Decision, dependency, date, registered predicate, or manual condition while refusing an untriggered deferral."
      - "The session retains enough bounded context for replies such as `started`, `I did it`, `change the route`, or `that is not what I meant`; ambiguous simultaneous contexts cause one selection question rather than a guessed association."
      - "The complete flow works at phone width, is keyboard and screen-reader usable, distinguishes model-derived suggestions from deterministic facts, and updates `START_HERE.md` with the normal operator procedure."
    decisions: ["0035"]
    references:
      - docs/decisions/0035-ask-active-session-sequencing.md
      - apps/dashboard/app/capture/page.tsx
      - apps/dashboard/lib/types.ts
      - src/commands/ask.ts
      - src/stewardship/index.ts
      - START_HERE.md
    depends_on: [unify-ask-capture-envelope]
  - id: make-ask-rules-easy-to-manage
    title: Manage deterministic Ask rules from the same interaction surface
    status: open
    responsibility: codex
    effort: session
    next_action: "Add preview-first Dashboard and CLI paths to inspect, test, create, edit, enable, and disable Ask rules without code changes or hidden configuration edits."
    expected_artifact: One safe management surface where the operator can understand and change every deterministic special route and prove its examples before apply
    clarification: clarified
    confidence: high
    source: Operator requirement on 2026-08-25
    acceptance_criteria:
      - "The Ask matched-rule card and `songbook rules` open the same rule detail showing prefix, Project, processing summary, enabled state, source, normalized version, last match, recent receipts, and every conflict or stale-source warning."
      - "The operator can create, edit, enable, and disable a rule through preview/apply; preview runs the rule's positive examples plus boundary, conflict, link, attachment, and routing-precedence checks without capturing or writing."
      - "CLI nouns read rule state, no-write test uses the live matcher, and mutating commands require explicit apply while returning the standard JSON envelope; Dashboard and CLI share one implementation."
      - "Disabling is reversible, edits retain prior normalized revisions for audit, and a live Ask receipt identifies the exact revision that handled it."
      - "The surface refuses duplicate prefixes, missing Projects or profiles, unsupported fields, path traversal, arbitrary executable configuration, and changes that invalidate any declared example."
      - "Focused tests cover view, test, create preview/apply, edit preview/apply, disable, enable, stale revision, conflicting concurrent edit, duplicate prefix, invalid example, and Dashboard/CLI response parity."
    decisions: ["0035"]
    references:
      - src/intent/registries.ts
      - src/cli/response.ts
      - src/cli.ts
      - apps/dashboard/app/capture/page.tsx
      - START_HERE.md
    depends_on: [build-guided-understanding-session]
  - id: dogfood-songbook-ask-session
    title: Prove the complete Ask experience through Living Songbook
    status: open
    responsibility: requires_review
    effort: project
    next_action: "Use the `songbook` rule from phone-width Arcadia Ask to inspect repertoire, add linked and attached source material, log real practice, request a recommendation and routine, correct one interpretation, and validate every resulting receipt and governed record."
    expected_artifact: Operator-accepted proof that one memorable prefix turns expressive text, links, and files into trustworthy Living Songbook work without a dedicated app
    clarification: clarified
    confidence: high
    source: Living Songbook dogfood requirements and operator direction on 2026-08-25
    acceptance_criteria:
      - "`songbook` alone presents the compact Living Songbook command surface; `songbook repertoire`, `songbook practice 20`, `songbook log ...`, `songbook add ...`, `songbook routine`, and natural free-form variants resolve to the correct read or proposed write."
      - "The exact Gimme Three Steps Google-wrapped Ultimate Guitar capture preserves the submitted link, proposes the canonical target, routes to Living Songbook, and proposes a repertoire record plus reconnaissance practice without scraping or copying tablature."
      - "One combined natural-language practice Log plus audio attachment preserves operator observations and the recording receipt, makes no audio-derived claim unless a supported processor explicitly runs, and updates the next practice recommendation from accepted evidence only."
      - "Repertoire and practice responses contain only real Project records, explain selection reasons and freshness, and say when insufficient evidence permits only a reconnaissance recommendation."
      - "The operator changes one extracted field, chooses one destination, and adds or changes one activation condition through the guided session; the final receipt and Project records agree with those corrections."
      - "Living Songbook repository writes occur only through its governed pointer or an explicit approved cross-Project Action; Arcadia dogfood may use fixtures and read-only Project evidence without claiming that foreign work changed."
      - "Relevant focused tests, the full suite, core and Discord builds, optimized Dashboard build, phone-width browser QA, and independent Arcadia PR QA pass; the pull request contains the complete operator-facing QA procedure."
      - "Operator QA accepts that the guided understanding session feels responsive, transparent, and more useful than a chatbot or terminal transcript, and records any deferred tail with a measured-use trigger."
    decisions: ["0035"]
    references:
      - docs/decisions/0035-ask-active-session-sequencing.md
      - apps/dashboard/app/capture/page.tsx
      - docs/operator-demo-and-release-contract.md
      - START_HERE.md
    depends_on: [make-ask-rules-easy-to-manage]
questions:
  - id: ask-active-session-activation
    question: "Should Arcadia resolve the current living-system v1 review and then activate `arcadia-ask-active-sessions` before restoring `idea-to-managed-build/promote-accepted-plan`, as recommended by Decision 0035?"
    gap_type: missing-decision
decisions: ["0035"]
---

# Arcadia Ask active sessions

## Outcome

Submitting to Arcadia Ask begins a short, active understanding session instead
of ending at a generic receipt. Arcadia preserves the original input, shows its
deterministic interpretation and any special processing, lets the operator
correct the result, proposes every destination and activation condition, and
commits only what the operator accepts.

The experience is the general Arcadia front door. Living Songbook is the first
dogfood profile because it combines expressive personal intent, a memorable
prefix, external links, optional attachments, durable Project records, and
immediately useful read and write interactions without earning a separate app.

## The vital few

1. Make deterministic routing and special processing visible.
2. Preserve text, links, and attachments through one capture envelope.
3. Turn that evidence into the guided understanding session the operator liked.
4. Manage the rules through that same surface, then prove the complete flow
   with `songbook`.

This order reuses the rich data `runAskCommand` already returns before adding a
new interaction model. Each piece remains independently testable and useful.

## Interaction contract

The guided understanding session is the product anchor. Conversation is a
correction channel around a structured shared draft, not the primary truth
store. At every point the operator can answer: what Arcadia heard, why it chose
this route, what it is processing, what it proposes to create or change, what
authority is required, and what condition will bring deferred work back.

A matched prefix never becomes invisible convenience. `songbook` remains shown
as the rule that selected Living Songbook, with its exact revision and ordered
processors. The operator can use normal Ask for one message or open the rule
editor without losing the captured payload.

## Authority and truth

Workspace Ask rules own personal ingress routing. Project repositories own
their processing contracts and durable Project truth. SQLite owns operational
capture and processing state. The Dashboard projects those sources and may not
become an additional rules or session database.

Deterministic extraction and original inputs remain visible when optional local
Intelligence proposes a richer interpretation. Suggestions never silently
replace captured text, route authority, Project pointers, or accepted records.

## Activation recommendation

Decision 0032 currently requires accepted living-system dogfood to restore the
pointer to `idea-to-managed-build/promote-accepted-plan`. This plan does not
silently break that promise. Decision 0035 recommends resolving the current
operator review, activating this plan next, and restoring the idea-to-managed-
build pointer after accepted Songbook dogfood.

That is the soonest clean trigger: it respects the current operator-only review,
then addresses a repeated core-product failure before another idea depends on
the same weak Ask boundary. Choosing the existing restoration sequence instead
keeps this plan draft until `promote-accepted-plan` is complete.

## Explicit deferrals

- Add fuzzy or regex matching only if exact prefixes cannot represent a second
  real rule without awkward operator language.
- Add arbitrary Project-supplied processors only when a second processing
  profile cannot be expressed through registered Arcadia capabilities.
- Add long-lived open-ended chat history only when bounded correction context
  repeatedly loses information needed for a real commit.
- Add proactive notifications or calendar integration only after a separate
  Decision authorizes the external effect and a real routine needs it.
- Build a dedicated Living Songbook app only after its own measured-use trigger;
  successful Ask dogfood is evidence against building one prematurely.
