```text
HEAD 13bebd57e1c761bb820288cae76d3ccbc391eeb3
PASS — read-only discovery complete; working tree unchanged.

Project scope: project:mission-control-site
Active pointer observed: improve-the-waitlist-user-experience#tour-persistent-signup

Supported capture commands (not run: they write retained evidence):
  arcadia learn "<verbatim workflow fact>" --scope project:mission-control-site
  arcadia learn "<verbatim tentative explanation>" --scope project:mission-control-site \
    --provenance inference --confidence low --evidence "<specific observation/source>"

The first defaults to observation/high. The second explicitly labels the explanation
as an inference with low confidence. Neither needs a model call, file, or Agent Ask.

Retry behavior:
  - Exact same-scope replay deduplicates; supplied evidence/observations are retained,
    otherwise it returns a receipt.
  - Similar wording remains a separate record; there is no semantic merge.
  - For an unchanged failure, preserve its receipt rather than retrying blindly.

Authority:
  - Capture writes durable evidence and requires ordinary permitted workspace/host access.
  - It creates no Action, Decision, promotion, rollout, approval, or new executable work.
  - Privacy and scope gates still apply.

Read-only verification:
  - Installed CLI: /Users/pmark/.local/bin/arcadia
  - `arcadia learn --help` and `arcadia learn search --help` succeeded.
  - `arcadia learn search "workflow" --scope project:mission-control-site` succeeded:
    Matches: 0. No concrete fact was supplied, so no exact-match search was possible.
  - Canonical QA registry lookup succeeded: qa is critic-identity, non-mutating,
    non-delegating, and requires an independent session.
  - Limitation: docs/notes-to-self.md is missing; reported, not substituted.

Instruction trail:
  - AGENTS.md:25-28 requires Project/current-Action and bounded-context startup.
  - AGENTS.md:39-46 specifies `arcadia learn`, inference labeling, no new authority,
    and exact-replay deduplication.
  - docs/agent-guidance/learning.md:4-16 directs scoped retained-lesson search and
    durable capture; it also requires reporting a missing notes file.
  - /Users/pmark/.codex/skills/arcadia-role/SKILL.md:44-49 confirms the same
    zero-model, evidence-only behavior; lines 63-64 define QA independence.
```
