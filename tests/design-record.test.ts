import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { checkDesignFile, recordHash, type DesignCheckResult } from "../src/design/record.js";
import { cleanupTrackedPaths, createTempConfigPath, parseJson, repoRoot, runCli } from "./cli-response-fixture.js";

type Obj = Record<string, any>;

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  cleanupTrackedPaths();
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const MISSION = "The Project keeps momentum with minimal operator attention.";
const SOURCE_TEXT = "The operator's notes.\n";
const WORKSPACE_TEXT = "A pasted vendor plan.\n";

interface Fixture { root: string; project: string; dir: string; record: string; workspace: string; }

/** A real Project with a design directory, one repo source, one workspace source and two review files. */
function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-design-")));
  roots.push(root);
  const project = path.join(root, "project");
  const dir = path.join(project, "docs", "design", "demo");
  const workspace = path.join(root, "workspace");
  for (const directory of [path.join(dir, "sources"), path.join(dir, "reviews"), path.join(project, "src"), path.join(workspace, "design-sources", "demo")]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(path.join(project, "PROJECT.md"), `# Demo\n\n${MISSION}\n`);
  writeFileSync(path.join(project, "src", "example.ts"), "export const x = 1;\n");
  writeFileSync(path.join(dir, "sources", "S001.md"), SOURCE_TEXT);
  writeFileSync(path.join(dir, "reviews", "R1.md"), "review one\n");
  writeFileSync(path.join(dir, "reviews", "R2.md"), "review two\n");
  writeFileSync(path.join(workspace, "design-sources", "demo", "S003.md"), WORKSPACE_TEXT);
  return { root, project, dir, record: path.join(dir, "record.yaml"), workspace };
}

/** A valid, ready record. A review hash of "CURRENT" is replaced with the record's own hash on write. */
function baseRecord(): Obj {
  return {
    schema: "arcadia-design-record-v1",
    design: "demo",
    project: "demo",
    authors: ["Claudia Atlas"],
    frame: {
      status: "confirmed",
      confirmed_ref: "Decision 0200",
      outcome: "One sentence outcome.",
      milestone: "One sentence milestone.",
      experience_target: "The moment it is judged against.",
      mission: [{ id: "M1", file: "PROJECT.md", quote: "keeps momentum" }],
      requirements: [{ id: "REQ-001", statement: "An observable behavior.", mission: ["M1"], proof: "The focused test." }],
      non_goals: ["Something excluded."]
    },
    sources: [
      { id: "S001", title: "Operator notes", kind: "operator", added: "2026-11-02", retention: "repo", path: "sources/S001.md", sha256: sha(SOURCE_TEXT) },
      { id: "S002", title: "Prototype docs", kind: "third_party", added: "2026-11-02", retention: "pointer", url: "https://example.com/repo", revision: "abc1234", rights: "MIT" },
      { id: "S003", title: "Pasted vendor plan", kind: "third_party", added: "2026-11-02", retention: "workspace", workspace_path: "design-sources/demo/S003.md", sha256: sha(WORKSPACE_TEXT) }
    ],
    concepts: [
      {
        id: "C-001", title: "The mechanism", kind: "mechanism", statement: "A paraphrase.",
        origins: [{ source: "S001", locator: "line 1" }, { source: "S002", locator: "docs/001.md" }],
        fit: { status: "partial", evidence: ["src/example.ts"] },
        position: "chosen", serves: ["REQ-001"], load_bearing: true,
        verification: { status: "verified", evidence: "tests/example.test.ts" }
      },
      { id: "C-002", title: "An alternative", kind: "mechanism", statement: "A paraphrase.", origins: [{ source: "S003", locator: "section 2" }], position: "rejected", reason: "Costs more attention." },
      { id: "C-003", title: "For later", kind: "mechanism", statement: "A paraphrase.", origins: [{ source: "S001", locator: "line 3" }], position: "parked", revival: "When a second caller exists." },
      { id: "C-004", title: "A duplicate", kind: "mechanism", statement: "A paraphrase.", origins: [{ source: "S003", locator: "section 3" }], position: "merged", merged_into: "C-001" }
    ],
    choices: [{
      id: "CH-01", question: "Which mechanism?",
      options: [{ concept: "C-001", consequence: "Cheap now." }, { concept: "C-002", consequence: "Costly later." }],
      chosen: "C-001", decided_by: "operator", decision_ref: "Decision 0201"
    }],
    riskiest_assumption: { statement: "It scales.", test: "Run the probe.", status: "supported", evidence: "probe.md" },
    scrutiny: [
      { id: "R1", path: "reviews/R1.md", reviewer: "Critic Cody Mason", independent_of_authors: true, lenses: ["mission", "evidence"], record_hash: "CURRENT", verdict: "pass", findings: [] },
      { id: "R2", path: "reviews/R2.md", reviewer: "Nadia Wells", independent_of_authors: true, lenses: ["failure"], record_hash: "CURRENT", verdict: "pass_with_changes", findings: [{ id: "R2-F1", severity: "blocking", summary: "Fixed already.", disposition: "fixed" }] }
    ]
  };
}

function write(fx: Fixture, record: Obj, finalize = true): void {
  if (finalize) {
    const hash = recordHash(record);
    for (const review of record.scrutiny ?? []) if (review.record_hash === "CURRENT") review.record_hash = hash;
  }
  writeFileSync(fx.record, stringifyYaml(record));
}

