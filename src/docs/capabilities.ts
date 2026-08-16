import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DispatchBlocker } from "./dispatch.js";

/**
 * A repository's capability registry, when it keeps one.
 *
 * Only the two fields this check needs are modelled. The registry carries much
 * more, and reading it loosely means a repository can extend its own schema
 * without Arcadia refusing to parse it.
 */
interface RegistryCommand {
  id?: unknown;
  invocation?: unknown;
  kind?: unknown;
  mutates?: unknown;
}

export const CAPABILITY_REGISTRY_PATH = ".arcadia/arcadia-way/capabilities.json";

/**
 * Check that no command claims to be read-only while declaring that it writes.
 *
 * The naming rule says a noun reads state and a verb may mutate it within
 * declared authority, so the part of speech is an authority signal an agent is
 * told to trust before running anything. A registry entry with `kind: "query"`
 * and `mutates: true` makes that signal lie, and the lie propagates: prose
 * copies the registry, and an agent then runs a writing command believing it is
 * orientation.
 *
 * The invariant is one-directional. `kind: "action"` with `mutates: false` is
 * fine -- claiming more authority than you use is safe, and several deliberate
 * entries do exactly that. Only the reverse is a defect.
 *
 * A repository without a registry returns no blockers. Most do not keep one,
 * and refusing to dispatch over its absence would impose a mechanism no project
 * adopted.
 */
export function checkCapabilityRegistry(repoRoot: string): DispatchBlocker[] {
  let raw: string;
  try {
    raw = readFileSync(join(repoRoot, CAPABILITY_REGISTRY_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [
      {
        relativePath: CAPABILITY_REGISTRY_PATH,
        field: "file",
        message: `This repository has a capability registry, but it could not be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`,
        remedy: `Make ${CAPABILITY_REGISTRY_PATH} a readable UTF-8 file, or remove it if this repository does not keep a registry.`
      }
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [
      {
        relativePath: CAPABILITY_REGISTRY_PATH,
        field: "file",
        message: "The capability registry is not valid JSON, so which commands mutate state cannot be determined.",
        remedy: `Fix the JSON syntax in ${CAPABILITY_REGISTRY_PATH}.`
      }
    ];
  }

  const commands = (parsed as { commands?: unknown })?.commands;
  if (!Array.isArray(commands)) return [];

  return commands.flatMap((entry) => {
    const command = entry as RegistryCommand;
    if (command.kind !== "query" || command.mutates !== true) return [];

    const name =
      (typeof command.id === "string" && command.id) ||
      (typeof command.invocation === "string" && command.invocation) ||
      "(unnamed command)";

    return [
      {
        relativePath: CAPABILITY_REGISTRY_PATH,
        field: `commands.${name}.kind`,
        message: `"${name}" declares kind "query" but also \`mutates: true\`, so a command documented as read-only actually writes.`,
        remedy: `Set kind to "action" for "${name}", or set \`mutates\` to false if it does not write after all. Update any prose that lists it as read-only in the same change.`
      }
    ];
  });
}
