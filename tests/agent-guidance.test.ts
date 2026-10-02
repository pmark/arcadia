import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_MARKER, GUIDANCE_INDEX, INSTRUCTION_BUDGET, assertBootstrapBudget, guidanceEntries, inspectGuidanceDelivery, renderGuidanceRetrieval } from "../src/projects/agentGuidance.js";
import { readAgentsContextBlock, setupArcadiaProjectContext } from "../src/projects/contextSetup.js";
import { computeWayPropagationPlan } from "../src/projects/wayPropagation.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { renderActionBrief } from "../src/sessions/actionBrief.js";

const roots: string[] = [];
const canonicalRoot = path.resolve(import.meta.dirname, "..");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function scratch(): string { const root = mkdtempSync(path.join(tmpdir(), "arcadia-guidance-")); roots.push(root); return root; }
function put(root: string, file: string, content: string): void { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); }
function adopted(): string { const root = scratch(); setupArcadiaProjectContext({ repoPath: root }); return root; }
function file(root: string, relative: string): string { return readFileSync(path.join(root, relative), "utf8"); }
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
      - Mandatory guidance arrives.
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
    for (const rule of ["CodeRabbit approves the current head", "A push resets proof", "never hand-edit pointers", "edit SQLite directly", "never on main", "docs/notes-to-self.md", "targeted `rg`", "arcadia identity resolve", "never rewrite Git config", "docs/agent-guidance/index.json"]) expect(loaded).toContain(rule);
    const entries = guidanceEntries(file(canonicalRoot, GUIDANCE_INDEX));
    for (const entry of entries) { expect(existsSync(path.join(canonicalRoot, entry.path))).toBe(true); expect(entry.trigger).toBeTruthy(); expect(entry.read_before).toBeTruthy(); }
  });

  it("refuses oversized canonical, adopter and combined instructions without deleting local rules", () => {
    expect(() => assertBootstrapBudget("é".repeat(4097))).toThrow(/bootstrap exceeds/);
    const root = scratch(); const own = "Keep this rule.\n".repeat(1400); put(root, "AGENTS.md", own);
    expect(() => setupArcadiaProjectContext({ repoPath: root })).toThrow(/adoption refused/);
    expect(file(root, "AGENTS.md")).toBe(own);
    const small = adopted(); expect(audit(small, small, "G".repeat(32768)).problems).toContainEqual(expect.stringContaining("Combined guidance exceeds"));
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
    // Real repository reads and command outputs; deterministic delivery/retrieval evidence, not a model comprehension claim.
    let lookup: string;
    try { lookup = execFileSync("rg", ["-n", "settle|workspace", "docs/notes-to-self.md"], { cwd: root, encoding: "utf8" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      lookup = execFileSync("grep", ["-nE", "settle|workspace", "docs/notes-to-self.md"], { cwd: root, encoding: "utf8" });
    }
    expect(lookup).toContain("Use settle --proposal, not --file");
    const entries = guidanceEntries(file(root, GUIDANCE_INDEX));
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
    expect(brief).not.toContain("### Three shapes");
    expect(brief).toContain("sha256");
    rmSync(path.join(root, identity.path));
    expect(resolveDispatch(root).blockers).toContainEqual(expect.objectContaining({ field: "guidance_delivery", message: expect.stringContaining(identity.path) }));
    expect(() => renderActionBrief({ repoRoot: root, projectSlug: "sample", planSlug: "fix", actionId: "repair", worktreePath: root, branch: "codex/proof", agent: "codex", baseRevision })).toThrow(/guidance delivery refused/);
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
    const other = scratch(); put(other, "AGENTS.md", "# Keep local rules");
    const outside = scratch(); symlinkSync(outside, path.join(other, "docs"));
    expect(() => setupArcadiaProjectContext({ repoPath: other })).toThrow(/target escapes repository/);
    expect(file(other, "AGENTS.md")).toBe("# Keep local rules");
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

  it("keeps a new bootstrap and its resource installation together in the governing propagation tier", () => {
    const root = scratch(); put(root, "AGENTS.md", "# Old guidance");
    const plan = computeWayPropagationPlan(root);
    expect(plan.changes.find((change) => change.path === "AGENTS.md")?.tier).toBe("governing");
    expect(plan.changes.find((change) => change.path === GUIDANCE_INDEX)?.tier).toBe("governing");
    expect(file(canonicalRoot, "AGENTS.md")).toContain(BOOTSTRAP_MARKER);
  });
});
