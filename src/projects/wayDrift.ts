import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Project } from "../domain/types.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import {
  adoptContinuationProtocol,
  CONTINUATION_PROTOCOL_FILE,
  readAdoptedConstitution,
  readAdoptedFile,
  updateAgentsMarkdown
} from "./contextSetup.js";

const ADOPTION_FILE = ".arcadia/arcadia-way/adoption.json";

export type WayFileDriftStatus = "match" | "differs" | "missing" | "unknown";

export interface WayDriftReport {
  projectId: string;
  projectName: string;
  repoPath: string | null;
  /** "unknown" whenever the repository path is unset or unreachable -- never assumed current. */
  status: "current" | "stale" | "unknown";
  files: {
    constitution: WayFileDriftStatus;
    agentsRegion: WayFileDriftStatus;
    continuationProtocol: WayFileDriftStatus;
  };
  upgradePolicy: string | null;
}

/**
 * Reports, per registered project, whether its adopted copies of
 * `CONSTITUTION.md`, the shared `AGENTS.md` region, and
 * `docs/agent-continuation-protocol.md` still match Arcadia's own canonical
 * text -- without writing anything anywhere.
 *
 * Drift detection reuses the same pure generator functions `setup-context`
 * writes with (`updateAgentsMarkdown`, `adoptContinuationProtocol`): a file is
 * current exactly when regenerating it from the canonical source reproduces
 * its own bytes. That keeps the read side and the write side from being two
 * separate statements of what "adopted" means.
 */
export function reportWayDrift(db: Database.Database): WayDriftReport[] {
  const canonicalConstitution = readAdoptedConstitution();
  const canonicalProtocolSource = readAdoptedFile(CONTINUATION_PROTOCOL_FILE);

  return listProjects(db).map((project) => {
    const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim() || null;
    return buildDriftReport(project, repoPath, canonicalConstitution, canonicalProtocolSource);
  });
}

function buildDriftReport(
  project: Project,
  repoPath: string | null,
  canonicalConstitution: string | null,
  canonicalProtocolSource: string | null
): WayDriftReport {
  if (!repoPath || !isReachableDirectory(repoPath)) {
    return {
      projectId: project.id,
      projectName: project.name,
      repoPath,
      status: "unknown",
      files: { constitution: "unknown", agentsRegion: "unknown", continuationProtocol: "unknown" },
      upgradePolicy: null
    };
  }

  const files = {
    constitution: compareConstitution(repoPath, canonicalConstitution),
    agentsRegion: compareAgentsRegion(repoPath),
    continuationProtocol: compareContinuationProtocol(repoPath, canonicalProtocolSource)
  };
  const stale = Object.values(files).some((status) => status !== "match");

  return {
    projectId: project.id,
    projectName: project.name,
    repoPath,
    status: stale ? "stale" : "current",
    files,
    upgradePolicy: readUpgradePolicy(repoPath)
  };
}

function compareConstitution(repoPath: string, canonical: string | null): WayFileDriftStatus {
  if (canonical === null) return "unknown";
  const target = readIfExists(path.join(repoPath, "CONSTITUTION.md"));
  if (target === null) return "missing";
  return target === canonical ? "match" : "differs";
}

function compareAgentsRegion(repoPath: string): WayFileDriftStatus {
  const target = readIfExists(path.join(repoPath, "AGENTS.md"));
  if (target === null) return "missing";
  return updateAgentsMarkdown(target) === target ? "match" : "differs";
}

function compareContinuationProtocol(repoPath: string, canonicalSource: string | null): WayFileDriftStatus {
  if (canonicalSource === null) return "unknown";
  const target = readIfExists(path.join(repoPath, CONTINUATION_PROTOCOL_FILE));
  if (target === null) return "missing";
  return adoptContinuationProtocol(canonicalSource, target, null) === target ? "match" : "differs";
}

function readUpgradePolicy(repoPath: string): string | null {
  const raw = readIfExists(path.join(repoPath, ADOPTION_FILE));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { upgrade_policy?: unknown };
    return typeof parsed.upgrade_policy === "string" ? parsed.upgrade_policy : null;
  } catch {
    return null;
  }
}

function isReachableDirectory(repoPath: string): boolean {
  try {
    return existsSync(repoPath) && statSync(repoPath).isDirectory();
  } catch {
    return false;
  }
}

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
