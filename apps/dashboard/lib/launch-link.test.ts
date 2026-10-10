import { describe, expect, it } from "vitest";
import { buildApprovals } from "./approvals";
import type { OperatorTodoItem } from "./arcadia-cli";
import { launchHrefOf, parseLaunchParam, resolveLaunchLink } from "./launch-link";
import type { ConsoleAction } from "./production-console";

function action(key: string, allowed: boolean, disabledReason: string | null = null): ConsoleAction {
  return { key, title: `Title of ${key}`, why: null, launch: { allowed, needsMakeNext: false, disabledReason } } as unknown as ConsoleAction;
}

describe("parseLaunchParam", () => {
  it("reads <project>/<actionId> from a cold query string", () => {
    expect(parseLaunchParam("?launch=arcadia/a-1")).toBe("arcadia/a-1");
    expect(parseLaunchParam("?x=1&launch=arcadia%2Fa-1")).toBe("arcadia/a-1");
  });
  it("rejects missing, empty and malformed values", () => {
    for (const search of ["", "?launch=", "?launch=arcadia", "?launch=/a", "?launch=arcadia/"]) expect(parseLaunchParam(search)).toBeNull();
  });
  it("round-trips through launchHrefOf", () => {
    const href = launchHrefOf("arcadia/a 1");
    expect(href).toBe("/production?launch=arcadia/a%201");
    expect(parseLaunchParam(href.slice(href.indexOf("?")))).toBe("arcadia/a 1");
  });
});

describe("resolveLaunchLink", () => {
  const actions = [action("arcadia/ready", true), action("arcadia/waiting", false, "Waits on arcadia/ready."), action("arcadia/nowhy", false)];
  it("opens the dialog for a launchable Action", () => {
    expect(resolveLaunchLink(actions, "arcadia/ready")).toMatchObject({ kind: "open", action: { key: "arcadia/ready" } });
  });
  it("says why a non-launchable Action cannot open", () => {
    expect(resolveLaunchLink(actions, "arcadia/waiting")).toEqual({ kind: "unavailable", message: "Title of arcadia/waiting cannot be launched now: Waits on arcadia/ready." });
    expect(resolveLaunchLink(actions, "arcadia/nowhy")).toMatchObject({ kind: "unavailable" });
  });
  it("says so when the Action is not in the queue", () => {
    expect(resolveLaunchLink(actions, "arcadia/gone")).toMatchObject({ kind: "unavailable", message: expect.stringContaining("arcadia/gone") });
  });
});

describe("escalation to-dos", () => {
  it("link to the Launch dialog for their Action; other kinds do not", () => {
    const base = { title: "t", project: "arcadia", blocking: true, createdAt: "2026-10-01", sourceRef: "r", answer: "a" };
    const items = [
      { ...base, key: "escalation:auth:arcadia/act-1", kind: "escalation:auth" },
      { ...base, key: "review_item:arcadia/r1", kind: "review_item" }
    ] as unknown as OperatorTodoItem[];
    const { approvals } = buildApprovals({ asks: [], decisions: [], todo: { items, unavailable: [] } });
    const byKind = Object.fromEntries(approvals.map((a) => [a.kind, a]));
    expect(byKind["escalation:auth"]?.launchHref).toBe("/production?launch=arcadia/act-1");
    expect(byKind.review_item?.launchHref ?? null).toBeNull();
  });
});
