---
arcadia: v1
type: decision
id: "0095"
slug: decide-whether-to-install-the-stable-demo-deployment-of-the-arcadia-dashboard
project: arcadia
status: approved
question: "Decide whether to install the stable demo deployment of the Arcadia dashboard described in Issue #1116. It would serve on port 3030 against the martianrover workspace, built from release tags, promoted nightly at 04:00 behind a smoke-check gate that keeps the last good build, with one-command failover. Nothing is installed by raising this Decision."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Install it; the release manager may cut rel- tags from green main
options:
  - label: Install it; the release manager may cut rel- tags from green main
    consequence: "After the tooling PR merges under the normal review gate, the release manager:\n- cuts rel-YYYY.MM.DD from main, only when all required checks are green;\n- builds and smoke-tests it;\n- installs both LaunchAgents and the port-443 tailscale serve entry;\n- verifies /now, /actions, /review and /projects from the Tailnet hostname;\n- pings you with the URLs.\nFrom then on, the nightly job deploys the newest release tag at 04:00, and a failure keeps the last good build and pings you. The release manager tags green main at most once a day, so the demo trails main by at most a day. You can still cut your own tags, or run release.sh use <tag> to fail over."
    recommended: true
  - label: Install it; only I cut release tags
    consequence: Same install and verification, but the release manager cuts only the first rel- tag needed to bring the demo up, and never tags again. The demo changes only when you push a tag matching v<digit>, rel- or release-. The nightly job then deploys it, or does nothing if there is no new tag. The demo is maximally predictable, but it falls behind main until you tag.
    recommended: false
  - label: Not now
    consequence: "Nothing is installed. The tooling PR may still merge, as inert code with no LaunchAgents, no serve entry and no tags. The demo stays the next dev dashboard on :3020, which is slow after each restart; the release manager keeps pre-loading its pages after every restart. Revival trigger: your next demo request, or another report of a slow or dead dashboard."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: Install it; the release manager may cut rel- tags from green main
decided: 2026-10-09
---

# Decision 0095: Decide whether to install the stable demo deployment of the Arcadia dashboard described in Issue #1116. It would serve on port 3030 against the martianrover workspace, built from release tags, promoted nightly at 04:00 behind a smoke-check gate that keeps the last good build, with one-command failover. Nothing is installed by raising this Decision.

## Options

- **Install it; the release manager may cut rel- tags from green main** (recommended): After the tooling PR merges under the normal review gate, the release manager:
- cuts rel-YYYY.MM.DD from main, only when all required checks are green;
- builds and smoke-tests it;
- installs both LaunchAgents and the port-443 tailscale serve entry;
- verifies /now, /actions, /review and /projects from the Tailnet hostname;
- pings you with the URLs.
From then on, the nightly job deploys the newest release tag at 04:00, and a failure keeps the last good build and pings you. The release manager tags green main at most once a day, so the demo trails main by at most a day. You can still cut your own tags, or run release.sh use <tag> to fail over.
- **Install it; only I cut release tags**: Same install and verification, but the release manager cuts only the first rel- tag needed to bring the demo up, and never tags again. The demo changes only when you push a tag matching v<digit>, rel- or release-. The nightly job then deploys it, or does nothing if there is no new tag. The demo is maximally predictable, but it falls behind main until you tag.
- **Not now**: Nothing is installed. The tooling PR may still merge, as inert code with no LaunchAgents, no serve entry and no tags. The demo stays the next dev dashboard on :3020, which is slow after each restart; the release manager keeps pre-loading its pages after every restart. Revival trigger: your next demo request, or another report of a slow or dead dashboard.

## Rationale

Operator request, 2026-10-09: a stable deployment that always works for a demo at any time and uses the same martianrover workspace as the development deployment. The operator directed:
- nightly deploys driven by release tags (a version number, rel or release prefix);
- easy failover to other tags;
- a fixed port, plus a Tailscale name if possible.

The current dashboard on :3020 runs next dev from the primary checkout. Every post-merge service restart makes each page cold-compile for 10-50s, which looks dead from a phone.

The design, code-only until this Decision is answered, is scripts/release.sh, built in a PR that references #1116:
- Each tag is built in its own detached worktree under /Users/pmark/Dev/MR/Arcadia/releases.
- next start serves releases/current on :3030 with ARCADIA_WORKSPACE set to martianrover, and the dashboard uses that release's own built CLI.
- A deploy smoke-tests the candidate on :3031 before swapping current. Any failure keeps the current release serving.
- release.sh use <tag> fails over to another built tag in about 2s.
- services.sh restart never touches the demo.

Installing is a deployment under CONSTITUTION Authority. It means:
- two LaunchAgents: com.arcadia.demo.dashboard (KeepAlive) and com.arcadia.demo.nightly (04:00);
- optionally, one tailscale serve entry mapping https://arcadia-1.alpine-rattlesnake.ts.net/ (port 443, currently unused) to :3030;
- cutting release tags.

Limits:
- The demo writes real data to martianrover.
- It shares the live worker, Intelligence and Discord bot.
- A destructive schema migration must ship with a new tag.
- A separate demo.<tailnet> name needs Tailscale Services set up by the operator in the admin console; this Decision does not cover that.

Everything is reversible: bootout the two agents, run tailscale serve off and delete the releases directory.

Proposed by Agent Ask raise-stable-demo-deployment-decision-20261009.
