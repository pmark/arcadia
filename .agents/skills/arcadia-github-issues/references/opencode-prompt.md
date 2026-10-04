# OpenCode / DeepSeek handoff

Open a fresh OpenCode session from the Arcadia repository root.
Use `/models` to select the intended configured DeepSeek provider/model and
confirm its actual ID. Use normal/default reasoning for classification; reserve
more reasoning for a bounded difficult verification. Do not change global model
settings or silently use another model. Existing Decision scope must permit any
credential use and paid inference; the prompt grants neither additional spending
nor GitHub mutation authority.

Paste this prompt:

```text
Load the arcadia-github-issues skill using your skill tool. If discovery fails,
read .agents/skills/arcadia-github-issues/SKILL.md directly and resolve
its references beside that file. Use the DeepSeek model selected for this
session; report its actual provider/model ID. Do not launch subagents.

Triage every open GitHub Issue in pmark/arcadia:
https://github.com/pmark/arcadia/issues
I expect 177, but reconcile the live inventory rather than limiting it to 177.
Exclude PRs. The purpose is to make future coding-agent resolution, closure,
and batching cheaper. Focus on the 80/20.

First load Arcadia's required governance and targeted Notes To Self. State the
current Milestone, Action, Responsibility, and expected triage Artifacts. This
is a triage-only assignment; do not replace the active Action, edit code or
governed records, repair issues, or launch managed production. Resolve existing
Decision scope before using authenticated GitHub reads or paid DeepSeek calls.
If authority is absent, preserve a concrete proposed Ask and give the exact
operator unblocker. Never read tokens or credential files or switch workspaces.

Persist artifacts in a fresh temporary output directory outside the live main
checkout. Report the absolute output path. Read-only
GitHub inventory and local source inspection are the intended external scope;
GitHub label writes, comments, closures, deletions, pushes and merges are excluded.

Download all pages once, retaining full issue bodies, current labels, URLs,
timestamps and comment counts. Pin the observed default-branch SHA and record
retrieval time and coverage. Check the inventory against the live open count/ID
set after fetching; if it changed, reconcile or label the snapshot accurately.
Save metadata/labels too. Prefer the existing GitHub connector or gh capability;
do not build a GitHub client or workflow service.

Use the skill's packet helper. Classify ALL issues in packets of 20, saving each
packet's rows before continuing. Calibrate the vocabulary on the first packet.
Reuse existing subsystem/type/priority labels. Propose one primary route:
verify, fix, batch, close-candidate, or needs-operator. Keep validity separate.

Then select the vital few investigations: blockers of governed work, likely
resolved/duplicate issues, and clusters with one shared cause or proof. Limit
this first verification pass to roughly 20% of the inventory (35 for 177).
Share source searches and relevant checks by cluster. Read full bodies and
relevant comments before confirming validity. Unknown is an acceptable result;
do not claim all issues are still valid or resolved. Expand the investigation
only to address a named gap that changes a useful recommendation.

Reconcile Issues and governed Actions in BOTH directions. Build a compact index
of explicit issue references in authoritative Plan Actions, source Asks and
linked Artifacts. Include completed and non-active Actions and fetch their
linked closed Issues as a separate reconciliation inventory. Match exact
plan/action identities; titles alone create proposed links, never established
ones. Relationships can be many-to-many. Compare Issue requirements against
linked Action acceptance, including partial coverage and unique requirements.
Give every open Issue its explicit Action references or unmapped status; flag
defect-resolution Actions that require an Issue reference but lack one.
Detect done-Action/open-Issue, closed-Issue/unfinished-Action, merged-fix/open-Action,
duplicates with divergent acceptance, and broken references. Persist findings,
provenance, evidence and the specific proposed correction in reconciliation.json.
Complete reference coverage is required; deep proof checks share the 20% budget.
Do not change Action status, pointers, Decisions or queue state. Draft selected
corrections through Agent Asks; do not settle them or modify GitHub here.

Write snapshot.json, index.json, packet results, triage.json, report.md, and
changes.json, plus reconciliation.json and the linked-closed-Issue inventory.
Give every open issue exactly one triage row. Include evidence, a concrete
next step, canonical duplicate references, proposed closure reasons, and batch
IDs. Each proposed implementation batch needs one shared change, ordered member
IDs, individual acceptance and common validation. Rank the top few batches by
unblock/cleanup value relative to effort. Deferred verification has a revival
trigger. Validate coverage and row consistency with the helper; assess evidence
truth separately. Never invent usage totals or treat similarity as duplicate proof.

Finish with actual inventory and verified/unknown totals, top 3-5 recommended
batches, evidence-backed closure candidates, reconciliation discrepancy counts,
and links to the local artifacts.
Present a visible numbered picker for the next governed move, its consequence,
whether this session ends, and the sufficient model/effort for the next session.
Return the proposed GitHub changes for review; apply none in this session.
```

Inventory example, only after read authority is established:

```sh
triage_dir=$(mktemp -d)
gh api --paginate --slurp 'repos/pmark/arcadia/issues?state=open&per_page=100' > "$triage_dir/issues.raw.json"
python3 .agents/skills/arcadia-github-issues/scripts/issue_packets.py prepare "$triage_dir/issues.raw.json" "$triage_dir/packets"
python3 .agents/skills/arcadia-github-issues/scripts/issue_packets.py validate "$triage_dir/packets/snapshot.json" "$triage_dir/triage.json"
```

Run from the repository root, using absolute paths to the input snapshot and
output directory if stored elsewhere. Successful pagination and live inventory
reconciliation are the caller's responsibility; an empty file or failed API
command is a failure, not an empty backlog.

OpenCode discovers this repository skill under `.agents/skills/`; installed
global skills can also live under `~/.config/opencode/skills/`. Model IDs have
the form `provider_id/model_id`. References:
[skills](https://opencode.ai/docs/skills/),
[models](https://opencode.ai/docs/models/),
[GitHub API pagination](https://cli.github.com/manual/gh_api).
