import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyableCodeBlock } from "../components/copyable-code-block";
import { copyText } from "./copy-text";

type FakeArea = { value: string; style: { cssText: string }; setAttribute: () => void; focus: () => void; select: () => void; setSelectionRange: () => void };

function stubBrowser(options: { secure: boolean; clipboard?: { writeText: (text: string) => Promise<void> }; execCommand?: () => boolean }) {
  const area: FakeArea = { value: "", style: { cssText: "" }, setAttribute: () => undefined, focus: () => undefined, select: vi.fn(), setSelectionRange: () => undefined };
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  const execCommand = vi.fn(options.execCommand ?? (() => true));
  vi.stubGlobal("window", { isSecureContext: options.secure });
  vi.stubGlobal("navigator", { clipboard: options.clipboard });
  vi.stubGlobal("document", { createElement: () => area, body, execCommand });
  return { area, body, execCommand };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the async clipboard in a secure context", async () => {
    const writeText = vi.fn(async () => undefined);
    const { execCommand } = stubBrowser({ secure: true, clipboard: { writeText } });
    await expect(copyText("full receipt")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("full receipt");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a hidden textarea and execCommand over plain http", async () => {
    const writeText = vi.fn(async () => undefined);
    const { area, body, execCommand } = stubBrowser({ secure: false, clipboard: undefined });
    await expect(copyText("full receipt")).resolves.toBe("copied");
    expect(writeText).not.toHaveBeenCalled();
    expect(area.value).toBe("full receipt");
    expect(area.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(body.removeChild).toHaveBeenCalledWith(area);
  });

  it("falls back when the secure clipboard write is refused", async () => {
    const { execCommand } = stubBrowser({ secure: true, clipboard: { writeText: async () => { throw new Error("denied"); } } });
    await expect(copyText("x")).resolves.toBe("copied");
    expect(execCommand).toHaveBeenCalled();
  });

  it("reports select when every path fails, never claiming Copied", async () => {
    stubBrowser({ secure: false, execCommand: () => false });
    await expect(copyText("x")).resolves.toBe("select");
    stubBrowser({ secure: false, execCommand: () => { throw new Error("unsupported"); } });
    await expect(copyText("x")).resolves.toBe("select");
  });
});

describe("CopyableCodeBlock", () => {
  it("renders a 44px Copy button above the pre with its classes preserved", () => {
    const html = renderToStaticMarkup(<CopyableCodeBlock text="{}" className="mt-2 text-xs" />);
    expect(html).toContain("min-h-11");
    expect(html).toContain(">Copy</button>");
    expect(html).toContain('<pre class="mt-2 text-xs">{}</pre>');
  });
});
