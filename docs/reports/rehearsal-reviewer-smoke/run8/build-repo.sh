#!/bin/zsh
# Builds a real throwaway git repo: base = run-8 rendered fixture tree (.fixture-amended), commit 1 = MARKER.md, commit 2 = settlement-shaped commit.
set -e
N=/private/tmp/claude-501/-Users-pmark-Dev-MR-Arcadia-arcadia/ceb509ea-dacf-4b5b-9ba6-2621299b95f6/scratchpad/qa-run8-smoke
D=/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/rehearsal-chain-dry-run.l7MT0W
R=$N/repo
rm -rf $R; mkdir -p $R; cp -R $D/.fixture-amended/. $R/
cd $R
export GIT_AUTHOR_NAME="Claudia Mason" GIT_AUTHOR_EMAIL="claudia.mason@agents.arcadia.local" GIT_COMMITTER_NAME="Claudia Mason" GIT_COMMITTER_EMAIL="claudia.mason@agents.arcadia.local"
git init -q -b main
git add -A
GIT_AUTHOR_DATE="2026-10-06T10:00:00-0700" GIT_COMMITTER_DATE="2026-10-06T10:00:00-0700" git commit -q -m "Reset the rehearsal fixture as a 9-Action serial chain for rehearsal run 8"
git rev-parse HEAD > $N/base.sha
printf 'three-action rehearsal start\n' > MARKER.md
git add MARKER.md
GIT_AUTHOR_DATE="2026-10-06T10:42:30-0700" GIT_COMMITTER_DATE="2026-10-06T10:42:30-0700" git commit -q -m "Implement MARKER.md for three-action rehearsal run 8

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
C1=$(git rev-parse HEAD)
RID=complete-write-start-marker-run8-2026-10-06
mkdir -p .arcadia/asks/archive
printf '%s\n' "{\"agent_ask\":\"v1\",\"request_id\":\"$RID\",\"project\":\"three-action-rehearsal\",\"intent\":\"complete\",\"target_ref\":\"action/write-start-marker\",\"candidate_revision\":\"$C1\",\"evidence\":[{\"criterion\":\"MARKER.md exists and contains exactly the line \\\"three-action rehearsal start\\\" followed by a trailing newline, with no other content.\",\"status\":\"met\"},{\"criterion\":\"The genesis check node scripts/check-rehearsal.mjs passes.\",\"status\":\"met\"}],\"desired_result\":\"Mark write-start-marker complete.\"}" > .arcadia/asks/archive/agent-ask-$RID.yaml
cat > MISSION_LOG.md <<LOG
---
arcadia: v1
type: log
slug: three-action-rehearsal-mission-log
project: three-action-rehearsal
updated: 2026-10-06
---

# Mission Log: three-action-rehearsal

## 2026-10-06 — Completed three-action-rehearsal/write-start-marker

- **Did:** Completed Action three-action-rehearsal/write-start-marker from accepted evidence (Candidate $C1).
- **Result:** Every declared acceptance criterion was accepted as met: "MARKER.md exists and contains exactly the line "three-action rehearsal start" followed by a trailing newline, with no other content."; "The genesis check node scripts/check-rehearsal.mjs passes.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask $RID).
LOG
# pointer + status edits, exactly the lines the run-7 settlement changed
sed -i '' 's/^current_action: write-start-marker$/current_action: transform-start-marker/' PROJECT.md
python3 - <<'PY'
import re
p='docs/plans/autonomous-three-action-rehearsal.md'
s=open(p).read()
s=s.replace("  - id: write-start-marker\n    title: Implement MARKER.md containing exactly the line \"three-action rehearsal start\" plus a trailing newline.\n    status: open","  - id: write-start-marker\n    title: Implement MARKER.md containing exactly the line \"three-action rehearsal start\" plus a trailing newline.\n    status: done",1)
s=s.replace("\ncurrent_action: write-start-marker\n---","\ncurrent_action: transform-start-marker\n---",1)
open(p,'w').write(s)
PY
git add -A
GIT_AUTHOR_DATE="2026-10-06T10:43:44-0700" GIT_COMMITTER_DATE="2026-10-06T10:43:44-0700" git commit -q -m "chore(arcadia): settle
 $RID

- Marked Action three-action-rehearsal/write-start-marker done with accepted evidence for all 2 criteria.
- Advanced to the next eligible Action in the explicit queue order. Pointer: three-action-rehearsal/transform-start-marker.
- Archived the settled Ask file to .arcadia/asks/archive/agent-ask-$RID.yaml.

Written by \`arcadia agent-ask settle --apply\` (asksettle_da211dec7a6f43bdb2).
Arcadia writes and lands its own managed documents; it did not author the
decision they record."
git rev-parse HEAD > $N/head.sha
git rev-parse HEAD^{tree} > $N/head.tree
printf '%s\n%s\n' $C1 $(cat $N/head.sha) > $N/commits.txt
git format-patch --no-signature --stdout $(cat $N/base.sha)..HEAD > $N/candidate.patch
git diff --name-status --no-renames $(cat $N/base.sha) HEAD
git diff --numstat --no-renames $(cat $N/base.sha) HEAD
