# Install for Claude Code, OpenCode and Codex

The maintained source is `.agents/skills/arcadia-github-issues/` in this
repository. Keep the whole folder, including `references/` and `scripts/`.
Installing the skill adds instructions; it does not authorize GitHub writes,
governance changes, credential use or paid inference.

## Repository access

After the reviewed change is available in your checkout, start a fresh agent
session in the Arcadia repository root. Codex and OpenCode discover the shared
`.agents/skills/` source. The checked-in relative symlink
`.claude/skills/arcadia-github-issues -> ../../.agents/skills/arcadia-github-issues`
gives Claude Code access to that same source. No global installation is needed
for sessions in this checkout. The relative link also works in other clones and
worktrees containing this commit.

| Agent | Invoke or verify discovery |
| --- | --- |
| Claude Code | Run `/arcadia-github-issues`. For a discovery-only check, ask Claude to list the available skills without running triage. |
| OpenCode | Ask: `Load the arcadia-github-issues skill and report its source path; do not run triage.` It loads via the native `skill` tool. |
| Codex | Mention `$arcadia-github-issues`. Codex CLI/IDE also exposes `/skills`. |

To run the initial Arcadia triage with DeepSeek, use
[the OpenCode prompt](opencode-prompt.md) after selecting the configured model
with `/models`.

## Personal access from other projects on this Mac

Once this reviewed change has landed in the stable main checkout, run this in
your own Terminal. Use the stable checkout, not an agent worktree that may be
retired later:

```sh
(
  set -eu
  arcadia_skill_source="/Users/pmark/Dev/MR/Arcadia/arcadia/.agents/skills/arcadia-github-issues"
  test -f "$arcadia_skill_source/SKILL.md"
  mkdir -p "$HOME/.agents/skills" "$HOME/.claude/skills"
  for arcadia_skill_dest in "$HOME/.agents/skills/arcadia-github-issues" "$HOME/.claude/skills/arcadia-github-issues"; do
    if [ -e "$arcadia_skill_dest" ] || [ -L "$arcadia_skill_dest" ]; then
      printf 'Existing entry; inspect before updating: %s\n' "$arcadia_skill_dest"
    else
      ln -s "$arcadia_skill_source" "$arcadia_skill_dest"
    fi
  done
)
```

If the `test` command fails, the block stops: that checkout does not contain the
skill yet. Existing directories or links are reported and left untouched;
inspect those before choosing whether to update an installation. On another machine, replace
only `arcadia_skill_source` with that machine's stable Arcadia checkout path.

Codex uses the personal `.agents/skills/` entry; Claude Code uses the personal
`.claude/skills/` entry. OpenCode can discover both locations, which point to
the same maintained skill rather than independent versions. No separate copy
under `.config/opencode/skills/` is needed.

Start fresh Claude Code and OpenCode sessions. Codex detects skill changes
automatically; restart Codex if the new skill does not appear. Verify that both
links expose the entrypoint:

```sh
test -f "$HOME/.agents/skills/arcadia-github-issues/SKILL.md"
test -f "$HOME/.claude/skills/arcadia-github-issues/SKILL.md"
```

Then perform the discovery checks in the table. The links follow updates in the
stable checkout; on another host or in a cloud environment, install there too.
Loading the files is the deterministic filesystem check. Native discovery must
be confirmed in each agent session; do not infer it from link creation alone.

## Official discovery references

- [Codex skill locations and symlinks](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
- [Claude Code skill locations and symlink support](https://code.claude.com/docs/en/skills#choose-where-skills-load)
- [OpenCode skill locations](https://opencode.ai/docs/skills/)
