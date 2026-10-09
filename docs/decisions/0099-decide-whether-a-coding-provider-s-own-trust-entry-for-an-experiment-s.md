---
arcadia: v1
type: decision
id: "0099"
slug: decide-whether-a-coding-provider-s-own-trust-entry-for-an-experiment-s
project: arcadia
status: approved
question: Decide whether a coding provider's own trust entry for an experiment's temporary folder (Codex adds [projects."<temp path>"] trust_level="trusted" to ~/.codex/config.toml) counts as Decision 0082's stop condition. Nothing changes by raising this Decision.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Not a stop condition: provider trust entries for the experiment's own temp folders are allowed"
options:
  - label: "Not a stop condition: provider trust entries for the experiment's own temp folders are allowed"
    consequence: Experiment workspaces continue until 2026-10-18 and the /runs headless provider test may be pressed again. A Codex (or other provider) trust entry for the run's own temporary folder is reported, not treated as a stop condition. Every other leak-check change, and any write to martianrover, still stops experiments. Stale entries for deleted temp folders accumulate in ~/.codex/config.toml until a later cleanup the operator approves.
    recommended: true
  - label: "It counts: experiments end now"
    consequence: The experiment window closes eight days early; the /runs headless provider test is retired; real-provider checks happen only on real queued Actions launched from /production, each producing a real draft PR.
    recommended: false
  - label: Pause until the per-run trust flag is verified
    consequence: No experiment runs until one more run shows whether the --config trust override prevents the write; that run itself may add an entry. Then choose one of the other options.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: "Not a stop condition: provider trust entries for the experiment's own temp folders are allowed"
decided: 2026-10-09
---

# Decision 0099: Decide whether a coding provider's own trust entry for an experiment's temporary folder (Codex adds [projects."<temp path>"] trust_level="trusted" to ~/.codex/config.toml) counts as Decision 0082's stop condition. Nothing changes by raising this Decision.

## Options

- **Not a stop condition: provider trust entries for the experiment's own temp folders are allowed** (recommended): Experiment workspaces continue until 2026-10-18 and the /runs headless provider test may be pressed again. A Codex (or other provider) trust entry for the run's own temporary folder is reported, not treated as a stop condition. Every other leak-check change, and any write to martianrover, still stops experiments. Stale entries for deleted temp folders accumulate in ~/.codex/config.toml until a later cleanup the operator approves.
- **It counts: experiments end now**: The experiment window closes eight days early; the /runs headless provider test is retired; real-provider checks happen only on real queued Actions launched from /production, each producing a real draft PR.
- **Pause until the per-run trust flag is verified**: No experiment runs until one more run shows whether the --config trust override prevents the write; that run itself may add an entry. Then choose one of the other options.

## Rationale

Decision 0082 allows experiment workspaces until 2026-10-18 and stops them at any leak-check change or martianrover write attributable to the experiment. On 2026-10-09 the operator ran the /runs headless provider test (run 20261009T135444Z-90379). Its leak check reported one change, hashes.codexConfig: Codex persisted a trust entry for the run's temporary fixture folder, which is deleted after the run and has a random name. The file already holds 569 trust entries from normal use. The operator said in the release-manager chat on 2026-10-09: "If we have to suffer some weird temp file stuff for now, that's totally fine. We can deal with that later. Do whatever it takes to keep running and fixing the actual problem that we need to focus on." Recording this keeps every agent reading AGENTS.md on the same rule.

Proposed by Agent Ask raise-0082-codex-trust-entry-ruling-20261009.
