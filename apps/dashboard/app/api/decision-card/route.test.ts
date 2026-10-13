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
  options: Array<{ label: string; consequence: string; recommended: boolean; effect?: string | null }>;
  relativePath: string;
  updated: string;
  action?: string | null;
  project?: string | null;
}
interface MockScript {
  id: string;
  kind?: string;
  title: string;
  success: { effect: string };
  repeatable: boolean;
  state: { status: string; runId?: string; finishedAt?: string };
  nextAfter?: { id: string; within_minutes: number } | null;
  lastRunReceipt?: { outcome: string; startedAt: string; finishedAt: string } | null;
}

const world = vi.hoisted(() => ({
  decisions: [] as unknown[],
  scripts: [] as unknown[],
  bytes: "descriptor-v1",
  reads: 0,
  productionReadable: true,
  flipAfterReads: Number.POSITIVE_INFINITY,
  openError: null as Error | null,
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
  loadOpenDecisions: vi.fn(async () => {
    if (world.openError) throw world.openError;
    return { data: { decisions: world.decisions } };
  }),
  approveDecision: world.approve
}));
vi.mock("../../../lib/approvals-feed", () => ({ invalidateApprovalsCache: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => {
    world.reads += 1;
    return Buffer.from(world.reads > world.flipAfterReads ? `${world.bytes}-flipped` : world.bytes);
  })
}));
vi.mock("../production-control/route", () => ({
  GET: vi.fn(async () =>
    world.productionReadable
      ? Response.json({ production: { read: { status: "ok", policy: { desiredState: "inactive" } } } })
      : Response.json({ error: "unreadable" }, { status: 500 })
  )
}));
vi.mock("../operator-script/route", () => ({
  LIBRARY_PATH: "/library",
  SAFE_ID: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  GET: vi.fn(async () => Response.json({ scripts: world.scripts })),
  POST: world.launch
}));

import { GET, POST } from "./route";
import { ArcadiaCliError } from "../../../lib/arcadia-cli";
import { optionFingerprint } from "../../../lib/decision-cards";
import { decisionOptionsDigest } from "../../../../../src/decisions/optionsDigest";
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

const prereq = (): MockScript =>
  script({
    id: "prereq-check",
    title: "Prereq check",
    repeatable: true,
    lastRunReceipt: { outcome: "succeeded", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }
  });
/** A library where rotate-logs is exactly the derived next operator action. */
const chain = (over: Partial<MockScript> = {}): MockScript[] => [prereq(), script({ nextAfter: { id: "prereq-check", within_minutes: 60 }, ...over })];

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
  const response = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Host: "localhost:3000" } }));
  return ((await response.json()) as { cards: DecisionCardView[] }).cards;
}

