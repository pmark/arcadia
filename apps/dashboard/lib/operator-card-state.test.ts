import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardStepId, classifyCard, formatCardTime, type CardEvidence } from "./operator-card-state";
import { readCardStates } from "./operator-card-state-server";
import { buildFeed, feedSections, liveItems } from "./workspace-feed";
import type { NextStepsResponse } from "./next-steps-server";

const NOW = new Date("2026-11-22T20:00:00Z");
const A = "start-run-standing-plan-e-press-successor-prove-20261117a";
const B = "start-run-standing-plan-e-press-successor-prove-20261117b";
// Recorded evidence, copied from the live library (artifacts/generated/operator-scripts).
const heldA = [
  { id: A, event: "held", at: "2026-11-17T18:51:38.836Z", by: "pmark", reason: "Voided: main moved to ec546c5c0; replaced by ...20261117b" },
  { id: A, event: "unheld", at: "2026-11-20T04:42:58.337Z", by: "pmark", reason: "Expired void card (replaced by ...20261117b); clearing the stale hold" }
];
const consumedB = { state: "CONSUMED", at: "2026-11-17T19:00:12.701Z", requestId: B, runId: "20261117T185944Z-76627" };
const ev = (over: Partial<CardEvidence>): CardEvidence => ({ id: "c", consumed: null, heldHistory: [], expiresAt: null, ...over });

describe("classifyCard", () => {
  it("classifies the recorded voided card (…20261117a), even after its hold was cleared", () => {
    expect(classifyCard(ev({ id: A, heldHistory: heldA, expiresAt: "2026-11-18T17:41:56Z" }), NOW)).toMatchObject({ state: "voided", at: "2026-11-17T18:51:38.836Z" });
  });
  it("classifies the recorded pressed card (…20261117b)", () => {
    expect(classifyCard(ev({ id: B, consumed: consumedB, expiresAt: "2026-11-18T17:41:56Z" }), NOW)).toMatchObject({ state: "pressed", at: consumedB.at });
  });
  it("classifies superseded, expired and actionable", () => {
    expect(classifyCard(ev({ heldHistory: [{ event: "held", at: "2026-11-18T01:00:00Z", reason: "Superseded by the next batch card" }] }), NOW).state).toBe("superseded");
    expect(classifyCard(ev({ expiresAt: "2026-11-21T00:00:00Z" }), NOW)).toMatchObject({ state: "expired", at: "2026-11-21T00:00:00.000Z" });
    expect(classifyCard(ev({ expiresAt: "2026-11-23T00:00:00Z" }), NOW).state).toBe("actionable");
    expect(classifyCard(ev({}), NOW).state).toBe("actionable");
  });
  it("a pressed card stays pressed after its expiry, and an ordinary hold alone is not an end state", () => {
    expect(classifyCard(ev({ consumed: consumedB, expiresAt: "2026-11-01T00:00:00Z" }), NOW).state).toBe("pressed");
    expect(classifyCard(ev({ heldHistory: [{ event: "held", reason: "Waiting for the review" }] }), NOW).state).toBe("actionable");
  });
  it("formats the end time in the given zone", () => {
    expect(formatCardTime("2026-11-17T19:00:12.701Z", "America/Los_Angeles")).toBe("Nov 17, 11:00 AM PST");
    expect(formatCardTime(null)).toBe("");
  });
});

