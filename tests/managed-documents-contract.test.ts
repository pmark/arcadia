import { describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch } from "../src/docs/dispatch.js";

/**
 * The repository's managed documents are Arcadia's control plane. A fixture
 * test proves parser behavior, but it cannot catch malformed frontmatter or a
 * dangling pointer introduced by editing the real plan files. Keep this small,
 * deterministic contract in the normal suite so main never becomes unable to
 * explain what Action comes next.
 */
describe("checked-in Arcadia control documents", () => {
  it("parse without errors and resolve one current Action", () => {
    const repoRoot = process.cwd();
    const discovered = discoverDocs(repoRoot);
    expect(discovered.errors).toEqual([]);
    expect(discovered.rejected).toEqual([]);

    const resolution = resolveDispatch(repoRoot, "arcadia");
    expect(resolution.context).not.toBeNull();
    if (resolution.operatorQuestion) {
      expect(resolution.context?.action.responsibility).toBe("requires_review");
      expect(resolution.context?.action.clarification).toBe("question_open");
      expect(resolution.blockers.every((blocker) => blocker.field === "status")).toBe(true);
    } else if (resolution.context?.action.id === "prove-two-action-unattended-production") {
      // Decision 0057 intentionally defers this Action ("Defer until the next
      // opencode-cli live rehearsal"), so while the pointer still names it,
      // dispatch reports exactly that one blocker. Any other blocker is a
      // regression in the checked-in documents. Once the deferral is applied
      // and the pointer advances, the next branch requires a clean resolution.
      expect(resolution.blockers).toHaveLength(1);
      expect(resolution.blockers[0]).toMatchObject({
        relativePath: "docs/decisions/0057-should-prove-two-action-unattended-production-be-deferred-until-the-next-live.md",
        field: "actions.prove-two-action-unattended-production.status",
        message:
          'Action "prove-two-action-unattended-production" is deferred by Decision 0057; dispatch must not select it.'
      });
    } else {
      expect(resolution.blockers).toEqual([]);
    }
  });
});
