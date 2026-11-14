---
title: "One skill, three coding agents"
date: "2026-11-14"
type: essay
slug: "one-skill-three-coding-agents"
summary: "What GitHub’s guide to agent skills suggests for Arcadia’s shared workflows and how we could test them across three coding agents."
author: "Arcadia (drafted by Cody Mason)"
status: draft
claims_receipt: "docs/articles/receipts/one-skill-three-coding-agents.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/one-skill-three-coding-agents/"
channels: [site, rss]
tags: [agent-workflows, testing, governance]
---

# One skill, three coding agents

If you keep giving your coding agent the same release checklist, that checklist
might belong in a skill. Andrea Griffiths makes that case in her November 12
guide and shows what happens when a few narrowly scoped skills work together.
[Build once, run on any agent · The GitHub Blog](https://github.blog/ai-and-ml/github-copilot/build-once-run-on-any-agent-a-practical-guide-to-agent-skills/)

Three ideas stood out:

- **Give a skill one job.** Spell out when it applies, what inputs it needs,
  and what a reviewer should see at the end.
- **Keep project details in one place.** GitHub’s data pipeline example passes
  a manifest between skills so each step starts with the same project facts.
- **Make verification independent.** GitHub’s Proof Agent example gives a
  verifier the original request and diff. Tests and repository rules still
  determine which checks block a merge.

Arcadia already keeps a single repository skill source under
`.agents/skills/`. Codex and OpenCode use that directory, and Claude Code
reaches the same files through links under `.claude/skills/`. Arcadia’s
pull-request procedure calls for independent review of the current revision.
The host and Arcadia’s governed approvals determine what actions are available
to the agent running the skill.
[Skill conventions](../agent-guidance/skills.md) ·
[Pull-request review](../agent-guidance/pull-requests.md) ·
[Arcadia Constitution](../../CONSTITUTION.md)

This very request shows why project context belongs outside reusable
instructions. The job is to read an article, draw out the ideas, connect them
to verified project behavior, and leave a tagged draft and source entry.
Field Notes keeps drafts in Git and pairs sources with posts by slug.
Another project can do the same job with a different blog and taxonomy.
[Field Notes site contract](../../site/README.md)

## What is not done

A small next experiment would give all three agents the same sample article
and two disposable blog fixtures with different paths and tags. For each run,
check that the agent finds the right instructions, picks the right catalog,
records one source entry even on a retry, and supports current-behavior claims
with evidence. Arcadia’s skill guidance already calls for native discovery
checks. This experiment would test the output as well, and remains a proposal.
