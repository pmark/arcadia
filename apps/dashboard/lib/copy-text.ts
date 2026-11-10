export type CopyOutcome = "copied" | "select";

/**
 * Copy text for the operator, honestly. `navigator.clipboard` exists only in a
 * secure context, and the dashboard is opened over the Tailnet as plain http,
 * so fall back to a hidden textarea and `execCommand("copy")`. When both fail
 * the caller gets "select" and should select the text for a manual copy.
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Permission or focus refusal: try the legacy path next.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px";
  document.body.appendChild(area);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy") ? "copied" : "select";
  } catch {
    return "select";
  } finally {
    document.body.removeChild(area);
  }
}
