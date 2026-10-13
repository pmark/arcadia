import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockDecision {
  id: string;
  slug: string;
  projectId: string;
  projectSlug: string;
  question: string;
  status: string;
  gateQuestion: string | null;
  recommendation: string | null;
  options: Array<{ label: string; consequence: string; recommended: boolean }>;
  relativePath: string;
  updated: string;
}
interface MockScript {
  id: string;
  title: string;
  success: { effect: string };
  repeatable: boolean;
  state: { status: string };
}

const world = vi.hoisted(() => ({
  decisions: [] as unknown[],
  scripts: [] as unknown[],
  bytes: "descriptor-v1",
  approve: vi.fn(),
  launch: vi.fn()
}));

vi.mock("../../../lib/arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode: number;
    details: unknown;
    constructor(message: string, statusCode: number, details: unknown = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  loadOpenDecisions: vi.fn(async () => ({ data: { decisions: world.decisions } })),
  approveDecision: world.approve
}));
vi.mock("../../../lib/approvals-feed", () => ({ invalidateApprovalsCache: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from(world.bytes)) }));
vi.mock("../operator-script/route", () => ({
  LIBRARY_PATH: "/library",
  SAFE_ID: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  GET: vi.fn(async () => Response.json({ scripts: world.scripts })),
  POST: world.launch
}));

import { GET, POST } from "./route";
import { DecisionCards } from "../../../components/decision-cards";
import type { DecisionCardView } from "../../../lib/decision-cards";

const decision = (over: Partial<MockDecision> = {}): MockDecision => ({
  id: "0042",
  slug: "pick-a-port",
  projectId: "p1",
  projectSlug: "alpha",
  question: "Which port should the service use?",
  status: "open",
  gateQuestion: null,
  recommendation: "Use 8080",
  options: [
    { label: "Use 8080", consequence: "The service binds 8080 on the next restart.", recommended: true },
    { label: "Use 9090", consequence: "The service binds 9090 on the next restart.", recommended: false }
  ],
  relativePath: "decisions/0042.md",
  updated: "2026-10-13T10:00:00Z",
  ...over
});

const script = (over: Partial<MockScript> = {}): MockScript => ({
  id: "rotate-logs",
  title: "Rotate logs",
  success: { effect: "Old logs are archived and the log directory is emptied." },
  repeatable: false,
  state: { status: "available" },
  ...over
});

function post(body: unknown, init: { origin?: string; contentType?: string; raw?: string } = {}): Request {
  return new Request("http://localhost:3000/api/decision-card", {
    method: "POST",
    headers: { "Content-Type": init.contentType ?? "application/json", Origin: init.origin ?? "http://localhost:3000", Host: "localhost:3000" },
    body: init.raw ?? JSON.stringify(body)
  });
}

async function views(): Promise<DecisionCardView[]> {
  const response = await GET();
  return ((await response.json()) as { cards: DecisionCardView[] }).cards;
}

beforeEach(() => {
  world.decisions = [decision()];
  world.scripts = [script()];
  world.bytes = "descriptor-v1";
  world.approve.mockReset();
  world.launch.mockReset();
  world.approve.mockImplementation(async () => {
    world.decisions = [];
    return { data: { relativePath: "decisions/0042.md", applied: true } };
  });
  world.launch.mockImplementation(async () => {
    world.scripts = [script({ state: { status: "running" } })];
    return Response.json({ runId: "r1", scriptId: "rotate-logs", status: "running", message: "Rotate logs started." }, { status: 202 });
  });
});

