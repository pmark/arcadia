import { describe, it } from "vitest";
import { expectManagedDocumentsContract } from "./helpers/managedDocumentsContract.js";

/**
 * The repository's managed documents are Arcadia's control plane. A fixture
 * test proves parser behavior, but it cannot catch malformed frontmatter or a
 * dangling pointer introduced by editing the real plan files. Keep this small,
 * deterministic contract in the normal suite so main never becomes unable to
 * explain what Action comes next. A finished active Plan whose successor is
 * not yet activated (Issue #2147) explains that by itself: nothing comes next
 * until `arcadia go` or the production tick activates the queued successor.
 */
describe("checked-in Arcadia control documents", () => {
  it("parse without errors and resolve one current Action", () => {
    expectManagedDocumentsContract(process.cwd(), "arcadia");
  });
});
