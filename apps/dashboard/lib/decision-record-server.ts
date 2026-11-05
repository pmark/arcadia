import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { withReadOnlyDatabase } from "../../../src/db/connection";
import { getProjectMetadata } from "../../../src/db/repositories";
import { loadOpenDecisions } from "./arcadia-cli";

/** Far above any Decision on record (the largest is about 24 KB); a bigger file is cut and says so, never sent whole. */
export const DECISION_RECORD_MAX_BYTES = 256 * 1024;

export interface DecisionRecord {
  id: string;
  relativePath: string;
  updated: string;
  /** The document's body, ready to render. */
  markdown: string;
  /** The document's front matter as written, so the full record leaves nothing out; null when it has none. */
  frontMatter: string | null;
  truncated: boolean;
}

export type DecisionRecordResult =
  | { ok: true; record: DecisionRecord }
  | { ok: false; status: number; error: string };

/** A document's body and its leading `---` front matter, when it has any. */
export function splitDecisionRecord(text: string): { frontMatter: string | null; markdown: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? { frontMatter: match[1], markdown: text.slice(match[0].length).trim() } : { frontMatter: null, markdown: text.trim() };
}

function repoPathOf(workspace: string, projectId: string): string | null {
  return withReadOnlyDatabase(workspace, (db) => getProjectMetadata(db, projectId)?.repo_path?.trim() || null);
}

/**
 * Read one open Decision's document, only when the operator asks for it. It reads nothing else: the id must name an
 * open Decision in that Project, and the file must resolve inside that Project's repository.
 */
export async function loadDecisionRecord(project: string, id: string): Promise<DecisionRecordResult> {
  const { data } = await loadOpenDecisions(project);
  const inProject = data.decisions.filter((decision) => decision.projectSlug === project);
  const byId = inProject.filter((decision) => decision.id === id);
  const matches = byId.length > 0 ? byId : inProject.filter((decision) => decision.slug === id);
  if (matches.length === 0) return { ok: false, status: 404, error: "This Decision isn't open any more, so its record isn't offered here." };
  if (matches.length > 1) {
    return { ok: false, status: 409, error: `Two open Decisions share this id: ${matches.map((decision) => decision.relativePath).join(", ")}.` };
  }
  const decision = matches[0];
  const repoPath = repoPathOf(resolveReadyWorkspace().workspacePath, decision.projectId);
  if (repoPath === null) return { ok: false, status: 409, error: "This Project has no repository path, so its Decision can't be read here." };

  const root = await realpath(path.resolve(repoPath));
  const absolute = await realpath(path.resolve(root, decision.relativePath));
  const inside = path.relative(root, absolute);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside) || path.extname(absolute).toLowerCase() !== ".md") {
    return { ok: false, status: 400, error: "This Decision's path is outside its repository." };
  }
  const bytes = await readFile(absolute);
  const truncated = bytes.byteLength > DECISION_RECORD_MAX_BYTES;
  const text = bytes.subarray(0, DECISION_RECORD_MAX_BYTES).toString("utf8");
  return {
    ok: true,
    record: { id: decision.id, relativePath: decision.relativePath, updated: String(decision.updated), ...splitDecisionRecord(text), truncated }
  };
}
