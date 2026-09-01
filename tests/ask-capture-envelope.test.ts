import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureAskEnvelope } from "../src/ask/captureEnvelope.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Ask capture envelope", () => {
  it("preserves submitted URLs and only proposes a known wrapper target", () => {
    const workspace = initializedWorkspace();
    const submitted = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Foriginal%3Fx%3D1";
    const envelope = withDatabase(workspace, (db) => captureAskEnvelope(db, {
      requestId: "url-request",
      originalText: `Review ${submitted} and https://unreadable.invalid/item.`,
      ingressSource: "dashboard.ask"
    }));

    expect(envelope.submittedUrls).toEqual([submitted, "https://unreadable.invalid/item"]);
    expect(envelope.canonicalLinkCandidates).toEqual([{
      submittedUrl: submitted,
      canonicalCandidate: "https://example.com/original?x=1",
      reason: "Known Google URL wrapper parameter; not fetched or verified."
    }]);
    expect(envelope.authority).toBe("untrusted_input");
  });

  it("creates byte-stable receipts for duplicate and unsafe original filenames", () => {
    const workspace = initializedWorkspace();
    const fileRoot = trackedRoot("arcadia-capture-files-");
    const first = path.join(fileRoot, "first.txt");
    const second = path.join(fileRoot, "second.bin");
    writeFileSync(first, "same name, first bytes", "utf8");
    writeFileSync(second, Buffer.from([0, 1, 2, 3]));
    const input = {
      requestId: "attachment-request",
      originalText: "Process both files.",
      ingressSource: "dashboard.ingress",
      attachments: [
        { path: first, originalFilename: "../notes.txt", storageReference: "outside-git/001-notes.txt" },
        { path: second, originalFilename: "../notes.txt", storageReference: "outside-git/002-notes.txt" }
      ]
    };

    const firstEnvelope = withDatabase(workspace, (db) => captureAskEnvelope(db, input));
    const retriedEnvelope = withDatabase(workspace, (db) => captureAskEnvelope(db, input));

    expect(retriedEnvelope).toEqual(firstEnvelope);
    expect(firstEnvelope.attachments.map((attachment) => attachment.originalFilename)).toEqual(["../notes.txt", "../notes.txt"]);
    expect(firstEnvelope.attachments[0]).toMatchObject({ mediaType: "text/plain", proposedRole: "project_text", derivationStatus: "completed" });
    expect(firstEnvelope.attachments[1]).toMatchObject({ mediaType: "application/octet-stream", proposedRole: "reference_attachment", derivationStatus: "unavailable" });
    expect(firstEnvelope.attachments.every((attachment) => /^[a-f0-9]{64}$/.test(attachment.sha256))).toBe(true);
    expect(firstEnvelope.derivations.filter((item) => item.processor === "metadata_extraction")).toHaveLength(2);
    expect(firstEnvelope.derivations.find((item) => item.processor === "text_extraction" && item.status === "completed")?.result)
      .toEqual({ text: "same name, first bytes" });
    expect(firstEnvelope.derivations.some((item) => item.status === "unavailable")).toBe(true);
  });

  it("rejects a changed retry for the same submitted request id", () => {
    const workspace = initializedWorkspace();
    withDatabase(workspace, (db) => captureAskEnvelope(db, {
      requestId: "same-request",
      originalText: "Original",
      ingressSource: "dashboard.ask"
    }));
    expect(() => withDatabase(workspace, (db) => captureAskEnvelope(db, {
      requestId: "same-request",
      originalText: "Changed",
      ingressSource: "dashboard.ask"
    }))).toThrow("already submitted with different content");
  });
});

function initializedWorkspace(): string {
  const workspace = trackedRoot("arcadia-capture-workspace-");
  initWorkspace(workspace);
  return workspace;
}

function trackedRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
