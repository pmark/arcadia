"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY_SLOW_MS, activityLabel, activityMessage, navigationTarget } from "../../lib/workspace-activity";

/**
 * Every tap on a link answers at once and says what it's opening, however slow the page is. This
 * only reads clicks: it never changes where a link goes, and it clears when the page changes.
 */
export function WorkspaceActivity() {
  const pathname = usePathname();
  const [label, setLabel] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [tapped, setTapped] = useState(0);
  const pressed = useRef<Element | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor) return;
      const target = navigationTarget(anchor, event, window.location);
      if (!target) return;
      pressed.current?.removeAttribute("data-opening");
      anchor.setAttribute("data-opening", "");
      pressed.current = anchor;
      setSlow(false);
      setLabel(activityLabel(target));
      setTapped(count => count + 1);
    };
    const clear = () => {
      pressed.current?.removeAttribute("data-opening");
      pressed.current = null;
      setLabel(null);
      setSlow(false);
    };
    // Safari only shows :active on touch when a touch listener exists. Coming back from a page restores this one as it was
    // left. Back or Forward before a page arrives abandons that page, and the route may never change, so it clears then too.
    const noop = () => {};
    document.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", noop, { passive: true });
    window.addEventListener("pageshow", clear);
    window.addEventListener("popstate", clear);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("touchstart", noop);
      window.removeEventListener("pageshow", clear);
      window.removeEventListener("popstate", clear);
    };
  }, []);

  // The page changed, so whatever was opening has arrived.
  useEffect(() => {
    pressed.current?.removeAttribute("data-opening");
    pressed.current = null;
    setLabel(null);
    setSlow(false);
  }, [pathname]);

  useEffect(() => {
    if (!label) return;
    const timer = setTimeout(() => setSlow(true), ACTIVITY_SLOW_MS);
    return () => clearTimeout(timer);
  }, [label, tapped]);

  return <div className="workspace-activity" role="status" aria-live="polite">
    {label && <p><span className="workspace-activity-spinner" aria-hidden="true" />{activityMessage(label, slow)}</p>}
  </div>;
}
