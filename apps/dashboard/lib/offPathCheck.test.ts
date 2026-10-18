import { describe, expect, it } from "vitest";
import { resolveOffPathConfirmation } from "./offPathCheck";

const script = (id: string) => ({ id, title: `Title ${id}`, repeatable: true, state: { status: "available" as const } });
const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("resolveOffPathConfirmation", () => {
  it("needs no confirmation when nothing is sequenced", async () => {
    expect(await resolveOffPathConfirmation(script("a"), respond(200, { scripts: [script("a"), script("b")] }))).toBeNull();
  });

  it("refuses to decide when the library cannot be read, so the caller launches nothing", async () => {
    await expect(resolveOffPathConfirmation(script("a"), respond(500, { error: "library down" }))).rejects.toThrow("library down");
  });
});
