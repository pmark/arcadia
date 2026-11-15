# Source references in adopted guidance

Indexed guidance sometimes links to Arcadia-specific skills, plans, and evidence
that adopting Projects do not contain. `docs/agent-guidance/source-references.json`
classifies those paths as source-owned and pins their bytes to an immutable,
public Arcadia commit. Setup, Way propagation, and the Way drift report use the
same target-aware generation: an existing target-local file stays local; an
absent source-owned target links to the pinned source. Generated fingerprints
cover the adapted content. This does not install skills or grant authority.

The manifest must identify a committed source revision whose files match all
listed SHA-256 hashes. When a source-owned dependency changes, commit that change
first, then update the revision and hashes to that commit in a subsequent
commit. Verify every path against `git show <revision>:<path>`; never point at
an uncommitted file or a moving branch. The focused Way propagation test checks
the hashes and requires every new indexed Markdown link to an existing source
file to be classified as either source-owned or target-local. Preserve the
target-local classification for each Project's own control documents.

The Signal fallback explains that reading the source does not install the skill.
If its source wording changes, generation refuses until that fallback has been
reviewed against the new text.
