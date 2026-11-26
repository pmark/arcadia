import { describe, expect, it } from "vitest";
import { STANDING_ANSWERS, isStandingGrantAnswered } from "../src/operatorActions/startRunDayGrant.js";

const record = (fields: string, body = "") => `---\n${fields}\n---\n${body}`;
const answered = (answer: string, status = "approved", id = '"0241"') => record(`id: ${id}\nstatus: ${status}\nanswer: ${answer}`);

describe("standing grant answered frontmatter", () => {
  it("lists exactly the three standing answers", () => {
    expect([...STANDING_ANSWERS]).toEqual(["A. Standing grant", "B. Standing grant", "E. Standing grant"]);
  });

  it("reads an approved A or E answer on the quoted id as answered", () => {
    expect(isStandingGrantAnswered(answered("A. Standing grant until stopped"), "0241")).toBe(true);
    expect(isStandingGrantAnswered(answered("E. Standing grant"), "0241")).toBe(true);
  });

  it("does not read other frontmatter as answered", () => {
    expect(isStandingGrantAnswered(answered("C. Daily approval"), "0241")).toBe(false);
    expect(isStandingGrantAnswered(answered("A. Standing grant", "proposed"), "0241")).toBe(false);
    expect(isStandingGrantAnswered(answered("A. Standing grant"), "0240")).toBe(false);
    expect(isStandingGrantAnswered(answered("A. Standing grant", "approved", "0241"), "0241")).toBe(false);
    expect(isStandingGrantAnswered(record('id: "0241"\nstatus: approved', "answer: A. Standing grant"), "0241")).toBe(false);
    expect(isStandingGrantAnswered("answer: A. Standing grant", "0241")).toBe(false);
  });
});
