import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_MARKER, GUIDANCE_FINGERPRINTS, GUIDANCE_INDEX, INSTRUCTION_BUDGET, assertBootstrapBudget, guidanceEntries, guidanceFingerprint, guidanceResources, inspectGuidanceDelivery, loadGuidanceEntries, renderGuidanceRetrieval } from "../src/projects/agentGuidance.js";
import { readAgentsContextBlock, setupArcadiaProjectContext } from "../src/projects/contextSetup.js";
import { computeWayPropagationPlan } from "../src/projects/wayPropagation.js";
import { renderDispatchResolution } from "../src/commands/next.js";
import { guidanceDeliverySource, resolveDispatch } from "../src/docs/dispatch.js";
import { renderActionBrief } from "../src/sessions/actionBrief.js";

const roots: string[] = [];
const canonicalRoot = path.resolve(import.meta.dirname, "..");
// Retries absorb transient ENOTEMPTY races from concurrent writers in the scratch tree.
// A root leaves the tracking array only after its removal succeeds, so a failure keeps the rest for a later attempt.
function removeScratchRoots(roots: string[], remove: typeof rmSync = rmSync): void {
  while (roots.length > 0) {
    remove(roots[0], { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    roots.shift();
  }
}
afterEach(() => { removeScratchRoots(roots); });
function scratch(): string { const root = mkdtempSync(path.join(tmpdir(), "arcadia-guidance-")); roots.push(root); return root; }
function put(root: string, file: string, content: string): void { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); }
function adopted(): string { const root = scratch(); setupArcadiaProjectContext({ repoPath: root }); return root; }
function file(root: string, relative: string): string { return readFileSync(path.join(root, relative), "utf8"); }
function entriesOf(root: string): ReturnType<typeof loadGuidanceEntries> { return loadGuidanceEntries((relative) => existsSync(path.join(root, relative)) ? file(root, relative) : null); }
function audit(root: string, cwd = root, globalInstructions = ""): ReturnType<typeof inspectGuidanceDelivery> { return inspectGuidanceDelivery(root, { cwd, globalInstructions }); }
function control(root: string): void {
  put(root, "PROJECT.md", `---
arcadia: v1
type: project
slug: sample
name: Sample
goal: Prove safe instruction delivery
updated: 2026-10-02
status: active
active_plan: fix
current_action: repair
---
`);
  put(root, "docs/plans/fix.md", `---
arcadia: v1
type: plan
slug: fix
project: sample
status: active
milestone: Deliver proof
current_action: repair
token_impact: medium
token_budget: One bounded session
recommended_model: sonnet
updated: 2026-10-02
actions:
  - id: repair
    title: Repair delivery
    status: open
    responsibility: agent
    clarification: clarified
    next_action: Repair the instruction delivery.
    expected_artifact: proof.md
    acceptance_criteria:
      - The dispatched packet contains the mandatory guidance.
---
`);
}

describe("compact Way instruction delivery", () => {
  it("keeps Arcadia and an adopting Project below default budgets with reserved global and nested context", () => {
    expect(Buffer.byteLength(readAgentsContextBlock())).toBeLessThanOrEqual(INSTRUCTION_BUDGET.bootstrap);
    for (const root of [canonicalRoot, adopted()]) {
      const report = audit(root, root, "G".repeat(8192));
      expect(report.problems).toEqual([]);
      expect(report.sources.at(-1)?.bytes).toBeLessThanOrEqual(INSTRUCTION_BUDGET.root);
      expect(report.combinedBytes).toBeLessThan(32768);
    }
    const root = adopted(); put(root, "apps/mobile/AGENTS.md", "Nested mobile guidance.\n".repeat(400));
    const report = audit(root, path.join(root, "apps/mobile"), "G".repeat(8192));
    expect(report.problems).toEqual([]);
    expect(report.sources.map((source) => source.path)).toEqual(["(supplied global guidance)", path.join(root, "AGENTS.md"), path.join(root, "apps/mobile/AGENTS.md")]);
  });

  it("keeps authority, governance, preservation, learning and identity rules in the visible bootstrap", () => {
    const loaded = Buffer.from(file(canonicalRoot, "AGENTS.md")).subarray(0, 32768).toString();
    for (const rule of ["independent review of the current head", "A push resets proof", "never hand-edit pointers", "edit SQLite directly", "never on main", "docs/notes-to-self.md", "targeted `rg`", "arcadia identity resolve", "never rewrite Git config", "docs/agent-guidance/index.json", "arcadia learn \"<exact text>\" --scope project:<slug>", "No novelty search, model call, file or Ask is required"]) expect(loaded).toContain(rule);
    expect(loaded).toContain("similar wording stays separate (no semantic merge)");
    const adoptedRoot = adopted();
    expect(file(adoptedRoot, "AGENTS.md")).toContain("arcadia learn \"<exact text>\" --scope project:<slug>");
    expect(file(adoptedRoot, "docs/agent-guidance/learning.md")).toContain("arcadia learn");
    const entries = entriesOf(canonicalRoot);
    for (const entry of entries) { expect(existsSync(path.join(canonicalRoot, entry.path))).toBe(true); expect(entry.trigger).toBeTruthy(); expect(entry.read_before).toBeTruthy(); }
  });

  it("refuses oversized canonical, adopter and combined instructions without deleting local rules", () => {
    expect(() => assertBootstrapBudget("é".repeat(4097))).toThrow(/bootstrap exceeds/);
    const root = scratch(); const own = "Keep this rule.\n".repeat(1400); put(root, "AGENTS.md", own);
    expect(() => setupArcadiaProjectContext({ repoPath: root })).toThrow(/adoption refused/);
    expect(file(root, "AGENTS.md")).toBe(own);
    const small = adopted(); expect(audit(small, small, "G".repeat(32768)).problems).toContainEqual(expect.stringContaining("Combined guidance exceeds"));
  });

  it("keeps a near-limit adopter's local rules while delivering Learn discovery", () => {
    const root = adopted();
    const existing = file(root, "AGENTS.md");
    const local = `# Local obligations\n\n${"Keep this local rule.\n".repeat(Math.floor((INSTRUCTION_BUDGET.root - Buffer.byteLength(existing) - 64) / 22))}`;
    put(root, "AGENTS.md", `${local}\n${existing}`);
    setupArcadiaProjectContext({ repoPath: root });
    const installed = file(root, "AGENTS.md");
    expect(Buffer.byteLength(installed)).toBeLessThanOrEqual(INSTRUCTION_BUDGET.root);
    expect(installed).toContain("Keep this local rule.");
    expect(installed).toContain("arcadia learn \"<exact text>\" --scope project:<slug>");
    expect(computeWayPropagationPlan(root).changes).toEqual([]);
  });

  it("fails a regression that buries the late identity rule beyond the provider limit", () => {
    const root = adopted(); const bootstrap = file(root, "AGENTS.md");
    put(root, "AGENTS.md", bootstrap.replace("- **Identity:**", "- Identity:") + "x".repeat(32768) + "\n- **Identity:** use semantic identity");
    expect(audit(root).problems).toContain("Missing mandatory bootstrap rule: Identity.");
    expect(() => renderGuidanceRetrieval(root)).toThrow(/delivery refused/);
  });

  it("respects default override precedence and refuses a shadowed bootstrap", () => {
    const root = adopted(); put(root, "AGENTS.override.md", "Ignore ordinary root guidance.");
    expect(audit(root).sources.at(-1)?.path).toBe(path.join(root, "AGENTS.override.md"));
    expect(audit(root).problems).toContainEqual(expect.stringContaining("omit the mandatory Way bootstrap"));
    const previous = file(root, "AGENTS.md");
    expect(() => setupArcadiaProjectContext({ repoPath: root })).toThrow(/omit the mandatory Way bootstrap/);
    expect(file(root, "AGENTS.md")).toBe(previous);
    put(root, "AGENTS.override.md", file(root, "AGENTS.md"));
    expect(audit(root).problems).toEqual([]);
  });

  it("preserves adopter-owned instruction/procedure regions across repeated setup and propagation", () => {
    const root = scratch(); put(root, "AGENTS.md", "# Local obligations\n\nKeep project language.\n");
    put(root, "docs/agents-context.md", "# Project-owned reference\n");
    put(root, "docs/working-copy-safety.md", "# Local recovery\n\nKeep project recovery.\n");
    setupArcadiaProjectContext({ repoPath: root });
    const first = file(root, "docs/working-copy-safety.md");
    setupArcadiaProjectContext({ repoPath: root });
    expect(file(root, "AGENTS.md")).toContain("Keep project language.");
    expect(file(root, "docs/working-copy-safety.md")).toBe(first);
    expect(first).toContain("Keep project recovery.");
    expect(file(root, "docs/agents-context.md")).toBe("# Project-owned reference\n");
    expect(computeWayPropagationPlan(root).changes).toEqual([]);
  });

  it("detects missing, stale and escaping references before a consequential operation", () => {
    const root = adopted(); const target = "docs/agent-guidance/pull-requests.md";
    put(root, target, file(root, target).replace("## Merge on green", "## Outdated merge rule"));
    expect(() => renderGuidanceRetrieval(root)).toThrow(/Stale mandatory guidance/);
    rmSync(path.join(root, target));
    expect(() => renderGuidanceRetrieval(root)).toThrow(/Missing mandatory guidance/);
    const outside = scratch(); put(outside, "copy.md", file(canonicalRoot, target));
    symlinkSync(path.join(outside, "copy.md"), path.join(root, target));
    expect(audit(root).problems).toContain(`Guidance reference escapes repository: ${target}.`);
  });

  it("delivers the compact contract through the Claude wrapper and opencode repository entry", () => {
    const root = adopted();
    for (const agent of ["claude", "opencode"] as const) {
      expect(inspectGuidanceDelivery(root, { agent, globalInstructions: "" }).problems).toEqual([]);
      expect(renderGuidanceRetrieval(root, agent).join("\n")).toContain("read its authoritative procedure before acting");
    }
    put(root, "CLAUDE.md", "# No import");
    expect(inspectGuidanceDelivery(root, { agent: "claude", globalInstructions: "" }).problems).toContainEqual(expect.stringContaining("does not import"));
  });

  it("binds manual and managed delivery to the actual governed Action and retrieved files", () => {
    const root = adopted(); control(root);
    put(root, "docs/notes-to-self.md", "# Notes\n\nkeys: settle, workspace, fingerprint\nUse settle --proposal, not --file.\n");
    const resolution = resolveDispatch(root);
    expect(resolution.blockers).toEqual([]);
    expect(resolution.context?.action.id).toBe("repair");
    expect(renderDispatchResolution(resolution).join("\n")).toContain("Mandatory guidance retrieval");
    // Real repository reads and command outputs; deterministic delivery/retrieval evidence, not a model comprehension claim.
    let lookup: string;
    try { lookup = execFileSync("rg", ["-n", "settle|workspace", "docs/notes-to-self.md"], { cwd: root, encoding: "utf8" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      lookup = execFileSync("grep", ["-nE", "settle|workspace", "docs/notes-to-self.md"], { cwd: root, encoding: "utf8" });
    }
    expect(lookup).toContain("Use settle --proposal, not --file");
    const entries = entriesOf(root);
    const identity = entries.find((entry) => entry.id === "git-identity")!;
    const asks = entries.find((entry) => entry.id === "agent-asks")!;
    expect(file(root, identity.path)).toContain("never use `git -c user.*`");
    expect(file(root, asks.path)).toContain("never by passing the file to `settle`");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: root });
    const baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const brief = renderActionBrief({ repoRoot: root, projectSlug: "sample", planSlug: "fix", actionId: "repair", worktreePath: root, branch: "codex/proof", agent: "codex", baseRevision });
    expect(brief).toContain("Action: repair");
    expect(brief).toContain("Mandatory guidance retrieval before the next operation");
    expect(brief).toContain("arcadia learn \"<exact text>\" --scope project:<slug>");
    expect(brief).not.toContain("### Three shapes");
    expect(brief).toContain("sha256");
    rmSync(path.join(root, identity.path));
    const refused = resolveDispatch(root);
    expect(refused.blockers).toContainEqual(expect.objectContaining({ field: "guidance_delivery", relativePath: identity.path, message: expect.stringContaining(identity.path) }));
    const humanRefusal = renderDispatchResolution(refused).join("\n");
    expect(humanRefusal).toContain(identity.path);
    expect(humanRefusal).toContain("Not dispatchable: repair the blockers above first.");
    expect(() => renderActionBrief({ repoRoot: root, projectSlug: "sample", planSlug: "fix", actionId: "repair", worktreePath: root, branch: "codex/proof", agent: "codex", baseRevision })).toThrow(/guidance delivery refused/);
  });

  it("names the guidance index, not AGENTS.md, when an index entry is malformed", () => {
    const root = adopted(); control(root);
    const index = JSON.parse(file(root, GUIDANCE_INDEX)) as { entries: Array<Record<string, unknown>> };
    delete index.entries[0].trigger;
    put(root, GUIDANCE_INDEX, JSON.stringify(index, null, 2));
    const blocker = resolveDispatch(root).blockers.find((candidate) => candidate.field === "guidance_delivery");
    expect(blocker?.relativePath).toBe(GUIDANCE_INDEX);
    expect(blocker?.message).toContain("Invalid guidance entry trigger");
  });

  it("maps each guidance-delivery problem to the file that must be repaired", () => {
    const root = scratch();
    const source = (message: string): string => guidanceDeliverySource(root, message);
    expect(source("Missing mandatory guidance: docs/agent-guidance/git-identity.md.")).toBe("docs/agent-guidance/git-identity.md");
    expect(source("Stale mandatory guidance: docs/agent-guidance/learning.md.")).toBe("docs/agent-guidance/learning.md");
    expect(source("Invalid docs/agent-guidance/fingerprints.json: expected arcadia-agent-guidance-v1 fingerprints.")).toBe(GUIDANCE_FINGERPRINTS);
    expect(source("Invalid guidance entry sha256.")).toBe(GUIDANCE_INDEX);
    expect(source("Missing mandatory guidance trigger: working-copy.")).toBe(GUIDANCE_INDEX);
    expect(source("CLAUDE.md does not import the mandatory AGENTS.md bootstrap.")).toBe("CLAUDE.md");
    expect(source("Missing mandatory bootstrap rule: Authority.")).toBe("AGENTS.md");
    expect(source("Missing mandatory retrieval reference: docs/agent-guidance/index.json")).toBe("AGENTS.md");
    expect(source("Root instructions exceed 12288 bytes.")).toBe("AGENTS.md");
    expect(source(`Unreadable instruction file: ${path.join(root, "docs/agent-guidance/learning.md")}`)).toBe("docs/agent-guidance/learning.md");
    // An absolute path outside the repository must not yield a fabricated repo-relative file.
    expect(source("Unreadable instruction file: /srv/docs/arcadia/AGENTS.md")).toBe("AGENTS.md");
    put(root, "AGENTS.override.md", "# Override\n");
    expect(source("Missing mandatory bootstrap rule: Authority.")).toBe("AGENTS.override.md");
  });

  it("refuses unknown automatic imports and still checks an adoption whose root markers were removed", () => {
    const root = adopted();
    put(root, "CLAUDE.md", "@AGENTS.md\n@docs/agent-guidance/agent-asks.md\n");
    expect(inspectGuidanceDelivery(root, { agent: "claude", globalInstructions: "" }).problems).toContainEqual(expect.stringContaining("Unsupported automatic import"));
    put(root, "AGENTS.md", "# Incomplete instructions");
    expect(() => renderGuidanceRetrieval(root)).toThrow(/omit the mandatory Way bootstrap/);
  });

  it("preflights foreign indexes and escaping adoption targets before changing project files", () => {
    const root = scratch(); put(root, "AGENTS.md", "# Keep local rules");
    put(root, GUIDANCE_INDEX, '{"schema":"project-owned"}');
    expect(() => setupArcadiaProjectContext({ repoPath: root })).toThrow(/Cannot overwrite project-owned/);
    expect(file(root, "AGENTS.md")).toBe("# Keep local rules");
    expect(computeWayPropagationPlan(root).changes.some((change) => change.action === "write")).toBe(false);
    const other = scratch(); put(other, "AGENTS.md", "# Keep local rules");
    const outside = scratch(); symlinkSync(outside, path.join(other, "docs"));
    expect(() => setupArcadiaProjectContext({ repoPath: other })).toThrow(/target escapes repository/);
    expect(file(other, "AGENTS.md")).toBe("# Keep local rules");
    const plan = computeWayPropagationPlan(other);
    expect(plan.unmanageable).toContainEqual(expect.objectContaining({ path: GUIDANCE_INDEX, reason: expect.stringContaining("target escapes repository") }));
    expect(plan.changes.some((change) => change.action === "write")).toBe(false);
    expect(existsSync(path.join(outside, "agent-guidance"))).toBe(false);
    rmSync(path.join(other, "docs"));
    symlinkSync(path.join(outside, "absent"), path.join(other, "docs"));
    expect(() => setupArcadiaProjectContext({ repoPath: other })).toThrow(/cannot be resolved safely/);
    expect(computeWayPropagationPlan(other).unmanageable).toContainEqual(expect.objectContaining({ path: GUIDANCE_INDEX, reason: expect.stringContaining("cannot be resolved safely") }));
  });

  it("loads a relevant nested Codex override beside the root bootstrap without duplicating it", () => {
    const root = adopted(); put(root, "apps/mobile/AGENTS.md", "Ignored nested rule");
    put(root, "apps/mobile/AGENTS.override.md", "Use the mobile validation command.");
    const delivery = audit(root, path.join(root, "apps/mobile"));
    expect(delivery.problems).toEqual([]);
    expect(delivery.sources.at(-1)?.path).toBe(path.join(root, "apps/mobile/AGENTS.override.md"));
    expect(delivery.sources).toHaveLength(2);
  });

  it("counts opencode's own global AGENTS.md before its Claude fallback", () => {
    const root = adopted(); const globalDirectory = scratch(); put(globalDirectory, "AGENTS.md", "Global opencode rule\n");
    const report = inspectGuidanceDelivery(root, { agent: "opencode", globalDirectory });
    expect(report.sources[0].path).toBe(path.join(globalDirectory, "AGENTS.md"));
    expect(report.sources[0].bytes).toBe(Buffer.byteLength("Global opencode rule\n"));
  });

  it("refuses uncounted Claude memory layouts and inline procedural imports", () => {
    const root = adopted(); put(root, "CLAUDE.local.md", "Extra local context");
    expect(inspectGuidanceDelivery(root, { agent: "claude", globalInstructions: "" }).problems).toContainEqual(expect.stringContaining("Additional Claude memory layout"));
    rmSync(path.join(root, "CLAUDE.local.md"));
    put(root, "CLAUDE.md", "@AGENTS.md\nRead @docs/agent-guidance/agent-asks.md before work\n");
    expect(inspectGuidanceDelivery(root, { agent: "claude", globalInstructions: "" }).problems).toContainEqual(expect.stringContaining("Unsupported automatic import"));
  });

  it("matches complete trigger words and phrases without selecting unrelated procedural context", () => {
    const root = adopted();
    const unrelated = renderGuidanceRetrieval(root, undefined, "Fix JavaScript Projectiles").join("\n");
    expect(unrelated).not.toContain("Read docs/agent-guidance/operator-actions.md:");
    expect(unrelated).not.toContain("Read docs/managed-documents.md:");
    const relevant = renderGuidanceRetrieval(root, undefined, "PREVIEW GOVERNANCE, then a PULL REQUEST").join("\n");
    expect(relevant).toContain("Read docs/agent-guidance/agent-asks.md:");
    expect(relevant).toContain("Read docs/agent-guidance/pull-requests.md:");
  });

  it("delivers the shared Git checkpoint procedure through adoption and each checkpoint trigger", () => {
    const root = adopted();
    const checkpointPath = "docs/agent-guidance/native-mail-checkpoints.md";
    const entries = entriesOf(root);
    expect(entries.filter((entry) => entry.path === checkpointPath)).toHaveLength(1);
    expect(guidanceFingerprint(file(root, checkpointPath))).toBe(guidanceFingerprint(file(canonicalRoot, checkpointPath)));
    for (const operation of ["onboarding", "between batches", "before consequential work", "before stopping", "git change check", "governed changes on main"]) {
      expect(renderGuidanceRetrieval(root, undefined, operation).join("\n")).toContain(`Read ${checkpointPath}:`);
    }
    // Procedure retrieval stays on demand: no expansion of the default bootstrap.
    expect(file(root, "AGENTS.md")).not.toContain("checkpoint_main=");
    expect(audit(root, root, "G".repeat(8192)).problems).toEqual([]);
    expect(computeWayPropagationPlan(root).changes).toEqual([]);
  });

  it.each(["push", "settle", "stop"])("retrieves shared checkpoints for ordinary operation %s", (operation) => {
    expect(renderGuidanceRetrieval(adopted(), undefined, operation).join("\n")).toContain("Read docs/agent-guidance/native-mail-checkpoints.md:");
  });

  it("keeps full fingerprints beside a compact index and validates both", () => {
    const index = file(canonicalRoot, GUIDANCE_INDEX);
    const fingerprints = JSON.parse(file(canonicalRoot, GUIDANCE_FINGERPRINTS)) as { schema: string; fingerprints: Record<string, string> };
    expect(index).not.toMatch(/[a-f0-9]{64}/);
    expect(fingerprints.schema).toBe("arcadia-agent-guidance-v1");
    const entries = entriesOf(canonicalRoot);
    expect(Object.keys(fingerprints.fingerprints).sort()).toEqual(entries.map((entry) => entry.id).sort());
    for (const entry of entries) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(guidanceFingerprint(file(canonicalRoot, entry.path))).toBe(entry.sha256);
    }
    expect(guidanceResources((relative) => existsSync(path.join(canonicalRoot, relative)) ? file(canonicalRoot, relative) : null).map((resource) => resource.path))
      .toEqual(expect.arrayContaining([GUIDANCE_INDEX, GUIDANCE_FINGERPRINTS]));
    expect(file(adopted(), GUIDANCE_FINGERPRINTS)).toBe(file(canonicalRoot, GUIDANCE_FINGERPRINTS));
  });

  it("refuses a stale, missing, orphaned or ambiguous fingerprint", () => {
    const index = file(canonicalRoot, GUIDANCE_INDEX);
    const valid = JSON.parse(file(canonicalRoot, GUIDANCE_FINGERPRINTS)) as { schema: string; fingerprints: Record<string, string> };
    const render = (fingerprints: Record<string, string>): string => JSON.stringify({ schema: valid.schema, fingerprints });
    const read = (overrides: Record<string, string | null>) => (relative: string): string | null =>
      relative in overrides ? overrides[relative] : existsSync(path.join(canonicalRoot, relative)) ? file(canonicalRoot, relative) : null;
    const stale = render({ ...valid.fingerprints, "pull-requests": "0".repeat(64) });
    expect(() => guidanceResources(read({ [GUIDANCE_FINGERPRINTS]: stale }))).toThrow(/Canonical guidance fingerprint is stale: docs\/agent-guidance\/pull-requests\.md/);
    const short = render({ ...valid.fingerprints, "pull-requests": valid.fingerprints["pull-requests"].slice(0, 12) });
    expect(() => guidanceEntries(index, short)).toThrow(/Unsafe reference/);
    const { learning: _learning, ...withoutLearning } = valid.fingerprints;
    expect(() => guidanceEntries(index, render(withoutLearning))).toThrow(/sha256 for learning/);
    expect(() => guidanceEntries(index, render({ ...valid.fingerprints, retired: "0".repeat(64) }))).toThrow(/without an index entry: retired/);
    expect(() => guidanceEntries(index, null)).toThrow(/Missing mandatory guidance: docs\/agent-guidance\/fingerprints\.json/);
    expect(() => guidanceEntries(index, "{}")).toThrow(/Invalid docs\/agent-guidance\/fingerprints\.json/);
    const legacyEntries = entriesOf(canonicalRoot);
    const legacy = JSON.stringify({ schema: "arcadia-agent-guidance-v1", entries: legacyEntries });
    expect(guidanceEntries(legacy)).toEqual(legacyEntries);
    expect(() => guidanceEntries(legacy, file(canonicalRoot, GUIDANCE_FINGERPRINTS))).toThrow(/Ambiguous guidance fingerprints/);
    const mixed = JSON.stringify({ schema: "arcadia-agent-guidance-v1", entries: legacyEntries.map((entry, i) => i === 0 ? entry : { ...entry, sha256: undefined }) });
    expect(() => guidanceEntries(mixed)).toThrow(/every entry or none/);

    const root = adopted();
    put(root, GUIDANCE_FINGERPRINTS, stale);
    expect(audit(root).problems).toContain("Stale mandatory guidance: docs/agent-guidance/pull-requests.md. Refresh adoption before its operation.");
    expect(() => renderGuidanceRetrieval(root)).toThrow(/Stale mandatory guidance/);
    rmSync(path.join(root, GUIDANCE_FINGERPRINTS));
    expect(audit(root).problems).toContainEqual(expect.stringContaining(`Missing mandatory guidance: ${GUIDANCE_FINGERPRINTS}`));
    // A legacy adopter keeps working with its inline fingerprints, and a stale inline one still fails.
    put(root, GUIDANCE_INDEX, legacy);
    expect(audit(root).problems).toEqual([]);
    put(root, GUIDANCE_INDEX, JSON.stringify({ schema: "arcadia-agent-guidance-v1", entries: legacyEntries.map((entry) => entry.id === "learning" ? { ...entry, sha256: "0".repeat(64) } : entry) }));
    expect(audit(root).problems).toContain("Stale mandatory guidance: docs/agent-guidance/learning.md. Refresh adoption before its operation.");
  });

  it("resolves every indexed trigger to its procedure", () => {
    const root = adopted();
    const entries = entriesOf(root);
    expect(entries).toHaveLength(entriesOf(canonicalRoot).length);
    for (const entry of entries) {
      const triggers = entry.trigger.split(",").map((trigger) => trigger.trim()).filter(Boolean);
      expect(triggers.length, entry.id).toBeGreaterThan(0);
      for (const trigger of triggers) {
        const rendered = renderGuidanceRetrieval(root, undefined, trigger).join("\n");
        expect(rendered, `${entry.id}: ${trigger}`).toContain(`Read ${entry.path}:`);
        for (const other of entries.filter((item) => !["continuation", "learning", "working-copy"].includes(item.id) && !item.trigger.split(",").some((t) => new RegExp(`(?:^|\\W)${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\W)`, "i").test(trigger))))
          expect(rendered, `${entry.id}: ${trigger} must not render ${other.id}`).not.toContain(`Read ${other.path}:`);
      }
    }
  });

  it("keeps a new bootstrap and its resource installation together in the governing propagation tier", () => {
    const root = scratch(); put(root, "AGENTS.md", "# Old guidance");
    const plan = computeWayPropagationPlan(root);
    expect(plan.changes.find((change) => change.path === "AGENTS.md")?.tier).toBe("governing");
    expect(plan.changes.find((change) => change.path === GUIDANCE_INDEX)?.tier).toBe("governing");
    expect(file(canonicalRoot, "AGENTS.md")).toContain(BOOTSTRAP_MARKER);
  });

  it("plans a stale adopter bootstrap rewrite without mutating that adopter", () => {
    const root = adopted(); const local = "# Local obligations\n\nPreserve this text.\n";
    put(root, "AGENTS.md", `${local}\n${file(root, "AGENTS.md")}`);
    const stale = file(root, "AGENTS.md").replace("arcadia learn \"<exact text>\" --scope project:<slug>", "learn later");
    put(root, "AGENTS.md", stale);
    const plan = computeWayPropagationPlan(root);
    const change = plan.changes.find((item) => item.path === "AGENTS.md");
    expect(change).toMatchObject({ tier: "mechanical", action: "write" });
    expect(change?.content).toContain("arcadia learn \"<exact text>\" --scope project:<slug>");
    expect(change?.content).toContain("Preserve this text.");
    expect(file(root, "AGENTS.md")).toBe(stale);
  });
});

describe("scratch teardown", () => {
  it("retries transient removal failures and defaults to the real rmSync", () => {
    const remove = vi.fn();
    removeScratchRoots(["/tmp/arcadia-a", "/tmp/arcadia-b"], remove);
    expect(remove).toHaveBeenCalledTimes(2);
    for (const [, options] of remove.mock.calls) {
      expect(options).toMatchObject({ recursive: true, force: true });
      expect(options.maxRetries).toBeGreaterThanOrEqual(3);
      expect(options.retryDelay).toBeGreaterThanOrEqual(50);
    }
    const pending = ["/tmp/arcadia-c", "/tmp/arcadia-d"];
    expect(() => removeScratchRoots(pending, vi.fn(() => { throw new Error("EBUSY"); }))).toThrow("EBUSY");
    expect(pending).toEqual(["/tmp/arcadia-c", "/tmp/arcadia-d"]);
    const real = mkdtempSync(path.join(tmpdir(), "arcadia-guidance-teardown-"));
    removeScratchRoots([real]);
    expect(existsSync(real)).toBe(false);
  });
});
