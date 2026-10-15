# Fresh-context Learn discovery probe — 2026-10-15

Initial source head `12230f4a138a3b3441b64601d36c08f4fb4f7379` (before review repairs). Separate read-only Codex researcher process, actual model `gpt-5.6-terra`, medium effort, standard tier. The prompt supplied a supervisor scenario and asked how to preserve a workaround, uncertain idea and possibly duplicate observation. It did not name Learn or provide the command. The ordinary repository instructions were loaded; no parent conversation was supplied. No capture or repository mutation was authorized or performed. Process exited 0.

Observed usage: 288,999 input tokens (238,848 cached) and 1,911 output tokens; 290,910 total processed. This is validation inference, separate from zero-model learning intake. One fresh session demonstrates discovery; it cannot guarantee every agent complies or reloads stale guidance.

## Raw returned answer

Use durable learning capture for all three:

```sh
arcadia learn "<exact text>" --scope project:<slug>
```

Any agent may use it promptly—no supervisor wait, novelty proof, model call, file, or Agent Ask is required.

- Workaround: record the exact command, symptom/failure, observed recovery, provenance/evidence, and prevention. Keep a verified remedy distinct from a hypothesis.
- Uncertain design: capture it explicitly as a hypothesis/uncertain idea, naming evidence and what remains unproved. Learning evidence is not truth or authority.
- Possibly prior observation: capture without first proving novelty. An exact replay in the same scope deduplicates and adds evidence; similar wording remains separate (no semantic merge).

Before implementation/repair/validation/handoff, agents should search both the bounded hot cache and durable records:

```sh
rg ... docs/notes-to-self.md
arcadia learn search "<terms>" --scope project:<slug>
```

Lessons are retrieved on demand; capture does not inject a growing store into future prompts or start model work. `docs/notes-to-self.md` is only a bounded verified-remedy cache; durable `learn` records are its backing store.

Limits: capture is evidence, not authorization—it cannot mutate an Action, Decision, queue, or Project document. Host, privacy, and scope gates still apply. A follow-up Action, canonical Log entry, or governed change must use an Agent Ask. Automatic reflection remains owned by Decision 0050 / `build-agent-agnostic-learning-loop`; the current CLI is deterministic intake and retention only. Supervisors harvest when assigned, but nobody waits for one.

Evidence read: `AGENTS.md` “Ask freely; execution stays governed” and learning paragraphs; `docs/agent-guidance/index.json` (`learning` trigger); `docs/agent-guidance/learning.md` “Learn before repeating work”; and `docs/notes-to-self.md` “How the cache works” / “When this outgrows a file.” No capture was executed.