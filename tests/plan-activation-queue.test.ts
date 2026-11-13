import { describe, expect, it } from "vitest";
import { expectedActivationSegment } from "../src/operatorActions/libraryContract.js";
import { planQueueFromDocs } from "../src/operatorActions/planQueue.js";

const action = (id: string, status = "open", dependsOn: string[] = []) => ({ id, status, dependsOn });
const plan = (actions: unknown[], slug = "next-plan", project = "demo") => ({ type: "plan", slug, project, status: "draft", actions });

describe("The activated Plan's queue, read from its live document (#2478)", () => {
  it("reads the named Plan's actions and fails closed when the Plan is missing", () => {
    const docs = [plan([action("first"), action("second", "done")]), { type: "project", slug: "demo" }];
    expect(planQueueFromDocs(docs as never, "demo", "next-plan")).toEqual([action("first"), action("second", "done")]);
    expect(() => planQueueFromDocs(docs as never, "demo", "missing-plan")).toThrow("not readable");
    expect(() => planQueueFromDocs([] as never, "demo", "next-plan")).toThrow("not readable");
  });
  it("expects every non-done Action, in dependency order, prefixed with the Project", () => {
    expect(expectedActivationSegment("demo", [action("later", "open", ["first"]), action("first"), action("done-one", "done")]))
      .toEqual(["demo/first", "demo/later"]);
  });
});
