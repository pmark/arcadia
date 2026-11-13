import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TodoItemPage from "../app/todo/[kind]/[...id]/page";

const mocks = vi.hoisted(() => ({
  retry: [] as Array<() => void>,
  stateRefresh: vi.fn(),
  cardRefresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ kind: "decision", id: ["site", "0003"] }) }));
vi.mock("./mobile-shell", () => ({ MobileShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("./decision-answer", () => ({ DecisionAnswerView: () => null }));
vi.mock("./todo-views", () => ({
  TodoItemView: (props: { onRetry?: () => void }) => { if (props.onRetry) mocks.retry.push(props.onRetry); return null; }
}));
vi.mock("../hooks/use-approvals", () => ({
  useApprovals: () => ({ approvals: [], source: "todo", pendingId: null, act: vi.fn(), message: null, error: null, note: null, hasLoaded: false, refresh: mocks.stateRefresh })
}));
vi.mock("../hooks/use-decision-cards", () => ({
  useDecisionCards: () => ({ views: [], refused: [], pendingId: null, outcomes: {}, press: vi.fn(), loaded: false, readFailed: true, decision: null, lastDecision: null, refresh: mocks.cardRefresh })
}));

beforeEach(() => {
  mocks.retry.length = 0;
  mocks.stateRefresh.mockClear();
  mocks.cardRefresh.mockClear();
});

describe("the Decision page's State unknown Retry", () => {
  it("re-reads the card as well as the state", () => {
    renderToStaticMarkup(<TodoItemPage />);
    expect(mocks.retry.length).toBeGreaterThan(0);
    mocks.retry.at(-1)?.();
    expect(mocks.cardRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.stateRefresh).toHaveBeenCalledTimes(1);
  });
});
