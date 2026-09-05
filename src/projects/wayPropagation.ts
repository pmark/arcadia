import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONTINUATION_PROTOCOL_FILE,
  adoptContinuationProtocol,
  readAdoptedConstitution,
  readAdoptedFile,
  thinClaudeWrapper,
  updateAgentsMarkdown
} from "./contextSetup.js";

/**
 * The two propagation tiers Decision 0024 defines.
 *
 * Mechanical: generated text Arcadia can reproduce byte-for-byte and that a
 * project never authors, so a mechanical-tier pull request merges without
 * review. Governing: the Constitution and the continuation protocol, which
 * change what an agent is permitted to do -- these always wait for a human.
 */
export type WayTier = "mechanical" | "governing";

export interface WayFileChange {
  /** Repository-relative path. */
  path: string;
  tier: WayTier;
  /** "write" has content ready to commit; "unmanageable" means propagation must skip this file and say why. */
  action: "write" | "unmanageable";
  content: string | null;
  reason?: string;
}

export interface WayPropagationPlan {
  repoPath: string;
  changes: WayFileChange[];
  hasMechanicalChanges: boolean;
  hasGoverningChanges: boolean;
  unmanageable: WayFileChange[];
}

const ADOPTION_FILE = ".arcadia/arcadia-way/adoption.json";

/**
 * The declared upgrade policy from an adopting repository's own
 * `.arcadia/arcadia-way/adoption.json`, or null when undeclared or unreadable.
 */
export function readUpgradePolicy(repoPath: string): string | null {
  const raw = readIfExists(path.join(repoPath, ADOPTION_FILE));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { upgrade_policy?: unknown };
    return typeof parsed.upgrade_policy === "string" ? parsed.upgrade_policy : null;
  } catch {
    return null;
  }
}

/** Whether this repository has opted out of automatic Way propagation. */
export function declinesAutomaticUpgrades(repoPath: string): boolean {
  return readUpgradePolicy(repoPath) === "explicit-only";
}

/**
 * Diffs an adopting repository's managed files against Arcadia's canonical
 * text, tiered per Decision 0024. Pure and read-only: it never writes.
 *
 * Reuses the exact generator functions `setup-context` writes with
 * (`updateAgentsMarkdown`, `thinClaudeWrapper`, `adoptContinuationProtocol`),
 * the same discipline `wayDrift.ts` already applies to status reporting, so
 * propagation and drift detection cannot disagree about what "current" means.
 */
export function computeWayPropagationPlan(repoPath: string, projectSlug: string | null = null): WayPropagationPlan {
  const changes: WayFileChange[] = [];

  const agentsPath = path.join(repoPath, "AGENTS.md");
  const existingAgents = readIfExists(agentsPath);
  const desiredAgents = updateAgentsMarkdown(existingAgents);
  if (desiredAgents !== existingAgents) {
    changes.push({ path: "AGENTS.md", tier: "mechanical", action: "write", content: desiredAgents });
  }

  const claudePath = path.join(repoPath, "CLAUDE.md");
  const existingClaude = readIfExists(claudePath);
  const desiredClaude = thinClaudeWrapper(existingClaude);
  if (desiredClaude === null) {
    changes.push({
      path: "CLAUDE.md",
      tier: "mechanical",
      action: "unmanageable",
      content: null,
      reason: "CLAUDE.md holds content that is not the generated wrapper, so propagation will not overwrite it."
    });
  } else if (desiredClaude !== existingClaude) {
    changes.push({ path: "CLAUDE.md", tier: "mechanical", action: "write", content: desiredClaude });
  }

  const canonicalConstitution = readAdoptedConstitution();
  if (canonicalConstitution !== null) {
    const constitutionPath = path.join(repoPath, "CONSTITUTION.md");
    const existingConstitution = readIfExists(constitutionPath);
    if (existingConstitution !== canonicalConstitution) {
      changes.push({ path: "CONSTITUTION.md", tier: "governing", action: "write", content: canonicalConstitution });
    }
  }

  const protocolSource = readAdoptedFile(CONTINUATION_PROTOCOL_FILE);
  if (protocolSource !== null) {
    const protocolPath = path.join(repoPath, CONTINUATION_PROTOCOL_FILE);
    const existingProtocol = readIfExists(protocolPath);
    const desiredProtocol = adoptContinuationProtocol(protocolSource, existingProtocol, projectSlug);
    if (desiredProtocol !== existingProtocol) {
      changes.push({ path: CONTINUATION_PROTOCOL_FILE, tier: "governing", action: "write", content: desiredProtocol });
    }
  }

  const writable = changes.filter((change) => change.action === "write");
  return {
    repoPath,
    changes,
    hasMechanicalChanges: writable.some((change) => change.tier === "mechanical"),
    hasGoverningChanges: writable.some((change) => change.tier === "governing"),
    unmanageable: changes.filter((change) => change.action === "unmanageable")
  };
}

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
