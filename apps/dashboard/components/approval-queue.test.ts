import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The dashboard has no DOM test harness, so this guards the one property that
// matters for /runs load time: the slow /api/approvals call must stay behind
// the collapsed section instead of firing on mount.
const source = readFileSync(new URL("./approval-queue.tsx", import.meta.url), "utf8");

describe("ApprovalQueue lazy loading", () => {
  it("starts collapsed", () => {
    expect(source).toMatch(/const \[open, setOpen\] = useState\(false\)/);
  });

  it("only fetches and polls while open", () => {
    const effect = source.slice(source.indexOf("useEffect(() => {"));
    expect(effect).toMatch(/if \(!open\) return undefined;\s+void refresh\(\);/);
    expect(effect).toMatch(/\[open, refresh\]/);
  });
});
