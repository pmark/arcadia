import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspaceArtifactFixture } from "../helpers/workspace-artifact-fixture";
import { runAskTrailCommand } from "../../src/commands/askTrail";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

test("opens real linked SVG and escaped text on a phone without changing the Ask", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(path.join(tmpdir(), "workspace-artifact-browser-"));
  const fixture = workspaceArtifactFixture(root);
  const trail = runAskTrailCommand({ workspace: fixture.workspace, id: fixture.receipt }).data;
  const repo = path.resolve(import.meta.dirname, "../..");
  const port = await freePort(); const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root, ARCADIA_WORKSPACE: fixture.workspace }, logPath: path.join(root, "next.log") });
  const errors: string[] = []; const external: string[] = []; let posts = 0; let byteReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("artifact-sentinel.invalid")) external.push(request.url()); });
  await page.route("**/api/**", async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") { posts++; return route.abort(); }
    if (endpoint.startsWith("/api/workspace/artifacts/")) { byteReads++; return route.continue(); }
    if (endpoint === "/api/ask/show") return route.fulfill({ json: trail });
    if (endpoint === "/api/plans") return route.fulfill({ json: { generatedAt: "2030-01-01", projects: [] } });
    return route.abort();
  });
  const saved = { draft: "Keep my unsent draft", target: { projectId: fixture.projectId, label: "Garden", context: "Garden selected context" }, exchange: { id: fixture.receipt, text: "Show the output", target: { label: "Garden", context: "Garden sent context" }, phase: "acknowledged" }, history: [] };
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.addInitScript(value => localStorage.setItem("arcadia.workspace.ask.v1", JSON.stringify(value)), saved);
    await page.goto(`${url}/workspace?receipt=${fixture.receipt}`);
    const open = page.getByRole("button", { name: "Open Artifact", exact: true });
    await expect(open).toHaveCount(3);
    const opener = (id: string) => page.locator(".workspace-ask-receipt article > div").filter({ hasText: id }).getByRole("button", { name: "Open Artifact", exact: true });
    const originalStorage = await page.evaluate(() => localStorage.getItem("arcadia.workspace.ask.v1"));
    const originalURL = page.url();
    // Keyboard activation and native dialog focus confinement, including Escape restoration.
    await opener(fixture.svgId).focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Artifact", exact: true });
    const image = dialog.getByRole("img", { name: "Linked Artifact output" });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(240);
    await expect(dialog.getByRole("button", { name: "Close Artifact" })).toBeFocused();
    await page.keyboard.press("Tab");
    // Native dialogs may yield a Tab stop to browser chrome; background controls stay inert.
    expect(await page.evaluate(() => { const modal = document.querySelector("dialog"); return modal?.matches(":modal") && (document.activeElement === document.body || modal.contains(document.activeElement)); })).toBe(true);
    await dialog.getByRole("button", { name: "Close Artifact" }).focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("artifact-phone.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("artifact-desktop.png"), fullPage: false });
    expect(external).toEqual([]); expect(await page.evaluate(() => "artifactScriptRan" in window)).toBe(false);
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener(fixture.svgId)).toBeFocused();
    await expect(page.getByRole("textbox")).toHaveValue(saved.draft);
    expect(await page.evaluate(() => localStorage.getItem("arcadia.workspace.ask.v1"))).toBe(originalStorage); expect(page.url()).toBe(originalURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await opener(fixture.textId).click(); await expect(dialog.locator("pre")).toContainText("<script>window.textExecuted=true</script>");
    expect(await page.evaluate(() => "textExecuted" in window)).toBe(false);
    await dialog.getByRole("button", { name: "Close Artifact" }).click();
    await opener(fixture.pathlessId).click(); await expect(dialog.getByRole("alert")).toHaveText("This Artifact has no file path.");
    await page.screenshot({ path: testInfo.outputPath("artifact-error-phone.png"), fullPage: false });
    await dialog.getByRole("button", { name: "Close Artifact" }).click();
    expect(await page.evaluate(() => localStorage.getItem("arcadia.workspace.ask.v1"))).toBe(originalStorage);
    expect(byteReads).toBe(3); expect(posts).toBe(0); expect(errors).toEqual([]);
    for (const name of ["artifact-phone.png", "artifact-desktop.png", "artifact-error-phone.png"]) await testInfo.attach(name, { path: testInfo.outputPath(name), contentType: "image/png" });
  } finally { await server.stop(); await testInfo.attach("next-server-log", { path: path.join(root, "next.log"), contentType: "text/plain" }); rmSync(root, { recursive: true, force: true }); }
});
