import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  decisions: [] as unknown[],
  openError: null as Error | null,
  projects: [] as Array<string | undefined>,
  approve: vi.fn(),
  repoPath: null as string | null
}));

vi.mock("../../../../lib/arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode = 500;
    details: unknown = null;
  },
  loadOpenDecisions: vi.fn(async (project?: string) => {
    world.projects.push(project);
    if (world.openError) throw world.openError;
    return { data: { decisions: world.decisions } };
  }),
  approveDecision: world.approve
}));
vi.mock("../../../../lib/approvals-feed", () => ({ invalidateApprovalsCache: vi.fn() }));
vi.mock("../../operator-script/route", () => ({
  LIBRARY_PATH: "/library",
  SAFE_ID: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  GET: vi.fn(async () => Response.json({ scripts: [] })),
  POST: vi.fn()
}));
vi.mock("../../production-control/route", () => ({ GET: vi.fn(async () => Response.json({})) }));
vi.mock("../../../../../../src/cli/workspace", () => ({ resolveReadyWorkspace: () => ({ workspacePath: "/workspace", databasePath: "/workspace/db" }) }));
vi.mock("../../../../../../src/db/connection", () => ({ withReadOnlyDatabase: (_workspace: string, callback: (db: unknown) => unknown) => callback({}) }));
vi.mock("../../../../../../src/db/repositories", () => ({ getProjectMetadata: () => ({ repo_path: world.repoPath }) }));

import { GET } from "./route";
import { GET as readRecord } from "./record/route";
import { GET as readAllCards, POST as press } from "../../decision-card/route";
import type { DecisionCardView } from "../../../../lib/decision-cards";
import { splitDecisionRecord } from "../../../../lib/decision-record-server";

const decision = (over: Record<string, unknown> = {}) => ({
  id: "0042",
  slug: "pick-a-port",
  projectId: "p1",
  projectSlug: "alpha",
  question: "Which port should the service use?",
  status: "open",
  gateQuestion: "approval_boundary",
  recommendation: "Use 8080",
  options: [
    { label: "Use 8080", consequence: "The service binds 8080 on the next restart.", recommended: true },
    { label: "Use 9090", consequence: "The service binds 9090 on the next restart.", recommended: false }
  ],
  relativePath: "docs/decisions/0042.md",
  updated: "2026-10-13",
  ...over
});

const headers = { Host: "localhost:3000" };
const read = async (project = "alpha", id = "0042") => {
  const response = await GET(new Request(`http://localhost:3000/api/todo-item/decision?project=${project}&id=${id}`, { headers }));
  return { status: response.status, body: (await response.json()) as { cards: DecisionCardView[]; refused: Array<{ id: string; reason: string }>; decision: { id: string; question: string; recommendedLabels: string[] } | null } };
};
const post = (cardId: string, fingerprint: string) =>
  press(new Request("http://localhost:3000/api/decision-card", { method: "POST", headers: { ...headers, Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ cardId, fingerprint }) }));

beforeEach(() => {
  world.decisions = [decision()];
  world.openError = null;
  world.projects = [];
  world.repoPath = null;
  world.approve.mockReset();
  world.approve.mockImplementation(async () => ({ data: { applied: true } }));
});

