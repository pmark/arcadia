import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shortcutBase = path.join(
  repositoryRoot,
  "scripts",
  "apple",
  "Send Thundertonk Recording to Arcadia (iPhone-iPad).shortcut"
);

describe("Thundertonk iOS Shortcut", () => {
  it("ships a signed, repeat-safe artifact with reproducible source", () => {
    const signed = readFileSync(shortcutBase);
    const source = readFileSync(`${shortcutBase}.plist`, "utf8");
    const builder = path.join(repositoryRoot, "scripts", "apple", "build-thundertonk-ios-shortcut");

    expect(signed.subarray(0, 4).toString("ascii")).toBe("AEA1");
    expect(source).toContain("yyyy-MM-dd-HHmmss-SSS");
    expect(source).toContain("<key>WFDate</key>");
    expect(source).toContain("<string>Date</string>");
    expect(source).toContain("Thundertonk practice ￼.m4a");
    expect(source).toContain("<key>{21, 1}</key>");
    expect(source).toContain("<string>iCloudIdeas/In/</string>");
    expect(source).toContain("<key>WFSaveFileOverwrite</key>\n\t\t\t\t<false/>");
    expect(statSync(builder).mode & 0o111).not.toBe(0);
  });
});
