import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ resolveDashboardWorkspace: vi.fn() }));
vi.mock("./arcadia-cli", () => cli);

import { GET } from "../app/api/sessions/[id]/log/route";
import { INITIAL_TAIL_BYTES, readSessionLogTail } from "./session-log";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "arcadia-session-log-"));
  mkdirSync(path.join(workspace, ".arcadia", "sessions"), { recursive: true });
  cli.resolveDashboardWorkspace.mockResolvedValue(workspace);
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

function logFile(id: string): string {
  return path.join(workspace, ".arcadia", "sessions", `${id}.log`);
}

async function get(id: string, offset?: number) {
  const query = offset === undefined ? "" : `?offset=${offset}`;
  const response = await GET(new Request(`http://arcadia.test/api/sessions/${id}/log${query}`), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

describe("Session log tail", () => {
  it("answers available: false, not an error, when the Session wrote no log", async () => {
    const { status, body } = await get("sess-none");
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, path: ".arcadia/sessions/sess-none.log", text: "" });
  });

  it("returns the whole small log, then only what was appended after the offset", async () => {
    writeFileSync(logFile("sess-1"), "line one\n");
    const first = await get("sess-1");
    expect(first.body).toMatchObject({ available: true, text: "line one\n", size: 9, from: 0, truncated: false });

    appendFileSync(logFile("sess-1"), "line two\n");
    const second = await get("sess-1", first.body.size);
    expect(second.body).toMatchObject({ text: "line two\n", from: 9, size: 18, reset: false });

    const idle = await get("sess-1", second.body.size);
    expect(idle.body.text).toBe("");
  });

  it("starts a long log at its tail and says so", async () => {
    writeFileSync(logFile("sess-big"), "x".repeat(INITIAL_TAIL_BYTES + 100));
    const { body } = await get("sess-big");
    expect(body.truncated).toBe(true);
    expect(body.text.length).toBe(INITIAL_TAIL_BYTES);
  });

  it("resets when the offset is past the end of a replaced file", async () => {
    writeFileSync(logFile("sess-r"), "new\n");
    const { body } = await get("sess-r", 500);
    expect(body).toMatchObject({ reset: true, text: "new\n", from: 0 });
  });

  it("refuses ids that could leave the sessions directory, and bad offsets", async () => {
    expect((await readSessionLogTail(workspace, "../worker", null)).ok).toBe(false);
    expect((await get("..%2Fworker")).status).toBe(400);
    expect((await get("sess-1", -1)).status).toBe(400);
  });
});
