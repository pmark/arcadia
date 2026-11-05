import { expect, test, type Page, type Route } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";
import { createE2EWorkspace } from "./fixtures/workspace.js";

// iPhone 15 Pro's width, and the height Safari leaves it with its toolbars showing.
const PHONE = { width: 393, height: 659 };

// Real-shaped: the longest open Decision on record when this was written, with four options and long consequences.
const OPTIONS = [
  { label: "Spec it first as a Decision-linked design note, then add an honest Mission Control section", consequence: "No Mission Control change ships yet. The next Action becomes a short written spec of what asset-orchestrator would concretely mean in Arcadia (what gets tracked, where, how it surfaces), reviewed by Mark, and only then does a Mission Control Action add copy describing that scoped, truthful capability -- nothing overclaimed.", recommended: true },
  { label: "Build a minimal real asset-tracking slice in Arcadia first, showcase after", consequence: "Slower to reach Mission Control, but the site only ever describes something that already runs. Requires committing engineering time to Arcadia core (dashboard/DB) before any marketing payoff, and defers the Mission Control ask Mark wants done right away.", recommended: false },
  { label: "Add a Mission Control section now describing the idea as a roadmap direction, clearly labeled as not-yet-built", consequence: "Fastest to ship what Mark asked for literally (a feature on the site right away), but risks reading as a promise rather than evidence if the labeling is not kept prominent, and produces the least market signal since visitors cannot try anything.", recommended: false },
  { label: "Defer entirely", consequence: "No Mission Control or Arcadia work happens on this. Revisit only when a concrete asset-management pain point (e.g. juggling generated images/audio across two or more live creative projects) actually surfaces as a bottleneck.", recommended: false }
];
const QUESTION = "Decide whether and how to explore positioning Arcadia as a streamlined asset-management orchestrator (tracking, versioning, and surfacing generated creative assets -- images, audio, video, docs -- across projects) as a feature or angle on the Mission Control site. This second sentence is what the first view leaves until an option is chosen.";
const row = {
  kind: "decision", id: "0003", project: "site", title: QUESTION, detail: OPTIONS[0].label, gateQuestion: "reasonable_disagreement", options: OPTIONS, evidence: [], sourceEvidence: [], cost: "Deterministic — a CLI write, no model call.", createdAt: "2030-01-01", readOnly: false, blocking: true, staleReason: null, answer: "arcadia decision approve 0003 --project site --answer '...'", answerVia: [], origin: null, todoKey: "decision:site/0003", href: "/todo/decision/site/0003", requestId: null, aliases: ["explore-positioning"], acceptable: null, acceptWhy: null, buildPacket: false
};
const cardId = "decision-k.site.0003";
const stateHash = (n: number) => String(n).repeat(64);
const fingerprint = (index: number, hash: string) => `v1|option=option-${index + 1}|state=${hash}`;
const view = (hash = stateHash(1)) => ({
  card: {
    schema: "arcadia-decision-card-v1", id: cardId, kind: "decision", what: `Answer Decision k.site.0003: ${QUESTION}`, verb: "answer",
    options: OPTIONS.map((option, index) => ({ id: `option-${index + 1}`, label: option.label, consequence: option.consequence })),
    evidence: [{ label: "Decision k.site.0003", fingerprint: hash }], pins: { stateHash: hash }, expires: "2031-01-01T00:00:00Z", policy_match: null, receipt: null
  },
  pressable: Object.fromEntries(OPTIONS.map((_, index) => [`option-${index + 1}`, fingerprint(index, hash)])),
  notExecutableReason: null, duplicates: { kind: "decision", project: "site", id: "0003" }, actionsHref: null
});
const meta = { id: "0003", question: QUESTION, gateQuestion: "reasonable_disagreement", recommendation: OPTIONS[0].label, recommendedLabels: [OPTIONS[0].label], relativePath: "docs/decisions/0003.md", updated: "2030-01-01" };
const RECORD = "# Decision 0003\n\n## Rationale\n\nThe whole reasoning lives here, and only here.\n";

// The list a Decision page used to download whole: the same size as the real one on the day this was written.
const wholeList = { source: "todo", note: null, approvals: Array.from({ length: 447 }, (_, index) => ({ ...row, id: `a${index}`, todoKey: `agent_ask:site/a${index}`, kind: "agent_ask", detail: "x".repeat(2600) })) };

