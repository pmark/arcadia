import type { ArcadiaCli } from "../arcadia/cli.js";
import type { ReplyHandler } from "../replyRouter/router.js";

/**
 * The orientation feature's ReplyHandler for the shared Discord Reply Router.
 * Delegates the actual interpretation (one Intelligence call) and ledger
 * writes to the CLI — this bot process never touches the DB directly.
 */
export function buildOrientationReplyHandler(cli: ArcadiaCli): ReplyHandler {
  return async (reply) => {
    const response = await cli.orientationReply(reply.text, "discord");

    if (response.ok) {
      return { kind: "applied", note: response.data.echo };
    }

    switch (response.error.code) {
      case "ORIENTATION_REPLY_AMBIGUOUS":
        return { kind: "clarify", question: response.error.message };
      case "ORIENTATION_REPLY_UNPARSEABLE":
        return { kind: "clarify", question: "Couldn't parse that — could you rephrase?" };
      case "ORIENTATION_INTERPRETER_UNAVAILABLE":
        return { kind: "rejected", reason: "Can't reach the local model right now — try again shortly." };
      case "ORIENTATION_ENTRY_NOT_FOUND":
        return { kind: "rejected", reason: response.error.message };
      default:
        return { kind: "rejected", reason: response.error.message };
    }
  };
}
