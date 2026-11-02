# Design record format

`docs/design/<slug>/record.yaml` is the archive of a large-module design. Every
source, concept and choice has a stable ID, so `rg C-012` finds every reference.
IDs are never reused or renumbered.

The record is evidence for a design. It grants no authority and holds no governed
state: Plans, Actions and Decisions stay in their own homes, and the record points
to them.

Validate it with `arcadia design check <path> [--ready] [--matrix] [--json]`.

## Example

```yaml
schema: arcadia-design-record-v1
design: example-module
project: arcadia
authors: [Claudia Atlas]
frame:
  status: confirmed            # proposed | confirmed
  confirmed_ref: "Decision 0200"
  outcome: One sentence.
  milestone: One sentence.
  experience_target: The moment the design is judged against, in the owner's words.
  mission:
    - id: M1
      file: PROJECT.md
      quote: "Exact text that appears in the file."
  requirements:
    - id: REQ-001
      statement: An observable behavior.
      mission: [M1]
      proof: The focused test, command or QA step that would prove it.
  non_goals: [Something deliberately excluded.]
sources:
  - id: S001
    title: Prototype design docs
    kind: third_party          # operator | agent | third_party | client
    added: 2026-11-02
    retention: pointer         # repo | pointer | workspace
    url: https://example.com/repo
    revision: abc1234
    rights: MIT
  - id: S002
    title: Operator's notes
    kind: operator
    added: 2026-11-02
    retention: repo
    path: sources/S002-operator-notes.md
    sha256: 64 hex characters
  - id: S003
    title: Pasted vendor plan
    kind: third_party
    added: 2026-11-02
    retention: workspace
    workspace_path: design-sources/example-module/S003.md
    sha256: 64 hex characters
concepts:
  - id: C-001
    title: Short name
    kind: mechanism            # mechanism | requirement | constraint | risk | claim | interface
    statement: A paraphrase in the extractor's words.
    origins:
      - { source: S001, locator: "docs/001-domain.md#concepts" }
      - { source: S002, locator: "line 12" }
    fit:                       # the audit against the real codebase
      status: partial          # exists | partial | missing | conflicts
      evidence: [src/example.ts]
    position: chosen           # open | candidates | leaning | chosen | rejected | parked | merged | captured
    serves: [REQ-001]          # chosen only
    adaptation: How it differs from the source, when it does.
    load_bearing: true
    verification: { status: verified, evidence: tests/example.test.ts }
  - id: C-002
    title: A rejected alternative
    kind: mechanism
    statement: A paraphrase.
    origins: [{ source: S003, locator: "section 2" }]
    position: rejected
    reason: Why it was not taken.
  - id: C-003
    title: For later
    kind: mechanism
    statement: A paraphrase.
    origins: [{ source: S001, locator: "docs/003-execution.md" }]
    position: parked
    revival: The checkable condition that brings it back.
  - id: C-004
    title: A duplicate
    kind: mechanism
    statement: A paraphrase.
    origins: [{ source: S003, locator: "section 3" }]
    position: merged
    merged_into: C-001
choices:
  - id: CH-01
    question: Which mechanism?
    options:
      - { concept: C-001, consequence: What follows, in the owner's terms. }
      - { concept: C-002, consequence: What follows, in the owner's terms. }
    chosen: C-001
    decided_by: operator       # operator | agent
    decision_ref: "Decision 0201"   # required for operator
    reason: Required for agent; a routine choice only.
riskiest_assumption:
  statement: What would sink the design if false.
  test: The cheapest probe that could prove it wrong.
  status: supported            # untested | supported | contradicted | inconclusive | accepted_risk
  evidence: docs/design/example-module/probe.md
  decision_ref: Required for accepted_risk.
scrutiny:
  - id: R1
    path: reviews/R1-mission.md
    reviewer: Critic Cody Mason
    independent_of_authors: true
    lenses: [mission, evidence, failure]
    record_hash: 64 hex characters   # printed by arcadia design check
    verdict: pass                    # pass | pass_with_changes | hold | incomplete
    findings:
      - id: R1-F1
        severity: blocking           # blocking | note
        summary: What was found.
        disposition: fixed           # open | fixed | declined | accepted_risk
        decision_ref: Required for accepted_risk.
        concepts: [C-001]            # optional; the concepts this finding concerns
```

## Choosing retention

Decide at intake without asking. The repository may be public.

| Value | Use for | What is stored |
| --- | --- | --- |
| `repo` | Text written by the operator or an agent for this design. Third-party text only when the operator confirms its rights and it holds no private material. | The verbatim file at `path`, with its `sha256`. |
| `pointer` | Anything published at a stable URL. | Only `url`, `revision` and `rights`. |
| `workspace` | **The default for every other paste,** including third-party, client and anything of unknown rights. | The verbatim file under the Arcadia workspace, outside the repository, with its `sha256`. |

