import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderTriggersSuccess, runTriggersCommand } from "../src/commands/triggers.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-triggers-"));
  roots.push(root);
  mkdirSync(path.join(root, "docs/plans"), { recursive: true });
  mkdirSync(path.join(root, "docs/decisions"), { recursive: true });
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return root;
}

function registry(root: string, triggers: unknown[], schema = "arcadia.triggers.v0"): void {
  writeFileSync(path.join(root, ".arcadia/triggers.json"), JSON.stringify({ schema, triggers }, null, 2), "utf8");
}

function byId(root: string, id: string) {
  const found = runTriggersCommand({ repo: root }).data.triggers.find((trigger) => trigger.id === id);
  if (!found) throw new Error(`No trigger ${id}. Found: ${runTriggersCommand({ repo: root }).data.triggers.map((t) => t.id).join(", ")}`);
  return found;
}

describe("arcadia triggers", () => {
  it("fires a count condition once the repository actually meets it", () => {
    const root = repo();
    writeFileSync(path.join(root, "sites.json"), JSON.stringify({
      sites: [{ status: "live" }, { status: "live" }, { status: "review" }]
    }), "utf8");
    registry(root, [{
      id: "two-live-clients",
      watches: "Live client sites",
      condition: { kind: "count", file: "sites.json", collection: "sites", where: { status: "live" }, atLeast: 2 },
      fires: { plan: "split-hosting" }
    }]);

    const fired = byId(root, "two-live-clients");
    expect(fired.state).toBe("fired");
    expect(fired.reason).toBe("2 of 3 match; 2 needed.");
    expect(fired.fires).toBe("plan split-hosting");

    // One short of the threshold is a real answer, not an absent one.
    writeFileSync(path.join(root, "sites.json"), JSON.stringify({ sites: [{ status: "live" }, { status: "review" }] }), "utf8");
    expect(byId(root, "two-live-clients")).toMatchObject({ state: "waiting", reason: "1 of 2 match; 2 needed." });
  });

  it("fires an observed condition only when a person has recorded the observation", () => {
    const root = repo();
    registry(root, [{ id: "client-asked", condition: { kind: "observed", observed: false, lookFor: "A client asks." } }]);
    expect(byId(root, "client-asked").state).toBe("waiting");

    registry(root, [{ id: "client-asked", condition: { kind: "observed", observed: true, lookFor: "A client asks." } }]);
    expect(byId(root, "client-asked")).toMatchObject({ state: "fired", reason: "The registry records this as observed." });
  });

  // "No deferral silently ignored" is the criterion. A registry Arcadia cannot
  // read must therefore be reported, never skipped.
  it("reports an unreadable or unsupported registry instead of ignoring it", () => {
    const malformed = repo();
    writeFileSync(path.join(malformed, ".arcadia/triggers.json"), "{ not json", "utf8");
    expect(runTriggersCommand({ repo: malformed }).data.triggers[0]).toMatchObject({ state: "unevaluable" });

    const futureSchema = repo();
    registry(futureSchema, [{ id: "anything" }], "arcadia.triggers.v99");
    expect(runTriggersCommand({ repo: futureSchema }).data.triggers[0]?.reason).toContain("arcadia.triggers.v99");

    const unknownKind = repo();
    registry(unknownKind, [{ id: "weather", condition: { kind: "barometric" } }]);
    expect(byId(unknownKind, "weather")).toMatchObject({ state: "unevaluable" });

    const missingFile = repo();
    registry(missingFile, [{ id: "counts-nothing", condition: { kind: "count", file: "absent.json", atLeast: 1 } }]);
    expect(byId(missingFile, "counts-nothing").reason).toContain("does not exist");
  });

  it("refuses to count a file outside the repository it governs", () => {
    const root = repo();
    registry(root, [{ id: "escapes", condition: { kind: "count", file: "../../../etc/hosts", atLeast: 1 } }]);
    const escaped = byId(root, "escapes");
    expect(escaped.state).toBe("unevaluable");
    expect(escaped.reason).toContain("outside this repository");
  });

  it("finds a prose deferral in every spelling the documents actually use", () => {
    const root = repo();
    writeFileSync(path.join(root, "docs/plans/a-plan.md"), [
      "---", "type: plan", "---", "",
      "Deferred for now. **Trigger:** a second machine needs the artifact.",
      "",
      "*Trigger: the first reconcile run that leaves three questions.*",
      "",
      "Narrative summarization revives when a second repository is onboarded.",
      "",
      "| Increment | Reactivate when |",
      "| --- | --- |",
      "| Capability registry | A command ships with an unfamiliar name. |",
      ""
    ].join("\n"), "utf8");

    const found = runTriggersCommand({ repo: root }).data.triggers;
    expect(found).toHaveLength(4);
    expect(found.every((trigger) => trigger.state === "unevaluable")).toBe(true);
    // A clause mid-sentence, one starting its line, a prose phrasing, and a
    // table row — every one of these was silently dropped by an earlier reader.
    expect(found[0]?.condition).toBe("a second machine needs the artifact.");
    expect(found[1]?.condition).toBe("the first reconcile run that leaves three questions.");
    expect(found[2]?.condition).toContain("revives when a second repository is onboarded");
    expect(found[3]).toMatchObject({
      watches: "Capability registry",
      condition: "A command ships with an unfamiliar name."
    });
  });

  it("does not mistake prose about triggers for a deferral", () => {
    const root = repo();
    writeFileSync(path.join(root, "docs/decisions/0001-about.md"), [
      "---", "type: decision", "status: approved", "---", "",
      "Every `**Trigger:**` clause is prose no command reads.", ""
    ].join("\n"), "utf8");
    expect(runTriggersCommand({ repo: root }).data.triggers).toEqual([]);
  });

  it("names a deferred document that declares no reviving condition at all", () => {
    const root = repo();
    writeFileSync(path.join(root, "docs/decisions/0002-silent.md"),
      ["---", "type: decision", "status: deferred", "---", "", "Parked.", ""].join("\n"), "utf8");
    const silent = byId(root, "docs/decisions/0002-silent.md");
    expect(silent.state).toBe("untriggered");
    expect(silent.reason).toContain("rejection");

    // A deferred document that does name one is not reported as untriggered.
    writeFileSync(path.join(root, "docs/decisions/0002-silent.md"),
      ["---", "type: decision", "status: deferred", "---", "", "**Trigger:** a second adopter appears.", ""].join("\n"), "utf8");
    expect(runTriggersCommand({ repo: root }).data.counts.untriggered).toBe(0);
  });

  // Frontmatter restates the answer, so scanning it reports the same deferral
  // twice — once as a paragraph-long `answer:` and again where it is declared.
  it("reads the document body rather than its restated frontmatter", () => {
    const root = repo();
    writeFileSync(path.join(root, "docs/decisions/0003-restated.md"), [
      "---", "type: decision", "status: approved",
      "answer: Deferred. Reactivate when a second adopter appears.", "---", "",
      "**Trigger:** a second adopter appears.", ""
    ].join("\n"), "utf8");
    expect(runTriggersCommand({ repo: root }).data.triggers).toHaveLength(1);
  });

  it("is a noun: it needs no workspace or database and writes nothing", () => {
    const root = repo();
    writeFileSync(path.join(root, "docs/plans/p.md"), "**Trigger:** something happens.\n", "utf8");
    registry(root, [{ id: "observed-one", condition: { kind: "observed", observed: true } }]);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "triggers@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Triggers Test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

    const response = runTriggersCommand({ repo: root });
    expect(response.ok).toBe(true);
    expect(response.workspace).toBeUndefined();
    expect(response.artifacts).toEqual([]);
    // Nothing written: not the registry, not the documents, not a cache.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
  });

  it("reports an empty repository plainly rather than inventing deferrals", () => {
    const root = repo();
    const response = runTriggersCommand({ repo: root });
    expect(response.data.triggers).toEqual([]);
    expect(response.data.registry).toBeNull();
    expect(renderTriggersSuccess(response).join("\n")).toContain("No deferrals declared");
  });

  it("puts fired triggers first and says a fired trigger outranks the current Action", () => {
    const root = repo();
    registry(root, [
      { id: "waiting-one", condition: { kind: "observed", observed: false } },
      { id: "fired-one", condition: { kind: "observed", observed: true } }
    ]);
    const rendered = renderTriggersSuccess(runTriggersCommand({ repo: root })).join("\n");
    expect(rendered.indexOf("FIRED")).toBeLessThan(rendered.indexOf("WAITING"));
    expect(rendered).toContain("outranks the current Action");
  });
});