describe("decision cards end to end", () => {
  it("renders an answer card with consequence, evidence and one pinned button per option, and answers through the canonical writer", async () => {
    const list = await views();
    const answer = list.find((v) => v.card.verb === "answer");
    expect(answer).toBeDefined();
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: list, pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).toContain("The service binds 8080 on the next restart.");
    expect(html).toContain("The service binds 9090 on the next restart.");
    expect(html).toContain("Decision alpha-0042");
    expect(html.match(/data-card-id="decision-alpha-0042"/g)).toHaveLength(2);
    const [optionId, fingerprint] = Object.entries(answer!.pressable)[1];
    const response = await POST(post({ cardId: answer!.card.id, fingerprint }));
    expect(response.status).toBe(200);
    expect(world.approve).toHaveBeenCalledTimes(1);
    expect(world.approve).toHaveBeenCalledWith({ projectSlug: "alpha", decisionId: "0042", answer: "Use 9090" });
    expect(optionId).toBe("option-2");
    // Replay of the same press: the Decision is closed, so it is refused and nothing more is written.
    const replay = await POST(post({ cardId: answer!.card.id, fingerprint }));
    expect(replay.status).toBe(404);
    expect(await replay.json()).toMatchObject({ reason: "card_not_open" });
    expect(world.approve).toHaveBeenCalledTimes(1);
  });

  it("renders a run card and starts the script only through the existing operator-script entry", async () => {
    const run = (await views()).find((v) => v.card.verb === "run")!;
    expect(Object.keys(run.pressable)).toEqual(["run"]);
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: [run], pendingId: null, outcomes: {}, onPress: () => undefined, verbs: ["run"] }));
    expect(html).toContain("Old logs are archived and the log directory is emptied.");
    expect(html).toContain("Descriptor rotate-logs");
    expect(html.match(/<button/g)).toHaveLength(1);
    const response = await POST(post({ cardId: run.card.id, fingerprint: run.pressable.run }));
    expect(response.status).toBe(200);
    expect(world.launch).toHaveBeenCalledTimes(1);
    expect(await (world.launch.mock.calls[0][0] as Request).json()).toEqual({ id: "rotate-logs" });
    const replay = await POST(post({ cardId: run.card.id, fingerprint: run.pressable.run }));
    expect(replay.status).toBe(404);
    expect(world.launch).toHaveBeenCalledTimes(1);
  });

  it("refuses the Do-not-run option of a run card: no button, no execution", async () => {
    const run = (await views()).find((v) => v.card.verb === "run")!;
    const skipFingerprint = run.pressable.run.replace("option=run", "option=skip");
    const response = await POST(post({ cardId: run.card.id, fingerprint: skipFingerprint }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reason: "option_not_executable_here" });
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("refuses a stale card with its reason when the source changed between render and press", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    world.decisions = [decision({ options: [{ label: "Use 8080", consequence: "Now it also drops the cache.", recommended: true }] })];
    const response = await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "stale_state_hash" });
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("refuses a run card whose descriptor bytes changed after render", async () => {
    const run = (await views()).find((v) => v.card.verb === "run")!;
    world.bytes = "descriptor-v2";
    const response = await POST(post({ cardId: run.card.id, fingerprint: run.pressable.run }));
    expect(response.status).toBe(409);
    expect(["stale_state_hash", "stale_preview_fingerprint"]).toContain((await response.json() as { reason: string }).reason);
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("refuses another card's fingerprint and a closed card id", async () => {
    world.decisions = [decision(), decision({ id: "0043", slug: "other", question: "Pick a colour?" })];
    const list = (await views()).filter((v) => v.card.verb === "answer");
    const [a, b] = list;
    const crossed = await POST(post({ cardId: a.card.id, fingerprint: b.pressable["option-1"] }));
    expect(crossed.status).toBe(409);
    expect(await crossed.json()).toMatchObject({ reason: "stale_state_hash" });
    const closed = await POST(post({ cardId: "decision-alpha-0999", fingerprint: a.pressable["option-1"] }));
    expect(closed.status).toBe(404);
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("refuses extra keys, prototype keys, non-strings, huge ids, arrays and huge bodies", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    const fingerprint = answer.pressable["option-1"];
    const base = { cardId: answer.card.id, fingerprint };
    for (const extra of [{ option: "Use 9090" }, { verb: "run" }, { actionKey: "a/b" }, { constructor: "x" }]) {
      const response = await POST(post({ ...base, ...extra }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "unknown_key" });
    }
    const proto = await POST(post(null, { raw: `{"__proto__":{"x":1},"cardId":"${answer.card.id}","fingerprint":"${fingerprint}"}` }));
    expect(proto.status).toBe(400);
    expect((await POST(post({ cardId: 7, fingerprint }))).status).toBe(400);
    expect((await POST(post({ cardId: answer.card.id, fingerprint: { a: 1 } }))).status).toBe(400);
    expect((await POST(post({ cardId: "x".repeat(500), fingerprint }))).status).toBe(400);
    expect((await POST(post({ cardId: answer.card.id, fingerprint: "v1|option=option-1" }))).status).toBe(400);
    expect((await POST(post([base]))).status).toBe(400);
    expect((await POST(post(null, { raw: "not json" }))).status).toBe(400);
    const huge = await POST(post(null, { raw: JSON.stringify({ ...base, pad: "x".repeat(10_000) }) }));
    expect(huge.status).toBe(413);
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("refuses cross-origin and wrong content-type requests", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    const body = { cardId: answer.card.id, fingerprint: answer.pressable["option-1"] };
    expect((await POST(post(body, { origin: "https://evil.example" }))).status).toBe(403);
    const wrong = await POST(post(body, { contentType: "text/plain" }));
    expect(wrong.status).toBe(415);
    expect(await wrong.json()).toMatchObject({ reason: "bad_content_type" });
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("refuses a concurrent second press of the same card without a second write", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    let release: () => void = () => undefined;
    world.approve.mockImplementation(
      () => new Promise((resolve) => { release = () => { world.decisions = []; resolve({ data: { relativePath: "x", applied: true } }); }; })
    );
    const body = { cardId: answer.card.id, fingerprint: answer.pressable["option-1"] };
    const first = POST(post(body));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await POST(post(body));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ reason: "already_in_progress" });
    release();
    expect((await first).status).toBe(200);
    expect(world.approve).toHaveBeenCalledTimes(1);
  });

  it("renders hostile card text as text, and a non-web evidence url as inert text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const view: DecisionCardView = {
      card: {
        schema: "arcadia-decision-card-v1",
        id: "decision-x",
        kind: "decision",
        what: hostile,
        options: [{ id: "option-1", label: hostile, consequence: hostile }],
        evidence: [{ label: hostile, url: "javascript:alert(1)" }],
        verb: "answer",
        pins: { stateHash: "a".repeat(64) },
        expires: "2030-01-01T00:00:00Z",
        policy_match: null,
        receipt: null
      },
      pressable: {},
      notExecutableReason: "none",
      duplicates: null
    };
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: [view], pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("javascript:");
  });
});
