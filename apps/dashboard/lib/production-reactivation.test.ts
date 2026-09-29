import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const calls: string[][] = [];

vi.mock("node:child_process", () => {
  const execFile = () => {
    throw new Error("callback form is not used");
  };
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (_command: string, args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify({ ok: true, command: "production.activate", data: {} }), stderr: "" };
  };
  return { execFile };
});

describe("dashboard production reactivation (Issue #392)", () => {
  it("forwards the exact recorded scope.actions instead of letting the CLI re-derive them", async () => {
    const { activateProduction } = await import("./arcadia-cli");
    await activateProduction({
      requestId: "req-1",
      grantedBy: "operator",
      expectedRevision: 4,
      scope: {
        intent: "Finish the Plan.",
        projects: ["demo"],
        plans: ["demo/queue-plan"],
        actions: ["demo/migrate", "demo/ship-it"],
        providers: ["claude"],
        maxConcurrentSessions: 1,
        mechanicalTransitions: ["validation"]
      }
    });

    const args = calls.at(-1) ?? [];
    const forwarded = args.flatMap((arg, index) => (arg === "--action" ? [args[index + 1]] : []));
    expect(forwarded).toEqual(["demo/migrate", "demo/ship-it"]);
  });
});
