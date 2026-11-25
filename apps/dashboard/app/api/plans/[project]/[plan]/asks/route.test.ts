import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ previewAgentAsk: vi.fn(), settlePendingAgentAsk: vi.fn() }));
const server = vi.hoisted(() => ({ resolvePlanTarget: vi.fn(), loadPlanAsks: vi.fn() }));

vi.mock("../../../../../../lib/arcadia-cli", async () => {
  const actual = await vi.importActual<typeof import("../../../../../../lib/arcadia-cli")>("../../../../../../lib/arcadia-cli");
  return { ...actual, ...cli };
});
vi.mock("../../../../../../lib/plans-server", async () => {
  const actual = await vi.importActual<typeof import("../../../../../../lib/plans-server")>("../../../../../../lib/plans-server");
  return { ...actual, ...server };
});

import { GET, POST } from "./route";
import { planAskRequestId } from "../../../../../../lib/plan-picker-actions";

const context = { params: Promise.resolve({ project: "arcadia", plan: "plan-g" }) };
const post = (body: unknown) => POST(new Request("http://127.0.0.1/api/plans/arcadia/plan-g/asks", { method: "POST", body: JSON.stringify(body) }), context);

beforeEach(() => {
  vi.clearAllMocks();
  server.resolvePlanTarget.mockResolvedValue({ project: "arcadia", plan: "plan-g" });
  cli.previewAgentAsk.mockImplementation(async (ask: { request_id: string }) => ({
    ok: true, command: "agent-ask.preview", workspace: "w", artifacts: [], warnings: [],
    data: { proposal: { id: "agentask_abc", fingerprint: "f", normalized: { requestId: ask.request_id }, effects: [{ operation: "create", targetKind: "proposal", targetRef: "plan/plan-g" }] }, replayed: false, projectWritesPerformed: 0 }
  }));
});

describe("/api/plans/[project]/[plan]/asks", () => {
  it("check composes the Annotate Ask and shows its consequence and effects without recording anything", async () => {
    const requestId = planAskRequestId("annotate", "plan-g");
    const response = await post({ mode: "check", kind: "annotate", text: "Revisit after Plan F.", requestId });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.consequence).toMatch(/^Records your note on plan-g .*changes no Plan, queue or status\.$/);
    expect(body.ask).toMatchObject({ intent: "proposal", project: "arcadia", target_ref: "plan/plan-g", request_id: requestId, requested_authority: "propose" });
    // Arcadia's own effect wording, as `agent-ask pending` prints it; a proposal settles as evidence only.
    expect(body.effects).toEqual(["update proposal plan/plan-g"]);
    expect(cli.previewAgentAsk).not.toHaveBeenCalled();
  });

  it("check shows Request change as a targeted Plan amendment with its effects before submission", async () => {
    const response = await post({ mode: "check", kind: "request-change", text: "Split the second Action.", requestId: planAskRequestId("request-change", "plan-g") });
    const body = await response.json();
    expect(body.ask).toMatchObject({ intent: "plan", target_ref: "plan/plan-g", desired_result: "Split the second Action." });
    expect(body.effects).toEqual(["update plan plan/plan-g"]);
    expect(body.consequence).toMatch(/nothing changes until the operator settles it/);
    expect(cli.previewAgentAsk).not.toHaveBeenCalled();
  });

  it("submit records the same Ask through agent-ask preview once and never settles it", async () => {
    const requestId = planAskRequestId("annotate", "plan-g");
    const response = await post({ mode: "submit", kind: "annotate", text: "Revisit after Plan F.", requestId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "submit", proposalId: "agentask_abc", requestId });
    expect(cli.previewAgentAsk).toHaveBeenCalledTimes(1);
    expect(cli.previewAgentAsk.mock.calls[0][0]).toMatchObject({ intent: "proposal", target_ref: "plan/plan-g", request_id: requestId });
    expect(cli.settlePendingAgentAsk).not.toHaveBeenCalled();
  });

  it("refuses Queue next and Archive, which have no governed Ask yet, so a tap changes no queue or status", async () => {
    for (const kind of ["queue-next", "archive"]) {
      const response = await post({ mode: "submit", kind, text: "x", requestId: `workspace-${kind}-plan-g-1` });
      expect(response.status).toBe(400);
    }
    expect(cli.previewAgentAsk).not.toHaveBeenCalled();
    expect(cli.settlePendingAgentAsk).not.toHaveBeenCalled();
  });

  it("refuses an empty note and a request id this page did not make", async () => {
    expect((await post({ mode: "check", kind: "annotate", text: " ", requestId: planAskRequestId("annotate", "plan-g") })).status).toBe(400);
    expect((await post({ mode: "check", kind: "annotate", text: "x", requestId: "settle-anything" })).status).toBe(400);
    expect((await post({ mode: "check", kind: "annotate", text: "x", requestId: planAskRequestId("request-change", "plan-g") })).status).toBe(400);
  });

  it("GET lists the Plan's Asks read for its own Project", async () => {
    server.loadPlanAsks.mockResolvedValue([{ proposalId: "agentask_1", state: "previewed" }]);
    const response = await GET(new Request("http://127.0.0.1/api/plans/arcadia/plan-g/asks"), context);
    expect(await response.json()).toEqual({ project: "arcadia", plan: "plan-g", asks: [{ proposalId: "agentask_1", state: "previewed" }] });
    expect(server.loadPlanAsks).toHaveBeenCalledWith("arcadia", "plan-g");
  });
});

describe("no route under the picker settles an Ask", () => {
  const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  const repo = path.resolve(dashboard, "../..");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
  const files = [
    ...walk(path.join(dashboard, "app/api/plans")),
    ...walk(path.join(dashboard, "app/workspace/plans")),
    ...walk(path.join(dashboard, "components/workspace/plans")),
    path.join(dashboard, "lib/plan-picker.ts"),
    path.join(dashboard, "lib/plan-picker-actions.ts"),
    path.join(repo, "src/plans/planAsks.ts")
  ];
  it.each(files.map((file) => [path.relative(repo, file), file]))("%s never calls agent-ask settle --apply", (_name, file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/["'`]settle["'`]|--apply|settlePendingAgentAsk|settleAgentAsk|runAgentAskSettleCommand/);
  });
  it("covers the picker's own route", () => {
    expect(files.some((file) => file.endsWith(path.join("asks", "route.ts")))).toBe(true);
  });
});