A `third_party` or `client` source may use `repo` only with `rights` stated. Client
material stays `workspace` unless the operator says otherwise. Label a source
`operator` only when the operator wrote it in their own words; a paste of unknown
authorship is `third_party`.

**Everything committed paraphrases.** The record, brief and review reports point to
locators and never quote `third_party`, `client` or `workspace` text. Check this
before every commit, because no validator can.

## Checks

`arcadia design check <path>` reports every problem it finds, not only the first.

**Always:**

- The record is at `<project root>/docs/design/<slug>/record.yaml`, and that project
  root holds `PROJECT.md`. A `PROJECT.md` anywhere else doesn't count.
- The schema, required fields and allowed values are valid.
- Each path stays inside its root, including through symlinks: the design directory
  for source and review `path`, the workspace for `workspace_path`, and the project
  root for mission `file` and `fit.evidence`.
- IDs are unique and match `S###`, `C-###`, `CH-##`, `REQ-###`, `M#`, `R#`. Every
  reference resolves.
- Each `repo` source file exists and matches its `sha256`. A `workspace` source
  matches when the file is reachable; otherwise the check warns that it was not
  verified.
- Each `pointer` source has `url`, `revision` and `rights`. The `url` is `http` or
  `https` and holds no embedded username or password.
- Each `third_party` or `client` source on `repo` has `rights`.
- Each concept has at least one origin.
- Each mission `file` is exactly `PROJECT.md`, `CONSTITUTION.md` or `NORTH_STAR.md`
  at the project root. Each `quote` has at least 20 non-space characters and appears
  exactly in that file. This makes a mission trace hard to invent; a critic still
  judges whether the quote really supports the requirement.
- Each `fit.evidence` path exists in the project.
- A `rejected` concept has `reason`, `parked` has `revival`, `merged` has a
  `merged_into` that isn't itself merged, and `chosen` has `serves`.
- It prints the current `record_hash`: the SHA-256 of the record's canonical JSON
  (keys sorted) with the `scrutiny` key removed.

**With `--ready`, also:**

- Each authority reference resolves (see below): `confirmed_ref`, and every
  `decision_ref`.
- Every `workspace` source was verified against its hash. Unverified is a warning
  otherwise, but it fails here.
- `frame.status` is `confirmed` with a `confirmed_ref`.
- There is at least one requirement. Each cites a mission entry, has a `proof`, and
  is served by at least one chosen concept.
- No concept is `open`, `candidates` or `leaning`.
- Each choice has a `chosen` option that is a `chosen` concept. Every other option
  is `rejected`, `parked` or `merged`. An `operator` choice has `decision_ref`; an
  `agent` choice has `reason`.
- A chosen concept whose fit is `conflicts` has an operator choice covering it.
- Each `load_bearing` chosen concept is `verified` with evidence, or is named in the
  `concepts` of a blocking finding marked `accepted_risk`, in a review that is
  independent and whose verdict is not `hold` or `incomplete`.
- `riskiest_assumption` is `supported` with evidence, or `accepted_risk` with
  `decision_ref`.
- Reviews whose `record_hash` matches the current hash cover all three lenses, each
  with `independent_of_authors: true` and a reviewer not listed in `authors`
  (compared ignoring case, any `Critic` title and adjacent punctuation), and none has
  the verdict `hold` or `incomplete`. Each `path` is a file that contains its
  `record_hash`, so a report states what it reviewed.
- Across **all** reviews, including stale ones, no blocking finding is `open` or
  `declined`, and each `accepted_risk` has `decision_ref`.
- More than three reviews of different hashes produces a warning, not a failure.

### Authority references

An authority reference is one of two things, and the check verifies it:

- `Decision NNNN`: `docs/decisions/NNNN-*.md` exists at the project root with
  `status: approved`.
- `S###`: a source with `kind: operator` and `retention: repo`, which keeps the
  operator's own words verbatim. Use it when the operator answered in conversation.

**What the check can't catch:** a paste mislabelled as `operator`, a `rights` value
that is wrong, or private text quoted in a brief or review. Those are for the author
and the critics.

## The matrix

`--matrix` prints a derived view; it is never stored:

- **Shared:** concepts with origins in two or more sources.
- **Differentiated:** concepts with one source, by source.
- **Choices:** each with its options and status.
- **Trace:** requirement → chosen concepts → origins.
- **Cut or later:** rejected and parked concepts with their reasons and conditions.

A second copy of this view would drift, so regenerate it rather than saving it.
