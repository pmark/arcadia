import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./markdown-body";
describe("Markdown body", () => {
  it("renders GFM and retains text without running embedded HTML or unsafe URLs", () => {
    const html = renderToStaticMarkup(<MarkdownBody text={"## Authority\nA **draft**. `code`\n\n| State | Effect |\n| --- | --- |\n| Inactive | None |\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))"} />);
    expect(html).toContain("<strong>draft</strong>"); expect(html).toContain("<table>"); expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<script>"); expect(html).not.toContain('href="javascript:');
  });
});
