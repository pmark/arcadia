import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DECISION_CARD_SCHEMA } from "../../src/decisions/card";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

// Ids with ":" and "/" are what next-step links percent-encode (src/decisions/nextSteps.ts).
const ids = Array.from({ length: 6 }, (_, i) => `decision:arcadia/01${40 + i}`);
const view = (id: string) => ({
  card: {
    schema: DECISION_CARD_SCHEMA, id, kind: "decision", what: `Decide ${id}`, verb: "answer", expires: "2030-01-02T00:00:00Z", policy_match: null, receipt: null, pins: { stateHash: "s" }, evidence: [],
    options: [1, 2, 3].map(n => ({ id: `option-${n}`, label: `Option ${n}`, consequence: `What option ${n} does for ${id}, written long enough to take up room on a phone.` }))
  },
  pressable: {}, notExecutableReason: "Fixture card: no button.", duplicates: null, actionsHref: null
});

test("a next-step card link scrolls to its card once the late-loading cards render", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-todo-card-anchor-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.abort();
    if (endpoint === "/api/decision-card") {
      // Arrive after the page has loaded, as the real read does, so the browser's own jump finds nothing.
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ json: { cards: ids.map(view), refused: [] } });
    }
    if (endpoint === "/api/approvals") return route.fulfill({ json: { approvals: [], note: null, source: "todo" } });
    return route.abort();
  });
  const card = (id: string) => page.locator("article", { has: page.getByRole("heading", { name: `Decide ${id}`, exact: true }) });
  try {
    await waitForHttp(`${url}/todo`, server);
    const target = ids[ids.length - 1];

    // The encoded form next-step links use.
    await page.goto(`${url}/todo#card-${encodeURIComponent(target)}`);
    await expect(card(target)).toBeInViewport();
    await expect(card(ids[0])).not.toBeInViewport();

    // A fragment the browser leaves partly unencoded still finds the same card.
    await page.goto(`${url}/todo`);
    await expect(card(ids[0])).toBeInViewport();
    await page.goto(`${url}/todo#card-${target}`);
    await expect(card(target)).toBeInViewport();
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
