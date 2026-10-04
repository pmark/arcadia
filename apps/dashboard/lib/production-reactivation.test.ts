import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const calls: string[][] = [];

vi.mock("node:child_process", () => {
  const execFile = () => {
    throw new Error("callback form is not used");
  };
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (_command: string, args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify({ ok: true, command: "production.reactivate", data: {} }), stderr: "" };
  };
  return { execFile };
});

describe("dashboard production reactivation (Issues #392, #883)", () => {
  it("asks the CLI to replay the saved configuration, bound to the previewed revisions, and never rebuilds a scope", async () => {
    const cli = await import("./arcadia-cli");
    // The old flag-rebuilding entry point is gone: argv cannot express grants,
    // delegation expiry or an empty transition list, which is how scope widened.
    expect("activateProduction" in cli).toBe(false);

    await cli.reactivateProduction({
      requestId: "req-1",
      grantedBy: "dashboard-toggle",
      expected: { policyRevision: 29, configurationRevision: 3, fingerprint: "abc123" }
    });

    const args = calls.at(-1) ?? [];
    expect(args.slice(args.indexOf("production"))).toEqual([
      "production",
      "reactivate",
      "--request-id",
      "req-1",
      "--granted-by",
      "dashboard-toggle",
      "--expected-revision",
      "29",
      "--expected-configuration-revision",
      "3",
      "--expected-fingerprint",
      "abc123",
      "--json"
    ]);
    // Remote preservation is replayed only from the saved fingerprint; the
    // dashboard has no way to request it.
    for (const flag of ["--action", "--project", "--plan", "--provider", "--transitions", "--concurrency", "--remote-preservation"]) {
      expect(args).not.toContain(flag);
    }
  });

  it("has no dashboard path that can request remote preservation", () => {
    // The only grant is `arcadia production activate --remote-preservation`;
    // no dashboard CLI wrapper may spell it.
    const source = readFileSync(new URL("./arcadia-cli.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/remote-preservation|remotePreservation/);
  });
});
