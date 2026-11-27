import { describe, expect, it } from "vitest";

import { parseImageDimensions, sniffImageMimeType } from "../src/intelligence/artifacts/imageMeta.js";

const PNG = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(PNG);
PNG.writeUInt32BE(640, 16);
PNG.writeUInt32BE(480, 20);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, ...Array(9).fill(0)]);
const PROGRESSIVE_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11,
  0x00,
]);
const SCAN_FIRST_JPEG = Buffer.from(JPEG);
SCAN_FIRST_JPEG[3] = 0xda;

describe("sniffImageMimeType", () => {
  it.each([
    ["PNG signature", PNG.subarray(0, 8), "image/png"],
    ["ff d8 ff", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"],
    ["GIF87a", Buffer.from("GIF87a", "latin1"), "image/gif"],
    ["GIF89a", Buffer.from("GIF89a", "latin1"), "image/gif"],
    ["RIFF0000WEBP", Buffer.from("RIFF0000WEBP", "latin1"), "image/webp"],
    ["GIF88a", Buffer.from("GIF88a", "latin1"), "application/octet-stream"],
    ["RIFF0000WAVE", Buffer.from("RIFF0000WAVE", "latin1"), "application/octet-stream"],
    ["ff d8", Buffer.from([0xff, 0xd8]), "application/octet-stream"],
    ["an empty buffer", Buffer.alloc(0), "application/octet-stream"],
  ])("names %s as %j", (_label, bytes, mimeType) => {
    expect(sniffImageMimeType(bytes)).toBe(mimeType);
  });
});

describe("parseImageDimensions", () => {
  it.each([
    ["a 24-byte PNG", PNG, { width: 640, height: 480 }],
    ["the PNG cut to 23 bytes", PNG.subarray(0, 23), undefined],
    ["a baseline JPEG", JPEG, { width: 640, height: 480 }],
    ["a progressive JPEG after APP0", PROGRESSIVE_JPEG, { width: 32, height: 16 }],
    ["a JPEG whose scan starts before any frame", SCAN_FIRST_JPEG, undefined],
    ["a GIF", Buffer.from("GIF89a.....", "latin1"), undefined],
  ])("reads %s", (_label, bytes, dimensions) => {
    expect(parseImageDimensions(bytes)).toEqual(dimensions);
  });
});
