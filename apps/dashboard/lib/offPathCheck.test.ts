import { describe, expect, it } from "vitest";
import { resolveOffPathConfirmation } from "./offPathCheck";

const script = (id: string) => ({ id, title: `Title ${id}`, repeatable: true, state: { status: "available" as const } });
const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("resolveOffPathConfirmation", () => {
  it("needs no confirmation when nothing is sequenced", async () => {
    expect(await resolveOffPathConfirmation(script("a"), respond(200, { scripts: [script("a"), script("b")] }))).toBeNull();
  });

  it("asks for confirmation when a next_after needs production status that cannot be read", async () => {
    const sequenced = { ...script("b"), nextAfter: { id: "a", within_minutes: 30, when_production: "inactive" as const } };
    const prerequisite = { ...script("a"), state: { status: "succeeded" as const }, lastRunReceipt: { outcome: "succeeded", startedAt: "2026-10-18T01:00:00Z", finishedAt: "2026-10-18T01:01:00Z", succeededAt: "2026-10-18T01:01:00Z" } };
    const fetchImpl = (async (url: string) => {
      if (String(url).startsWith("/api/production-control")) throw new Error("down");
      return new Response(JSON.stringify({ scripts: [prerequisite, sequenced] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await resolveOffPathConfirmation(script("a"), fetchImpl, Date.parse("2026-10-18T01:05:00Z"))).toContain("Could not confirm this is your next action");
  });

  it("refuses to decide when the library cannot be read, so the caller launches nothing", async () => {
    await expect(resolveOffPathConfirmation(script("a"), respond(500, { error: "library down" }))).rejects.toThrow("library down");
  });
});
