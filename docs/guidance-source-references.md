# Source references in adopted guidance

Indexed guidance sometimes links to Arcadia-specific skills, plans, and evidence
that adopting Projects do not contain. `docs/agent-guidance/source-references.json`
classifies those paths as source-owned and pins their bytes to an immutable,
public Arcadia commit. Setup, Way propagation, and the Way drift report use the
same target-aware generation: an existing target-local file stays local; an
absent source-owned target links to the pinned source. Generated fingerprints
cover the adapted content. This does not install skills or grant authority.
When an indexed procedure refers to a skill absent from the committed target,
its generated text explicitly routes that workflow to an Arcadia source checkout
with the skill and runtime available. The pinned link is a historical snapshot,
including its transitive links; it is not proof that those dependencies are current
or runnable in the adopting Project. Use the supported host's current resources
for the actual operation.

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
CI fetches the pinned commit explicitly and verifies the manifest hashes against
its Git objects, so a typo or a hash from a different revision cannot pass.
