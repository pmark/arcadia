---
id: main-checkout-holds-another-sessions-unpushed-settles
cost: 45
fix: proposed: agent-ask settle refuses or warns when local main is ahead of origin with commits it did not make, and names the remedy
status: open
---
Queue-placing settlements must run from the main checkout, and settlements commit locally and never push. Another session's settle commits sat unpushed on local main for over half an hour (Cody Atlas, two settles including the answer to Decision 0127), so this session could not settle without stacking on them (which would publish them with the next push) or resetting them away (which destroys unpushed work). A push of another session's commits was blocked by the host as out-of-place publication, correctly. Resolution needed the operator to push main by hand. Proposed fix: make settle detect local main ahead of origin/main with foreign commits and stop with the exact remedy; and have settlement land through a branch and PR by default.
