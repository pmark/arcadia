"use client";

import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode, type RefObject } from "react";
import { copyText, type CopyOutcome } from "../lib/copy-text";

type CopyableCodeBlockProps = Omit<ComponentPropsWithoutRef<"pre">, "children"> & {
  /** The full text placed on the clipboard. */
  text: string;
  /** What the block displays; defaults to `text`. */
  children?: ReactNode;
  preRef?: RefObject<HTMLPreElement | null>;
};

/** A `<pre>` with a Copy button above it: 44px tap target, fixed label width, no layout shift. */
export function CopyableCodeBlock({ text, children, preRef, ...preProps }: CopyableCodeBlockProps) {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const local = useRef<HTMLPreElement | null>(null);
  const target = preRef ?? local;
  const copy = async () => {
    const result = await copyText(text);
    if (result === "select" && target.current) {
      const range = document.createRange();
      range.selectNodeContents(target.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setOutcome(result);
    setTimeout(() => setOutcome(null), 2500);
  };
  return (
    <div className="min-w-0">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void copy()}
          data-testid="copy-code-block"
          className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-md border border-line px-3 text-xs font-semibold text-ink transition hover:border-steel"
        >
          {outcome === "copied" ? "Copied" : outcome === "select" ? "Select and copy" : "Copy"}
        </button>
      </div>
      <pre ref={target} {...preProps}>{children ?? text}</pre>
      <span role="status" className="sr-only">{outcome === "copied" ? "Copied to clipboard" : outcome === "select" ? "Copy failed; text selected, copy it manually" : ""}</span>
    </div>
  );
}