interface RunOptions { ready?: boolean; matrix?: boolean; workspace?: string | null; keepHashes?: boolean; }
function run(mutate: (record: Obj, fx: Fixture) => void = () => undefined, options: RunOptions = {}): DesignCheckResult {
  const fx = fixture();
  const record = baseRecord();
  mutate(record, fx);
  write(fx, record, !options.keepHashes);
  return checkDesignFile(fx.record, {
    ready: options.ready, matrix: options.matrix,
    workspace: options.workspace === undefined ? fx.workspace : options.workspace
  });
}
const ready = (mutate: (record: Obj, fx: Fixture) => void, extra: RunOptions = {}): DesignCheckResult => run(mutate, { ready: true, ...extra });

function expectProblem(result: DesignCheckResult, pattern: RegExp): void {
  expect(result.problems.some((problem) => pattern.test(problem)), `expected /${pattern.source}/ in:\n${result.problems.join("\n")}`).toBe(true);
}

describe("a valid design record", () => {
  it("passes the structural and --ready checks and prints its hash", () => {
    const structural = run();
    expect(structural.problems).toEqual([]);
    expect(structural.warnings).toEqual([]);
    expect(structural.kind).toBe("record");
    expect(structural.recordHash).toMatch(/^[0-9a-f]{64}$/);
    const gate = ready(() => undefined);
    expect(gate.problems).toEqual([]);
    expect(gate.warnings).toEqual([]);
  });

  it("reports every problem, not only the first", () => {
    const result = run((record) => {
      record.concepts[1].reason = " ";
      record.concepts[2].revival = undefined;
      record.sources[0].sha256 = "ABC";
    });
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("reads no workspace and writes nothing", () => {
    const fx = fixture();
    write(fx, baseRecord());
    const snapshot = (): string[] => (readdirSync(fx.root, { recursive: true }) as string[]).sort().map((entry) => `${entry}:${statSync(path.join(fx.root, entry)).mtimeMs}`);
    const before = snapshot();
    checkDesignFile(fx.record, { ready: true, matrix: true, workspace: fx.workspace });
    expect(snapshot()).toEqual(before);
  });
});

describe("paths", () => {
  it("refuses an absolute source path", () => {
    expectProblem(run((r, fx) => { r.sources[0].path = path.join(fx.dir, "sources", "S001.md"); }), /absolute path/);
  });

  it("refuses a .. escape", () => {
    expectProblem(run((r) => { r.sources[0].path = "../outside.md"; }), /escapes its directory/);
    expectProblem(run((r) => { r.scrutiny[0].path = "../../R1.md"; }), /escapes its directory/);
  });

  it("refuses a symlink that leaves the design directory, even to a missing target", () => {
    const outside = (fx: Fixture): string => path.join(fx.root, "outside.md");
    expectProblem(run((r, fx) => {
      writeFileSync(outside(fx), SOURCE_TEXT);
      symlinkSync(outside(fx), path.join(fx.dir, "sources", "link.md"));
      r.sources[0].path = "sources/link.md";
    }), /outside its directory/);
    expectProblem(run((r, fx) => {
      symlinkSync(fx.root, path.join(fx.dir, "sources", "dir"));
      r.sources[0].path = "sources/dir/outside.md";
    }), /outside its directory/);
    expectProblem(run((r, fx) => {
      symlinkSync(path.join(fx.root, "nowhere.md"), path.join(fx.dir, "sources", "dangling.md"));
      r.sources[0].path = "sources/dangling.md";
    }), /cannot be resolved/);
  });

  it("refuses a fit.evidence or mission file that escapes the Project", () => {
    expectProblem(run((r) => { r.concepts[0].fit.evidence = ["../outside.ts"]; }), /fit\.evidence "\.\.\/outside\.ts" escapes/);
    expectProblem(run((r) => { r.concepts[0].fit.evidence = ["/etc/hosts"]; }), /fit\.evidence "\/etc\/hosts" is an absolute path/);
    expectProblem(run((r) => { r.frame.mission[0].file = "../PROJECT.md"; }), /escapes its directory/);
  });

  it("reports a missing fit.evidence file", () => {
    expectProblem(run((r) => { r.concepts[0].fit.evidence = ["src/missing.ts"]; }), /does not exist in the Project/);
  });

  it("refuses a workspace_path that escapes the workspace, with or without a workspace", () => {
    expectProblem(run((r) => { r.sources[2].workspace_path = "../escape.md"; }), /escapes its directory/);
    expectProblem(run((r) => { r.sources[2].workspace_path = "../escape.md"; }, { workspace: null }), /escapes its directory/);
    expectProblem(run((r) => { r.sources[2].workspace_path = "/etc/hosts"; }), /absolute path/);
    expectProblem(run((r, fx) => {
      symlinkSync(fx.root, path.join(fx.workspace, "design-sources", "demo", "out"));
      r.sources[2].workspace_path = "design-sources/demo/out/outside.md";
    }), /outside its directory/);
  });

  it("reports a missing project root for mission and fit checks", () => {
    const fx = fixture();
    rmSync(path.join(fx.project, "PROJECT.md"));
    write(fx, baseRecord());
    const result = checkDesignFile(fx.record, { workspace: fx.workspace });
    expectProblem(result, /no PROJECT\.md was found/);
    expect(result.problems.filter((problem) => /no PROJECT\.md/.test(problem))).toHaveLength(1);
  });
});

describe("source hashes and retention", () => {
  it("rejects a wrong sha256 for a repo source", () => {
    expectProblem(run((r) => { r.sources[0].sha256 = sha("something else"); }), /sha256 does not match sources\/S001\.md/);
  });

  it("rejects uppercase, short and missing hex", () => {
    expectProblem(run((r) => { r.sources[0].sha256 = sha(SOURCE_TEXT).toUpperCase(); }), /64 lowercase hex/);
    expectProblem(run((r) => { r.sources[0].sha256 = "abc123"; }), /64 lowercase hex/);
    expectProblem(run((r) => { r.sources[0].sha256 = undefined; }), /sha256 is required/);
    expectProblem(run((r) => { r.scrutiny[0].record_hash = "abc"; }, { keepHashes: true }), /record_hash must be 64 lowercase hex/);
  });

  it("rejects a missing repo source file", () => {
    expectProblem(run((r) => { r.sources[0].path = "sources/missing.md"; }), /does not exist in the design directory/);
  });

  it("rejects a workspace file whose hash differs", () => {
    expectProblem(run((r) => { r.sources[2].sha256 = sha("different"); }), /does not match the workspace file/);
  });

  it("warns, and still passes, when the workspace is unavailable or the file is missing", () => {
    const unavailable = run(undefined, { workspace: null });
    expect(unavailable.problems).toEqual([]);
    expect(unavailable.warnings.join("\n")).toMatch(/S003.*not verified/);
    const missing = run((r) => { r.sources[2].workspace_path = "design-sources/demo/absent.md"; });
    expect(missing.problems).toEqual([]);
    expect(missing.warnings.join("\n")).toMatch(/absent\.md.*not verified/);
  });

  it("requires rights for third_party or client text kept in the repository", () => {
    expectProblem(run((r) => { r.sources[0].kind = "third_party"; }), /third_party source kept in the repository needs rights/);
    expectProblem(run((r) => { r.sources[0].kind = "client"; r.sources[0].rights = "  "; }), /client source kept in the repository needs rights/);
    expect(run((r) => { r.sources[0].kind = "third_party"; r.sources[0].rights = "Operator owns it"; }).problems).toEqual([]);
  });

  it("requires url, revision and rights for a pointer", () => {
    for (const field of ["url", "revision", "rights"]) {
      expectProblem(run((r) => { r.sources[1][field] = undefined; }), new RegExp(`pointer source needs ${field}`));
    }
    expectProblem(run((r) => { r.sources[1].revision = "   "; }), /needs revision/);
  });

  it("validates kind, retention and the added date", () => {
    expectProblem(run((r) => { r.sources[0].kind = "stranger"; }), /kind must be one of/);
    expectProblem(run((r) => { r.sources[0].retention = "cloud"; }), /retention must be one of/);
    expectProblem(run((r) => { r.sources[0].added = "2026-13-45"; }), /added is required/);
  });
});

describe("ids and references", () => {
  it("rejects duplicate ids in every namespace", () => {
    expectProblem(run((r) => { r.sources[1].id = "S001"; }), /duplicate id S001/);
    expectProblem(run((r) => { r.concepts[1].id = "C-001"; }), /duplicate id C-001/);
    expectProblem(run((r) => { r.choices.push({ ...r.choices[0] }); }), /duplicate id CH-01/);
    expectProblem(run((r) => { r.frame.requirements.push({ ...r.frame.requirements[0] }); }), /duplicate id REQ-001/);
    expectProblem(run((r) => { r.frame.mission.push({ ...r.frame.mission[0] }); }), /duplicate id M1/);
    expectProblem(run((r) => { r.scrutiny[1].id = "R1"; }), /duplicate id R1/);
  });

  it("rejects badly formed ids", () => {
    expectProblem(run((r) => { r.sources[0].id = "S1"; }), /id "S1" does not match/);
    expectProblem(run((r) => { r.concepts[0].id = "C001"; }), /id "C001" does not match/);
    expectProblem(run((r) => { r.choices[0].id = "CH-1"; }), /id "CH-1" does not match/);
    expectProblem(run((r) => { r.frame.requirements[0].id = "REQ-1"; }), /does not match/);
    expectProblem(run((r) => { r.frame.mission[0].id = "Mission"; }), /does not match/);
    expectProblem(run((r) => { r.scrutiny[0].id = "review-1"; }), /does not match/);
  });

  it("rejects dangling references", () => {
    expectProblem(run((r) => { r.concepts[0].origins[0].source = "S099"; }), /unknown source "S099"/);
    expectProblem(run((r) => { r.choices[0].options[0].concept = "C-099"; }), /unknown concept "C-099"/);
    expectProblem(run((r) => { r.choices[0].chosen = "C-099"; }), /chosen names unknown concept/);
    expectProblem(run((r) => { r.concepts[0].serves = ["REQ-099"]; }), /unknown requirement "REQ-099"/);
    expectProblem(run((r) => { r.frame.requirements[0].mission = ["M9"]; }), /mission reference "M9"/);
    expectProblem(run((r) => { r.concepts[3].merged_into = "C-099"; }), /unknown concept C-099/);
  });

  it("rejects a merge chain and a self-merge", () => {
    expectProblem(run((r) => { r.concepts[0].position = "merged"; r.concepts[0].merged_into = "C-002"; r.concepts[1].position = "merged"; r.concepts[1].merged_into = "C-003"; }), /merge chains/);
    expectProblem(run((r) => { r.concepts[3].merged_into = "C-004"; }), /merged into itself/);
    expectProblem(run((r) => { r.concepts[3].merged_into = undefined; }), /needs merged_into/);
  });

  it("requires at least one origin", () => {
    expectProblem(run((r) => { r.concepts[0].origins = []; }), /at least one origin/);
  });
});

describe("mission quotes", () => {
  it("rejects a quote that is not in the file", () => {
    expectProblem(run((r) => { r.frame.mission[0].quote = "an invented line"; }), /quote does not appear exactly in PROJECT\.md/);
  });

  it("rejects an empty or whitespace-only quote", () => {
    expectProblem(run((r) => { r.frame.mission[0].quote = ""; }), /quote is required and must not be blank/);
    expectProblem(run((r) => { r.frame.mission[0].quote = "  \n "; }), /quote is required and must not be blank/);
  });

  it("matches exactly: a whitespace or case difference fails", () => {
    expectProblem(run((r) => { r.frame.mission[0].quote = "keeps  momentum"; }), /does not appear exactly/);
    expectProblem(run((r) => { r.frame.mission[0].quote = "Keeps momentum"; }), /does not appear exactly/);
    expectProblem(run((r) => { r.frame.mission[0].quote = "keeps\nmomentum"; }), /does not appear exactly/);
  });

  it("rejects a mission file that is missing", () => {
    expectProblem(run((r) => { r.frame.mission[0].file = "NOPE.md"; }), /does not exist in the Project/);
  });
});

describe("positions", () => {
  it("requires a reason for rejected, a revival for parked, serves for chosen", () => {
    expectProblem(run((r) => { r.concepts[1].reason = undefined; }), /rejected concept needs a reason/);
    expectProblem(run((r) => { r.concepts[2].revival = undefined; }), /parked concept needs a revival/);
    expectProblem(run((r) => { r.concepts[0].serves = undefined; }), /chosen concept needs serves/);
    expectProblem(run((r) => { r.concepts[0].serves = ["REQ-009"]; }), /unknown requirement "REQ-009"/);
  });

  it("counts whitespace-only values as missing", () => {
    expectProblem(run((r) => { r.concepts[1].reason = "   "; }), /needs a reason/);
    expectProblem(run((r) => { r.concepts[2].revival = "\n"; }), /needs a revival/);
    expectProblem(run((r) => { r.concepts[0].serves = []; }), /needs serves/);
    expectProblem(run((r) => { r.concepts[3].merged_into = " "; }), /needs merged_into/);
  });

  it("rejects an unknown position, kind or fit status", () => {
    expectProblem(run((r) => { r.concepts[0].position = "decided"; }), /position must be one of/);
    expectProblem(run((r) => { r.concepts[0].kind = "idea"; }), /kind must be one of/);
    expectProblem(run((r) => { r.concepts[0].fit.status = "maybe"; }), /status must be one of/);
  });
});

describe("rights and pointers", () => {
  it("rejects a pointer missing revision", () => {
    expectProblem(run((r) => { delete r.sources[1].revision; }), /pointer source needs revision/);
  });
});

describe("the ready gate", () => {
  it("rejects an unconfirmed frame or one without confirmed_ref", () => {
    expectProblem(ready((r) => { r.frame.status = "proposed"; }), /frame\.status must be confirmed/);
    expectProblem(ready((r) => { r.frame.confirmed_ref = " "; }), /needs confirmed_ref/);
  });

  it("does not apply the gate without --ready", () => {
    expect(run((r) => { r.frame.status = "proposed"; r.concepts[0].position = "leaning"; r.concepts[0].serves = undefined; }).problems).toEqual([]);
  });

  it("requires a requirement, a mission, a proof and a chosen concept serving it", () => {
    expectProblem(ready((r) => { r.frame.requirements = []; r.concepts[0].serves = undefined; r.concepts[0].position = "rejected"; r.concepts[0].reason = "x"; r.choices = []; }), /at least one requirement/);
    expectProblem(ready((r) => { r.frame.requirements.push({ id: "REQ-002", statement: "Another.", mission: ["M1"], proof: "A test." }); }), /REQ-002: no chosen concept serves this requirement/);
    expectProblem(ready((r) => { r.frame.requirements[0].mission = []; }), /must cite at least one mission/);
    expectProblem(ready((r) => { r.frame.requirements[0].proof = "  "; }), /needs a proof/);
  });

  it("rejects an open, candidates or leaning concept", () => {
    for (const position of ["open", "candidates", "leaning"]) {
      expectProblem(ready((r) => { r.concepts[2].position = position; }), new RegExp(`C-003: concept is still ${position}`));
    }
  });

  it("checks each choice", () => {
    expectProblem(ready((r) => { r.choices[0].chosen = "C-003"; }), /chosen C-003 is not among the options/);
    expectProblem(ready((r) => { r.choices[0].chosen = undefined; }), /no chosen option/);
    expectProblem(ready((r) => { r.concepts[1].position = "open"; r.concepts[1].reason = undefined; }), /unchosen option C-002 is open/);
    expectProblem(ready((r) => { r.choices[0].decision_ref = undefined; }), /operator choice needs decision_ref/);
    expectProblem(ready((r) => { r.choices[0].decided_by = "agent"; }), /agent choice needs a reason/);
    expectProblem(ready((r) => { r.choices[0].decided_by = undefined; }), /decided_by must be operator or agent/);
    expect(ready((r) => { r.choices[0].decided_by = "agent"; r.choices[0].reason = "Routine."; r.concepts[0].fit.status = "exists"; }).problems).toEqual([]);
  });

  it("requires an operator choice for a conflicting fit", () => {
    expectProblem(ready((r) => { r.concepts[0].fit.status = "conflicts"; r.choices[0].decided_by = "agent"; r.choices[0].reason = "Routine."; }), /conflicts, so an operator choice must cover/);
    expect(ready((r) => { r.concepts[0].fit.status = "conflicts"; }).problems).toEqual([]);
  });

  it("requires a load-bearing chosen concept to be verified or covered by an accepted risk", () => {
    expectProblem(ready((r) => { r.concepts[0].verification = { status: "unverified" }; }), /load-bearing concept must be verified/);
    expectProblem(ready((r) => { r.concepts[0].verification = { status: "verified", evidence: " " }; }), /load-bearing concept must be verified/);
    expect(ready((r) => {
      r.concepts[0].verification = undefined;
      r.scrutiny[1].findings = [{ id: "R2-F1", severity: "blocking", summary: "Unproven.", concepts: ["C-001"], disposition: "accepted_risk", decision_ref: "Decision 0202" }];
    }).problems).toEqual([]);
  });

  it("covers a concept only through the concepts list of an accepted_risk blocking finding", () => {
    const unverified = (r: Obj, finding: Obj): void => { r.concepts[0].verification = undefined; r.scrutiny[1].findings = [{ id: "R2-F1", severity: "blocking", summary: "Unproven.", decision_ref: "Decision 0202", ...finding }]; };
    // Named only in the summary: not covered.
    expectProblem(ready((r) => unverified(r, { summary: "C-001 is unproven.", disposition: "accepted_risk" })), /C-001: a load-bearing concept must be verified/);
    // A longer ID does not cover a shorter one.
    expectProblem(ready((r) => {
      r.concepts.push({ id: "C-0012", title: "Longer", kind: "mechanism", statement: "A paraphrase.", origins: [{ source: "S001", locator: "line 9" }], position: "parked", revival: "Later." });
      unverified(r, { concepts: ["C-0012"], disposition: "accepted_risk" });
    }), /C-001: a load-bearing concept must be verified/);
    // A finding that is not an accepted risk, or is only a note, does not cover it.
    expectProblem(ready((r) => unverified(r, { concepts: ["C-001"], disposition: "fixed" })), /C-001: a load-bearing concept must be verified/);
    expectProblem(ready((r) => unverified(r, { concepts: ["C-001"], severity: "note", disposition: "accepted_risk" })), /C-001: a load-bearing concept must be verified/);
  });

  it("rejects an unknown or malformed concepts entry on a finding", () => {
    const withConcepts = (concepts: unknown) => (r: Obj): void => { r.scrutiny[1].findings[0].concepts = concepts; };
    expectProblem(run(withConcepts(["C-099"])), /concepts names unknown concept "C-099"/);
    expectProblem(run(withConcepts(["C-0012"])), /unknown concept "C-0012"/);
    expectProblem(run(withConcepts("C-001")), /concepts: must be a list/);
    expect(run(withConcepts(["C-001"])).problems).toEqual([]);
  });

  it("requires the riskiest assumption to be supported or an accepted risk", () => {
    expectProblem(ready((r) => { r.riskiest_assumption.status = "untested"; }), /riskiest_assumption: status is "untested"/);
    expectProblem(ready((r) => { r.riskiest_assumption.evidence = undefined; }), /supported assumption needs evidence/);
    expectProblem(ready((r) => { r.riskiest_assumption.status = "accepted_risk"; }), /accepted_risk assumption needs decision_ref/);
    expectProblem(ready((r) => { r.riskiest_assumption = undefined; }), /riskiest_assumption is missing/);
    expect(ready((r) => { r.riskiest_assumption.status = "accepted_risk"; r.riskiest_assumption.decision_ref = "Decision 0203"; }).problems).toEqual([]);
  });
});

describe("scrutiny", () => {
  it("does not count a review of a stale hash toward lens coverage", () => {
    const result = ready((r) => { r.scrutiny[1].record_hash = sha("an earlier record"); });
    expectProblem(result, /no current independent review covers the failure lens/);
    expect(result.warnings.join("\n")).toMatch(/R2.*stale/);
  });

  it("reports a missing lens", () => {
    expectProblem(ready((r) => { r.scrutiny[0].lenses = ["mission"]; }), /covers the evidence lens/);
    expectProblem(ready((r) => { r.scrutiny = []; }), /covers the mission lens/);
  });

  it("rejects a reviewer who is an author, ignoring case and the Critic title", () => {
    expectProblem(ready((r) => { r.scrutiny[0].reviewer = "Claudia Atlas"; }), /reviewer "Claudia Atlas" is one of the authors/);
    expectProblem(ready((r) => { r.scrutiny[0].reviewer = "critic claudia atlas"; }), /is one of the authors/);
    expectProblem(ready((r) => { r.scrutiny[0].reviewer = "CLAUDIA   ATLAS"; }), /is one of the authors/);
    expectProblem(ready((r) => { r.authors = ["Critic Cody Mason"]; }), /is one of the authors/);
  });

  it("rejects a review that is not independent", () => {
    const result = ready((r) => { r.scrutiny[0].independent_of_authors = false; });
    expectProblem(result, /independent_of_authors is not true/);
    expectProblem(result, /covers the mission lens/);
  });

  it("rejects a hold or incomplete verdict on the current hash", () => {
    expectProblem(ready((r) => { r.scrutiny[0].verdict = "hold"; }), /verdict is hold on the current record/);
    expectProblem(ready((r) => { r.scrutiny[0].verdict = "incomplete"; }), /verdict is incomplete/);
    expect(ready((r) => { r.scrutiny[0].record_hash = sha("older"); r.scrutiny[0].verdict = "hold"; r.scrutiny.push({ ...r.scrutiny[0], id: "R3", path: "reviews/R1.md", record_hash: "CURRENT", verdict: "pass" }); }).problems).toEqual([]);
  });

  it("rejects a review whose file is missing, only for the ready gate", () => {
    const mutate = (r: Obj): void => { r.scrutiny[0].path = "reviews/missing.md"; };
    expectProblem(ready(mutate), /review file "reviews\/missing\.md" does not exist/);
    expect(run(mutate).problems).toEqual([]);
  });

  it("fails on a blocking finding that is open or declined, even in a stale review", () => {
    for (const disposition of ["open", "declined"]) {
      expectProblem(ready((r) => {
        r.scrutiny[1].findings = [{ id: "R2-F1", severity: "blocking", summary: "Bad.", disposition }];
      }), new RegExp(`blocking finding is ${disposition}`));
      expectProblem(ready((r) => {
        r.scrutiny[0].record_hash = sha("older");
        r.scrutiny[0].findings = [{ id: "R1-F1", severity: "blocking", summary: "Bad.", disposition }];
        r.scrutiny.push({ id: "R3", path: "reviews/R1.md", reviewer: "Cody Mason", independent_of_authors: true, lenses: ["mission", "evidence"], record_hash: "CURRENT", verdict: "pass", findings: [] });
      }), new RegExp(`R1/R1-F1: blocking finding is ${disposition}`));
    }
    expect(ready((r) => { r.scrutiny[1].findings = [{ id: "R2-F1", severity: "note", summary: "Fine.", disposition: "open" }]; }).problems).toEqual([]);
  });

  it("requires decision_ref for an accepted_risk finding", () => {
    expectProblem(ready((r) => { r.scrutiny[1].findings = [{ id: "R2-F1", severity: "blocking", summary: "Bad.", disposition: "accepted_risk" }]; }), /accepted_risk finding needs decision_ref/);
  });

  it("warns, and does not fail, for more than three distinct hashes", () => {
    const result = ready((r) => {
      for (const id of ["R3", "R4", "R5"]) r.scrutiny.push({ id, path: "reviews/R1.md", reviewer: "Cody Mason", independent_of_authors: true, lenses: ["mission"], record_hash: sha(id), verdict: "pass", findings: [] });
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/4 reviews are of different record hashes/);
  });

  it("validates the shape of a review", () => {
    expectProblem(run((r) => { r.scrutiny[0].lenses = ["style"]; }), /lens "style" must be one of/);
    expectProblem(run((r) => { r.scrutiny[0].verdict = "approved"; }), /verdict must be one of/);
    expectProblem(run((r) => { r.scrutiny[0].independent_of_authors = "yes"; }), /independent_of_authors is required/);
    expectProblem(run((r) => { r.scrutiny[1].findings[0].severity = "major"; }), /severity must be one of/);
  });
});

describe("record_hash", () => {
  it("ignores scrutiny and key order but not content", () => {
    const base = baseRecord();
    const hash = recordHash(base);
    const reviewed = baseRecord();
    reviewed.scrutiny[0].verdict = "hold";
    reviewed.scrutiny.push({ id: "R9" });
    expect(recordHash(reviewed)).toBe(hash);
    const withoutScrutiny = baseRecord();
    delete withoutScrutiny.scrutiny;
    expect(recordHash(withoutScrutiny)).toBe(hash);

    const reordered: Obj = Object.fromEntries(Object.entries(baseRecord()).reverse());
    reordered.concepts[0] = Object.fromEntries(Object.entries(reordered.concepts[0]).reverse());
    expect(recordHash(reordered)).toBe(hash);

    const changed = baseRecord();
    changed.concepts[0].statement = "A different paraphrase.";
    expect(recordHash(changed)).not.toBe(hash);
  });

  it("is the hash of canonical JSON, and a stored scrutiny change does not touch it", () => {
    const fx = fixture();
    const record = baseRecord();
    write(fx, record);
    const first = checkDesignFile(fx.record, { workspace: fx.workspace }).recordHash;
    const parsed = parseYaml(readFileSync(fx.record, "utf8")) as Obj;
    parsed.scrutiny[0].verdict = "incomplete";
    writeFileSync(fx.record, stringifyYaml(parsed));
    expect(checkDesignFile(fx.record, { workspace: fx.workspace }).recordHash).toBe(first);
    expect(first).toBe(sha(JSON.stringify(sortedWithoutScrutiny(record))));
  });
});

function sortedWithoutScrutiny(record: Obj): unknown {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort((value as Obj)[key])])) : value;
  const { scrutiny: _scrutiny, ...rest } = record;
  return sort(rest);
}

