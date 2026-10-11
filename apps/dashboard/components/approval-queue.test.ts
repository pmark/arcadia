import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-level guards for the property the operator asked for: the
// Accept/Reject buttons load on mount at the top of /runs, and collapsing the
// section stops its poll. The card and the poll now live in shared modules
// (todo-card.tsx, use-approvals.ts) that /todo also uses.
const source = readFileSync(new URL("./approval-queue.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/use-approvals.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("./todo-card.tsx", import.meta.url), "utf8");

describe("ApprovalQueue loading", () => {
  it("starts open, so its buttons load with the page", () => {
    expect(source).toMatch(/const \[open, setOpen\] = useState\(true\)/);
  });

  it("only fetches and polls while open", () => {
    expect(source).toMatch(/useApprovals\(\{ enabled: open, refreshSignal \}\)/);
    const effect = hook.slice(hook.indexOf("useEffect(() => {"));
    expect(effect).toMatch(/if \(!enabled\) return undefined;\s+void refresh\(\);/);
    expect(effect).toMatch(/\[enabled, refresh, refreshSignal\]/);
    expect(hook).toContain("export const APPROVAL_POLL_MS = 15_000;");
  });
});

describe("ApprovalQueue read-only rows and notes", () => {
  it("renders a note when the list is degraded, and gives read-only rows no settle controls", () => {
    expect(source).toMatch(/\{note \? <p role="status"/);
    expect(card).toContain("<ReadOnlyAnswer approval={approval} />");
    // Both settle control branches sit behind the readOnly guard.
    expect(card).toMatch(/\{approval\.readOnly \? null : approval\.buildPacket \? \(/);
    expect(card).toMatch(/\) : approval\.kind === "decision" \? \(/);
  });

  it("counts only live rows in the heading and folds stale rows into a collapsed group using the same card", () => {
    expect(source).toContain("To-do{hasLoaded ? ` (${liveApprovals.length})` : \"\"}");
    expect(source).toContain("{staleApprovals.map(renderCard)}");
    expect(source).toMatch(/<details className="mt-4">[\s\S]*Stale \(\{staleApprovals\.length\}\)/);
  });

  it("shares the TodoCard with /todo and never hardcodes a recommendation", () => {
    expect(source).toContain("<TodoCard");
    expect(card).not.toContain("Recommended: accept");
    expect(card).not.toMatch(/unless the details below change your mind/);
  });
});
