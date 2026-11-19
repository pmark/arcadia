import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyGatePath,
  gateImportDrift,
  gateSetForProject,
  GATE_SET_PATH,
  loadGateSet,
  type ProjectGateSet,
} from "../src/production/gateSet.js";

/**
 * Gate-set list (Action define-the-gate-set): the list, its one loader and
 * this drift test are themselves in the list.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arcadia = (): ProjectGateSet => {
  const lookup = gateSetForProject(loadGateSet(root), "arcadia");
  if (!lookup.found) throw new Error(lookup.report);
  return lookup.entry;
};

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-set-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

describe("the checked-in list", () => {
  it("names the eight gate modules, spend, the hard classes and its own list, loader and test", () => {
    const entry = arcadia();
    expect(entry.gateModules.map((m) => m.id)).toEqual([
      "workerMerge",
      "independentReview",
      "batchMerge",
      "startRunDerive",
      "autoSettleBeforeDispatch",
      "candidateChangeGate",
      "mechanicalRepair",
      "start-run.sh",
    ]);
    expect(entry.spend).toEqual(["src/spend/"]);
    expect(entry.hardClasses.map((c) => c.name)).toEqual(["decisions", "agent_permissions", "constitution", "governance_files"]);
    expect(entry.self.map((s) => s.path)).toEqual([GATE_SET_PATH, "src/production/gateSet.ts", "tests/gate-set.test.ts"]);
  });

  it("has no drift against the real source tree", () => {
    expect(gateImportDrift(root, arcadia())).toEqual([]);
  });

  it("drift check fails naming the module and import when a gate module gains an unlisted import", () => {
    const dir = tempRoot({
      "src/production/gate.ts": 'import { a } from "./listed.js";\nimport { b } from "../new/extra.js";\nimport fs from "node:fs";\n',
      "src/production/listed.ts": "export const a = 1;\n",
      "src/new/extra.ts": "export const b = 2;\n",
    });
    const entry: ProjectGateSet = {
      repository: "x/y",
      gateModules: [{ id: "gate", path: "src/production/gate.ts", imports: ["node:fs", "src/production/listed.ts"] }],
      spend: [],
      hardClasses: [],
      self: [],
    };
    const drift = gateImportDrift(dir, entry);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ module: "src/production/gate.ts", import: "src/new/extra.ts" });
    expect(drift[0].message).toContain("src/production/gate.ts");
    expect(drift[0].message).toContain("src/new/extra.ts");
  });

  it("allows a listed gate module as an import and reports a listed module that no longer exists", () => {
    const dir = tempRoot({ "a.ts": 'import "./b.js";\n', "b.ts": "" });
    const entry: ProjectGateSet = {
      repository: "x/y",
      gateModules: [
        { id: "a", path: "a.ts", imports: [] },
        { id: "b", path: "b.ts", imports: [] },
        { id: "gone", path: "gone.ts", imports: [] },
      ],
      spend: [],
      hardClasses: [],
      self: [],
    };
    const drift = gateImportDrift(dir, entry);
    expect(drift.map((d) => d.module)).toEqual(["gone.ts"]);
  });
});

describe("one loader", () => {
  it("is the only module that names the list file", () => {
    const readers: string[] = [];
    const skip = new Set(["node_modules", ".git", "dist", ".next", "artifacts"]);
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(?:ts|tsx|mts|mjs|js|sh)$/.test(name)) {
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (rel === "src/production/gateSet.ts" || rel === "tests/gate-set.test.ts") continue;
          if (readFileSync(full, "utf8").includes("gate-set.json")) readers.push(rel);
        }
      }
    };
    for (const dir of ["src", "scripts", "tests", "apps", "bin"]) {
      try {
        walk(path.join(root, dir));
      } catch {
        /* directory absent */
      }
    }
    expect(readers, `only src/production/gateSet.ts may read ${GATE_SET_PATH}; call loadGateSet() instead`).toEqual([]);
  });
});

describe("fail-closed classification", () => {
  it("protects an unmapped new file under a listed gate directory", () => {
    const result = classifyGatePath(arcadia(), "src/production/brandNewModule.ts");
    expect(result).toMatchObject({ protected: true, mapped: false });
    expect(result.reason).toContain("fail closed");
  });

  it("protects mapped entries, spend, hard classes and imports, and leaves unrelated paths free", () => {
    const entry = arcadia();
    expect(classifyGatePath(entry, "src/production/workerMerge.ts")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "src/spend/anything.ts")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "docs/decisions/0001-x.md")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "CONSTITUTION.md")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, ".claude/settings.json")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "config/gate-set.json")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "src/git/worktrees.ts")).toMatchObject({ protected: true, mapped: true });
    expect(classifyGatePath(entry, "src/timeline/render.ts")).toMatchObject({ protected: false });
  });
});

describe("keyed by project", () => {
  it("carries Arcadia as the first entry and reports a second project's absence", () => {
    const doc = loadGateSet(root);
    expect(Object.keys(doc.projects)[0]).toBe("arcadia");
    expect(doc.projects.arcadia.repository).toBe("pmark/arcadia");
    const missing = gateSetForProject(doc, "martianrover");
    expect(missing.found).toBe(false);
    if (!missing.found) expect(missing.report).toContain("no gate list for project martianrover");
    expect(gateSetForProject(doc, "constructor").found).toBe(false);
  });
});
