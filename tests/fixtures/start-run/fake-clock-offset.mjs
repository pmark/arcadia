// A clock a test can jump mid-run for the executor's `node -e` checks: the real time plus the offset in milliseconds held
// in $START_RUN_CLOCK_OFFSET_FILE, read on every call. Preloaded through NODE_OPTIONS only by the cases that ask for it;
// tests/fixtures/start-run/fake-arcadia.mjs writes the file when state.clockJump names the call it is answering.
import { readFileSync } from "node:fs";

const file = process.env.START_RUN_CLOCK_OFFSET_FILE;
const offset = () => { try { return Number(readFileSync(file, "utf8")) || 0; } catch { return 0; } };
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(RealDate.now() + offset());
  }
  static now() {
    return RealDate.now() + offset();
  }
};
