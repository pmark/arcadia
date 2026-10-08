import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PEER_WATCH_TRAILERS } from "../src/agentWatch/contract.js";
import { guidanceEntries } from "../src/projects/agentGuidance.js";

const root = path.resolve(import.meta.dirname, "..");
const guidancePath = "docs/agent-guidance/standard-harness.md";
const heading = "## Session protocol (by convention today)";

function sessionProtocol(): string {
  const text = readFileSync(path.join(root, guidancePath), "utf8");
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `${guidancePath} must contain "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\n## ", heading.length);
  return (next < 0 ? rest : rest.slice(0, next)).trimEnd();
}

describe("standard harness guidance", () => {
  it("is indexed exactly once", () => {
    const entries = guidanceEntries(readFileSync(path.join(root, "docs/agent-guidance/index.json"), "utf8"));
    expect(entries.filter((entry) => entry.path === guidancePath)).toHaveLength(1);
  });

  it("keeps the Session protocol short and linked to the peer-watch contract", () => {
    const section = sessionProtocol();
    expect(section.split("\n").length).toBeLessThanOrEqual(40);
    expect(section).toContain("docs/agent-guidance/agent-peer-watch.md");
    expect(section).toContain("src/agentWatch/contract.ts");
    expect(section).toContain("arcadia ping send");
  });

  it("names exactly the PEER_WATCH_TRAILERS keys, spelled as the contract spells them", () => {
    const section = sessionProtocol();
    const expected = Object.values(PEER_WATCH_TRAILERS).sort();
    const spelled = [...new Set(section.match(/\bArcadia-[A-Za-z]+\b/g) ?? [])].sort();
    expect(spelled).toEqual(expected);
    const anyCase = [...new Set((section.match(/\barcadia-(?:agent|action|claim|heartbeat)\b/gi) ?? []).map((name) => name))].sort();
    expect(anyCase).toEqual(expected);
  });
});
