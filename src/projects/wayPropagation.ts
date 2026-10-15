import { assertGuidanceTarget, guidanceEntries, guidanceFingerprint, guidanceResources, inspectGuidanceDelivery } from "./agentGuidance.js";
import { validationError } from "../cli/errors.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONTINUATION_PROTOCOL_FILE,
  adoptGuidanceResource,
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

export interface WayPropagationSelection {
  /** Install only the retrieval path for retained Learn lessons. */
  learningOnly?: boolean;
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
export function computeWayPropagationPlan(
  repoPath: string,
  projectSlug: string | null = null,
  selection: WayPropagationSelection = {}
): WayPropagationPlan {
  if (selection.learningOnly) return computeLearningOnlyPlan(repoPath);
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

  for (const resource of guidanceResources(readAdoptedFile)) {
    const existing = readIfExists(path.join(repoPath, resource.path));
    try {
      const desired = adoptGuidanceResource(resource, existing);
      if (desired !== existing) changes.push({ path: resource.path, tier: "governing", action: "write", content: desired });
    } catch (error) {
      changes.push({ path: resource.path, tier: "governing", action: "unmanageable", content: null, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (changes.some((change) => change.path.startsWith("docs/") && change.path !== CONTINUATION_PROTOCOL_FILE)) {
    const bootstrap = changes.find((change) => change.path === "AGENTS.md");
    if (bootstrap) bootstrap.tier = "governing";
  }
  const delivery = inspectGuidanceDelivery(repoPath, { rootInstructions: desiredAgents });
  const budgetProblems = delivery.problems.filter((problem) => /exceed|omit|Missing mandatory bootstrap rule|Missing mandatory retrieval reference/.test(problem));
  if (budgetProblems.length) {
    // Report without discarding adopter additions or publishing an unsafe bootstrap.
    for (const change of changes) {
      change.action = "unmanageable";
      change.content = null;
      change.reason = budgetProblems.join(" ");
    }
    if (!changes.length) changes.push({ path: "AGENTS.md", tier: "governing", action: "unmanageable", content: null, reason: budgetProblems.join(" ") });
  }

  for (const change of changes) {
    if (change.action !== "write") continue;
    try { assertGuidanceTarget(repoPath, change.path); }
    catch (error) {
      change.action = "unmanageable";
      change.content = null;
      change.reason = error instanceof Error ? error.message : String(error);
    }
  }
  const blockedLibrary = changes.find((change) => change.action === "unmanageable" && change.path.startsWith("docs/"));
  if (blockedLibrary) {
    for (const change of changes) {
      if (change.action !== "write") continue;
      change.action = "unmanageable";
      change.content = null;
      change.reason = `Guidance library installation is blocked by ${blockedLibrary.path}: ${blockedLibrary.reason}`;
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

/**
 * Add the smallest self-contained Learn retrieval path to an existing compact
 * adoption. This deliberately does not regenerate the shared bootstrap: an
 * adopter may have local text inside an old managed region, and replacing that
 * region would discard it. Repositories without a compact, valid index remain
 * visible as unmanageable for a reviewed migration.
 */
function computeLearningOnlyPlan(repoPath: string): WayPropagationPlan {
  const changes: WayFileChange[] = [];
  const agentsPath = path.join(repoPath, "AGENTS.md");
  const existingAgents = readIfExists(agentsPath);
  const learningBootstrap = readLearningBootstrap();
  const desiredAgents = appendLearningBootstrap(existingAgents, learningBootstrap);
  if (desiredAgents === null) {
    changes.push({
      path: "AGENTS.md", tier: "governing", action: "unmanageable", content: null,
      reason: "Learning-only propagation requires an existing compact managed bootstrap; it will not replace a legacy or oversized AGENTS.md region."
    });
  } else if (desiredAgents !== existingAgents) {
    changes.push({ path: "AGENTS.md", tier: "governing", action: "write", content: desiredAgents });
  }
  if (desiredAgents !== null) {
    const delivery = inspectGuidanceDelivery(repoPath, { rootInstructions: desiredAgents });
    const budgetProblems = delivery.problems.filter((problem) => /Root instructions exceed|Project instructions exceed|Combined guidance exceeds|Missing mandatory bootstrap rule|Missing mandatory retrieval reference/.test(problem));
    if (budgetProblems.length) {
      changes.push({ path: "AGENTS.md", tier: "governing", action: "unmanageable", content: null, reason: budgetProblems.join(" ") });
    }
  }

  const indexPath = path.join(repoPath, "docs/agent-guidance/index.json");
  const existingIndex = readIfExists(indexPath);
  const learningSource = readAdoptedFile("docs/agent-guidance/learning.md");
  if (!existingIndex?.trim() || !learningSource?.trim()) {
    changes.push({
      path: "docs/agent-guidance/index.json", tier: "governing", action: "unmanageable", content: null,
      reason: "Learning-only propagation requires the adopter's existing guidance index and Arcadia's canonical learning procedure."
    });
  } else {
    try {
      const learningPath = "docs/agent-guidance/learning.md";
      const existingLearning = readIfExists(path.join(repoPath, learningPath));
      const selectedLearning = selectLearningProcedure(learningSource, existingLearning);
      const desiredIndex = updateLearningIndex(existingIndex, learningSource, selectedLearning);
      if (desiredIndex !== existingIndex) changes.push({ path: "docs/agent-guidance/index.json", tier: "governing", action: "write", content: desiredIndex });
      const desiredLearning = adoptGuidanceResource({ path: learningPath, content: selectedLearning }, existingLearning);
      if (desiredLearning !== existingLearning) {
        changes.push({ path: learningPath, tier: "governing", action: "write", content: desiredLearning });
      }
    } catch (error) {
      changes.push({ path: "docs/agent-guidance/index.json", tier: "governing", action: "unmanageable", content: null, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const change of changes) {
    if (change.action !== "write") continue;
    try { assertGuidanceTarget(repoPath, change.path); }
    catch (error) { change.action = "unmanageable"; change.content = null; change.reason = error instanceof Error ? error.message : String(error); }
  }
  const blocked = changes.find((change) => change.action === "unmanageable");
  if (blocked) {
    for (const change of changes) {
      if (change.action === "write") {
        change.action = "unmanageable";
        change.content = null;
        change.reason = `Learning-only delivery is blocked by ${blocked.path}: ${blocked.reason}`;
      }
    }
  }
  const writable = changes.filter((change) => change.action === "write");
  return {
    repoPath,
    changes,
    hasMechanicalChanges: false,
    hasGoverningChanges: writable.length > 0,
    unmanageable: changes.filter((change) => change.action === "unmanageable")
  };
}

function readLearningBootstrap(): string {
  return [
    "**Before implementation, repair, validation or handoff**, `rg` `docs/notes-to-self.md` for command/subsystem/symptom evidence; read matches, repeat on failure, report missing files, preserve failed receipts/remedies. No second store or inferred operator preference.",
    "",
    "Any agent captures useful discovery: `arcadia learn \"<exact text>\" --scope project:<slug>`. Bare is observation/high; uncertainty: `--provenance inference --confidence low --evidence \"<source>\"`. Exact retry deduplicates; different wording stays separate. Evidence grants no authority. Retrieve on demand; Notes is the bounded verified hot cache."
  ].join("\n");
}

function appendLearningBootstrap(existing: string | null, learningBootstrap: string): string | null {
  if (!existing?.includes("<!-- ARCADIA_CONTEXT_START -->") || !existing.includes("<!-- ARCADIA_CONTEXT_END -->") || !existing.includes("<!-- arcadia-bootstrap-v1 -->")) return null;
  // A fresh setup-context adoption already has the full current Learn block.
  // Keep it byte-for-byte rather than requiring the compact replacement text.
  if (updateAgentsMarkdown(existing) === existing) return existing;
  if (existing.includes(learningBootstrap)) return existing;
  const oldLearning = /\*\*Before implementation, repair, validation or handoff\*\*[\s\S]*?second memory store or treat an inference as operator preference\./;
  const compacted = existing.replace(oldLearning, learningBootstrap);
  return compacted !== existing && Buffer.byteLength(compacted) <= 12 * 1024 ? compacted : null;
}

function selectLearningProcedure(canonical: string, existing: string | null): string {
  // Hacker recovery is a separate workflow. Do not introduce its link into a
  // narrow Learn rollout when the adopter did not already carry that procedure.
  if (existing?.includes("[Hacker recovery](hacker-recovery.md)")) return canonical;
  return canonical.replace(/\nTwo unchanged workflow refusals without new evidence require\n\[Hacker recovery\]\(hacker-recovery\.md\) before another attempt\. Explicit\nstop-the-line requests activate it immediately\. This changes diagnostic strategy,\nnot authority, admission or budget\. Supervisors must recognize the pattern\.\n/, "\n");
}

function updateLearningIndex(existing: string, canonicalLearningSource: string, selectedLearning: string): string {
  const parsed = JSON.parse(existing) as { schema?: unknown; entries?: unknown };
  if (parsed.schema !== "arcadia-agent-guidance-v1" || !Array.isArray(parsed.entries)) {
    throw validationError("Cannot update a project-owned guidance index; migrate it through a reviewed adoption change.");
  }
  // Validate the existing canonical shape before replacing only its learning record.
  guidanceEntries(existing);
  const canonicalIndex = readAdoptedFile("docs/agent-guidance/index.json");
  if (!canonicalIndex) throw validationError("Arcadia's canonical guidance index is missing.");
  const canonicalLearning = guidanceEntries(canonicalIndex).find((entry) => entry.id === "learning");
  if (!canonicalLearning) throw validationError("Arcadia's canonical guidance index is missing its learning entry.");
  if (guidanceFingerprint(canonicalLearningSource) !== canonicalLearning.sha256) throw validationError("Arcadia's canonical learning procedure does not match its index fingerprint.");
  const entries = parsed.entries as Array<Record<string, unknown>>;
  const index = entries.findIndex((entry) => entry.id === "learning");
  if (index < 0) throw validationError("The adopter guidance index has no learning entry; migrate it through a reviewed adoption change.");
  entries[index] = { ...canonicalLearning, sha256: guidanceFingerprint(selectedLearning) };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function readIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
