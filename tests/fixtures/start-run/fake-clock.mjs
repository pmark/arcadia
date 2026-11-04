// A clock the test controls for the executor's `node -e` checks, preloaded through NODE_OPTIONS only by the cases that ask
// for it (`clockEnv` in tests/start-run-executor.test.ts). The shell's own `date` and Git's timestamps are not affected.
const now = Date.parse(process.env.START_RUN_FAKE_NOW ?? "");
if (!Number.isFinite(now)) throw new Error("fake-clock.mjs needs START_RUN_FAKE_NOW to be a parseable time");

globalThis.Date = class extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super(now);
  }
  static now() {
    return now;
  }
};
