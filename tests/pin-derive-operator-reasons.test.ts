import { describe, expect, it } from "vitest";
import { operatorReasons } from "../src/operatorActions/startRunDerive.js";

const action = (decisions?: string[], references?: string[]) =>
  ({ id: "a", status: "ready", dependsOn: [], criteriaErrors: [], decisions, references });

describe("operatorReasons", () => {
  it("names each unanswered cited Decision, in citation order", () => {
    expect(operatorReasons(action(["0300", "0100", "0200"]), ["0100"])).toEqual([
      "cites unanswered Decision 0300",
      "cites unanswered Decision 0200",
    ]);
  });

  it("returns nothing when every cited Decision is answered", () => {
    expect(operatorReasons(action(["0300", "0100"]), ["0100", "0300"])).toEqual([]);
  });

  it("returns nothing when the Action cites no Decision or leaves decisions absent", () => {
    expect(operatorReasons(action([]), ["0100"])).toEqual([]);
    expect(operatorReasons(action(undefined), [])).toEqual([]);
  });

  it("does not stop for referenced authority paths when no Decision is cited", () => {
    expect(operatorReasons(action(undefined, [".github/workflows/ci.yml", "CONSTITUTION.md"]), [])).toEqual([]);
  });
});
