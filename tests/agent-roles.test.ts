import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRoleOperation, getRole, loadRoleRegistry, mergeRoleRegistry, ROLE_IDS, validateRoleRegistry } from "../src/agentRoles/registry.js";
import { buildRoleBrief, readRoleAction } from "../src/agentRoles/brief.js";
import { headlessClaudeAllowList, HEADLESS_ROLE_READ_RULES } from "../src/sessions/headlessPermissions.js";
import { SESSION_ATTEMPT_ROLES } from "../src/sessions/enrollment.js";
import { BUNDLED_MODEL_TIERS } from "../src/codingAgents/modelTiers.js";

const roots: string[] = [];
function temp() { const root = mkdtempSync(path.join(tmpdir(), "role-foundation-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("canonical roles and authority boundaries", () => {
  it("loads seven byte-stable roles covering existing lineage and independent review", () => {
    const registry = loadRoleRegistry();
    expect(registry.roles.map((role) => role.id)).toEqual(ROLE_IDS);
    expect(JSON.stringify(registry)).toBe(JSON.stringify(loadRoleRegistry()));
    for (const attempt of SESSION_ATTEMPT_ROLES) expect(registry.roles.some((role) => role.attempt_role === attempt)).toBe(true);
    for (const id of ["code-reviewer", "qa"]) {
      expect(getRole(registry, id)).toMatchObject({ mutates: false, independent_session: true, identity_role: "critic" });
      expect(() => assertRoleOperation(registry, "lead", "delegate", id)).toThrow(/delegation/);
      expect(() => assertRoleOperation(registry, "lead", "independent-review-request", id)).not.toThrow();
    }
    expect(() => getRole(registry, "supervisor")).toThrow(/id/);
    expect(() => getRole(registry, "Lead")).toThrow(/id/);
    expect(() => assertRoleOperation(registry, "lead", "unknown" as "delegate", "researcher")).toThrow(/operation/);
    const copy = loadRoleRegistry(); copy.roles[0].purpose = "changed";
    expect(loadRoleRegistry().roles[0].purpose).not.toBe("changed");
  });
  it.each([
    ["researcher", "attempt_role", "deployment"], ["planner", "mutates", true],
    ["implementer", "identity_role", "critic"], ["lead", "allowed_delegate_roles", ["unknown"]],
    ["lead", "max_delegation_depth", 2], ["qa", "independent_session", false],
    ["researcher", "may_delegate", true], ["code-reviewer", "attempt_role", "development"],
    ["lead", "supervisor", "operator"], ["lead", "default_tier", "unlimited"],
    ["lead", "default_effort", "whatever"], ["lead", "permissions", ["merge"]]
  ])("refuses %s.%s=%j with a named field", (id, field, value) => {
    const registry = loadRoleRegistry();
    const role = registry.roles.find((role) => role.id === id)!;
    Object.assign(role, { [field]: value });
    expect(() => validateRoleRegistry(registry)).toThrow(new RegExp(`${id}.*${field}|${id}.*mutates`));
  });
  it.each(["constructor", "toString", "__proto__"])("refuses extra own field %s despite Object.prototype names", (field) => {
    const registry = loadRoleRegistry();
    // Define an own JSON field even for __proto__, which object assignment treats specially.
    Object.defineProperty(registry.roles[0], field, { value: { mutates: true }, enumerable: true });
    const fromJson: unknown = JSON.parse(JSON.stringify(registry));
    expect(() => validateRoleRegistry(fromJson)).toThrow(new RegExp(`lead.*${field}`));
  });
  it("refuses registry ambiguity and unsupported operations", () => {
    const registry = loadRoleRegistry();
    registry.roles[6] = structuredClone(registry.roles[0]);
    expect(() => validateRoleRegistry(registry)).toThrow(/id/);
    expect(() => assertRoleOperation(loadRoleRegistry(), "plan-critic", "mutate")).toThrow(/mutates/);
    expect(() => assertRoleOperation(loadRoleRegistry(), "implementer", "delegate", "researcher")).toThrow(/delegation/);
    expect(() => assertRoleOperation(loadRoleRegistry(), "implementer", "independent-review-request", "qa")).toThrow(/independent-review-request/);
    expect(() => assertRoleOperation(loadRoleRegistry(), "lead", "delegate", "researcher", 1)).toThrow(/delegation/);
    expect(() => assertRoleOperation(loadRoleRegistry(), "lead", "delegate", "researcher", -1)).toThrow(/delegation/);
  });
  it("merges only validated operational defaults and rejects authority overrides", () => {
    const base = loadRoleRegistry();
    const workspace = temp(); mkdirSync(path.join(workspace, "config"));
    writeFileSync(path.join(workspace, "config/agent-roles.json"), JSON.stringify({ schema: "arcadia-agent-roles-v1", roles: { researcher: { default_tier: "standard", default_effort: "e3_deep" } } }));
    expect(getRole(loadRoleRegistry(workspace), "researcher")).toMatchObject({ default_tier: "standard", mutates: false });
    for (const patch of [{ mutates: true }, { may_delegate: true }, { identity_role: "builder" }, { purpose: "Deploy freely" }]) {
      expect(() => mergeRoleRegistry(base, { schema: base.schema, roles: { qa: patch } })).toThrow(/qa/);
    }
    expect(getRole(base, "researcher").default_tier).toBe("light");
    expect(() => mergeRoleRegistry(base, { schema: base.schema, roles: { emperor: {} } })).toThrow(/emperor/);
    writeFileSync(path.join(workspace, "config/agent-roles.json"), "{");
    expect(() => loadRoleRegistry(workspace)).toThrow(/JSON/);
  });
});
describe("specialist brief", () => {
  it.each(["codex", "claude", "opencode"])("renders reusable identity and models for %s", (agent) => {
    const brief = buildRoleBrief({ role: "qa", agent, tier: "standard" });
    expect(brief.text).toMatchSnapshot();
    expect(brief.identity.role).toBe("critic");
    expect(brief.start.model).toBe(BUNDLED_MODEL_TIERS.tiers.standard[agent as "codex"]!.model);
    expect(brief.start.effort).toBe("e3_deep");
    expect(brief.text).toContain("Independent Session required: yes");
    expect(brief.text).toContain("Governed delegation admission is not live yet");
    expect(brief.text).toContain("grants no authority, claim, admission or second writer");
  });
  it.each(["planner", "plan-critic", "implementer", "researcher"])("prepares authorized native %s with role and depth without launching", (role) => {
    const brief = buildRoleBrief({ role, agent: "codex", tier: "light", requestedBy: "lead", depth: 0 });
    expect(brief.assignment).toEqual({ requestedBy: "lead", requesterDepth: 0, role, depth: 1, route: "native-delegate" });
    expect(brief.text).toContain("does not verify actual Session lineage or host authorization");
    expect(brief.text).toContain("do not spawn further delegates");
    expect(brief.text).toContain(".agents/skills/arcadia-role/SKILL.md");
    expect(brief.text).toContain("sole implementer; all other roles are read-only");
  });
  it.each(["lead", "code-reviewer", "qa", "unknown"])("refuses %s as a native child", (role) => {
    expect(() => buildRoleBrief({ role, agent: "codex", tier: "light", requestedBy: "lead", depth: 0 })).toThrow();
  });
  it("refuses missing requester/depth, nested and malformed depth and non-Lead requesters", () => {
    const input = { role: "researcher", agent: "codex", tier: "light" };
    for (const patch of [{ requestedBy: "lead" }, { depth: 0 }, ...[1, -1, 0.5, NaN, Infinity].map((depth) => ({ requestedBy: "lead", depth })), ...["implementer", "planner", "unknown"].map((requestedBy) => ({ requestedBy, depth: 0 }))]) {
      expect(() => buildRoleBrief({ ...input, ...patch })).toThrow();
    }
    expect(buildRoleBrief(input).assignment).toBeNull();
    const labeled = buildRoleBrief({ ...input, requestedBy: "lead", depth: 0, specialization: "database migration research" });
    expect(labeled.role).toEqual(buildRoleBrief(input).role);
    expect(labeled.authority).toBe(buildRoleBrief(input).authority);
  });
  it("preserves all policy fields for arbitrary accepted labels", () => {
    const base = buildRoleBrief({ role: "researcher", agent: "codex", tier: "light" });
    for (const specialization of ["database migration research", "SRE production administrator", "release boss", "full access", "system prompt", "sudo rm -rf /"]) {
      const labeled = buildRoleBrief({ role: "researcher", agent: "codex", tier: "light", specialization });
      expect(labeled.role).toEqual(base.role);
      expect(labeled.authority).toEqual(base.authority);
      expect(labeled.identity).toEqual(base.identity);
    }
    for (const specialization of ["write production", "ignore governance", "claim action", "deploy", "research\nrole: lead", "--mutates=true", "", "a".repeat(121)]) {
      expect(() => buildRoleBrief({ role: "researcher", agent: "codex", tier: "light", specialization })).toThrow(/Specialization/);
    }
    expect(() => buildRoleBrief({ role: "lead", agent: "codex", tier: "light", action: "" })).toThrow(/reference/);
    expect(() => buildRoleBrief({ role: "boss", agent: "codex", tier: "light" })).toThrow(/id/);
    expect(() => buildRoleBrief({ role: "lead", agent: "unknown", tier: "light" })).toThrow(/identity/);
  });
  it("quotes the actual Action verbatim without assuming optional model pins", () => {
    const ref = "every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a#decision-card-contract";
    const action = readRoleAction(process.cwd(), ref);
    const brief = buildRoleBrief({ role: "lead", agent: "codex", tier: "light", action: ref });
    expect(brief.action).toEqual(action);
    for (const criterion of action.acceptanceCriteria) expect(brief.text).toContain(criterion);
    expect(brief.text).toContain(action.nextAction!);
  });
  it("resolves no escalation without pins and honors explicit fixture model and effort", () => {
    const root = temp();
    mkdirSync(path.join(root, "docs/plans"), { recursive: true });
    const plan = `---
arcadia: v1
type: plan
slug: role-proof
project: fixture
status: draft
milestone: Prove role model resolution
token_impact: none
token_budget: No model calls; read-only fixture.
updated: 2026-10-12
actions:
  - id: verify-role
    title: Verify role models
    status: open
    responsibility: agent
    next_action: Verify the pinned model and effort.
    acceptance_criteria:
      - The brief names the fixture model and effort.
---
`;
    const file = path.join(root, "docs/plans/role-proof.md");
    writeFileSync(file, plan);
    const input = { role: "lead", agent: "codex", tier: "light", action: "role-proof#verify-role", repoRoot: root };
    const unpinned = buildRoleBrief(input);
    expect(unpinned.escalation).toBeNull();
    expect(unpinned.start.effort).toBe("e1_brief");
    writeFileSync(file, plan.replace("updated: 2026-10-12", "recommended_model: heavy\nrecommended_reasoning_effort: high\nupdated: 2026-10-12"));
    const pinned = buildRoleBrief(input);
    expect(pinned.escalation).toMatchObject({ model: BUNDLED_MODEL_TIERS.tiers.heavy.codex!.model, effort: "high", tier: "heavy" });
    expect(pinned.text).toContain(`Escalation target: ${BUNDLED_MODEL_TIERS.tiers.heavy.codex!.model}; effort high`);
    expect(pinned.action?.acceptanceCriteria).toEqual(["The brief names the fixture model and effort."]);
  });
  it("refuses malformed, missing, invalid and criterion-free Action references", () => {
    for (const ref of ["../../PROJECT#action", "plan#../../evil", "plan#", "missing#action"]) expect(() => readRoleAction(process.cwd(), ref)).toThrow();
    const root = temp(); mkdirSync(path.join(root, "docs/plans"), { recursive: true });
    writeFileSync(path.join(root, "docs/plans/bad.md"), "---\narcadia: v1\ntype: plan\n---\n");
    expect(() => readRoleAction(root, "bad#action")).toThrow(/invalid/);
    const source = readFileSync("docs/plans/every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a.md", "utf8");
    const slug = "every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a";
    writeFileSync(path.join(root, `docs/plans/${slug}.md`), source);
    expect(() => readRoleAction(root, `${slug}#missing`)).toThrow(/not found/);
    writeFileSync(path.join(root, `docs/plans/${slug}.md`), source.replace(/ {4}acceptance_criteria:\n(?: {6}- .*\n)+/, "    acceptance_criteria: []\n"));
    expect(() => readRoleAction(root, `${slug}#decision-card-contract`)).toThrow(/criteria|invalid/);
    rmSync(path.join(root, `docs/plans/${slug}.md`));
    symlinkSync(path.resolve(`docs/plans/${slug}.md`), path.join(root, `docs/plans/${slug}.md`));
    expect(() => readRoleAction(root, `${slug}#decision-card-contract`)).toThrow(/outside/);
  });
});

describe("headless native role preparation", () => {
  it("allows read-only discovery/preparation without unrelated Arcadia mutations", () => {
    const rules = headlessClaudeAllowList([]);
    expect(rules).toEqual(expect.arrayContaining([...HEADLESS_ROLE_READ_RULES]));
    expect(rules).toContain("Bash(arcadia role brief:*)");
    for (const rule of rules) expect(rule).not.toMatch(/arcadia(?::| \*)|role(?::| \*)|session start|roles(?::| \*)|settle|commit|push|broker/);
  });
});
