import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinnedAskSettlementLauncher } from "../../../../../src/operatorActions/libraryContract.js";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = { schema: "arcadia-operator-script-v1", title: "Example", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" }, repeatable: true };
function entry(library: string, id: string, extra: Record<string, unknown> = {}, script = "#!/bin/sh\nprintf 'state=%s\\n' \"$ARCADIA_OPERATOR_SCRIPT_STATE_DIR\"\n"): void {
  mkdirSync(library, { recursive: true });
  writeFileSync(path.join(library, `${id}.sh`), script, { mode: 0o755 });
  writeFileSync(path.join(library, `${id}.json`), JSON.stringify({ ...base, id, script: `${id}.sh`, ...extra }));
}

/** Arcadia's library plus two registered Project checkouts, each with its own library. */
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-project-libraries-"))); roots.push(root);
  const arcadia = path.join(root, "arcadia/artifacts/generated/operator-scripts");
  const alphaRepo = path.join(root, "alpha");
  const betaRepo = path.join(root, "beta");
  const alpha = path.join(alphaRepo, "artifacts/generated/operator-scripts");
  const beta = path.join(betaRepo, "artifacts/generated/operator-scripts");
  entry(arcadia, "own-action");
  entry(alpha, "publish-me", { project: "alpha" });
  entry(alpha, "legacy-unpublished");
  entry(alpha, "claims-beta", { project: "beta" });
  entry(beta, "beta-action", { project: "beta" });
  // A Project whose library escapes its checkout through a symlink is never read.
  const escapeRepo = path.join(root, "escape");
  mkdirSync(path.join(escapeRepo, "artifacts/generated"), { recursive: true });
  symlinkSync(alpha, path.join(escapeRepo, "artifacts/generated/operator-scripts"), "dir");
  vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", arcadia);
  vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES", JSON.stringify({ alpha: alphaRepo, beta: betaRepo, escape: escapeRepo, missing: path.join(root, "nowhere") }));
  vi.resetModules();
  return { root, arcadia, alpha, beta, alphaRepo };
}
const post = (POST: (request: Request) => Promise<Response>, id: string) => POST(new Request("http://arcadia.test/api/operator-script", {
  method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ id })
}));