interface Fixture { requested: string[]; bytes: Map<string, number>; card: () => unknown; record: () => Promise<void>; press: (route: Route) => Promise<unknown>; reads: () => Promise<void> }

async function serveFixtures(page: Page, overrides: Partial<Fixture> = {}): Promise<Fixture> {
  const fixture: Fixture = { requested: [], bytes: new Map(), card: () => ({ cards: [view()], refused: [], decision: meta }), record: async () => undefined, press: route => route.abort(), reads: async () => undefined, ...overrides };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    fixture.requested.push(`${route.request().method()} ${url.pathname}`);
    const reply = (json: unknown) => {
      fixture.bytes.set(url.pathname, JSON.stringify(json).length);
      return route.fulfill({ json });
    };
    if (url.pathname === "/api/decision-card" && route.request().method() === "POST") return fixture.press(route);
    if (route.request().method() !== "GET") return route.abort();
    // Slow reads, as real ones are, so the screen has to say something in the meantime.
    if (url.pathname === "/api/todo-item") {
      await fixture.reads();
      await new Promise(resolve => setTimeout(resolve, 300));
      return reply({ source: "todo", note: null, approvals: [row] });
    }
    if (url.pathname === "/api/todo-item/decision") {
      await fixture.reads();
      await new Promise(resolve => setTimeout(resolve, 900));
      return reply(fixture.card());
    }
    if (url.pathname === "/api/todo-item/decision/record") {
      await fixture.record();
      return reply({ id: "0003", relativePath: "docs/decisions/0003.md", updated: "2030-01-01", markdown: RECORD, frontMatter: "id: \"0003\"", truncated: false });
    }
    if (url.pathname === "/api/approvals") return reply(wholeList);
    if (url.pathname === "/api/decision-card") return reply({ cards: [], refused: [] });
    return route.abort();
  });
  return fixture;
}

const option = (page: Page, index: number) => page.getByTestId("decision-option").nth(index);
const answerButton = (page: Page) => page.getByTestId("decision-answer-button");

