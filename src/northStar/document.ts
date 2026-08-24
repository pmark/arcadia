import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
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
    qaUrl: optionalString(data, "qa_url"),
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

// ---------------------------------------------------------------------------
// Marking an operator-owned gate
// ---------------------------------------------------------------------------

export interface GateStatusChange {
  gateId: string;
  title: string;
  previous: GateStatus;
  next: GateStatus;
  changed: boolean;
  path: string;
}

/**
 * Set the declared status of one operator-owned gate, in place.
 *
 * Edited as text rather than parsed-and-reserialized on purpose. This is a
 * document the operator writes by hand, with their own key order, comments and
 * prose below the frontmatter; a tool that reformatted the whole file every
 * time a gate was ticked would make them stop ticking gates. Only the one
 * `status:` line moves.
 *
 * Refuses a gate that tracks an Action. Those derive their status from the
 * record, and letting a tap overwrite that would put the document and the
 * database into a disagreement the screen has no way to show.
 */
export function setDeclaredGateStatus(
  workspacePath: string,
  gateId: string,
  next: GateStatus
): GateStatusChange {
  const absolute = northStarPath(workspacePath);
  if (!existsSync(absolute)) {
    throw validationError(`No ${NORTH_STAR_FILENAME} in this workspace, so there are no gates to mark.`, {
      expectedPath: absolute
    });
  }

  const content = readFileSync(absolute, "utf8");
  const lines = content.split("\n");

  const frontmatterEnd = findFrontmatterEnd(lines);
  const gateStart = findGateLine(lines, frontmatterEnd, gateId);
  const dashIndent = indentOf(lines[gateStart]);
  const gateEnd = findGateBlockEnd(lines, gateStart, frontmatterEnd, dashIndent);

  let keyIndent = dashIndent + 2;
  let statusLine = -1;
  let title = gateId;

  for (let index = gateStart + 1; index < gateEnd; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }
    keyIndent = indentOf(line);
    const key = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line)?.[1];
    if (key === "action") {
      throw derivedGateError(gateId, line.split(":").slice(1).join(":").trim());
    }
    if (key === "status") {
      statusLine = index;
    }
    if (key === "title") {
      title = line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "") || gateId;
    }
  }

  const previous = (statusLine >= 0
    ? (lines[statusLine].split(":").slice(1).join(":").trim() as GateStatus)
    : "open") as GateStatus;

  if (previous === next) {
    return { gateId, title, previous, next, changed: false, path: absolute };
  }

  if (statusLine >= 0) {
    lines[statusLine] = `${" ".repeat(indentOf(lines[statusLine]))}status: ${next}`;
  } else {
    lines.splice(gateEnd, 0, `${" ".repeat(keyIndent)}status: ${next}`);
  }

  writeFileAtomic(absolute, lines.join("\n"));
  return { gateId, title, previous, next, changed: true, path: absolute };
}

function derivedGateError(gateId: string, actionRef: string): Error {
  return validationError(
    `Gate \`${gateId}\` tracks \`${actionRef}\`, so its status comes from that Action. ` +
      `Move the Action to change it — marking it here would put the document and the record into disagreement.`,
    { gateId, actionRef }
  );
}

function findFrontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") {
    throw validationError(`${NORTH_STAR_FILENAME} has no YAML frontmatter block.`);
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return index;
    }
  }
  throw validationError(`${NORTH_STAR_FILENAME} frontmatter is never closed.`);
}

function findGateLine(lines: string[], frontmatterEnd: number, gateId: string): number {
  const pattern = new RegExp(`^\\s*-\\s+id:\\s*["']?${escapeRegExp(gateId)}["']?\\s*$`);
  for (let index = 1; index < frontmatterEnd; index += 1) {
    if (pattern.test(lines[index])) {
      return index;
    }
  }
  throw validationError(`No gate with id \`${gateId}\` in ${NORTH_STAR_FILENAME}.`, {
    gateId,
    known: knownGateIds(lines, frontmatterEnd)
  });
}

/** The gate's block runs until the next list item, or the end of the list. */
function findGateBlockEnd(lines: string[], gateStart: number, frontmatterEnd: number, dashIndent: number): number {
  for (let index = gateStart + 1; index < frontmatterEnd; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }
    if (indentOf(line) <= dashIndent) {
      return index;
    }
  }
  return frontmatterEnd;
}

/** Named in the not-found error, because a typo is the likeliest cause of one. */
function knownGateIds(lines: string[], frontmatterEnd: number): string[] {
  const ids: string[] = [];
  for (let index = 1; index < frontmatterEnd; index += 1) {
    const match = /^\s*-\s+id:\s*["']?([^"'\s]+)["']?\s*$/.exec(lines[index]);
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}

function indentOf(line: string): number {
  return /^(\s*)/.exec(line)?.[1].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rename over the original so a failed write cannot leave a half-written North Star. */
function writeFileAtomic(absolute: string, content: string): void {
  const temporary = `${absolute}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, absolute);
}