describe("the matrix", () => {
  it("derives the five sections from the record", () => {
    const { matrix } = run(undefined, { matrix: true });
    expect(matrix?.shared).toEqual([{ concept: "C-001", title: "The mechanism", sources: ["S001", "S002"] }]);
    expect(matrix?.differentiated).toEqual([
      { source: "S001", title: "Operator notes", concepts: [{ concept: "C-003", title: "For later" }] },
      { source: "S003", title: "Pasted vendor plan", concepts: [{ concept: "C-002", title: "An alternative" }, { concept: "C-004", title: "A duplicate" }] }
    ]);
    expect(matrix?.choices).toEqual([{
      choice: "CH-01", question: "Which mechanism?", status: "chosen", chosen: "C-001", decidedBy: "operator",
      options: [
        { concept: "C-001", title: "The mechanism", position: "chosen", consequence: "Cheap now." },
        { concept: "C-002", title: "An alternative", position: "rejected", consequence: "Costly later." }
      ]
    }]);
    expect(matrix?.trace).toEqual([{
      requirement: "REQ-001", statement: "An observable behavior.", mission: ["M1"],
      concepts: [{ concept: "C-001", title: "The mechanism", origins: [{ source: "S001", locator: "line 1" }, { source: "S002", locator: "docs/001.md" }] }]
    }]);
    expect(matrix?.cutOrLater).toEqual([
      { concept: "C-002", title: "An alternative", position: "rejected", reason: "Costs more attention.", revival: null },
      { concept: "C-003", title: "For later", position: "parked", reason: null, revival: "When a second caller exists." }
    ]);
  });

  it("is omitted unless requested", () => {
    expect(run().matrix).toBeUndefined();
  });
});

