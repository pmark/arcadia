/**
 * The Production deep link `/production?launch=<project>/<actionId>`: it only
 * opens the Launch dialog for one Action. Opening starts nothing; the operator
 * still confirms the preview inside the dialog (see launch-flow.ts).
 */
import type { ConsoleAction } from "./production-console";

export const LAUNCH_PARAM = "launch";

/** The Action key the link names, `<project>/<actionId>`; null when absent or malformed. */
export function parseLaunchParam(search: string): string | null {
  const raw = new URLSearchParams(search).get(LAUNCH_PARAM)?.trim();
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) return null;
  return raw;
}

/** The link for an Action key (the work queue's `<project>/<actionId>`). */
export function launchHrefOf(actionKey: string): string {
  return `/production?${LAUNCH_PARAM}=${encodeURIComponent(actionKey).replace(/%2F/gi, "/")}`;
}

export type LaunchLinkResolution =
  | { kind: "open"; action: ConsoleAction }
  | { kind: "unavailable"; message: string };

/** Open the dialog only for a launchable Action; otherwise say why it cannot be launched now. */
export function resolveLaunchLink(actions: ConsoleAction[], key: string): LaunchLinkResolution {
  const action = actions.find((candidate) => candidate.key === key);
  if (!action) {
    return { kind: "unavailable", message: `${key} is not in the work queue now, so there is nothing to launch. It may be done, or not yet approved.` };
  }
  if (!action.launch.allowed) {
    return {
      kind: "unavailable",
      message: `${action.title} cannot be launched now: ${action.launch.disabledReason ?? action.why ?? "it is not ready."}`
    };
  }
  return { kind: "open", action };
}

export type LaunchLinkDecision =
  | { kind: "idle" }
  | { kind: "open"; action: ConsoleAction }
  | { kind: "warn"; message: string }
  /** The queue copy may be the server's short-cached one: read a fresh queue before giving a negative verdict. */
  | { kind: "refresh" };

/**
 * What the Queue should do about a deep link now. A key is handled (once-only)
 * when the dialog opens, or when a negative verdict comes from a fresh read; a
 * negative verdict from a possibly cached read asks for a fresh one instead, so
 * a just-created Action is never falsely reported.
 */
export function decideLaunchLink(input: {
  key: string | null;
  handledKey: string | null;
  actions: ConsoleAction[] | null;
  queueFresh: boolean;
  askedFresh: boolean;
}): LaunchLinkDecision {
  if (!input.key || input.handledKey === input.key || !input.actions) return { kind: "idle" };
  const resolution = resolveLaunchLink(input.actions, input.key);
  if (resolution.kind === "open") return resolution;
  if (!input.queueFresh) return input.askedFresh ? { kind: "idle" } : { kind: "refresh" };
  return { kind: "warn", message: resolution.message };
}
