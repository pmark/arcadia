// Interaction validation for go-workspace.html. Drives the simulated prototype in a real browser and
// checks the PPN walkthrough, draft preservation, repeatable intervention and the adversarial cases.
//
//   node docs/reports/go-workspace-design-2026-10-27/prototype/validate.cjs [screenshot-dir]
//
// Uses the repository's Playwright. Set PW_CHROMIUM to a Chromium binary when the pinned browser is not installed.
const path = require("node:path");
const fs = require("node:fs");
let chromium;
try { ({ chromium } = require("@playwright/test")); } catch { ({ chromium } = require("playwright")); }

const URL = "file://" + path.join(__dirname, "go-workspace.html");
const OUT = process.argv[2] || path.join(require("node:os").tmpdir(), "go-workspace-validation");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fresh(page) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#table-title", { state: "attached" });
}
const title = page => page.locator("#table-title").innerText();
const draftValue = page => page.locator("#draft").inputValue();
const activeId = page => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.dataset.k || document.activeElement.tagName));
async function console_(page, sim) {
  if (await page.locator("#console").isHidden()) await page.click('header [data-act="toggle-console"]');
  await page.click(`#console [data-sim="${sim}"]`);
  if (sim !== "reload") await page.click('#console [data-act="toggle-console"]');
}
async function waitStatus(page, n, word, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.locator(".receipt", { hasText: `#${n} →` }).first().innerText().catch(() => "");
    if (t.includes(word)) return t;
    await sleep(150);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (!r.url().startsWith("file:")) external.push(r.url()); });
  await fresh(page);
  await page.screenshot({ path: path.join(OUT, "desktop-1-glance.png") });

  // ---- Primary PPN walkthrough ----
  check("Simulation is labelled", await page.locator(".simbadge").isVisible());
  await page.click('.fitem:has-text("Hero/Recognition copy r2 needs your review")');
  check("1. Attention item opens the Action in the crafting table", (await title(page)).includes("Compare and revise Hero/Recognition copy"));
  const rec = await page.locator("#table .rec").first().innerText();
  check("1. Recommendation and its consequence are visible", rec.includes("Ask for a revision of r2") && rec.includes("Consequence"));
  check("2. Proposed copy is compared with evidence (3 unsupported claims flagged)", (await page.locator("#table .claim.none").count()) === 3 && (await page.locator("#table .ev").count()) === 3);
  await page.click('#table [data-act="focus-composer"]');
  check("3. 'Write a revision direction' focuses the composer", (await activeId(page)) === "draft");
  check("3. Composer is explicitly addressed to the Action", (await page.locator("#target-label").innerText()).includes("Compare and revise Hero/Recognition copy"));
  const D1 = "Drop 'overnight', 'proven growth systems' and 'thousands'. Ground the hero in [E1] and recognition in [E2].";
  await page.locator("#draft").pressSequentially(D1, { delay: 2 });
  // An automatic feed event arrives about 3.5 s after typing starts.
  await page.waitForSelector(".newpill", { timeout: 8000 }).catch(() => {});
  check("7. Arriving feed event shows as a 'new' pill", await page.locator(".newpill").isVisible());
  check("7. Arrival did not steal focus", (await activeId(page)) === "draft");
  check("7. Arrival did not change selection or the draft", (await title(page)).includes("Compare and revise") && (await draftValue(page)) === D1);
  await page.screenshot({ path: path.join(OUT, "desktop-2-drafting-with-arrival.png") });

  await page.click('#table [data-act="select"][data-id="T-evidence"]');
  check("4. Linked Topic opens in the same work area", (await title(page)) === "Practitioner evidence");
  check("4. Draft and target survive navigation", (await draftValue(page)) === D1 && (await page.locator("#target-label").innerText()).includes("Compare and revise"));
  check("4. Composer explains the target differs from the view", (await page.locator("#target-hint").innerText()).includes("still addressed to"));
  await page.click('[data-act="lens"][data-lens="map"]');
  await page.waitForSelector(".map-node.self");
  check("Map lens shows the selected node and its links", (await page.locator(".map-node.self").innerText()).includes("Practitioner evidence") && (await page.locator(".map-node.cross").count()) >= 1);
  await page.screenshot({ path: path.join(OUT, "desktop-3-map-lens.png") });
  await page.click('.map-node:has-text("Compare and revise")');
  check("4. Map node navigates back to the Action (navigation only)", (await title(page)).includes("Compare and revise") && (await page.locator(".receipt").count()) === 0);
  check("4. Feed place kept (new pill still waiting)", await page.locator(".newpill").isVisible());
  await page.click('[data-act="lens"][data-lens="outline"]');

  await page.click("#send");
  const seen = [];
  for (const w of ["Arcadia recorded your direction", "Delivered to the agent", "acknowledged it. That is not a result"]) { if (await waitStatus(page, 1, w)) seen.push(w); }
  const revsAtAck = await page.locator("#table .rev").count();
  check("5. Submitted, delivered and acknowledged are distinct simulated states", seen.length === 3, seen.join(" → "));
  check("5. Acknowledgment is not a result (no new revision yet)", revsAtAck === 2);
  await waitStatus(page, 1, "The agent produced r3");
  check("5. Resulting revision r3 arrives separately", (await page.locator("#table").innerText()).includes("r3 is the current proposal"));
  check("6. Comparison shows what changed r2 → r3", (await page.locator("#table ins").count()) > 0 && (await page.locator("#table del").count()) > 0);
  await page.screenshot({ path: path.join(OUT, "desktop-4-revision-r3.png") });

  // E4 arrives automatically about 6 s after r3: the "approve r3" recommendation goes stale.
  await page.waitForSelector("text=This recommendation changed while you were looking", { timeout: 10000 }).catch(() => {});
  const staleText = await page.locator("#table .notice.warn").first().innerText().catch(() => "");
  check("7. Recommendation goes stale and names the changed facts", staleText.includes("changed while you were looking") && staleText.includes("E4"));
  check("7. No approve action is offered until the change is reviewed", (await page.locator('#table [data-act="approve"]').count()) === 0);
  await page.screenshot({ path: path.join(OUT, "desktop-5-stale-recommendation.png") });
  await page.reload(); await page.waitForSelector("#table-title", { state: "attached" });
  check("7. The stale gate survives a reload (no silent clearing)", (await page.locator("#table").innerText()).includes("changed while you were looking"));
  await page.click('#table [data-act="ack-rec"]');
  check("7. Refreshed recommendation explains the new choice", (await page.locator("#table .rec").first().innerText()).includes("Ask for a softer hero line"));
  await page.click('#table .alt:has-text("Approve r3 anyway") button');
  check("6. Approve within the simulation", (await page.locator("#table").innerText()).includes("r3 accepted"));

  await page.locator("#draft").fill("Replace 'Evenings back' with less after-hours admin [E2]; keep the recognition line.");
  await page.click("#send");
  await waitStatus(page, 2, "The agent produced r4");
  check("6. Intervene again: second direction produces r4", (await page.locator("#table").innerText()).includes("r4 is the current proposal"));
  await page.click('#table [data-act="approve"]');
  await page.locator("#draft").fill("One sentence for the hero, please.");
  await page.click("#send");
  await waitStatus(page, 3, "The agent produced r5");
  check("6. No one-correction limit: a third direction produces r5", (await page.locator("#table").innerText()).includes("r5 is the current proposal"));

  // ---- Adversarial checks ----
  await page.locator("#draft").fill("One sentence for the hero, please.");
  await page.click("#send");
  check("Duplicate send is caught before sending", (await page.locator("#send-warn").innerText()).includes("matches direction #3"));
  await page.click('#send-warn [data-act="dup-keep"]');
  check("Duplicate kept as one (not sent again)", (await page.locator(".receipt", { hasText: "#4 →" }).innerText()).includes("kept as one"));

  await page.locator("#draft").fill("Make the recognition line warmer.");
  await page.click("#send");
  await page.locator("#draft").fill("Make the recognition line more clinical.");
  await page.click("#send");
  check("Contradictory follow-up asks before sending", (await page.locator("#send-warn").innerText()).includes("may contradict"));
  await page.click('#send-warn [data-act="send-follow"]');
  await waitStatus(page, 6, "The agent produced");

  await console_(page, "stop");
  await page.locator("#draft").fill("Keep going after the stop.");
  await page.click("#send");
  check("Stopped recipient: direction is held, not delivered", (await waitStatus(page, 7, "waits and is delivered when work resumes", 4000)) !== null);
  check("Stopped recipient: next move says to resume", (await page.locator("#moves .rec").innerText()).includes("Resume the A3 session"));
  await page.click('#moves [data-act="resume-recipient"]');
  check("Resume delivers the held direction", (await waitStatus(page, 7, "Delivered to the agent", 4000)) !== null || (await waitStatus(page, 7, "acknowledged", 4000)) !== null);
  await waitStatus(page, 7, "The agent produced");

  await console_(page, "flaky");
  await page.locator("#draft").fill("Check this arrives.");
  await page.click("#send");
  await sleep(2500);
  const unk = await page.locator(".receipt", { hasText: "#8 →" }).innerText();
  check("Uncertain submission is marked unknown and never resent automatically", unk.includes("cannot tell whether this arrived") && (await page.locator(".receipt").count()) === 8);
  await page.click('.receipt:has-text("#8 →") [data-act="check-receipt"]');
  check("Receipt check confirms without a second send", (await waitStatus(page, 8, "Delivered to the agent", 3000)) !== null || (await waitStatus(page, 8, "acknowledged", 3000)) !== null);
  await waitStatus(page, 8, "The agent produced");

  await page.locator("#draft").fill("This draft must survive a reload.");
  await page.waitForTimeout(200);
  await page.reload(); await page.waitForSelector("#table-title");
  check("Draft and target survive a page reload", (await draftValue(page)) === "This draft must survive a reload." && (await page.locator("#target-label").innerText()).includes("Compare and revise"));
  await console_(page, "reload");
  await page.waitForSelector("#table-title");
  await sleep(400);
  const afterReload = await page.locator(".receipt", { hasText: "#9 →" }).innerText().catch(() => "");
  check("Reload mid-send: the unconfirmed direction is not silently resent", afterReload.includes("cannot tell whether this arrived") && (await page.locator(".receipt").count()) === 9);

  // Copying an old direction back never overwrites a different draft without asking.
  await page.click('.node:has-text("Field notes")');
  await page.locator("#draft").fill("my unsent draft");
  await page.click('.receipt:has-text("#9 →") [data-act="copy-back"]');
  check("Copy-back asks before replacing a different draft", (await page.locator("#send-warn").innerText()).includes("would be replaced") && (await draftValue(page)) === "my unsent draft");
  await page.click('#send-warn [data-act="send-cancel"]');
  check("Keeping the draft leaves its text and target", (await draftValue(page)) === "my unsent draft" && (await page.locator("#target-label").innerText()).includes("Field notes"));
  await page.locator("#draft").fill("");
  await page.click('.node:has-text("Compare and revise")');

  // A session that stops after acknowledging produces nothing until it resumes.
  const revsBefore = await page.locator("#table .rev").count();
  await page.locator("#draft").fill("Halt test: tighten the recognition line.");
  await page.click("#send");
  await waitStatus(page, 10, "acknowledged it");
  await console_(page, "stop");
  await sleep(4000);
  check("Stop after acknowledgment: no revision while stopped", (await page.locator("#table .rev").count()) === revsBefore && (await page.locator(".receipt", { hasText: "#10 →" }).innerText()).includes("No revision is produced until A3 resumes"));
  await page.click('#moves [data-act="resume-recipient"]');
  check("Resume lets the acknowledged direction finish", (await waitStatus(page, 10, "The agent produced", 6000)) !== null);

  // Switching automatic timing off mid-send stops the pending transition.
  await page.locator("#draft").fill("Manual step test.");
  await page.click("#send");
  await page.click('header [data-act="toggle-console"]'); await page.click("#auto"); await page.click('#console [data-act="toggle-console"]');
  await sleep(3000);
  check("Auto off: the direction stays submitted", (await page.locator(".receipt", { hasText: "#11 →" }).innerText()).includes("Arcadia recorded your direction"));
  await page.click('.receipt:has-text("#11 →") [data-act="advance"]');
  check("Auto off: one manual step advances one state", (await page.locator(".receipt", { hasText: "#11 →" }).innerText()).includes("Delivered to the agent"));
  await page.click('header [data-act="toggle-console"]'); await page.click("#auto"); await page.click('#console [data-act="toggle-console"]');
  check("Auto back on: the direction finishes once", (await waitStatus(page, 11, "The agent produced", 8000)) !== null && (await page.locator(".receipt").count()) === 11);
  check("Allowance never counts operator directions", (await page.locator("#journey").innerText()).includes("Your directions never use it"));

  await page.click('.fitem:has-text("Decision D-04")');
  check("Answered approval in an older snapshot is called out", (await page.locator("#table").innerText()).includes("already answered at 10:05"));
  await page.click('#table [data-act="d04-refresh"]');
  check("Refreshing marks the feed item answered", (await page.locator('.fitem:has-text("Decision D-04")').innerText()).includes("answered"));

  await page.click('.fitem:has-text("Hero/Recognition copy r2")');
  await console_(page, "manual");
  check("Direct operator edit (source change) is detected and re-bases the comparison", (await page.locator("#table").innerText()).includes("You edited the hero line directly"));
  await console_(page, "prs");
  check("Partial source outage is shown honestly", (await page.locator("#feed").innerText()).includes("Pull requests could not be read") && (await page.locator("#feed .tag.stale").count()) > 0);
  await console_(page, "prs");
  await console_(page, "empty");
  check("Empty feed has an honest empty state", (await page.locator("#feed").innerText()).includes("Nothing needs you right now"));
  await console_(page, "empty");

  await page.click('#moves [data-act="pause"]');
  check("Pause requested is distinct from paused", (await page.locator("#moves").innerText()).includes("Pause requested"));
  await page.waitForSelector("#moves >> text=Paused at a checkpoint", { timeout: 5000 }).catch(() => {});
  check("Then paused at a checkpoint", (await page.locator("#moves").innerText()).includes("Paused at a checkpoint"));
  await page.click('#moves [data-act="resume"]');

  // ---- Secondary flows ----
  await page.click('#moves [data-act="preview-continuation"]');
  check("Continuation preview compares one Action with a bounded plan", (await page.locator("#table").innerText()).includes("Continue a bounded plan") && (await page.locator("#table").innerText()).includes("Continue one Action"));
  await page.click('#table [data-cont="bounded"]');
  await page.click('#table [data-act="launch"]');
  check("Launch is simulated and says so", (await page.locator("#table .notice.sim").innerText()).includes("Nothing started for real"));
  await page.click('#table [data-act="launch"]');
  check("Repeated launch creates no second writer", (await page.locator("#table .notice.sim").innerText()).includes("No second writer"));
  await page.click('#table [data-cont="one"]');
  await page.click('#table [data-act="launch"]');
  check("An overlapping launch with a different scope is refused", (await page.locator("#table .notice.sim").innerText()).includes("would add a second writer"));
  await page.screenshot({ path: path.join(OUT, "desktop-6-continuation.png") });
  await page.click('#trail [data-id="ppn"]');
  await page.locator("#adopt-text").fill("# Plan: Testimonials page\n- Collect consented practitioner quotes\n- Draft the testimonials section\n- Review with two practitioners");
  await page.click('.node:has-text("Practitioner evidence")');
  await page.click('[data-act="back"] >> nth=0');
  check("Pasted plan Markdown survives navigation", (await page.locator("#adopt-text").inputValue()).startsWith("# Plan: Testimonials page\n- Collect consented"));
  await page.click('#table [data-act="adopt-preview"]');
  check("External plan preview lists candidate Actions", (await page.locator("#table .notice.info").innerText()).includes("3 candidate Actions"));
  await page.click('#table [data-act="adopt-go"]');
  check("Adopted plan is a proposal, not executable", (await page.locator("#table").innerText()).includes("not an executable Plan"));
  await page.click('#trail [data-id="portfolio"]');
  check("Portfolio shows next eligible work with blocked reasons", (await page.locator("#table .alt.blocked").count()) >= 1);
  await page.click('#table [data-act="propose"]');
  check("New Project/feature proposal gets a simulated receipt", (await page.locator("#table").innerText()).includes("waits for your acceptance"));
  await page.click('.node:has-text("Landing preview")');
  check("Artifact viewer shows the current revision", await page.locator(".preview").isVisible());
  await page.click('.node:has-text("Compare and revise")');
  await page.locator('[data-sec="audit"] summary').click();
  check("Native session links are disabled and explained", (await page.locator('#table button:has-text("Open in Claude Code")').isDisabled()) && (await page.locator("#native-why").innerText()).includes("no verified native destination"));

  // ---- Keyboard ----
  await page.keyboard.press("Escape");
  await page.locator('#trail [data-id="portfolio"]').focus();
  await page.keyboard.press("Enter");
  check("Keyboard: Enter on a trail item navigates", (await title(page)) === "Portfolio");
  const ring = await page.evaluate(() => { const b = document.querySelector('[data-k="trail-portfolio"]') || document.querySelector("#trail button"); b.focus(); return getComputedStyle(b).outlineStyle; });
  check("Keyboard: focused controls show a visible outline", ring !== "none", ring);
  // An arrival while focus is on a composer control (not the textarea) keeps that focus.
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errors.push(e.message));
  await fresh(p2);
  await p2.locator("#draft").pressSequentially("x");
  await p2.locator('[data-k="cite-E2"]').focus();
  await p2.waitForSelector(".newpill", { timeout: 8000 }).catch(() => {});
  check("Arrival keeps focus on a Cite button", (await p2.evaluate(() => document.activeElement?.dataset.k)) === "cite-E2" && (await p2.locator(".newpill").isVisible()));
  await p2.close();
  check("No page errors on desktop", errors.length === 0, errors.join(" | "));
  check("No network requests (no live API, no CDN)", external.length === 0, external.join(" "));
  await ctx.close();

  // ---- Phone width ----
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", hasTouch: true, isMobile: true });
  const ph = await pctx.newPage(); const perr = []; ph.on("pageerror", e => perr.push(e.message));
  await fresh(ph);
  check("Phone: no horizontal scroll", (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  check("Phone: feed is the starting view and the composer is reachable", (await ph.locator("#feed").isVisible()) && (await ph.locator("#draft").isVisible()));
  await ph.screenshot({ path: path.join(OUT, "phone-1-feed.png") });
  await ph.tap('.fitem:has-text("Hero/Recognition copy r2")');
  check("Phone: one focused work area replaces the feed", (await ph.locator("#table").isVisible()) && (await ph.locator("#feed").isHidden()));
  await ph.locator("#draft").fill("Phone direction draft");
  await ph.tap('#table [data-act="select"][data-id="T-evidence"]');
  check("Phone: draft kept while exploring", (await ph.locator("#draft").inputValue()) === "Phone direction draft");
  await ph.screenshot({ path: path.join(OUT, "phone-2-work.png") });
  await ph.tap('.phone-back');
  check("Phone: clear return to the feed", await ph.locator("#feed").isVisible());
  await ph.tap('[data-act="toggle-moves"]');
  check("Phone: Direction sheet opens with the next move", await ph.locator("#moves .rec").isVisible());
  check("Phone: focus moves into the Direction sheet", await ph.evaluate(() => document.getElementById("moves").contains(document.activeElement)));
  await ph.screenshot({ path: path.join(OUT, "phone-3-direction.png") });
  await ph.keyboard.press("Escape");
  check("Phone: Escape closes the sheet and returns focus", (await ph.locator("#direction.sheet-open").count()) === 0 && (await ph.evaluate(() => document.activeElement?.dataset.act)) === "toggle-moves");
  await ph.tap('[data-act="toggle-context"]');
  check("Phone: Context opens as a sheet", await ph.locator("#context.sheet-open").isVisible());
  check("Phone: Context sheet sits below the header and trail", await ph.evaluate(() => document.getElementById("context").getBoundingClientRect().top >= document.querySelector(".top").getBoundingClientRect().bottom - 1));
  await ph.screenshot({ path: path.join(OUT, "phone-4-context.png") });
  check("Phone: no page errors with reduced motion", perr.length === 0, perr.join(" | "));
  await browser.close();

  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ url: URL, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
