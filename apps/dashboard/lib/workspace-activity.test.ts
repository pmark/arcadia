import { describe, expect, it } from "vitest";
import { activityLabel, activityMessage, navigationTarget } from "./workspace-activity";

const here = { origin: "http://arcadia", pathname: "/workspace" };
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, target = "", download = false) => ({ href, target, hasAttribute: (name: string) => name === "download" && download });

describe("workspace activity", () => {
  it("names what's opening in the operator's words", () => {
    expect(activityLabel("/workspace/feed")).toBe("what's waiting");
    expect(activityLabel("/workspace/projects/a")).toBe("this Project");
    expect(activityLabel("/workspace/projects/a/plans/b")).toBe("this Plan");
    expect(activityLabel("/workspace/projects/a/plans/b/actions/c")).toBe("this Action");
    expect(activityLabel("/todo/decision/p/0053")).toBe("this Decision");
    expect(activityLabel("/todo")).toBe("your to-do list");
    expect(activityLabel("/production")).toBe("Production");
    expect(activityLabel("/somewhere-new")).toBe("that page");
  });

  it("says the tap was received once a page has been slow for a while", () => {
    expect(activityMessage("this Plan", false)).toBe("Opening this Plan...");
    expect(activityMessage("this Plan", true)).toContain("Your tap was received");
  });

  it("counts links that navigate to another page in this tab", () => {
    expect(navigationTarget(link("http://arcadia/workspace/feed"), plain, here)).toBe("/workspace/feed");
    expect(navigationTarget(link("http://arcadia/todo", "_self"), plain, here)).toBe("/todo");
  });

  it("ignores links that don't leave this page in this tab", () => {
    expect(navigationTarget(link("http://arcadia/workspace"), plain, here)).toBeNull();
    expect(navigationTarget(link("http://arcadia/workspace#context"), plain, here)).toBeNull();
    expect(navigationTarget(link("https://github.com/pmark/arcadia"), plain, here)).toBeNull();
    expect(navigationTarget(link("http://arcadia/todo", "_blank"), plain, here)).toBeNull();
    expect(navigationTarget(link("http://arcadia/file", "", true), plain, here)).toBeNull();
    expect(navigationTarget(link("not a url"), plain, here)).toBeNull();
  });

  it("ignores clicks that open a new tab or window", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) expect(navigationTarget(link("http://arcadia/todo"), { ...plain, [key]: true }, here)).toBeNull();
    expect(navigationTarget(link("http://arcadia/todo"), { ...plain, button: 1 }, here)).toBeNull();
  });
});
