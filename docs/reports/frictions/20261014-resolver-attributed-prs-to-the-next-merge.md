---
id: resolver-attributed-prs-to-the-next-merge
cost: 30
fix: this PR (a sha maps to a PR only through the merge whose second parent contains it, or when it is the squash commit itself)
status: practice
---
The first plan close-out resolved a candidate sha to a PR by taking the next merge commit on main. Settle commits land directly on main, so all six done Actions were credited to an unrelated PR (#1348). Unit tests passed because their scratch repo only used a no-ff merge. Caught by the Lead re-reading the committed record, not by tests or the review. A null PR is correct; never attribute by position. Rule for resolvers: test the direct-on-main case and the squash case, and read the real record, not only the test.
