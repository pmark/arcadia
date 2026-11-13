import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDecisionCards } from "./use-decision-cards";

afterEach(() => { vi.restoreAllMocks(); });

describe("useDecisionCards refresh", () => {
  it("returns a refresh that re-reads the same card URL on demand", async () => {
    const url = "/api/todo-item/decision?project=site&id=0003";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ cards: [], refused: [], decision: null }), { status: 200 }));
    let hook: ReturnType<typeof useDecisionCards> | undefined;
    function Consumer() { hook = useDecisionCards({ url }); return null; }
    renderToStaticMarkup(<Consumer />);
    // Server rendering runs no effects, so the only read so far is the one the test asks for.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(typeof hook?.refresh).toBe("function");
    await hook?.refresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(url);
  });
});
