/**
 * What a tap on a link is opening, in the operator's words, so the screen can say so at once
 * however slow the page is. Only links that navigate to another page count.
 */
const ROUTES: Array<[RegExp, string]> = [
  [/^\/workspace\/feed\/?$/, "what's waiting"],
  [/^\/workspace\/projects\/[^/]+\/plans\/[^/]+\/actions\/[^/]+\/?$/, "this Action"],
  [/^\/workspace\/projects\/[^/]+\/plans\/[^/]+\/?$/, "this Plan"],
  [/^\/workspace\/projects\/[^/]+\/?$/, "this Project"],
  [/^\/workspace\/?$/, "your portfolio"],
  [/^\/todo\/decision\//, "this Decision"],
  [/^\/todo\/agent_ask\//, "this request"],
  [/^\/todo(\/|$)/, "your to-do list"],
  [/^\/review(\/|$)/, "your Decisions"],
  [/^\/production(\/|$)/, "Production"],
  [/^\/actions(\/|$)/, "operator actions"],
  [/^\/now(\/|$)/, "Now"],
  [/^\/mission-control(\/|$)/, "Mission Control"],
  [/^\/journey(\/|$)/, "the Journey"],
  [/^\/$/, "the dashboard"]
];

export function activityLabel(pathname: string): string {
  return ROUTES.find(([route]) => route.test(pathname))?.[1] ?? "that page";
}

/** After this long, the screen also says the tap was received and the page is just slow. */
export const ACTIVITY_SLOW_MS = 8_000;

export function activityMessage(label: string, slow: boolean): string {
  return slow ? `Still opening ${label}. Your tap was received, and the page is slow.` : `Opening ${label}...`;
}

/** The address a click will navigate to, or null when it won't leave this page in this tab. */
export function navigationTarget(
  anchor: { href: string; target: string; hasAttribute(name: string): boolean },
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  here: { origin: string; pathname: string }
): string | null {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  let url: URL;
  try { url = new URL(anchor.href); } catch { return null; }
  if (url.origin !== here.origin || url.pathname === here.pathname) return null;
  return url.pathname;
}
