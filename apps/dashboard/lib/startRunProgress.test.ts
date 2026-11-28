import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadStartRunProgress, startRunStatusLine } from "./startRunProgress";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const CARD = "standing-start-fixture0001";
const EXECUTOR_RUN = "20261128T020000Z-4242";

/** A library holding one pressed START card: the dashboard's press directory, claimed by the executor, and its receipt. */
function pressed(receipt: Record<string, unknown> | null, claim: string | null = EXECUTOR_RUN) {
  const library = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-start-run-progress-")));
  roots.push(library);
  const press = path.join(library, "runs", "operator", CARD, "20261128020000000-press");
  mkdirSync(press, { recursive: true });
  if (claim !== null) writeFileSync(path.join(press, "start-run.claimed"), `${claim}\n`);
  if (receipt) {
    mkdirSync(path.join(library, "runs", CARD, EXECUTOR_RUN), { recursive: true });
    writeFileSync(path.join(library, "runs", CARD, EXECUTOR_RUN, "receipt.json"), JSON.stringify({ schema: "arcadia-start-run-receipt-v1", id: CARD, runId: EXECUTOR_RUN, ...receipt }));
  }
  return { library, press };
}

describe("START card progress on the run result page (#3189)", () => {
  it("says \"checking host\" while the quiet-host check samples, and nothing for the other phases", () => {
    expect(startRunStatusLine({ phaseName: "quiet_host", outcome: "in_progress" })).toMatch(/^Checking host: .*about 90 seconds before it uses anything up\.$/);
    expect(startRunStatusLine({ phaseName: "state", outcome: "in_progress" })).toBeNull();
    expect(startRunStatusLine({ phaseName: "sign_in", outcome: "refused", reason: "the sign-in sequence did not succeed" })).toBeNull();
    expect(startRunStatusLine({ phaseName: "complete", outcome: "succeeded" })).toBeNull();
  });

  it("says plainly that nothing was used up when the card refused \"host not quiet\"", () => {
    expect(startRunStatusLine({ phaseName: "quiet_host", outcome: "refused", reason: "host not quiet: a beat gap of 27 s (at most 25 s) over 21 samples; nothing was consumed" }))
      .toBe("Host not quiet: nothing was used up. Press this same card again later, once the host is quieter.");
  });

  it("reads the executor receipt the press directory's claim names", async () => {
    const { library, press } = pressed({ phase: "P2", phaseName: "quiet_host", outcome: "in_progress", reason: "" });
    expect(await loadStartRunProgress(library, CARD, press)).toEqual({ phase: "P2", phaseName: "quiet_host", outcome: "in_progress", reason: "", statusLine: expect.stringMatching(/^Checking host: /) });
  });

  it("returns null before the executor claims the press, for a malformed claim, or for a receipt of another card or run", async () => {
    const unclaimed = pressed({ phase: "P0", phaseName: "context", outcome: "in_progress" }, null);
    expect(await loadStartRunProgress(unclaimed.library, CARD, unclaimed.press)).toBeNull();
    const traversal = pressed({ phase: "P2", phaseName: "quiet_host", outcome: "in_progress" }, "../../etc");
    expect(await loadStartRunProgress(traversal.library, CARD, traversal.press)).toBeNull();
    const foreign = pressed({ phase: "P2", phaseName: "quiet_host", outcome: "in_progress", id: "another-card" });
    expect(await loadStartRunProgress(foreign.library, CARD, foreign.press)).toBeNull();
    const missing = pressed(null);
    expect(await loadStartRunProgress(missing.library, CARD, missing.press)).toBeNull();
  });
});