async function withServer(testInfo: { attach: (name: string, options: { path: string; contentType: string }) => Promise<void> }, run: (url: string) => Promise<void>) {
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-todo-decision-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  try {
    await waitForHttp(`${url}/todo`, server);
    await run(url);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
}

test.use({ viewport: PHONE });

test("a Decision opens small and at once, on one phone screen, with the full record only on request", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let releaseRecord = () => undefined as void;
    const recordHeld = new Promise<void>(resolve => { releaseRecord = resolve; });
    let releaseReads = () => undefined as void;
    const readsHeld = new Promise<void>(resolve => { releaseReads = resolve; });
    const fixture = await serveFixtures(page, { record: () => recordHeld, reads: () => readsHeld });

    // The shell and a specific line come with no data at all: both reads are held until this has been seen.
    await page.goto(`${url}/todo/decision/site/0003`, { waitUntil: "commit" });
    await expect(page.getByRole("status").filter({ hasText: /this Decision/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
    await expect(page.getByTestId("decision-answer")).toHaveCount(0);
    await testInfo.attach("shell", { body: await page.screenshot(), contentType: "image/png" });
    releaseReads();

    // The row fills in first, then the card; there's no way to answer from the row's text.
    await expect(page.getByTestId("decision-question")).toBeVisible();
    await expect(page.getByTestId("decision-answer")).toBeVisible();
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toBeVisible();

    // Small: nothing of the whole list, nothing of the menu's data, and no document.
    expect(fixture.requested).not.toContain("GET /api/approvals");
    expect(fixture.requested).not.toContain("GET /api/mission-control");
    expect(fixture.requested).not.toContain("GET /api/todo-item/decision/record");
    const firstViewBytes = [...fixture.bytes.values()].reduce((sum, size) => sum + size, 0);
    expect(firstViewBytes).toBeLessThan(10_000);
    expect(JSON.stringify(wholeList).length).toBeGreaterThan(1_000_000);
    await testInfo.attach("first-view-bytes", { body: `${firstViewBytes} bytes of API, against ${JSON.stringify(wholeList).length} for the whole list`, contentType: "text/plain" });

    // One phone screen, with the question, all four options, and the way to the record all on it.
    const { scrollHeight, innerHeight } = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
    expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
    await expect(page.getByTestId("decision-question")).toBeInViewport();
    await expect(option(page, 3)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Read the full record" })).toBeInViewport();
    await testInfo.attach("first-view", { body: await page.screenshot(), contentType: "image/png" });

    // The record arrives only when asked for, and says what it's doing until then.
    await page.getByRole("button", { name: "Read the full record" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reading the full record" })).toBeVisible();
    expect(fixture.requested.filter(entry => entry === "GET /api/todo-item/decision/record")).toHaveLength(1);
    releaseRecord();
    await expect(page.getByTestId("decision-record")).toContainText("The whole reasoning lives here, and only here.");
    await expect(page.getByTestId("decision-record")).toContainText("Gate: reasonable_disagreement");
    await expect(page.getByTestId("decision-record")).toContainText(`Recommendation: ${OPTIONS[0].label}`);
    await page.getByRole("button", { name: "Hide the full record" }).click();
    await page.getByRole("button", { name: "Read the full record" }).click();
    await expect(page.getByTestId("decision-record")).toContainText("The whole reasoning");
    expect(fixture.requested.filter(entry => entry === "GET /api/todo-item/decision/record")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

test("answering is pinned: nothing to press until everything is on screen, and a changed Decision must be read again", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    const posts: unknown[] = [];
    let hash = stateHash(1);
    let accept = false;
    const fixture = await serveFixtures(page, {
      card: () => ({ cards: [view(hash)], refused: [], decision: meta }),
      press: async route => {
        posts.push(route.request().postDataJSON());
        if (accept) return route.fulfill({ json: { ok: true, cardId, verb: "answer", optionId: "option-2", message: `Answered ${cardId}.` } });
        // What the real route answers when the record moved after this page read it.
        hash = stateHash(2);
        return route.fulfill({ status: 409, json: { error: "The card changed after you were shown it (stale_state_hash). Nothing was written; reload and read the current card.", reason: "stale_state_hash" } });
      }
    });
    await page.goto(`${url}/todo/decision/site/0003`);
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toBeVisible();
    await expect(answerButton(page)).toHaveCount(0);

    const clamped = () => page.getByTestId("decision-consequence").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).webkitLineClamp));
    expect(new Set(await clamped())).toEqual(new Set(["2"]));
    // Actually clamped, not just styled: the box is shorter than its text.
    expect(await page.getByTestId("decision-consequence").first().evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(page.getByTestId("decision-question").getByText("This second sentence")).not.toBeInViewport();

    // Choosing opens the whole question and every option's whole consequence, and only then offers the button.
    await option(page, 1).getByRole("button").click();
    await expect(answerButton(page)).toHaveText(`Answer: ${OPTIONS[1].label}`);
    await expect(answerButton(page)).toBeInViewport();
    expect(new Set(await clamped())).toEqual(new Set(["none"]));
    await expect(page.getByTestId("decision-question")).toContainText("This second sentence");
    for (const text of OPTIONS) await expect(page.getByTestId("decision-answer")).toContainText(text.consequence);
    await testInfo.attach("chosen", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Tapping it again puts the button away.
    await option(page, 1).getByRole("button").first().click();
    await expect(answerButton(page)).toHaveCount(0);
    await option(page, 1).getByRole("button").click();

    // The press carries exactly what the pinned press has always carried, and a refusal is shown with its reason.
    await answerButton(page).click();
    await expect(page.getByTestId("decision-refused")).toContainText("Refused (stale_state_hash)");
    expect(posts).toEqual([{ cardId, fingerprint: fingerprint(1, stateHash(1)) }]);

    // The refusal's refresh brings the new card: the choice is gone until it's read and made again.
    await expect(page.getByRole("alert").filter({ hasText: "changed while you were reading" })).toBeVisible();
    await expect(answerButton(page)).toHaveCount(0);

    accept = true;
    await option(page, 1).getByRole("button").click();
    await answerButton(page).click();
    await expect(page.getByTestId("decision-answered")).toContainText(`Answered: ${OPTIONS[1].label}`);
    expect(posts[1]).toEqual({ cardId, fingerprint: fingerprint(1, stateHash(2)) });
    await expect(answerButton(page)).toHaveCount(0);
    await expect(option(page, 1).getByRole("button")).toHaveCount(0);

    // Answering went only through the pinned route, and the whole list was never read.
    expect(fixture.requested.filter(entry => entry.startsWith("POST"))).toEqual(["POST /api/decision-card", "POST /api/decision-card"]);
    expect(fixture.requested).not.toContain("GET /api/approvals");
  });
});

test("a next-step link opens the Decision instead of the whole list, and Back never bounces", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    const fixture = await serveFixtures(page);
    // A fresh load, the way a Workspace "answer" tap or a shared link arrives.
    await page.goto(`${url}/todo#card-${encodeURIComponent(cardId)}`);
    await expect(page).toHaveURL(/\/todo\/decision\/site\/0003$/);
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toBeVisible();
    expect(fixture.requested).not.toContain("GET /api/approvals");
    expect(fixture.requested).not.toContain("GET /api/decision-card");
    expect(fixture.requested).not.toContain("GET /api/next-steps");

    // From the list: its own next-step links replace themselves, so Back returns to the list and stays there.
    await page.goto(`${url}/todo`);
    await expect(page.getByTestId("todo-summary")).toBeVisible();
    await page.evaluate(id => { window.location.hash = `#card-${encodeURIComponent(id)}`; }, cardId);
    await expect(page).toHaveURL(/\/todo\/decision\/site\/0003$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(page.getByTestId("todo-summary")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/todo$/);

    // Any other card link still means the list.
    await page.goto(`${url}/todo#card-script-rotate-logs`);
    await expect(page.getByTestId("todo-summary")).toBeVisible();
    await expect(page).toHaveURL(/\/todo#card-script-rotate-logs$/);
  });
});

test("a failed read says so and offers nothing to press, and the next read brings the pinned card back", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    let failing = true;
    await page.route("**/api/**", route => {
      const endpoint = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") return route.abort();
      if (endpoint === "/api/todo-item") return route.fulfill({ json: { source: "todo", note: null, approvals: [row] } });
      if (endpoint === "/api/todo-item/decision") return failing ? route.fulfill({ status: 503, json: { error: "This Decision could not be read.", reason: "decision_unreadable" } }) : route.fulfill({ json: { cards: [view()], refused: [], decision: meta } });
      return route.abort();
    });
    await page.goto(`${url}/todo/decision/site/0003`);
    await expect(page.getByRole("alert").filter({ hasText: "so nothing can be pressed yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toHaveCount(0);
    await expect(page.getByText("Answer from the to-do card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    failing = false;
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toBeVisible({ timeout: 30_000 });
  });
});

test("a Decision with no options or only a title shows what it has and invents nothing", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    const bare = { ...row, id: "0016", title: "Copy production model", detail: null, gateQuestion: null, options: [], blocking: false, todoKey: "decision:site/0016", href: "/todo/decision/site/0016", aliases: [] };
    await page.route("**/api/**", route => {
      const endpoint = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") return route.abort();
      if (endpoint === "/api/todo-item") return route.fulfill({ json: { source: "todo", note: null, approvals: [bare] } });
      if (endpoint === "/api/todo-item/decision") return route.fulfill({ json: { cards: [], refused: [{ id: "decision-k.site.0016", reason: "no_options", message: "The Decision offers no options to answer between." }], decision: { ...meta, id: "0016", question: bare.title, gateQuestion: null, recommendation: null, recommendedLabels: [] } } });
      return route.abort();
    });
    await page.goto(`${url}/todo/decision/site/0016`);
    await expect(page.getByTestId("decision-question")).toHaveText("Copy production model");
    await expect(page.getByText("The record gives only this title, not a full question.")).toBeVisible();
    await expect(page.getByText(/offers no options to answer between/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the full record" })).toBeVisible();
    await expect(page.getByTestId("decision-option")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Answer|Approve/ })).toHaveCount(0);
  });
});

test("a long unbroken token in an option stays on the screen, so nothing about an answer is clipped", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    // A live Decision's real option label.
    const label = "Authorize one bounded container audit 6ba40cb873552467cdc317d85c2786524b42f0f2f296e568c57b9e9e37cf56e0";
    const token = `sha256:${"f".repeat(120)}`;
    const long = view();
    long.card.options[0].label = label;
    long.card.options[0].consequence = `Permit one request for ${token} and nothing else.`;
    await serveFixtures(page, { card: () => ({ cards: [long], refused: [], decision: meta }) });
    await page.goto(`${url}/todo/decision/site/0003`);
    await expect(option(page, 0).getByRole("button")).toBeVisible();
    const offScreen = () => page.evaluate(() => [...document.querySelectorAll("article, article *")].filter(node => node.getBoundingClientRect().right > window.innerWidth + 0.5 && !node.closest(".sr-only")).map(node => node.tagName));
    expect(await offScreen()).toEqual([]);
    await option(page, 0).getByRole("button").click();
    await expect(answerButton(page)).toBeInViewport();
    expect(await offScreen()).toEqual([]);
    await expect(page.getByTestId("decision-answer")).toContainText(token);
    await testInfo.attach("long-token", { body: await page.screenshot(), contentType: "image/png" });
  });
});

