import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  deactivateProduction: vi.fn(),
  previewProductionReactivation: vi.fn(),
  reactivateProduction: vi.fn(),
  loadProductionStatus: vi.fn()
}));

vi.mock("../../../lib/arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode: number;
    details: unknown;
    constructor(message: string, statusCode: number, details: unknown = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  ...cli,
  loadCapacityStatus: vi.fn(),
  loadDispatchJournal: vi.fn(),
  loadScheduleSummary: vi.fn(),
  resolveDashboardWorkspace: vi.fn()
}));
vi.mock("../../../lib/system-status", () => ({ readManagedRunWorker: vi.fn() }));

import { POST } from "./route";

function toggle(action: string): Request {
  return new Request("http://arcadia.test/api/production-control", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ action })
  });
}

const expected = { policyRevision: 29, configurationRevision: 2, fingerprint: "fp-1" };

beforeEach(() => {
  for (const fn of Object.values(cli)) fn.mockReset();
  cli.loadProductionStatus.mockResolvedValue({ data: { read: { policy: null } } });
});

describe("POST /api/production-control On", () => {
  it("reactivates the saved configuration bound to the previewed revisions", async () => {
    cli.previewProductionReactivation.mockResolvedValue({ data: { preview: { ready: true, refusals: [], expected } } });
    cli.reactivateProduction.mockResolvedValue({ data: {} });

    const response = await POST(toggle("activate"));

    expect(response.status).toBe(200);
    expect(cli.reactivateProduction).toHaveBeenCalledTimes(1);
    expect(cli.reactivateProduction.mock.calls[0][0]).toMatchObject({ grantedBy: "dashboard-toggle", expected });
  });

  it("answers 409 with the exact gate, and activates nothing, when nothing was saved", async () => {
    cli.previewProductionReactivation.mockResolvedValue({
      data: {
        preview: {
          ready: false,
          expected: null,
          refusals: [{ code: "no_saved_configuration", reason: "No reviewed configuration was saved.", remedy: "Run preview and activate once." }]
        }
      }
    });

    const response = await POST(toggle("activate"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "No reviewed configuration was saved. Run preview and activate once.",
      details: { conflict: true, code: "no_saved_configuration", remedy: "Run preview and activate once." }
    });
    expect(cli.reactivateProduction).not.toHaveBeenCalled();
  });

  it("answers 409 for drift such as a closed Action instead of narrowing the scope", async () => {
    cli.previewProductionReactivation.mockResolvedValue({
      data: { preview: { ready: false, expected, refusals: [{ code: "action_not_open", reason: "Saved Action(s) are no longer open: demo/migrate.", remedy: "Preview again." }] } }
    });
    const response = await POST(toggle("activate"));
    expect(response.status).toBe(409);
    expect(cli.reactivateProduction).not.toHaveBeenCalled();
  });

  it("relays a refusal raised by the apply step itself as 409", async () => {
    cli.previewProductionReactivation.mockResolvedValue({ data: { preview: { ready: true, refusals: [], expected } } });
    const { ArcadiaCliError } = await import("../../../lib/arcadia-cli");
    cli.reactivateProduction.mockRejectedValue(
      new ArcadiaCliError("Reactivation refused: Production is already Active.", 409, { conflict: true, code: "already_active" })
    );
    const response = await POST(toggle("activate"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ details: { code: "already_active" } });
  });

  it("gives every toggle its own request id, even within one millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T00:00:00.000Z"));
    try {
      cli.previewProductionReactivation.mockResolvedValue({ data: { preview: { ready: true, refusals: [], expected } } });
      cli.reactivateProduction.mockResolvedValue({ data: {} });
      cli.deactivateProduction.mockResolvedValue({ data: {} });

      await POST(toggle("activate"));
      await POST(toggle("activate"));
      await POST(toggle("deactivate"));

      const ids = [
        cli.reactivateProduction.mock.calls[0][0].requestId,
        cli.reactivateProduction.mock.calls[1][0].requestId,
        cli.deactivateProduction.mock.calls[0][0].requestId
      ];
      expect(new Set(ids).size).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a cross-origin toggle before reading anything", async () => {
    const response = await POST(
      new Request("http://arcadia.test/api/production-control", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ action: "activate" })
      })
    );
    expect(response.status).toBe(403);
    expect(cli.previewProductionReactivation).not.toHaveBeenCalled();
  });
});
