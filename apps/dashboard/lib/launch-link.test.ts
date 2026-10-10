import { describe, expect, it } from "vitest";
import { buildApprovals } from "./approvals";
import type { OperatorTodoItem } from "./arcadia-cli";
import { decideLaunchLink, launchHrefOf, parseLaunchParam, resolveLaunchLink } from "./launch-link";
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

describe("decideLaunchLink", () => {
  const actions = [action("arcadia/ready", true), action("arcadia/waiting", false, "Waits.")];
  const base = { key: "arcadia/ready", handledKey: null, actions, queueFresh: false, askedFresh: false };

  it("opens once: a handled key is idle", () => {
    expect(decideLaunchLink(base)).toMatchObject({ kind: "open" });
    expect(decideLaunchLink({ ...base, handledKey: "arcadia/ready" })).toEqual({ kind: "idle" });
  });
  it("waits for the queue and for a key", () => {
    expect(decideLaunchLink({ ...base, actions: null })).toEqual({ kind: "idle" });
    expect(decideLaunchLink({ ...base, key: null })).toEqual({ kind: "idle" });
  });
  it("stale then fresh: a negative verdict from a possibly cached read asks for a fresh one, then the fresh read decides", () => {
    const missing = { ...base, key: "arcadia/new" };
    expect(decideLaunchLink(missing)).toEqual({ kind: "refresh" });
    expect(decideLaunchLink({ ...missing, askedFresh: true })).toEqual({ kind: "idle" });
    expect(decideLaunchLink({ ...missing, queueFresh: true })).toMatchObject({ kind: "warn" });
    expect(decideLaunchLink({ ...missing, queueFresh: true, actions: [...actions, action("arcadia/new", true)] })).toMatchObject({ kind: "open" });
  });
  it("a changed key is handled again", () => {
    expect(decideLaunchLink({ ...base, key: "arcadia/waiting", handledKey: "arcadia/ready", queueFresh: true })).toMatchObject({ kind: "warn" });
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
