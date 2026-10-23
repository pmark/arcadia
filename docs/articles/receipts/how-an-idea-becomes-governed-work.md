# Field Notes evidence: how-an-idea-becomes-governed-work

- Type: essay; operator-requested explainer, intended to become a guide on Arcadia Mission Control later.
- Article: docs/articles/2026-10-23-how-an-idea-becomes-governed-work.md
- Source repository and pinned revision: pmark/arcadia@280b094f0e956f8d55d67b6ed1d646cd60b3886f
- Cadence window: not assessed; operator-requested idea draft, dated in America/Los_Angeles.
- Evidence collection: repository documents at the pinned revision, read 2026-10-23.
- Previous verified publication/cutoff: none established for this article.
- Eligibility: explanatory draft; no shipped-work or Milestone claim. Publication eligibility unassessed.
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)
- The canonical URL is an intended destination; no page, RSS entry or delivery is claimed.

## Claims

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | An Ask is the single door into governed state; agents never hand-edit status, answers or pointers. | [agent-asks.md, "Asking Arcadia to change Project state"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. Document hygiene is a stated exception the article does not cover. |
| C2 | An Ask has `request_id`, Project, `intent` and `desired_result`; only `request_id` and `desired_result` are required everywhere. | [agent-asks.md, "The intents"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Schema summary; `arcadia agent-ask contract` is the live authority. |
| C3 | `intent: proposal` preserves evidence only, with no executable Action; preview records a pending proposal. | [agent-asks.md intents table and preview section](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C4 | Plan status is draft, active, complete or superseded. | [managed-documents.md, plan anatomy](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md) | `dormant` and `proposed` Plans are supporting records, omitted from the article for brevity. |
| C5 | Action fields: acceptance criteria, responsibility (autonomous, agent, requires_review, blocked), next step, dependencies. | [managed-documents.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md), [arcadia-semantics.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/arcadia-semantics.md) | Documented schema. |
| C6 | Decision definition and the `decision` intent gate (reasonable disagreement, resists reversal, approval boundary). | [arcadia-semantics.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/arcadia-semantics.md), [agent-asks.md, "Decision intent triage"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. |
| C7 | `PROJECT.md` names `active_plan`, the Plan names `current_action`; exactly one Action is current. | [managed-documents.md, "The pointer chain"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md) | A second session may take the next unclaimed queue entry without moving the pointer; omitted for brevity. |
| C8 | The queue reads canonical Actions, stores only ordering, and a ready Action elsewhere waits for the pointer. | [COMMANDS.md, "The Agent Queue"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/COMMANDS.md); [agent-asks.md, settling section](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C9 | Preview writes receipts and a fingerprint, and nothing to Project documents or queue; a receipt is registration, not approval; Asks are never self-approving; neither requested_authority value lets an agent apply. | [agent-asks.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. |
| C10 | Settlement writes the previewed effects and commits locally, never pushing. | [agent-asks.md, "Settling commits locally and never pushes"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C11 | `intent: plan` without `target_ref` creates a complete inactive draft Plan. | [agent-asks.md intents table](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C12 | Activation is a settlement of an `intent: plan` Ask targeting the draft with `--activate`; it makes the Plan active and sets `current_action` to its first Action, and does not merge or deploy. | [operator-plan-amendments.md, "Plan activation"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/operator-plan-amendments.md) | Documented runner shape (`--activate --action <id> --model --effort --top`). The activation runner performs its normal push, unlike a bare `settle --apply`. "Does not merge or deploy" is inferred from its allowed-effects list. |
| C13 | A `complete` Ask needs evidence for every criterion, verbatim and in order, against a candidate revision; any criterion not met refuses; settlement marks the Action done and resolves the next Action, question, blocker or completed Plan. | [agent-asks.md intents table and "One session completes one Action"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. Merge remains a separate gate per [settling-actions.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/settling-actions.md). |
| C14 | Capability grants nothing. | [CONSTITUTION.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/CONSTITUTION.md) | Constitutional rule. |
| C15 | Worked example: a proposal on email copy for client sites was registered with `agent-ask preview` as an `intent: plan` Ask; settling it will create an inactive draft Plan with four Actions. | PPN [docs/proposals/email-edits-for-client-sites.md](https://github.com/pmark/private-practice-now/blob/b94e2ef/docs/proposals/email-edits-for-client-sites.md), merged in [PPN PR 356](https://github.com/pmark/private-practice-now/pull/356) (merge b94e2ef). | The proposal records the registration receipt and the four proposed Actions. Settlement, activation and completion have not run and are described only as the governed path. The repository may be private. |
| C16 | Summary: Arcadia lets any agent ask for anything and changes the governed record only when an Ask is settled. | [agent-asks.md, "Ask freely" and "Asking Arcadia to change Project state"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule; "any agent may ask" is the capture contract, which does not promise acceptance. |
| C17 | The governed record changes only when a request is settled, applying exactly the previewed changes once the operator or a deterministic proof accepts them. | [agent-asks.md, preview/settle sections and `complete` intent](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Settlement applies fingerprint-bound effects; a `complete` apply without `--operator` records `deterministic_proof` authority. |
| C18 | A draft Plan does not claim the pointer, so no agent is dispatched from it. | [managed-documents.md, "The pointer chain"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md); [COMMANDS.md, `next`](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/COMMANDS.md) | Dispatch resolves `active_plan` then `current_action`; a draft Plan omits `current_action`. |
| C19 | Four doors: capture, plan settlement, activation and completion; each leaves a receipt and an operator yes/no point. | C9, C11, C12, C13 | Synthesis of the documented steps. A `complete` settlement may apply under deterministic proof; the operator's merge is the remaining yes/no point there. |
| C20 | `requires_review` Actions must not be implemented by a coding agent; `complete` is refused while a required review Decision is unresolved. | [managed-documents.md, "The fields with teeth"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md); [agent-asks.md intents table](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rules. |
| C21 | Publication requires Decision 0120's checks. | [docs/articles/README.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/articles/README.md), [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) | Governs automatic Field Notes publication; this draft is unassessed. |

## Mechanical checks

Front matter present; about 860 words including the diagram and table; no em
dashes; no placeholders; American spelling checked by grep; relative links only.

## Independent review

- Reviewer identity and independent lineage: pending; to be assigned by the Lead.
- Reviewed article and receipt revision: pending committed draft.
- Source revision: 280b094f0e956f8d55d67b6ed1d646cd60b3886f
- Report: pending; the author provides no independent approval.
- Verdict: HOLD for publication.
- Findings and resolution: round 1 independent review returned BLOCKING (unsettled example described as settled, summary overstating who settles, activation framing). Revised in a follow-up commit; delta review pending.

## Delivery handoff

Draft only. No site or RSS publication, deployment, notification or unpublish
receipt exists. Committing, pushing or merging the draft does not publish it.