describe("GET /api/todo-item/decision", () => {
  it("returns one Decision's card and its record's fields, read for that Project only", async () => {
    world.decisions = [decision(), decision({ id: "0043", slug: "another" })];
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(world.projects).toEqual(["alpha"]);
    expect(body.cards.map((view) => view.card.id)).toEqual(["decision-k.alpha.0042"]);
    expect(body.decision).toMatchObject({ id: "0042", question: "Which port should the service use?", recommendedLabels: ["Use 8080"] });
  });

  it("finds a Decision by its slug too", async () => {
    expect((await read("alpha", "pick-a-port")).body.cards[0].card.id).toBe("decision-k.alpha.0042");
  });

  it("says when no open Decision matches", async () => {
    const { status, body } = await read("alpha", "9999");
    expect(status).toBe(200);
    expect(body).toEqual({ cards: [], refused: [], decision: null });
  });

  it("is not a way around a refusal: no card for a Decision that has no options, or two options sharing a label", async () => {
    world.decisions = [decision({ options: [] })];
    let { body } = await read();
    expect(body.cards).toEqual([]);
    expect(body.refused.map((entry) => entry.reason)).toEqual(["no_options"]);
    world.decisions = [decision({ options: [{ label: "Go", consequence: "A", recommended: true }, { label: " go ", consequence: "B", recommended: false }] })];
    ({ body } = await read());
    expect(body.cards).toEqual([]);
    expect(body.refused.map((entry) => entry.reason)).toEqual(["duplicate_option_labels"]);
  });

  it("offers no card when two open Decisions share one id, matching the full list", async () => {
    world.decisions = [decision({ question: "One?" }), decision({ question: "Another?", relativePath: "docs/decisions/0042-b.md" })];
    const { body } = await read();
    expect(body.cards).toEqual([]);
    expect(body.refused.length).toBeGreaterThan(0);
    const all = (await (await readAllCards(new Request("http://localhost:3000/api/decision-card", { headers }))).json()) as { cards: DecisionCardView[] };
    expect(all.cards.filter((view) => view.card.verb === "answer")).toEqual([]);
  });

  it("refuses a cross-origin read", async () => {
    const response = await GET(new Request("http://localhost:3000/api/todo-item/decision?project=alpha&id=0042", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(response.status).toBe(403);
    expect(world.projects).toEqual([]);
  });

  it("needs a project and an id, and gives a fixed error when the read fails", async () => {
    expect((await GET(new Request("http://localhost:3000/api/todo-item/decision?project=alpha", { headers }))).status).toBe(400);
    world.openError = new Error("/secret/path exploded");
    const response = await GET(new Request("http://localhost:3000/api/todo-item/decision?project=alpha&id=0042", { headers }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("the short view's card through the existing answer gate", () => {
  it("pins exactly what the full list pins", async () => {
    const one = (await read()).body.cards[0];
    const all = (await (await readAllCards(new Request("http://localhost:3000/api/decision-card", { headers }))).json()) as { cards: DecisionCardView[] };
    const same = all.cards.find((view) => view.card.id === one.card.id)!;
    expect(one.pressable).toEqual(same.pressable);
    expect(one.card.pins).toEqual(same.card.pins);
    expect(one.card.options).toEqual(same.card.options);
    expect(one.card.what).toEqual(same.card.what);
  });

  it("answers through the writer with every precondition the pinned press has always sent", async () => {
    const view = (await read()).body.cards[0];
    const response = await post(view.card.id, view.pressable["option-2"]);
    expect(response.status).toBe(200);
    expect(world.approve).toHaveBeenCalledTimes(1);
    expect(world.approve).toHaveBeenCalledWith(expect.objectContaining({
      projectSlug: "alpha",
      decisionId: "0042",
      answer: "Use 9090",
      expectStatus: "open",
      expectUpdated: "2026-10-13",
      expectOptions: expect.stringMatching(/\S/),
      expectNoPointerMove: true
    }));
  });

  it.each([
    ["the question changed", { question: "Which port now?" }],
    ["a consequence changed", { options: [{ label: "Use 8080", consequence: "Something else entirely.", recommended: true }, { label: "Use 9090", consequence: "The service binds 9090 on the next restart.", recommended: false }] }],
    ["the record was updated", { updated: "2026-10-14" }]
  ])("refuses a press and writes nothing when %s after the view was read", async (_name, change) => {
    const view = (await read()).body.cards[0];
    world.decisions = [decision(change)];
    const response = await post(view.card.id, view.pressable["option-1"]);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe("stale_state_hash");
    expect(world.approve).not.toHaveBeenCalled();
  });

  it("refuses a press of a Decision answered elsewhere after the view was read", async () => {
    const view = (await read()).body.cards[0];
    world.decisions = [];
    const response = await post(view.card.id, view.pressable["option-1"]);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { reason: string }).reason).toBe("card_not_open");
    expect(world.approve).not.toHaveBeenCalled();
  });
});

describe("GET /api/todo-item/decision/record", () => {
  let root = "";
  const url = (id = "0042") => new Request(`http://localhost:3000/api/todo-item/decision/record?project=alpha&id=${id}`, { headers });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "decision-record-"));
    mkdirSync(path.join(root, "docs/decisions"), { recursive: true });
    writeFileSync(path.join(root, "docs/decisions/0042.md"), "---\nid: \"0042\"\nquestion: Which port?\n---\n\n# Decision 0042\n\nThe full reasoning.\n");
    world.repoPath = root;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("returns the document's body and its fields apart", async () => {
    const response = await readRecord(url());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "0042", relativePath: "docs/decisions/0042.md", updated: "2026-10-13", markdown: "# Decision 0042\n\nThe full reasoning.", frontMatter: "id: \"0042\"\nquestion: Which port?", truncated: false });
  });

  it("serves only an open Decision", async () => {
    world.decisions = [];
    expect((await readRecord(url())).status).toBe(404);
  });

  it("says so when two open Decisions share the id, rather than guessing", async () => {
    world.decisions = [decision(), decision({ relativePath: "docs/decisions/0042-b.md" })];
    const response = await readRecord(url());
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("0042-b.md");
  });

  it("refuses a path outside the repository, by traversal or by symlink, with a fixed error", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "decision-outside-"));
    writeFileSync(path.join(outside, "secret.md"), "secret");
    symlinkSync(path.join(outside, "secret.md"), path.join(root, "docs/decisions/link.md"));
    try {
      for (const relativePath of ["../../outside.md", "docs/decisions/link.md"]) {
        world.decisions = [decision({ relativePath })];
        const response = await readRecord(url());
        expect(response.status).toBeGreaterThanOrEqual(400);
        const text = JSON.stringify(await response.json());
        expect(text).not.toContain("secret\"");
        expect(text).not.toContain(root);
      }
      world.decisions = [decision({ relativePath: "docs/decisions/0042.txt" })];
      writeFileSync(path.join(root, "docs/decisions/0042.txt"), "not markdown");
      expect((await readRecord(url())).status).toBe(400);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("cuts an oversized document and says so", async () => {
    writeFileSync(path.join(root, "docs/decisions/0042.md"), `---\nid: x\n---\n${"word ".repeat(120_000)}`);
    const body = (await (await readRecord(url())).json()) as { truncated: boolean; markdown: string };
    expect(body.truncated).toBe(true);
    expect(body.markdown.length).toBeLessThanOrEqual(256 * 1024);
  });

  it("refuses a cross-origin read", async () => {
    expect((await readRecord(new Request("http://localhost:3000/api/todo-item/decision/record?project=alpha&id=0042", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  });
});

describe("splitDecisionRecord", () => {
  it.each([
    ["---\na: 1\n---\n\nBody", "a: 1", "Body"],
    ["---\r\na: 1\r\n---\r\nBody", "a: 1", "Body"],
    ["No front matter", null, "No front matter"],
    ["---\nnever closed\nBody", null, "---\nnever closed\nBody"]
  ])("%j", (input, frontMatter, markdown) => {
    expect(splitDecisionRecord(input)).toEqual({ frontMatter, markdown });
  });
});
