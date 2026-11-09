import { describe, expect, it } from "vitest";

import { mimeTypeToExtension } from "../src/intelligence/artifacts/imageMeta.js";

describe("mimeTypeToExtension", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
  ])("maps %j to %j", (mimeType, extension) => {
    expect(mimeTypeToExtension(mimeType)).toBe(extension);
  });

  it.each(["image/svg+xml", "IMAGE/PNG", ""])("falls back to bin for %j", (mimeType) => {
    expect(mimeTypeToExtension(mimeType)).toBe("bin");
  });
});
