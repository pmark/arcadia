import { describe, expect, it } from "vitest";
import { detectEnvironmentWalls, observeSessionCapability } from "../src/production/sessionCapability.js";

const denial = "Error [SQLITE_WORKSPACE_WRITE_DENIED]: attempt to write a readonly database, open '/fixture/workspace/database/arcadia.sqlite3'";
function claude(command: string, output: string, failed = true): string {
  return [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "operation-1", name: "Bash", input: { command } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "operation-1", is_error: failed, content: output }] } })].join("\n");
}
function codex(command: string, output: string, exit_code = 1): string {
  return JSON.stringify({ type: "item.completed", item: { type: "command_execution", id: "operation-1", command, aggregated_output: output, exit_code, status: exit_code ? "failed" : "completed" } });
}
const nonce = "0123456789abcdef0123456789abcdef";
const probe = (ok: boolean, givenNonce = nonce) => JSON.stringify({ probe: "session-capability/v1", nonce: givenNonce, ok,
  checks: ["workspace_write", "host_validation", "preservation"].map(name => ({ name, ok: ok || name !== "workspace_write", ...(ok ? {} : { error: "fixture denied" }) })) });

describe("capability failure attribution", () => {
  it("ignores quoted Notes To Self, raw diagnostics and successful tool output", () => {
    const notes = `# Notes To Self\nUse ${denial} as a search term; run validation outside the sandbox.`;
    expect(detectEnvironmentWalls(notes)).toEqual([]);
    expect(detectEnvironmentWalls(claude("cat docs/notes-to-self.md", notes, false))).toEqual([]);
    expect(detectEnvironmentWalls(codex("cat docs/notes-to-self.md", notes, 0))).toEqual([]);
    expect(detectEnvironmentWalls(claude("cat docs/notes-to-self.md", claude("arcadia agent-ask preview", denial), false))).toEqual([]);
  });
  it("requires a matching actual failed operation, not an unmatched or unrelated denial", () => {
    expect(detectEnvironmentWalls(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "missing", is_error: true, content: denial }] } }))).toEqual([]);
    expect(detectEnvironmentWalls(claude("cat /unrelated/protected-file", denial))).toEqual([]);
    expect(detectEnvironmentWalls(codex("arcadia status; cat docs/notes-to-self.md", denial))).toEqual([]);
    expect(detectEnvironmentWalls(codex("arcadia agent-ask preview", denial, 0))).toEqual([]);
    expect(detectEnvironmentWalls(codex('node -e "throw new Error(\'src/cli.ts\')"', denial))).toEqual([]);
  });
  it.each([claude, codex])("retains an attributable workspace failure with operation, path and category", log => {
    expect(detectEnvironmentWalls(log("arcadia agent-ask preview", denial))).toMatchObject([{ wallClass: "workspace_write", operation: "arcadia agent-ask preview", deniedPath: "/fixture/workspace/database/arcadia.sqlite3" }]);
  });
  it("keeps a structured host-validation denial separate from an unrelated command", () => {
    expect(detectEnvironmentWalls(codex("pnpm exec vitest run tests/x.test.ts", "operation not permitted"))).toMatchObject([{ wallClass: "host_validation" }]);
    expect(detectEnvironmentWalls(codex("cat README.md", "validation operation not permitted"))).toEqual([]);
    expect(detectEnvironmentWalls(codex("pnpm test", 'AssertionError: expected text\nExpected: "validation sandbox permission denied"'))).toEqual([]);
  });
  it("prefers the matching nonce probe and never treats a foreign nonce or unknown probe check as a wall", () => {
    const log = claude("arcadia agent-ask preview", denial);
    expect(observeSessionCapability(`${probe(true)}\n${log}`, nonce)).toMatchObject({ status: "clear", provenance: "session_probe", walls: [] });
    const failed = observeSessionCapability(probe(false), nonce);
    expect(failed).toMatchObject({ status: "wall", provenance: "session_probe", walls: [{ wallClass: "workspace_write" }] });
    expect(JSON.stringify(failed)).not.toContain(nonce);
    expect(observeSessionCapability(probe(false, "foreign"), nonce)).toMatchObject({ status: "unknown", provenance: "unattributed", walls: [] });
    expect(observeSessionCapability(JSON.stringify({ probe: "session-capability/v1", nonce, ok: false, checks: [{ name: "unknown", ok: false }] }), nonce)).toMatchObject({ status: "unknown", walls: [] });
  });
  it("bounds and sanitizes retained operation diagnostics", () => {
    const view = observeSessionCapability(claude("arcadia agent-ask preview", `${denial} secret ghp_${"x".repeat(35)}\u001b[31m @operator ${"x".repeat(2000)}`), null);
    const text = JSON.stringify(view);
    expect(text).not.toContain("ghp_"); expect(text).not.toContain("\\u001b"); expect(text).not.toContain("x".repeat(301)); expect(text.length).toBeLessThan(1600);
    expect(view).toMatchObject({ provenance: "failed_tool_operation", status: "wall" });
  });
});
