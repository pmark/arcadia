import { describe, expect, it } from "vitest";
import { splitActionKey } from "../src/journey/derive.js";

describe("splitActionKey", () => {
  it("splits a project/action key into its two parts", () => {
    expect(splitActionKey("arcadia/pin-x")).toEqual(["arcadia", "pin-x"]);
  });

  it.each(["arcadia", "a/b/c", "a /b", ""])("refuses the malformed key %j", (key) => {
    expect(() => splitActionKey(key)).toThrow("Expected <project>/<action>");
  });
});
