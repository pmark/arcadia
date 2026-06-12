# Arcadia Intake

Arcadia Intake is the shared natural-language front door for Arcadia.

It turns raw text from any ingress into a typed, deterministic result:

```text
Ingress
  -> Intake
  -> Intent resolution
  -> Structured request
  -> Existing Arcadia commands, work items, review items, or execution plans
```

Intake does not execute work. It does not invoke Codex. It does not own Discord, iCloud ingress, dogfood, dashboard, or CLI behavior. Those surfaces can call Intake to interpret text, then route the result through existing Arcadia command and repository code.

## Why It Exists

Arcadia should not require users to remember command names, skills, queues, or execution rules for common workflows. A user should be able to write:

```sh
pnpm arcadia ask "Add Pinterest publishing support to Rebuster." --workspace "$WORKSPACE"
```

and have Arcadia decide whether this is work, a review question, a status request, a goal update, or a loose thought that needs clarification.

## Difference From Ingress Adapters

Ingress adapters move text into Arcadia from a source:

- CLI receives a terminal argument.
- Dogfood ask supplies the repo-local workspace.
- Discord receives a slash-command request.
- iCloud ingress reads local request files.
- Dashboard can pass user-entered text from UI.

Intake is the common parser beneath those adapters. It accepts raw text and workspace context, then returns a typed result. It does not know or care which adapter supplied the text.

## Difference From Codex

Codex is an execution or planning tool for code-worthy work after Arcadia has already structured the request.

Intake is deterministic and local. It does not call Codex, an LLM, a local model, a server, Discord, or iCloud. If Intake decides work is Codex-worthy, it returns structured fields that the ask command can route into the existing Codex packet flow.

## Supported Intents

The first supported intents are:

- `CaptureThought`: Preserve a loose idea or unclear note and create a Requires Review item.
- `InstantiateProject`: Create a work item for a supported templated project.
- `UpdateGoal`: Update the goal of an existing project.
- `CreateWork`: Create actionable work for an existing project.
- `ReviewRequired`: Show Requires Review items.
- `ShowStatus`: Show current status and focus guidance.

Intake also recognizes simple `pause <project>` and `resume <project>` project status requests.

Supported project templates:

- Astro website/blog
- Phaser game
- Three.js game/experiment
- NextJS web app
- serverless API
- NodeJS utility app

## Confidence Behavior

Intake returns:

- raw input
- resolved intent
- numeric confidence and confidence label
- extracted fields
- missing fields
- proposed action
- whether execution is safe
- whether review is required
- human-readable explanation

High-confidence results can be routed immediately to existing Arcadia behavior. For example, `UpdateGoal` updates the project goal, while `CreateWork` creates an auditable work item and Codex packet.

Medium-confidence results preserve the proposed interpretation but require confirmation. They become Requires Review items instead of silently executing.

Low-confidence results are captured as thoughts and become Requires Review items asking for clarification. Arcadia preserves the source input instead of discarding it.

## Deterministic-First Design

Intake currently supports deterministic patterns including:

```text
create a <template> called <name>
create a <template> named <name>
the goal for <project> is <goal>
pause <project>
resume <project>
add <action> for <project>
build <action> for <project>
implement <action> for <project>
what needs review
what should I focus on
status
```

Project names and template names use local fuzzy matching. Ambiguous or weak matches require review.

## Examples

CLI:

```sh
pnpm arcadia ask "Create a NextJS app called Rebuster Admin." --workspace "$WORKSPACE"
pnpm arcadia ask "The goal for MIDI Opener is to improve App Store conversion." --workspace "$WORKSPACE"
pnpm arcadia ask "What needs review?" --workspace "$WORKSPACE"
pnpm arcadia review --workspace "$WORKSPACE"
```

Dogfood:

```sh
pnpm arcadia dogfood ask "Implement Arcadia Intake as the unified natural language front door."
```

Discord:

```text
/arcadia request Add Pinterest publishing support to Rebuster.
/arcadia request What should I focus on today?
```

iCloud ingress:

```text
~/ArcadiaIngress/iCloudIdeas/in/rebuster-pinterest.txt
```

with file contents:

```text
Pinterest might help Rebuster.
```

That input is low-confidence and becomes a Requires Review item asking for clarification.
