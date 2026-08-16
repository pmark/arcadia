import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_PATH, checkCapabilityRegistry } from "../src/docs/capabilities.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repo(registry?: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-capabilities-"));
  temporary.push(root);
  if (registry !== undefined) {
    const absolute = path.join(root, CAPABILITY_REGISTRY_PATH);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, typeof registry === "string" ? registry : JSON.stringify(registry), "utf8");
  }
  return root;
}

describe("capability registry check", () => {
  it("reports a command that claims to be read-only but writes", () => {
    const root = repo({
      commands: [
        { id: "arcadia.docket", kind: "query", mutates: false },
        { id: "arcadia.plan", kind: "query", mutates: true }
      ]
    });

    const blockers = checkCapabilityRegistry(root);

    // The exact defect two agents part-missed in a real registry: the noun/verb
    // signal an agent is told to trust before running anything, lying.
    expect(blockers).toHaveLength(1);
    expect(blockers[0].field).toBe("commands.arcadia.plan.kind");
    expect(blockers[0].message).toContain("read-only actually writes");
    expect(blockers[0].remedy).toContain('Set kind to "action"');
  });

  it("allows an action that does not mutate", () => {
    // Claiming more authority than you use is safe; the invariant is
    // one-directional, and real registries do this deliberately.
    const root = repo({ commands: [{ id: "arcadia.council", kind: "action", mutates: false }] });

    expect(checkCapabilityRegistry(root)).toEqual([]);
  });

  it("passes a consistent registry", () => {
    const root = repo({
      commands: [
        { id: "arcadia.docket", kind: "query", mutates: false },
        { id: "arcadia.advance", kind: "action", mutates: true }
      ]
    });

    expect(checkCapabilityRegistry(root)).toEqual([]);
  });

  it("says nothing about a repository with no registry", () => {
    expect(checkCapabilityRegistry(repo())).toEqual([]);
  });

  it("reports unreadable JSON rather than ignoring it", () => {
    const root = repo("{ not json");

    const blockers = checkCapabilityRegistry(root);

    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain("not valid JSON");
  });

  it("tolerates a registry that extends its own schema", () => {
    const root = repo({
      commands: [{ id: "arcadia.docket", kind: "query", mutates: false, aliases: ["what now"] }],
      views: { atlas: {} }
    });

    expect(checkCapabilityRegistry(root)).toEqual([]);
  });

  it("names the command by invocation when it has no id", () => {
    const root = repo({ commands: [{ invocation: "arcadia plan", kind: "query", mutates: true }] });

    expect(checkCapabilityRegistry(root)[0].field).toBe("commands.arcadia plan.kind");
  });
});
