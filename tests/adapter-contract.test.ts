import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

const contractPath = path.resolve("docs", "ADAPTER_CONTRACT.md");

describe("adapter contract", () => {
  it("keeps documented JSON examples valid", () => {
    const contract = readFileSync(contractPath, "utf8");
    const jsonBlocks = [...contract.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);

    expect(jsonBlocks.length).toBeGreaterThan(0);
    for (const block of jsonBlocks) {
      expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  it("documents the stable ingress commands without legacy Requires Review wording", () => {
    const contract = readFileSync(contractPath, "utf8");

    for (const command of [
      "arcadia init <workspace>",
      'arcadia ask "<intent>"',
      "arcadia status",
      "arcadia review",
      "arcadia review show <id>",
      "arcadia review approve <id>",
      "arcadia review reject <id>",
      "arcadia review defer <id>",
      'arcadia dogfood ask "<intent>"',
      "arcadia dogfood status",
      "arcadia dogfood review",
      "arcadia dogfood review approve <id>"
    ]) {
      expect(contract).toContain(command);
    }

    expect(contract).toContain("Requires Review");
    expect(contract).not.toContain("needs_mark");
    expect(contract).not.toContain("Needs Mark");
  });

  it("aligns help output with supported daily commands and compatibility shortcuts", () => {
    const program = buildProgram();
    const rootHelp = program.helpInformation();
    const dogfood = program.commands.find((command) => command.name() === "dogfood");
    const review = program.commands.find((command) => command.name() === "review");

    expect(rootHelp).toContain("ask");
    expect(rootHelp).toContain("status");
    expect(rootHelp).toContain("review");
    expect(rootHelp).toContain("dogfood");
    expect(rootHelp).not.toContain("Needs Mark");
    expect(rootHelp).not.toContain("needs_mark");

    const dogfoodHelp = dogfood?.helpInformation() ?? "";
    expect(dogfoodHelp).toContain("Compatibility shortcuts");
    expect(dogfoodHelp).toContain("status");
    expect(dogfoodHelp).toContain("review");
    expect(dogfoodHelp).toContain("ask");
    expect(dogfoodHelp).toContain(".arcadia-workspace");
    expect(dogfoodHelp).not.toContain("dogfooding");
    expect(dogfoodHelp).not.toContain("Needs Mark");
    expect(dogfoodHelp).not.toContain("needs_mark");

    const reviewHelp = review?.helpInformation() ?? "";
    expect(reviewHelp).toContain("show");
    expect(reviewHelp).toContain("approve");
    expect(reviewHelp).toContain("reject");
    expect(reviewHelp).toContain("defer");
    expect(reviewHelp).toContain("--workspace <path>");
    expect(reviewHelp).toContain("Requires Review");
    expect(reviewHelp).not.toContain("Needs Mark");
    expect(reviewHelp).not.toContain("needs_mark");
  });
});
