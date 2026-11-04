import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayGrantLauncher, inspectDayGrantChain } from "../../../../../src/operatorActions/startRunDayGrant.js";
import { TAILNET_PRESS_HEADERS } from "../../../../../tests/helpers/dayGrantFixture.js";
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("Operator endpoint projects shared runner receipts", () => {
  it("returns a server-created run id and keeps terminal output in its launch record", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-launch-record-")); roots.push(root);
    writeFileSync(path.join(root, "example.sh"), "#!/bin/sh\nprintf 'hello from operator action\\n'\n", { mode: 0o755 });
    writeFileSync(path.join(root, "example.json"), JSON.stringify({ schema: "arcadia-operator-script-v1", id: "example", script: "example.sh", title: "Example", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" }, repeatable: true }));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { POST } = await import("./route");
    const response = await POST(new Request("http://arcadia.test/api/operator-script", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ id: "example" }) }));
    expect(response.status).toBe(202);
    const started = await response.json() as { runId: string };
    expect(started.runId).toMatch(/^[a-z0-9-]+$/);
    const runPath = path.join(root, "runs", "operator", "example", started.runId, "run.json");
    for (let attempt = 0; attempt < 40 && (!existsSync(runPath) || JSON.parse(readFileSync(runPath, "utf8")).status === "running"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const run = JSON.parse(readFileSync(runPath, "utf8")) as { status: string; exitCode: number; runId: string };
    expect(run).toMatchObject({ status: "succeeded", exitCode: 0, runId: started.runId });
    expect(readFileSync(path.join(root, "runs", "operator", "example", started.runId, "stdout.log"), "utf8")).toContain("hello from operator action");
  });

  it("turns the header set a browser sends on the Tailnet URL into a day approval the chain accepts, through the real runner and executor", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-day-grant-press-")); roots.push(root);
    const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
    const fixtures = path.join(repoRoot, "tests", "fixtures", "start-run");
    const repo = path.join(root, "arcadia"), bin = path.join(root, "bin");
    const library = path.join(repo, "artifacts", "generated", "operator-scripts");
    const plan = "active-plan", id = "approve-critical-path-day";
    const executor = readFileSync(path.join(repoRoot, "scripts", "day-grant.sh"));
    for (const dir of [path.join(repo, "scripts"), path.join(repo, "docs", "decisions"), path.join(repo, "docs", "plans"), library, bin]) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(repo, "scripts", "day-grant.sh"), executor, { mode: 0o755 });
    writeFileSync(path.join(repo, "docs", "decisions", "0173-fixture.md"), '---\nstatus: approved\nanswer: "A. Daily grant: START and routine run operations"\n---\n');
    writeFileSync(path.join(repo, "PROJECT.md"), `---\nactive_plan: ${plan}\n---\n`);
    writeFileSync(path.join(repo, "docs", "plans", `${plan}.md`), "---\nstatus: active\n---\n");
    writeFileSync(path.join(library, `${id}.sh`), dayGrantLauncher(id), { mode: 0o755 });
    writeFileSync(path.join(library, `${id}.json`), JSON.stringify({
      schema: "arcadia-operator-script-v1", id, kind: "grant", script: `${id}.sh`, title: "Approve one day", problem: "Example problem", desired_effect: "Example effect", repeatable: false, expires_at: "2099-01-01T00:00:00Z",
      authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" },
      dayGrant: { schema: "arcadia-day-grant-v1", decision: "0173", executorSha256: createHash("sha256").update(executor).digest("hex"), project: "arcadia", plan, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130" }
    }));
    writeFileSync(path.join(root, "state.json"), JSON.stringify({ workspace: root, repository: repo, plan, production: { desiredState: "inactive", revision: 91, epoch: 50, liveAdmissions: 0, authority: null }, worker: { alive: false } }));
    writeFileSync(path.join(bin, "fake-arcadia.mjs"), readFileSync(path.join(fixtures, "fake-arcadia.mjs")));
    writeFileSync(path.join(bin, "mise"), `#!/usr/bin/env bash\nexec "${path.join(fixtures, "fake-mise")}" "$@"\n`, { mode: 0o755 });
    writeFileSync(path.join(bin, "timeout"), '#!/usr/bin/env bash\nshift; exec "$@"\n', { mode: 0o755 });
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", library); vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("FAKE_ROOT", root); vi.stubEnv("FAKE_BIN", bin); vi.stubEnv("FAKE_ARCADIA_ROOT", repoRoot);
    vi.stubEnv("ARCADIA_WORKSPACE", undefined); vi.stubEnv("CODEX_SANDBOX", undefined);
    vi.resetModules();
    const { POST } = await import("./route");
    const press = (headers: Record<string, string>, body: unknown) => POST(new Request(`http://${TAILNET_PRESS_HEADERS.host}/api/operator-script`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const refused = async (headers: Record<string, string>, body: unknown, reason: string) => {
      const response = await press(headers, body);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ reason });
    };
    // A scripted POST, the host's own browser at loopback, and a delegated press never make an approval.
    await refused({ host: TAILNET_PRESS_HEADERS.host }, { id }, "DAY_GRANT_BROWSER_PRESS_REQUIRED");
    await refused({ origin: "http://127.0.0.1:3020", host: "127.0.0.1:3020" }, { id }, "DAY_GRANT_BROWSER_PRESS_REQUIRED");
    await refused({ origin: "http://127.0.0.1:3020", host: "127.0.0.1:3020", "sec-fetch-site": "same-origin" }, { id }, "DAY_GRANT_BROWSER_PRESS_REQUIRED");
    await refused(TAILNET_PRESS_HEADERS, { id, delegation: { decision: "0173", agent: "rowan" } }, "NOT_DELEGATED_CARD");
    expect(existsSync(path.join(library, "runs", "operator", id))).toBe(false);
    const browser = await press(TAILNET_PRESS_HEADERS, { id });
    expect(browser.status).toBe(202);
    const { runId } = await browser.json() as { runId: string };
    const runPath = path.join(library, "runs", "operator", id, runId, "run.json");
    for (let attempt = 0; attempt < 400 && JSON.parse(readFileSync(runPath, "utf8")).status === "running"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const run = JSON.parse(readFileSync(runPath, "utf8")) as { status: string; browserPress?: boolean; press?: unknown; startedAt: string };
    expect(run, readFileSync(path.join(library, "runs", "operator", id, runId, "stderr.log"), "utf8")).toMatchObject({ status: "succeeded", browserPress: true });
    expect(run.press).toBeUndefined();
    const consumed = JSON.parse(readFileSync(path.join(library, `${id}.consumed.json`), "utf8")) as { runId: string };
    const chain = inspectDayGrantChain({
      library, approvalCard: id, approvalRun: consumed.runId, approvalReceiptSha256: null, approvalPressSha256: null, now: new Date(), evidence: { transitions: [], activations: [] }, policyRevision: 91, excludePress: null,
      scope: { project: "arcadia", plan, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130" }, previous: null, attempt: 1
    });
    expect(chain.window.opensAt).toBe(run.startedAt);
    expect(chain.window.closesAtMs - chain.window.opensAtMs).toBe(24 * 3_600_000);
  });

  it("accepts an optional grant kind while descriptors without it list unchanged", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-script-kind-")); roots.push(root);
    const base = { schema: "arcadia-operator-script-v1", title: "Example", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" } };
    for (const [id, kind] of [["ordinary", undefined], ["grant", "grant"]] as const) {
      writeFileSync(path.join(root, `${id}.sh`), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
      writeFileSync(path.join(root, `${id}.json`), JSON.stringify({ ...base, id, script: `${id}.sh`, ...(kind ? { kind } : {}) }));
    }
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET } = await import("./route");
    const listing = await (await GET()).json() as { scripts: Array<{ id: string; kind?: string }> };
    expect(listing.scripts.find((script) => script.id === "ordinary")).not.toHaveProperty("kind");
    expect(listing.scripts.find((script) => script.id === "grant")).toMatchObject({ kind: "grant" });
  });

  it("shows the canonical receipt and refuses a completed one-shot without any dashboard launcher state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-receipt-endpoint-")); roots.push(root);
    mkdirSync(path.join(root, "runs/receipts"), { recursive: true });
    writeFileSync(path.join(root, "example.sh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const descriptor = { schema: "arcadia-operator-script-v1", id: "example", script: "example.sh", title: "Example", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" }, repeatable: false };
    writeFileSync(path.join(root, "example.json"), JSON.stringify(descriptor));
    const receipt = { schema: "arcadia-plan-amendment-receipt-v1", id: "example", status: "succeeded", reason: "SETTLED_AND_PUBLISHED", message: "The exact amendment was published.", next: "Keep the receipt.", runDirectory: "runs/example", settlement: { applied: true, documentsCommit: "exact" } };
    writeFileSync(path.join(root, "runs/receipts/example.json"), JSON.stringify(receipt));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET, POST } = await import("./route");
    const listing = await (await GET()).json() as { scripts: { state: { status: string }; receipt: unknown }[] };
    expect(listing.scripts[0].state.status).toBe("succeeded");
    expect(listing.scripts[0].receipt).toEqual(receipt);
    const response = await POST(new Request("http://arcadia.test/api/operator-script", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ id: "example" }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("already completed") });
  });
});