describe("yaml", () => {
  function raw(content: string, name = "record.yaml"): DesignCheckResult {
    const fx = fixture();
    const file = path.join(fx.dir, name);
    writeFileSync(file, content);
    return checkDesignFile(file);
  }

  it("reports malformed yaml as a problem", () => {
    expectProblem(raw("schema: [unclosed\n  - nope: : :\n"), /^yaml:/);
    expectProblem(raw("a: 1\na: 2\n"), /^yaml:/);
  });

  it("reports a non-object root as a problem", () => {
    expectProblem(raw("- a\n- b\n"), /mapping at its root/);
    expectProblem(raw("just a string\n"), /mapping at its root/);
    expectProblem(raw(""), /mapping at its root/);
  });

  it("rejects any other schema value", () => {
    expectProblem(raw("schema: something-else\n"), /schema: must be arcadia-design-record-v1 or arcadia-design-field-guide-v1/);
    expectProblem(raw("design: x\n"), /found null/);
  });

  it("keeps the yaml package's alias-expansion limit on", () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 0; level < 6; level += 1) {
      const previous = String.fromCharCode(97 + level);
      const next = String.fromCharCode(98 + level);
      lines.push(`${next}: &${next} [${Array.from({ length: 10 }, () => `*${previous}`).join(", ")}]`);
    }
    expectProblem(raw(lines.join("\n") + "\n"), /^yaml:.*alias/i);
  });

  it("reports a missing or unreadable file as a problem", () => {
    const fx = fixture();
    expectProblem(checkDesignFile(path.join(fx.dir, "absent.yaml")), /^file:/);
    expectProblem(checkDesignFile(fx.dir), /not a regular file/);
  });
});

