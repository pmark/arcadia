import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_TIME_PING_CAUSES, signalPingDecision } from "../src/ping/signalPingPolicy.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string): Buffer => readFileSync(path.join(root, relative));
const BAN = /never press START/i;

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const relative = path.join(dir, name);
    return statSync(path.join(root, relative)).isDirectory() ? files(relative) : [relative];
  });
}

describe("grant-based press authority in skills and start prompts", () => {
  it("states that Signal and release-manager read press authority from grant-status, with identical skill copies", () => {
    for (const skill of ["arcadia-signal", "arcadia-release-manager"]) {
      const agents = read(`.agents/skills/${skill}/SKILL.md`);
      expect(agents.toString("utf8")).toContain("arcadia start-run grant-status");
      expect(agents.toString("utf8")).toMatch(/from no chat\s+message/);
      expect(read(`.claude/skills/${skill}/SKILL.md`).equals(agents)).toBe(true);
    }
  });

  it("ships Rowan and Signal start prompts that read grant-status and carry no blanket ban", () => {
    for (const template of ["rowan", "signal"]) {
      const text = read(`docs/agent-guidance/start-prompts/${template}.md`).toString("utf8");
      expect(text).toContain("arcadia start-run grant-status --json");
      expect(text).not.toMatch(BAN);
    }
  });

  it("fails when any skill or start prompt says never press START", () => {
    const scanned = [...files(".agents/skills"), ...files("docs/agent-guidance/start-prompts")].filter((file) => file.endsWith(".md"));
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.filter((file) => BAN.test(read(file).toString("utf8")))).toEqual([]);
    expect(BAN.test("Rowan: never press START.")).toBe(true);
  });
});

describe("Signal real-time ping causes", () => {
  it("lists exactly the seven causes in the Signal skill", () => {
    const skill = read(".agents/skills/arcadia-signal/SKILL.md").toString("utf8").replace(/\s+/g, " ");
    expect(REAL_TIME_PING_CAUSES).toHaveLength(7);
    expect(skill).toContain("a Decision to answer, a Plan to choose, a merge that carries a Decision or changes authority, a spend or credential step, a second failed batch on one cause, a refused press, and an ended grant");
    expect(skill).toContain("Every other event, including a card ready, a batch complete and a successor pressed, is recorded for the morning (16:00Z) and evening (04:00Z) digest");
  });

  it("sends 0 pings for events card ready, batch complete and successor pressed under an open grant, and 1 for a refused press", () => {
    const sent = (events: Parameters<typeof signalPingDecision>[0][]): number => events.filter((event) => signalPingDecision(event).ping).length;
    expect(sent(["events-card-ready", "batch-complete", "successor-pressed"])).toBe(0);
    expect(sent(["refused-press"])).toBe(1);
    expect(signalPingDecision("refused-press").cause).toBe("refused-press");
  });

  it("pings for every listed cause and for no digest event", () => {
    for (const cause of REAL_TIME_PING_CAUSES) expect(signalPingDecision(cause).ping).toBe(true);
    for (const event of ["pr-opened", "ci-update", "progress"] as const) expect(signalPingDecision(event).ping).toBe(false);
  });
});
