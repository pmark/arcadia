/**
 * Deep links from Discord into the dashboard's /todo. The scheme is
 * `${dashboardUrl}/todo/<kind>/<project>/<id>` for one item and
 * `${dashboardUrl}/todo` for the list. With no dashboard URL configured there
 * is nowhere to link, so every helper returns null and callers omit the line.
 */

export interface TodoRef {
  kind: string;
  project: string;
  id: string;
}

function base(dashboardUrl: string | undefined | null): string | null {
  const trimmed = dashboardUrl?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

export function todoListUrl(dashboardUrl: string | undefined | null): string | null {
  const root = base(dashboardUrl);
  return root ? `${root}/todo` : null;
}

export function todoItemUrl(dashboardUrl: string | undefined | null, ref: TodoRef): string | null {
  const root = base(dashboardUrl);
  if (!root || !ref.kind || !ref.project || !ref.id) return null;
  return `${root}/todo/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.project)}/${encodeURIComponent(ref.id)}`;
}

/** Parse `<kind>:<project>/<id>` (kind may be `escalation:<sub>`), the key `arcadia todo` prints. */
export function parseTodoKey(key: string | undefined | null): TodoRef | null {
  const value = key?.trim();
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash < 0) return null;
  const head = value.slice(0, slash);
  const colon = head.lastIndexOf(":");
  if (colon <= 0) return null;
  return { kind: head.slice(0, colon), project: head.slice(colon + 1), id: value.slice(slash + 1) };
}

export function todoKeyUrl(dashboardUrl: string | undefined | null, key: string | undefined | null): string | null {
  const ref = parseTodoKey(key);
  return ref ? todoItemUrl(dashboardUrl, ref) : null;
}
