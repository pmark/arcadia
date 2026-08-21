import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { GateStatus, NorthStarDocument, NorthStarGate } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const GATE_STATUSES: GateStatus[] = ["done", "in_progress", "blocked", "open", "unknown"];

export const NORTH_STAR_FILENAME = "NORTH_STAR.md";

export function northStarPath(workspacePath: string): string {
  return path.join(workspacePath, NORTH_STAR_FILENAME);
}

export class NorthStarParseError extends Error {}

/**
 * Read the workspace's declared North Star.
 *
 * Returns `null` rather than throwing when the file is absent, because "no
 * target declared yet" is a first-class state the Now screen renders — that
 * absence is itself the operator's next action, and refusing to load would
 * hide the one instruction that fixes it.
 */
export function loadNorthStar(workspacePath: string): NorthStarDocument | null {
  const absolute = northStarPath(workspacePath);
  if (!existsSync(absolute)) {
    return null;
  }

  const content = readFileSync(absolute, "utf8");
  const match = FRONTMATTER.exec(content);
  if (!match) {
    throw new NorthStarParseError(`${NORTH_STAR_FILENAME} has no YAML frontmatter block.`);
  }

  let data: Record<string, unknown>;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new NorthStarParseError(`${NORTH_STAR_FILENAME} frontmatter must be a YAML mapping.`);
    }
    data = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof NorthStarParseError) {
      throw error;
    }
    throw new NorthStarParseError(
      `${NORTH_STAR_FILENAME} frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const target = requiredString(data, "target");
  const projectSlug = requiredString(data, "project");

  return {
    target,
    projectSlug,
    why: optionalString(data, "why") ?? "",
    looksLike: optionalString(data, "looks_like") ?? "",
    gates: parseGates(data.gates),
    updated: optionalString(data, "updated"),
    path: absolute
  };
}

function parseGates(raw: unknown): NorthStarGate[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const gates: NorthStarGate[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = optionalString(record, "id");
    const title = optionalString(record, "title");
    if (!id || !title) {
      throw new NorthStarParseError(`Every gate needs an \`id\` and a \`title\`.`);
    }
    if (seen.has(id)) {
      throw new NorthStarParseError(`Duplicate gate id \`${id}\`.`);
    }
    seen.add(id);

    const declared = optionalString(record, "status");
    if (declared && !GATE_STATUSES.includes(declared as GateStatus)) {
      throw new NorthStarParseError(
        `Gate \`${id}\` has status \`${declared}\`; expected one of ${GATE_STATUSES.join(", ")}.`
      );
    }

    gates.push({
      id,
      title,
      actionRef: optionalString(record, "action") ?? null,
      declaredStatus: (declared as GateStatus | undefined) ?? null
    });
  }

  return gates;
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = optionalString(data, key);
  if (!value) {
    throw new NorthStarParseError(`${NORTH_STAR_FILENAME} is missing required field \`${key}\`.`);
  }
  return value;
}

function optionalString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}