test("the Decision view follows the phone's dark and light settings", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withServer(testInfo, async url => {
    await serveFixtures(page);
    const canvas = () => page.locator("[data-theme-scope=auto] > div").first().evaluate(node => getComputedStyle(node).backgroundColor);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${url}/todo/decision/site/0003`);
    await expect(page.getByRole("button", { name: /Defer entirely/ })).toBeVisible();
    expect(await canvas()).toBe("rgb(18, 21, 25)");
    await testInfo.attach("dark", { body: await page.screenshot(), contentType: "image/png" });
    await page.emulateMedia({ colorScheme: "light" });
    expect(await canvas()).toBe("rgb(245, 247, 248)");
    await testInfo.attach("light", { body: await page.screenshot(), contentType: "image/png" });
  });
});

test("the short view answers through the real route and the real writer, and a stale press writes nothing", async ({ page }) => {
  test.setTimeout(180_000);
  const arcadia = await createE2EWorkspace();
  let failed = true;
  try {
    const project = path.join(arcadia.root, "repos", "arcadia");
    const decisions = path.join(project, "docs", "decisions");
    mkdirSync(decisions, { recursive: true });
    // The writer commits the answer, and the server's HOME is this temp folder, so the repository needs its own identity.
    for (const [key, value] of [["user.name", "E2E Fixture"], ["user.email", "e2e@example.invalid"]]) spawnSync("git", ["config", key, value], { cwd: project });
    const file = path.join(decisions, "0900-pick-a-port.md");
    const doc = (consequence: string) => `---
arcadia: v1
type: decision
id: "0900"
slug: pick-a-port
project: arcadia
status: open
question: Which port should the fixture service use?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Use 8080
options:
  - label: Use 8080
    consequence: ${consequence}
    recommended: true
  - label: Use 9090
    consequence: The fixture binds 9090 on the next restart.
    recommended: false
confidence: high
updated: 2030-01-01
---

# Decision 0900: Which port should the fixture service use?

## Rationale

The whole reasoning lives in this document.
`;
    writeFileSync(file, doc("The fixture binds 8080 on the next restart."));
    await page.goto(`${arcadia.url}/todo/decision/arcadia/0900`);
    await expect(page.getByRole("button", { name: /Use 9090/ })).toBeVisible({ timeout: 60_000 });

    // The real record, on request.
    await page.getByRole("button", { name: "Read the full record" }).click();
    await expect(page.getByTestId("decision-record")).toContainText("The whole reasoning lives in this document.", { timeout: 30_000 });
    await expect(page.getByTestId("decision-record")).toContainText("docs/decisions/0900-pick-a-port.md");
    // Nothing is left out: the record's fields are one more tap away.
    await expect(page.getByText("gap_type")).not.toBeVisible();
    await page.getByTestId("decision-record").getByText("Record fields").click();
    await expect(page.getByTestId("decision-record")).toContainText("gap_type: missing-decision");

    // The record changes after the page read it, so the real route refuses and the file isn't answered.
    await option(page, 0).getByRole("button").click();
    await expect(answerButton(page)).toBeVisible();
    const edited = doc("The fixture binds 8080 and also restarts the world.");
    writeFileSync(file, edited);
    await answerButton(page).click();
    await expect(page.getByTestId("decision-refused")).toContainText("stale_state_hash", { timeout: 60_000 });
    expect(readFileSync(file, "utf8")).toBe(edited);

    // The new text reaches the page, and the choice has to be made again against it.
    await expect(page.getByTestId("decision-answer")).toContainText("also restarts the world", { timeout: 60_000 });
    await expect(answerButton(page)).toHaveCount(0);
    await option(page, 1).getByRole("button").click();
    await answerButton(page).click();
    await expect(page.getByTestId("decision-answered")).toContainText("Answered: Use 9090", { timeout: 60_000 });
    const answered = readFileSync(file, "utf8");
    expect(answered).toContain("status: approved");
    expect(answered).toContain("answer: Use 9090");

    // Answered: a fresh load has nothing to press, and says so.
    await page.reload();
    await expect(page.getByText("Nothing is waiting on you here.")).toBeVisible({ timeout: 60_000 });
    failed = false;
  } finally {
    await arcadia.stop(failed);
  }
});
