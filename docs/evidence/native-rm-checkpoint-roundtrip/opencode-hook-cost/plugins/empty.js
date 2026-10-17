// Empty-inbox branch stand-in: observe session.created and tool.execute.after, log that they fired, add nothing.
import { appendFileSync } from "node:fs";
const log = (e) => appendFileSync(process.env.HOOK_LOG, `${Date.now()} ${e}\n`);
export const EmptyProbe = async () => ({
  event: async ({ event }) => { if (event.type === "session.created") log("session.created"); },
  "tool.execute.after": async () => { log("tool.execute.after"); },
});