describe("field guides", () => {
  const guidePath = path.join(repoRoot, ".agents", "skills", "arcadia-design", "field-guides", "software-architecture.yaml");
  const guide = (): Obj => parseYaml(readFileSync(guidePath, "utf8")) as Obj;
  function checkGuide(mutate: (data: Obj) => void, name = "software-architecture.yaml"): DesignCheckResult {
    const fx = fixture();
    const data = guide();
    mutate(data);
    const file = path.join(fx.dir, name);
    writeFileSync(file, stringifyYaml(data));
    return checkDesignFile(file);
  }

  it("passes for the real guide", () => {
    const result = checkDesignFile(guidePath);
    expect(result.kind).toBe("field-guide");
    expect(result.problems).toEqual([]);
    expect(checkGuide(() => undefined).problems).toEqual([]);
  });

  it("requires provenance, kind, confidence and reason on every entry and framework", () => {
    expectProblem(checkGuide((g) => { delete g.entries[0].provenance; }), /entries\[E1\]: provenance is required/);
    expectProblem(checkGuide((g) => { delete g.entries[0].provenance.kind; }), /entries\[E1\]\.provenance: kind must be one of/);
    expectProblem(checkGuide((g) => { delete g.entries[0].provenance.confidence; }), /confidence must be one of/);
    expectProblem(checkGuide((g) => { g.entries[0].provenance.reason = " "; }), /reason is required/);
    expectProblem(checkGuide((g) => { delete g.frameworks[0].provenance; }), /frameworks\[F1\]: provenance is required/);
    expectProblem(checkGuide((g) => { delete g.frameworks[1].provenance.reason; }), /frameworks\[F2\]\.provenance: reason is required/);
    expectProblem(checkGuide((g) => { g.entries[0].kind = "advice"; }), /entries\[E1\]: kind must be one of/);
    expectProblem(checkGuide((g) => { g.entries[0].provenance.confidence = "certain"; }), /confidence must be one of/);
  });

  it("requires a source for imported and operator_statement entries only", () => {
    expectProblem(checkGuide((g) => { delete g.entries[1].provenance.source; }), /entries\[E2\]\.provenance: source is required for imported/);
    expectProblem(checkGuide((g) => { delete g.entries[0].provenance.source; }), /source is required for operator_statement/);
    expect(checkGuide((g) => { g.entries[8].provenance.source = undefined; }).problems).toEqual([]);
  });

  it("requires the field to match the file name", () => {
    expectProblem(checkGuide(() => undefined, "other-field.yaml"), /"software-architecture" must match the file name "other-field"/);
  });

  it("requires a validation example, an entry, scope, revision and review_date", () => {
    expectProblem(checkGuide((g) => { g.validation_examples = []; }), /at least one validation example/);
    expectProblem(checkGuide((g) => { delete g.validation_examples; }), /at least one validation example/);
    expectProblem(checkGuide((g) => { g.entries = []; }), /at least one entry/);
    expectProblem(checkGuide((g) => { g.scope.limits = ""; }), /scope\.limits: limits is required/);
    expectProblem(checkGuide((g) => { delete g.scope; }), /scope is required/);
    expectProblem(checkGuide((g) => { g.revision = 0; }), /revision is required/);
    expectProblem(checkGuide((g) => { g.review_date = "yesterday"; }), /review_date is required/);
    expectProblem(checkGuide((g) => { g.validation_examples[0].expect = " "; }), /expect is required/);
  });

  it("rejects duplicate ids and a malformed review", () => {
    expectProblem(checkGuide((g) => { g.entries[1].id = "E1"; }), /duplicate id E1/);
    expectProblem(checkGuide((g) => { g.frameworks[0].id = "E1"; }), /duplicate id E1/);
    expectProblem(checkGuide((g) => { g.review = { date: "2026-12-01" }; }), /review\.by: by is required/);
    expect(checkGuide((g) => { g.review = { date: "2026-12-01", by: "Mark", ref: "PR 1" }; }).problems).toEqual([]);
  });

  it("notes that --ready and --matrix do not apply to a guide", () => {
    const result = checkDesignFile(guidePath, { ready: true, matrix: true });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});

describe("repository discovery", () => {
  it("checks every committed record under docs/design and every field guide", () => {
    const files: string[] = [];
    const designRoot = path.join(repoRoot, "docs", "design");
    try {
      for (const slug of readdirSync(designRoot)) {
        const record = path.join(designRoot, slug, "record.yaml");
        if (statSync(designRoot).isDirectory() && safeIsFile(record)) files.push(record);
      }
    } catch {
      // No design directory yet.
    }
    const guides = path.join(repoRoot, ".agents", "skills", "arcadia-design", "field-guides");
    for (const name of readdirSync(guides)) if (/\.ya?ml$/.test(name)) files.push(path.join(guides, name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(checkDesignFile(file, { workspace: null }).problems, file).toEqual([]);
  });
});

function safeIsFile(file: string): boolean {
  try { return statSync(file).isFile(); } catch { return false; }
}

describe("arcadia design check (CLI)", () => {
  function cli(args: string[], fx: Fixture) {
    return runCli(["design", "check", ...args], {}, { configPath: createTempConfigPath(), cwd: fx.root });
  }

  it("passes a valid record and prints its hash", () => {
    const fx = fixture();
    write(fx, baseRecord());
    const result = cli([fx.record, "--ready", "--workspace", fx.workspace], fx);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Design record is valid and ready");
    expect(result.stdout).toContain(`record_hash: ${recordHash(baseRecord())}`);
    const json = parseJson(cli([fx.record, "--ready", "--json", "--workspace", fx.workspace], fx).stdout);
    expect(json).toMatchObject({ ok: true, command: "design.check", data: { kind: "record", ready: true, problems: [], warnings: [] } });
    expect(json.data.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.matrix).toBeUndefined();
  });

  it("fails --ready with every problem visible in human and JSON output", () => {
    const fx = fixture();
    const record = baseRecord();
    record.frame.status = "proposed";
    record.riskiest_assumption.status = "untested";
    write(fx, record);
    const human = cli([fx.record, "--ready", "--workspace", fx.workspace], fx);
    expect(human.status).toBe(1);
    expect(human.stderr).toContain("Error [VALIDATION_ERROR]");
    expect(human.stderr).toContain("frame.status must be confirmed");
    expect(human.stderr).toContain("riskiest_assumption");
    expect(human.stderr).toContain("record_hash:");
    // Host runtimes may print their own noise to stderr before the JSON envelope.
    const failure = cli([fx.record, "--ready", "--json", "--workspace", fx.workspace], fx).stderr;
    const json = parseJson(failure.slice(failure.indexOf("{")));
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.problems.length).toBeGreaterThanOrEqual(2);
    expect(json.error.details.recordHash).toMatch(/^[0-9a-f]{64}$/);
    // The same record passes the structural check.
    expect(cli([fx.record, "--workspace", fx.workspace], fx).status).toBe(0);
  });

  it("prints the matrix in human and JSON output", () => {
    const fx = fixture();
    write(fx, baseRecord());
    const human = cli([fx.record, "--matrix", "--workspace", fx.workspace], fx);
    expect(human.status, human.stderr).toBe(0);
    for (const heading of ["Shared", "Differentiated", "Choices:", "Trace", "Cut or later:"]) expect(human.stdout).toContain(heading);
    expect(human.stdout).toContain("C-001 The mechanism [S001, S002]");
    const json = parseJson(cli([fx.record, "--matrix", "--json", "--workspace", fx.workspace], fx).stdout);
    expect(Object.keys(json.data.matrix)).toEqual(["shared", "differentiated", "choices", "trace", "cutOrLater"]);
  });

  it("warns, and still passes, when --workspace names a directory that does not exist", () => {
    const fx = fixture();
    write(fx, baseRecord());
    const result = cli([fx.record, "--ready", "--json", "--workspace", path.join(fx.root, "no-such-workspace")], fx);
    expect(result.status, result.stderr).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.problems).toEqual([]);
    expect(json.data.warnings.join("\n")).toMatch(/S003.*not verified/);
  });

  it("validates a field guide and warns when no workspace is reachable for a workspace source", () => {
    const fx = fixture();
    const guide = path.join(repoRoot, ".agents", "skills", "arcadia-design", "field-guides", "software-architecture.yaml");
    const result = cli([guide], fx);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Field guide is valid");
    write(fx, baseRecord());
    const unverified = parseJson(cli([fx.record, "--json"], fx).stdout);
    expect(unverified.data.problems).toEqual([]);
    expect(unverified.data.warnings.join("\n")).toMatch(/not verified/);
  });
});
