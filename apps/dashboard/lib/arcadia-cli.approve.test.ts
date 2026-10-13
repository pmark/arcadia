import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock("node:child_process", () => ({
  execFile: (_command: string, args: string[], _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
    exec.calls.push(args);
    callback(null, { stdout: JSON.stringify({ ok: true, command: "decision.approve", data: { relativePath: "docs/decisions/0001.md", applied: true } }), stderr: "" });
  }
}));

import { approveDecision } from "./arcadia-cli";

describe("approveDecision argv", () => {
  beforeEach(() => {
    exec.calls.length = 0;
  });

  it("passes the three writer preconditions with their values", async () => {
    await approveDecision({
      projectSlug: "alpha",
      decisionId: "0042",
      answer: "Use 8080",
      expectStatus: "open",
      expectUpdated: "2026-10-13",
      expectOptions: "a".repeat(64)
    });
    const args = exec.calls[0];
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args.slice(args.indexOf("decision"), args.indexOf("decision") + 3)).toEqual(["decision", "approve", "0042"]);
    expect(at("--project")).toBe("alpha");
    expect(at("--answer")).toBe("Use 8080");
    expect(at("--expect-status")).toBe("open");
    expect(at("--expect-updated")).toBe("2026-10-13");
    expect(at("--expect-options")).toBe("a".repeat(64));
  });

  it("omits the flags when no precondition is given", async () => {
    await approveDecision({ projectSlug: "alpha", decisionId: "0042", answer: "Use 8080" });
    expect(exec.calls[0]).not.toContain("--expect-status");
    expect(exec.calls[0]).not.toContain("--expect-updated");
    expect(exec.calls[0]).not.toContain("--expect-options");
  });
});
