// Positive control: the same two hooks, plus a fixed payload the instrument must detect.
// session.created's event hook returns void in 1.19.3, so session-start injection uses experimental.chat.system.transform.
import { appendFileSync } from "node:fs";
const log = (e) => appendFileSync(process.env.HOOK_LOG, `${Date.now()} ${e}\n`);
const PAYLOAD = "NATIVE-MAIL-CONTROL: 1 unacknowledged message (control payload, not real mail).";
export const ControlProbe = async () => ({
  event: async ({ event }) => { if (event.type === "session.created") log("session.created"); },
  "experimental.chat.system.transform": async (_input, output) => { log("system.transform"); output.system.push(PAYLOAD); },
  "tool.execute.after": async (_input, output) => { log("tool.execute.after"); output.output += `\n${PAYLOAD}`; },
});
