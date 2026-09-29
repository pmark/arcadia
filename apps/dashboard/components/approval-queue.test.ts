import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The dashboard has no DOM test harness, so this guards the property the
// operator asked for: the Accept/Reject buttons load on mount at the top of
// /runs, and collapsing the section stops its poll.
const source = readFileSync(new URL("./approval-queue.tsx", import.meta.url), "utf8");

describe("ApprovalQueue loading", () => {
  it("starts open, so its buttons load with the page", () => {
    expect(source).toMatch(/const \[open, setOpen\] = useState\(true\)/);
  });

  it("only fetches and polls while open", () => {
    const effect = source.slice(source.indexOf("useEffect(() => {"));
    expect(effect).toMatch(/if \(!open\) return undefined;\s+void refresh\(\);/);
    expect(effect).toMatch(/\[open, refresh, refreshSignal\]/);
  });
});