beforeEach(() => {
  world.decisions = [decision()];
  world.scripts = chain();
  world.bytes = "descriptor-v1";
  world.reads = 0;
  world.productionReadable = true;
  world.flipAfterReads = Number.POSITIVE_INFINITY;
  world.openError = null;
  world.approve.mockReset();
  world.launch.mockReset();
  world.approve.mockImplementation(async () => {
    world.decisions = [];
    return { data: { relativePath: "decisions/0042.md", applied: true } };
  });
  world.launch.mockImplementation(async () => {
    world.scripts = chain({ state: { status: "running" } });
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
    expect(html).toContain("Decision k.alpha.0042");
    expect(html.match(/data-card-id="decision-k.alpha.0042"/g)).toHaveLength(2);
    const [optionId, fingerprint] = Object.entries(answer!.pressable)[1];
    const response = await POST(post({ cardId: answer!.card.id, fingerprint }));
    expect(response.status).toBe(200);
    expect(world.approve).toHaveBeenCalledTimes(1);
    expect(world.approve).toHaveBeenCalledWith({
      projectSlug: "alpha",
      decisionId: "0042",
      answer: "Use 9090",
      expectStatus: "open",
      expectUpdated: "2026-10-13T10:00:00Z",
      expectOptions: expect.stringMatching(/^[0-9a-f]{64}$/),
      expectNoPointerMove: true
    });
    expect(optionId).toBe("option-2");
    // Replay of the same press: the Decision is closed, so it is refused and nothing more is written.
    const replay = await POST(post({ cardId: answer!.card.id, fingerprint }));
    expect(replay.status).toBe(404);
    expect(await replay.json()).toMatchObject({ reason: "card_not_open" });
    expect(world.approve).toHaveBeenCalledTimes(1);
  });

  it("renders a run card and starts the script only through the existing operator-script entry", async () => {
    const run = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
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
    const run = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
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
    const run = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
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
    const closed = await POST(post({ cardId: "decision-alpha.0999", fingerprint: a.pressable["option-1"] }));
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

  it("B1: a Decision with labels that match after case-folding gets no button, a visible refusal, and a refused press", async () => {
    world.decisions = [
      decision({
        options: [
          { label: "Use 8080", consequence: "Binds 8080.", recommended: true },
          { label: "use 8080 ", consequence: "Binds 8080 too.", recommended: false }
        ]
      })
    ];
    const response = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Host: "localhost:3000" } }));
    const body = (await response.json()) as { cards: DecisionCardView[]; refused: Array<{ id: string; reason: string; message: string }> };
    expect(body.cards.filter((v) => v.card.verb === "answer")).toHaveLength(0);
    expect(body.refused).toContainEqual(expect.objectContaining({ id: "decision-k.alpha.0042", reason: "duplicate_option_labels" }));
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: body.cards, refused: body.refused, pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).toContain("duplicate_option_labels");
    expect(html).not.toContain("data-card-id=\"decision-k.alpha.0042\"");
    const press = await POST(post({ cardId: "decision-k.alpha.0042", fingerprint: `v1|option=option-2|state=${"a".repeat(64)}` }));
    expect(press.status).toBe(409);
    expect(await press.json()).toMatchObject({ reason: "duplicate_option_labels" });
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("B2: the writer is called with the status and updated preconditions and its refusal is surfaced, nothing else written", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    world.approve.mockImplementation(async () => {
      throw new ArcadiaCliError("DECISION_PRECONDITION_FAILED: changed", 400, { reason: "decision_precondition_failed" });
    });
    const response = await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "decision_precondition_failed" });
    expect(world.approve).toHaveBeenCalledWith(expect.objectContaining({ expectStatus: "open", expectUpdated: "2026-10-13T10:00:00Z" }));
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("B3: a script that is not the derived next action (or is a grant) renders with an Actions link and is refused", async () => {
    const now = new Date().toISOString();
    world.scripts = [
      script({ id: "prereq-check", title: "Prereq check", repeatable: true, lastRunReceipt: { outcome: "succeeded", startedAt: now, finishedAt: now } }),
      script({ id: "dependent-step", title: "Dependent step", nextAfter: { id: "prereq-check", within_minutes: 60 } }),
      script({ id: "grant-spend", title: "Grant it", kind: "grant" })
    ];
    const list = await views();
    const byId = (id: string) => list.find((v) => v.card.id === `script-${id}`)!;
    expect(Object.keys(byId("dependent-step").pressable)).toEqual(["run"]);
    for (const id of ["prereq-check", "grant-spend"]) {
      expect(Object.keys(byId(id).pressable)).toEqual([]);
      expect(byId(id).actionsHref).toBe(`/actions?q=${id}`);
      const html = renderToStaticMarkup(createElement(DecisionCards, { views: [byId(id)], pendingId: null, outcomes: {}, onPress: () => undefined, verbs: ["run"] }));
      expect(html).toContain(`href="/actions?q=${id}"`);
      expect(html).toContain(byId(id).card.options[0].consequence);
      expect(html).not.toContain("<button");
      const press = await POST(post({ cardId: byId(id).card.id, fingerprint: optionFingerprint(byId(id).card, "run") }));
      expect(press.status).toBe(409);
      expect(await press.json()).toMatchObject({ reason: "off_path_requires_confirmation" });
    }
    expect(world.launch).not.toHaveBeenCalled();
    const ok = await POST(post({ cardId: "script-dependent-step", fingerprint: byId("dependent-step").pressable.run }));
    expect(ok.status).toBe(200);
    expect(world.launch).toHaveBeenCalledTimes(1);
  });

  it("(a) cards for the same decision id in two projects keep distinct ids; hostile slugs cannot collide", async () => {
    world.decisions = [decision(), decision({ projectSlug: "beta" }), decision({ projectSlug: "a.b", id: "c" }), decision({ projectSlug: "a", id: "b.c" })];
    const ids = (await views()).filter((v) => v.card.verb === "answer").map((v) => v.card.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("(b) a fingerprint captured before a repeatable script ran is stale after it", async () => {
    world.scripts = chain({ repeatable: true });
    const before = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
    world.scripts = chain({ repeatable: true, state: { status: "succeeded", runId: "run-1", finishedAt: "2026-10-13T11:00:00Z" } });
    const after = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
    expect(after.card.pins.previewFingerprint).not.toBe(before.card.pins.previewFingerprint);
    const stale = await POST(post({ cardId: before.card.id, fingerprint: before.pressable.run }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: "stale_state_hash" });
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("(c) the descriptor bytes are re-hashed immediately before launch and a change refuses", async () => {
    const run = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
    // The press reads once to regenerate (2 reads per script, 2 scripts); the re-check read after that sees changed bytes.
    world.reads = 0;
    world.flipAfterReads = 4;
    const response = await POST(post({ cardId: run.card.id, fingerprint: run.pressable.run }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "descriptor_changed" });
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("(d) an oversized body without a content-length is cut off while streaming", async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1000).fill(97));
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request("http://localhost:3000/api/decision-card", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost:3000" },
      body: stream,
      duplex: "half"
    } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(20);
  });

  it("(e) GET refuses cross-origin and never returns raw error text", async () => {
    const cross = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Origin: "https://evil.example", Host: "localhost:3000" } }));
    expect(cross.status).toBe(403);
    world.openError = new Error("ENOENT /Users/secret/path");
    const response = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Host: "localhost:3000" } }));
    const text = await response.text();
    expect(text).toContain("decisions_unreadable");
    expect(text).not.toContain("secret");
  });

  it("N1a: an option's effect is passed through, rendered, pinned and handed to the writer's digest", async () => {
    const plain = (await views()).find((v) => v.card.verb === "answer")!;
    const withEffect = decision({
      action: "act-1",
      project: "alpha",
      options: [
        { label: "Use 8080", consequence: "The service binds 8080 on the next restart.", recommended: true, effect: "defer" },
        { label: "Use 9090", consequence: "The service binds 9090 on the next restart.", recommended: false }
      ]
    });
    world.decisions = [withEffect];
    const deferred = (await views()).find((v) => v.card.verb === "answer")!;
    expect(deferred.card.options[0].consequence).toContain("[effect: defer]");
    expect(deferred.card.options[0].consequence).toContain("Parks alpha/act-1.");
    expect(deferred.card.options[1].consequence).not.toContain("Parks");
    expect(plain.card.options[0].consequence).not.toContain("[effect:");
    expect(deferred.card.pins.stateHash).not.toBe(plain.card.pins.stateHash);
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: [deferred], pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).toContain("[effect: defer]");
    const press = await POST(post({ cardId: deferred.card.id, fingerprint: deferred.pressable["option-1"] }));
    expect(press.status).toBe(200);
    expect(world.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        expectOptions: decisionOptionsDigest(withEffect.question, [
          { label: "Use 8080", consequence: "The service binds 8080 on the next restart.", effect: "defer" },
          { label: "Use 9090", consequence: "The service binds 9090 on the next restart.", effect: null }
        ], { action: "act-1", project: "alpha" })
      })
    );
  });

  it("N1a: an unknown effect is a visible refusal, not a card", async () => {
    world.decisions = [
      decision({ options: [{ label: "Use 8080", consequence: "Binds 8080.", recommended: true, effect: "explode" }] })
    ];
    const response = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Host: "localhost:3000" } }));
    const body = (await response.json()) as { cards: DecisionCardView[]; refused: Array<{ id: string; reason: string; message: string }> };
    expect(body.cards.filter((v) => v.card.verb === "answer")).toHaveLength(0);
    expect(body.refused).toContainEqual(expect.objectContaining({ id: "decision-k.alpha.0042", reason: "bad_source" }));
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: body.cards, refused: body.refused, pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).toContain("not a known Decision option effect");
  });

  it("N1b: the route passes the options digest computed by the shared function", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    expect(world.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        expectOptions: decisionOptionsDigest("Which port should the service use?", [
          { label: "Use 8080", consequence: "The service binds 8080 on the next restart." },
          { label: "Use 9090", consequence: "The service binds 9090 on the next restart." }
        ])
      })
    );
  });

  it("N2: with no next action, or an unknown one, no script card is pressable and a press is refused", async () => {
    world.scripts = [script({ id: "lonely", title: "Lonely" })];
    const none = (await views()).find((v) => v.card.id === "script-lonely")!;
    expect(Object.keys(none.pressable)).toEqual([]);
    expect(none.actionsHref).toBe("/actions?q=lonely");
    const refusedNone = await POST(post({ cardId: none.card.id, fingerprint: optionFingerprint(none.card, "run") }));
    expect(refusedNone.status).toBe(409);
    expect(await refusedNone.json()).toMatchObject({ reason: "off_path_requires_confirmation" });

    // A rule that needs production Off, with production unreadable, makes the next action unknown.
    const now = new Date().toISOString();
    world.scripts = [
      script({ id: "needs-off", title: "Needs off", nextAfter: { id: "pre", within_minutes: 60, when_production: "inactive" } as never }),
      script({ id: "pre", title: "Pre", repeatable: true, lastRunReceipt: { outcome: "succeeded", startedAt: now, finishedAt: now } })
    ];
    world.productionReadable = false;
    const unknown = (await views()).find((v) => v.card.id === "script-needs-off")!;
    expect(Object.keys(unknown.pressable)).toEqual([]);
    const refusedUnknown = await POST(post({ cardId: unknown.card.id, fingerprint: optionFingerprint(unknown.card, "run") }));
    expect(refusedUnknown.status).toBe(409);
    expect(await refusedUnknown.json()).toMatchObject({ reason: "next_action_unknown" });
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("B1: a defer option on a Decision with no action is refused visibly, never offered", async () => {
    world.decisions = [decision({ options: [{ label: "Park it", consequence: "Parks.", recommended: true, effect: "defer" }] })];
    const response = await GET(new Request("http://localhost:3000/api/decision-card", { headers: { Host: "localhost:3000" } }));
    const body = (await response.json()) as { cards: DecisionCardView[]; refused: Array<{ reason: string }> };
    expect(body.cards.filter((v) => v.card.verb === "answer")).toHaveLength(0);
    expect(body.refused).toContainEqual(expect.objectContaining({ reason: "defer_without_action" }));
  });

  it("B1: the action id is part of the card's pinned state and of the digest handed to the writer", async () => {
    const options = [{ label: "Park it", consequence: "Parks.", recommended: true, effect: "defer" }];
    world.decisions = [decision({ options, action: "act-a", project: "alpha" })];
    const first = (await views()).find((v) => v.card.verb === "answer")!;
    world.decisions = [decision({ options, action: "act-b", project: "alpha" })];
    const second = (await views()).find((v) => v.card.verb === "answer")!;
    expect(second.card.options[0].consequence).toContain("Parks alpha/act-b.");
    expect(second.card.pins.stateHash).not.toBe(first.card.pins.stateHash);
    const stale = await POST(post({ cardId: first.card.id, fingerprint: first.pressable["option-1"] }));
    expect(stale.status).toBe(409);
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("a defer option whose target is the current Action is refused by the writer with defer_would_move_pointer", async () => {
    world.decisions = [decision({ action: "act-1", project: "alpha", options: [{ label: "Park it", consequence: "Parks.", recommended: true, effect: "defer" }] })];
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    expect(answer.card.options[0].consequence).toContain("Refused if this is the current Action; answer that case from the CLI.");
    world.approve.mockImplementation(async () => {
      throw new ArcadiaCliError("DECISION_PRECONDITION_FAILED: /Users/pmark/x", 400, { reason: "defer_would_move_pointer" });
    });
    const response = await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain("defer_would_move_pointer");
    expect(text).not.toContain("/Users/pmark");
    expect(world.approve).toHaveBeenCalledWith(expect.objectContaining({ expectNoPointerMove: true }));
  });

  it("N3: a grant that IS the derived next action has no button and its press is refused", async () => {
    world.scripts = [prereq(), script({ id: "grant-next", title: "Grant next", kind: "grant", nextAfter: { id: "prereq-check", within_minutes: 60 } })];
    const grant = (await views()).find((v) => v.card.id === "script-grant-next")!;
    expect(Object.keys(grant.pressable)).toEqual([]);
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: [grant], pendingId: null, outcomes: {}, onPress: () => undefined, verbs: ["run"] }));
    expect(html).not.toContain("<button");
    const press = await POST(post({ cardId: grant.card.id, fingerprint: optionFingerprint(grant.card, "run") }));
    expect(press.status).toBe(409);
    expect(world.launch).not.toHaveBeenCalled();
  });

  it("N4: writer and launcher failures return fixed reason codes, never raw messages, paths or details", async () => {
    const answer = (await views()).find((v) => v.card.verb === "answer")!;
    const secret = "/Users/pmark/Dev/MR/Arcadia/arcadia/docs/decisions/0042.md fatal: git stderr";
    world.approve.mockImplementation(async () => {
      throw new ArcadiaCliError(`VALIDATION_ERROR: ${secret}`, 400, { labels: ["Use 8080"], path: secret });
    });
    const refused = await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    const refusedText = await refused.text();
    expect(refused.status).toBe(409);
    expect(refusedText).toContain("decision_write_refused");
    expect(refusedText).not.toContain("/Users/pmark");
    expect(refusedText).not.toContain("git stderr");
    expect(refusedText).not.toContain("Use 8080\"]");

    world.approve.mockImplementation(async () => {
      throw new ArcadiaCliError(secret, 500, { commandFailed: true, exitCode: 1 });
    });
    const unparsable = await POST(post({ cardId: answer.card.id, fingerprint: answer.pressable["option-1"] }));
    const unparsableText = await unparsable.text();
    expect(unparsableText).toContain("cli_unparsable");
    expect(unparsableText).not.toContain("/Users/pmark");

    const run = (await views()).find((v) => v.card.id === "script-rotate-logs")!;
    world.launch.mockImplementation(async () => Response.json({ error: `${secret} already running` }, { status: 409 }));
    const launch = await POST(post({ cardId: run.card.id, fingerprint: run.pressable.run }));
    const launchText = await launch.text();
    expect(launchText).toContain("script_start_refused");
    expect(launchText).not.toContain("/Users/pmark");
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
      actionsHref: null,
      duplicates: null
    };
    const html = renderToStaticMarkup(createElement(DecisionCards, { views: [view], pendingId: null, outcomes: {}, onPress: () => undefined }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("javascript:");
  });
});