describe("/api/operator-script reads every registered Project's own library", () => {
  it("lists Arcadia's entries by id and each Project's published entries by <project>--<id>, with the Project named", async () => {
    const f = fixture();
    const { GET } = await import("./route");
    const listing = await (await GET()).json() as { scripts: { id: string; project: string | null }[] };
    expect(listing.scripts.map((script) => [script.id, script.project]).sort()).toEqual([
      ["alpha--publish-me", "alpha"],
      ["beta--beta-action", "beta"],
      ["own-action", null]
    ]);
    expect(existsSync(f.alpha)).toBe(true);
  });

  it("reads one Project entry by key and refuses unknown Projects, unpublished entries and malformed keys", async () => {
    fixture();
    const { GET } = await import("./[id]/route");
    const read = (id: string) => GET(new Request(`http://arcadia.test/api/operator-script/${id}`), { params: Promise.resolve({ id }) });
    const found = await read("alpha--publish-me");
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ script: { id: "alpha--publish-me", project: "alpha", title: "Example" } });
    expect((await read("gamma--publish-me")).status).toBe(404);
    expect((await read("escape--publish-me")).status).toBe(404);
    expect((await read("alpha--legacy-unpublished")).status).toBe(404);
    expect((await read("alpha---publish-me")).status).toBe(400);
    expect((await read("alpha--..")).status).toBe(400);
  });

  it("launches a Project entry with run state beside Arcadia's library, leaving the Project checkout untouched", async () => {
    const f = fixture();
    const before = readdirSync(f.alpha).sort();
    const { POST } = await import("./route");
    const response = await post(POST, "alpha--publish-me");
    expect(response.status).toBe(202);
    const started = await response.json() as { runId: string; scriptId: string };
    expect(started.scriptId).toBe("alpha--publish-me");
    const state = path.join(f.arcadia, "projects/alpha");
    const runPath = path.join(state, "runs/operator/publish-me", started.runId, "run.json");
    for (let attempt = 0; attempt < 80 && (!existsSync(runPath) || JSON.parse(readFileSync(runPath, "utf8")).status === "running"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(JSON.parse(readFileSync(runPath, "utf8"))).toMatchObject({ status: "succeeded", scriptId: "alpha--publish-me" });
    expect(readFileSync(path.join(path.dirname(runPath), "stdout.log"), "utf8")).toContain(`state=${state}`);
    expect(readdirSync(f.alpha).sort()).toEqual(before);

    const { GET } = await import("./[id]/runs/[runId]/route");
    const run = await GET(new Request("http://arcadia.test"), { params: Promise.resolve({ id: "alpha--publish-me", runId: started.runId }) });
    expect(run.status).toBe(200);
    // The same run id under another Project's key is not found.
    const other = await GET(new Request("http://arcadia.test"), { params: Promise.resolve({ id: "beta--publish-me", runId: started.runId }) });
    expect(other.status).toBe(404);
  });

  it("refuses to launch an entry that publishes itself for another Project", async () => {
    fixture();
    const { POST } = await import("./route");
    const response = await post(POST, "alpha--claims-beta");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "UNPUBLISHED_PROJECT_ENTRY" });
  });

  it("never lists or launches a Project entry that names an Ask by request id alone, and shows a pinned entry's pin", async () => {
    const f = fixture();
    const settleScript = "#!/bin/sh\narcadia agent-ask settle --apply\n";
    // beta's Ask named from alpha's library: a plain agentAsk scope and a rejection list.
    entry(f.alpha, "settle-beta-ask", { project: "alpha", repeatable: false, agentAsk: { proposal: "beta-ask", intent: "decision", targetRef: null } }, settleScript);
    entry(f.alpha, "reject-beta-asks", { project: "alpha", repeatable: false, agentAskRejections: { manifest: "m.json", sha256: "b".repeat(64), proposals: ["agentask_0123abcd"] } }, settleScript);
    entry(f.alpha, "settle-alpha-ask", {
      project: "alpha", repeatable: false, title: "Accept alpha Ask",
      agentAsk: { proposal: "alpha-ask", intent: "decision", targetRef: null },
      agentAskSettlement: { schema: "arcadia-agent-ask-settlement-v1", project: "alpha", proposalFingerprint: "a".repeat(64), requestId: "reject-alpha-ask", disposition: "rejected", placement: null }
    }, pinnedAskSettlementLauncher("settle-alpha-ask"));
    const { GET, POST } = await import("./route");
    const listing = await (await GET()).json() as { scripts: { id: string; pinnedSettlement: unknown }[] };
    expect(listing.scripts.map((script) => script.id).sort()).toEqual(["alpha--publish-me", "alpha--settle-alpha-ask", "beta--beta-action", "own-action"]);
    // The card reads the pin, so an "Accept" title cannot hide a pinned rejection.
    expect(listing.scripts.find((script) => script.id === "alpha--settle-alpha-ask")?.pinnedSettlement).toEqual({ project: "alpha", proposal: "alpha-ask", disposition: "rejected", placement: null });
    expect(listing.scripts.find((script) => script.id === "alpha--publish-me")?.pinnedSettlement).toBeNull();
    for (const key of ["alpha--settle-beta-ask", "alpha--reject-beta-asks"]) {
      const response = await post(POST, key);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ reason: "UNSUPPORTED_PROJECT_ENTRY" });
    }
  });

  it("redirects /actions?q=<project key> to its single-action page", async () => {
    fixture();
    const { singleActionPath } = await import("../../../lib/actionRedirect");
    expect(await singleActionPath("alpha--publish-me")).toBe("/actions/alpha--publish-me");
    expect(await singleActionPath("gamma--publish-me")).toBeNull();
    expect(await singleActionPath("own-action")).toBe("/actions/own-action");
  });
});