describe("the feed with ended cards", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });

  const runStep = (id: string) => ({ id: cardStepId(id), order: 0, kind: "run", title: `Run ${id}`, click: "Run", href: `#card-script-${id}`, unblocks: "", waitingFor: null }) as NextStepsResponse["steps"][number];
  const hash = async (d: string) => {
    const h = createHash("sha256");
    for (const name of (await readdir(d)).sort()) h.update(name).update("\0").update(await readFile(path.join(d, name)));
    return h.digest("hex");
  };

  it("drops ~twenty consumed run items from Your move, keeps the actionable ones, lists the rest under history, and never touches the library", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "arcadia-card-library-"));
    const write = (name: string, body: unknown) => writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body) + "\n");
    for (const id of [A, B]) await write(`${id}.json`, { schema: "arcadia-operator-script-v1", id, title: `START ${id}`, expires_at: "2026-11-18T17:41:56Z" });
    await write(`${A}.held-history.jsonl`, heldA.map(e => JSON.stringify(e)).join("\n") + "\n");
    await write(`${B}.consumed.json`, consumedB);
    const pressed = Array.from({ length: 16 }, (_, i) => `start-run-old-${i}`);
    for (const id of pressed) { await write(`${id}.json`, { id, title: `Old START ${i(id)}` }); await write(`${id}.consumed.json`, { ...consumedB, requestId: id }); }
    const expired = ["start-run-expired-1", "start-run-expired-2"];
    for (const id of expired) await write(`${id}.json`, { id, title: `Expired ${id}`, expires_at: "2026-11-19T00:00:00Z" });
    const live = ["start-run-live-1", "approve-live-2"];
    for (const id of live) await write(`${id}.json`, { id, title: `Live ${id}`, expires_at: "2026-12-31T00:00:00Z" });
    function i(id: string) { return id.split("-").pop(); }

    const before = await hash(dir);
    const states = await readCardStates(dir, NOW);
    const all = [A, B, ...pressed, ...expired, ...live];
    const steps = all.map(runStep);
    const items = buildFeed({ approvals: null, pullRequests: null, nextSteps: { nowStep: null, steps } as unknown as NextStepsResponse, endedCards: states });
    const sections = feedSections(items);
    expect(all.length).toBe(22);
    expect(sections.map(s => [s.section, s.items.length])).toEqual([["Your move", 2]]);
    expect(sections[0].items.map(x => x.title)).toEqual(["Run start-run-live-1", "Run approve-live-2"]);
    const history = feedSections(items, true).find(s => s.section === "History")!.items;
    expect(history).toHaveLength(20);
    expect(history.find(h => h.key === `history:${A}`)).toMatchObject({ chip: "Voided" });
    expect(history.find(h => h.key === `history:${B}`)).toMatchObject({ chip: "Pressed" });
    expect(history.filter(h => h.chip === "Expired")).toHaveLength(2);
    // Newest end first; nothing in the library was written, renamed or deleted.
    expect(history[0].chip).toBe("Expired");
    expect(await hash(dir)).toBe(before);
  });

  it("a superseded card is reinstated by a later unhold, a voided one is not; an ended nowStep does not promote the next step", () => {
    const held = { event: "held", at: "2026-11-18T01:00:00Z", reason: "Superseded by the next batch card" };
    expect(classifyCard(ev({ heldHistory: [held, { event: "unheld", at: "2026-11-18T02:00:00Z" }] }), NOW).state).toBe("actionable");
    expect(classifyCard(ev({ heldHistory: [{ ...held, reason: "Voided: main moved" }, { event: "unheld", at: "2026-11-18T02:00:00Z" }] }), NOW).state).toBe("voided");
    const now = runStep(A);
    const items = buildFeed({ approvals: null, pullRequests: null, nextSteps: { nowStep: now, steps: [now, runStep("x")] } as unknown as NextStepsResponse, endedCards: [{ id: A, title: "A", state: "voided", at: null }] });
    expect(items.find(i => i.key === "action:card-script-x")).toMatchObject({ chip: "run", urgent: false });
  });

  it("History alone never counts as live work", () => {
    const items = buildFeed({ approvals: null, pullRequests: null, nextSteps: { nowStep: null, steps: [runStep(A)] } as unknown as NextStepsResponse, endedCards: [{ id: A, title: "A", state: "voided", at: null }] });
    expect(items).toHaveLength(1);
    expect(liveItems(items)).toEqual([]);
  });

  it("hides nothing when the ended-card read is absent", () => {
    const items = buildFeed({ approvals: null, pullRequests: null, nextSteps: { nowStep: null, steps: [runStep("x")] } as unknown as NextStepsResponse });
    expect(items.map(x => x.section)).toEqual(["Your move"]);
  });
});
