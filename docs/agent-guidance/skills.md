# Arcadia skills across coding agents

Every Arcadia skill must support Codex, Claude Code and OpenCode when created
or modified. This includes personal skills, repository skills and generated
skills such as the broker’s `src/agentSetup/*.SKILL.md` templates. A skill’s
instructions, resources and discovery are part of the same change.

## One source, three discovery paths

For repository skills, maintain the complete folder under
`.agents/skills/<name>/`, with portable `name` and `description` frontmatter.
Codex and OpenCode discover that directory. Add the relative directory symlink
`.claude/skills/<name> -> ../../.agents/skills/<name>` for Claude Code.
Keep references and scripts relative to the skill directory, not the caller’s
working directory. Optional `agents/openai.yaml` is Codex UI metadata; no
required behavior may live only there.

For personal installations, expose the same source folder through
`~/.agents/skills/<name>` (Codex and OpenCode) and
`~/.claude/skills/<name>` (Claude Code and OpenCode). Use a stable source,
never a disposable candidate. Preserve and inspect existing entries before
replacing them; do not overwrite another maintained version. Existing generated
broker skills retain their host installer and safety checks: Claude’s installed
link also supplies OpenCode discovery. Do not hand-edit generated installations
or run a broker reinstall just to add a skill.

## Portable behavior

Write workflow requirements in terms of evidence and capabilities. Resolve the
current agent for identity and provider-specific launchers. Use native tools
only when available and authorized; name supported alternatives or an explicit
operation boundary when a host lacks sessions, messaging, delegation or timers.
Continue independent useful work. Never invent a substitute runner, silently
skip acceptance, weaken approval gates, or equate file access with live execution.

## Validate each change

1. Run `node --import tsx scripts/check-agent-skills.ts` from the candidate root.
   It validates all repository entrypoints and same-source discovery links;
   the existing agent-guidance CI check also runs it.
2. Review required references/scripts and host-specific instructions. Validate
   any changed executable through its existing focused checks. A filesystem
   check cannot prove behavioral portability.
3. In fresh sessions, check discovery without starting the workflow:

| Agent | Discovery-only request |
| --- | --- |
| Codex | List available skills; confirm `$arcadia-release-manager` and its source. |
| Claude Code | List available skills; confirm `/arcadia-release-manager` and its source. |
| OpenCode | Load `arcadia-release-manager` with the native `skill` tool and report its source; do not start coordination. |

Substitute the changed skill’s name. Record actual results separately from
filesystem proof. If a runtime is unavailable or permission hides skills,
report that exact verification gap; do not claim native discovery passed.
Installation never starts a watch or authorizes messaging or dispatch.

Official discovery contracts: [Claude Code](https://code.claude.com/docs/en/skills)
and [OpenCode](https://opencode.ai/docs/skills/). Codex uses the shared
`.agents/skills` source; provider UI metadata does not replace `SKILL.md`.
